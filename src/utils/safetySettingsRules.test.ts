import assert from 'node:assert/strict';
import test from 'node:test';
import { getSafetySettingsValidationError } from './safetySettingsRules.ts';

const valid: Parameters<typeof getSafetySettingsValidationError>[0] = {
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
  recencyWarningMessage: 'Review your recency before solo flight.',
  safetyLoginWarningMessage: 'Review your safety records.',
  safetyLoginWarningTitle: 'Safety items need attention',
  recencyNoFlightMessage: 'No recent flight was found.',
  recencyLastFlightMessage: 'The last flight was {days} days ago.',
  flightReviewEndorsementTypes: [],
};

test('a complete safety configuration is internally valid', () => {
  assert.equal(getSafetySettingsValidationError(valid), null);
});

test('rejects empty numeric fields and blank operational messages', () => {
  assert.match(getSafetySettingsValidationError({ ...valid, recencyDays: Number.NaN }) || '', /Recency period/);
  assert.match(getSafetySettingsValidationError({ ...valid, recencyWarningMessage: ' ' }) || '', /cannot be empty/);
});
