import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  getTrainingRecordReassignmentCandidates,
  matchesTrainingRecordReassignmentSearch,
  type TrainingRecordReassignmentFlight,
} from './trainingRecordReassignment.ts';

const flight = (
  id: string,
  overrides: Partial<TrainingRecordReassignmentFlight> = {},
): TrainingRecordReassignmentFlight => ({
  id,
  bookingId: `booking-${id}`,
  instructorId: 'instructor-1',
  startTime: '2026-08-15T01:00:00.000Z',
  endTime: '2026-08-15T02:30:00.000Z',
  dualTime: 1.1,
  soloTime: 0,
  trainingRecordStatus: 'pending',
  registration: '24-5420',
  instructorName: 'Alex Instructor',
  bookingNotes: 'Effects of controls',
  ...overrides,
});

test('reassignment offers only unoccupied outstanding flights for the same instructor', () => {
  const result = getTrainingRecordReassignmentCandidates({
    flights: [
      flight('source'),
      flight('available'),
      flight('recorded', { trainingRecordStatus: 'recorded' }),
      flight('other-instructor', { instructorId: 'instructor-2' }),
      flight('occupied-flight'),
      flight('occupied-booking', { bookingId: 'shared-booking' }),
    ],
    links: [
      { trainingRecordId: 'record-1', flightLogId: 'source', bookingId: 'booking-source' },
      { trainingRecordId: 'record-2', flightLogId: 'occupied-flight' },
      { trainingRecordId: 'record-3', bookingId: 'shared-booking' },
    ],
    sourceFlightLogId: 'source',
    sourceTrainingRecordId: 'record-1',
    currentUserId: 'instructor-1',
    canManageAnyInstructor: false,
  });

  assert.deepEqual(result.map(item => item.id), ['available']);
});

test('CFI and admin recovery can target another instructors unoccupied flight', () => {
  const result = getTrainingRecordReassignmentCandidates({
    flights: [flight('target', { instructorId: 'instructor-2' })],
    links: [],
    sourceFlightLogId: 'source',
    sourceTrainingRecordId: 'record-1',
    currentUserId: 'cfi-1',
    canManageAnyInstructor: true,
  });

  assert.deepEqual(result.map(item => item.id), ['target']);
});

test('flight search covers the date, aircraft, instructor and booking notes', () => {
  const candidate = flight('target');
  assert.equal(matchesTrainingRecordReassignmentSearch(candidate, '5420'), true);
  assert.equal(matchesTrainingRecordReassignmentSearch(candidate, 'alex'), true);
  assert.equal(matchesTrainingRecordReassignmentSearch(candidate, 'effects'), true);
  assert.equal(matchesTrainingRecordReassignmentSearch(candidate, '15/08/2026'), true);
  assert.equal(matchesTrainingRecordReassignmentSearch(candidate, 'missing'), false);
});

test('database reassignment is atomic, same-student only and preserves an audit trail', () => {
  const migration = readFileSync(
    'supabase/migrations/20260902100000_reassign_training_record_flight.sql',
    'utf8',
  );

  assert.match(migration, /target_log\.student_id is distinct from v_record\.student_id/i);
  assert.match(migration, /target_log\.training_record_status not in \('pending', 'dismissed'\)/i);
  assert.match(migration, /flight_log_id = p_target_flight_log_id/i);
  assert.match(migration, /booking_id = v_target_log\.booking_id/i);
  assert.match(migration, /training_record_status = 'pending'/i);
  assert.match(migration, /training_record_status = 'recorded'/i);
  assert.match(migration, /flight_log_reassigned/i);
  assert.match(migration, /operations_audit_events/i);
  assert.match(migration, /superseded_at = clock_timestamp\(\)/i);
  assert.match(migration, /unique index[\s\S]+training_records\(flight_log_id\)/i);
  assert.match(migration, /unique index[\s\S]+training_records\(booking_id\)/i);
});
