import assert from 'node:assert/strict';
import test from 'node:test';
import type { SafetyComplianceSettings } from '../hooks/useSafetySettings.ts';
import type { Student } from '../types/index.ts';
import { buildSafetyComplianceSummary, getLastCurrencyFlightDate, getPilotInCommandHours } from './safetyCompliance.ts';
import {
  bfrLapseSeverity,
  credentialLapseSeverity,
} from './safetyComplianceRules.ts';

const safetySettings: SafetyComplianceSettings = {
  recencyDays: 90,
  medicalWarningDays: 60,
  licenceWarningDays: 60,
  bfrWarningDays: 60,
  instructorSopCheckMonths: 3,
  seniorInstructorSopCheckMonths: 12,
  defaultSafetyOfficer: 'Safety Officer',
  autoAssignIncidents: true,
  autoBlockExpiredMedical: true,
  autoBlockExpiredLicence: true,
  requireBfrForSolo: true,
  recencyWarningMessage: 'Review recency before solo flight.',
  safetyLoginWarningMessage: 'Review safety items.',
  safetyLoginWarningTitle: 'Safety items need attention',
  recencyNoFlightMessage: 'No recent logged flight was found for {subject}.',
  recencyLastFlightMessage: '{possessive} last logged flight was {days} days ago.',
  flightReviewEndorsementTypes: [],
};

const pilot: Student = {
  id: 'pilot-1',
  email: 'pilot@example.com',
  name: 'Test Pilot',
  role: 'pilot',
  roles: ['pilot'],
  endorsements: [],
  licences: [],
};

test('expired credential blocking follows the configured switch', () => {
  assert.equal(credentialLapseSeverity(true), 'blocked');
  assert.equal(credentialLapseSeverity(false), 'lapsed');
});

test('a lapsed BFR blocks only solo bookings when the rule is enabled', () => {
  assert.equal(bfrLapseSeverity(true, false), 'blocked');
  assert.equal(bfrLapseSeverity(true, true), 'lapsed');
  assert.equal(bfrLapseSeverity(false, false), 'lapsed');
});

test('pilot recency applies to solo hire but not a booking with an instructor', () => {
  const soloSummary = buildSafetyComplianceSummary(pilot, safetySettings, []);
  const instructionalSummary = buildSafetyComplianceSummary(pilot, safetySettings, [], { hasInstructor: true });

  assert.equal(soloSummary.concerns.some((concern) => concern.type === 'recency'), true);
  assert.equal(instructionalSummary.concerns.some((concern) => concern.type === 'recency'), false);
});

test('an instructor suppresses only solo recency and not other safety checks', () => {
  const summary = buildSafetyComplianceSummary({
    ...pilot,
    medicalExpiry: new Date('2000-01-01T00:00:00Z'),
  }, safetySettings, [], { hasInstructor: true });

  assert.deepEqual(summary.concerns.map((concern) => concern.type), ['medical']);
  assert.equal(summary.blockingConcerns[0]?.type, 'medical');
});

test('external baselines and post-baseline flights contribute to PIC without double-counting', () => {
  const logs = [
    { student_id: pilot.id, instructor_id: null, start_time: '2026-01-01T10:00:00Z', solo_time: 2, dual_time: 0, flight_duration: 2 },
    { student_id: pilot.id, instructor_id: null, start_time: '2026-07-02T10:00:00Z', solo_time: 1, dual_time: 0, flight_duration: 1 },
  ];
  const supplement = {
    baselines: [{ user_id: pilot.id, as_of_date: '2026-06-30', last_flight_date: '2026-06-20', pic_hours: 55 }],
    externalEntries: [
      { user_id: pilot.id, flight_date: '2026-06-01', pic_hours: 4 },
      { user_id: pilot.id, flight_date: '2026-07-03', pic_hours: 1.5 },
    ],
  };

  assert.equal(getPilotInCommandHours(pilot.id, logs, supplement), 57.5);
  assert.equal(getLastCurrencyFlightDate(pilot.id, logs, supplement)?.toLocaleDateString('en-CA'), '2026-07-03');
});

test('an as-of date does not establish recency without an actual last-flight date', () => {
  assert.equal(getLastCurrencyFlightDate(pilot.id, [], {
    baselines: [{ user_id: pilot.id, as_of_date: '2026-08-01', last_flight_date: null, pic_hours: 55 }],
  }), null);
});
