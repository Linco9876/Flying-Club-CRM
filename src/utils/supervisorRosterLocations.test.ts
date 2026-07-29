import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSupervisorLocationValidationError,
  toggleSupervisorLocation,
} from './supervisorRosterLocations.ts';

test('adds and removes a supervision location without disturbing the others', () => {
  assert.deepEqual(toggleSupervisorLocation(['bendigo'], 'echuca'), ['bendigo', 'echuca']);
  assert.deepEqual(toggleSupervisorLocation(['bendigo', 'echuca'], 'bendigo'), ['echuca']);
});

test('requires coverage on every working day for an authorised supervisor', () => {
  assert.equal(
    getSupervisorLocationValidationError({
      isAuthorisedSupervisor: true,
      isAvailable: true,
      supervisionLocationIds: [],
      dayLabel: 'Monday',
    }),
    'Monday: choose at least one supervision location',
  );
});

test('does not require supervisor coverage for non-working days or other instructors', () => {
  assert.equal(
    getSupervisorLocationValidationError({
      isAuthorisedSupervisor: true,
      isAvailable: false,
      supervisionLocationIds: [],
      dayLabel: 'Monday',
    }),
    null,
  );
  assert.equal(
    getSupervisorLocationValidationError({
      isAuthorisedSupervisor: false,
      isAvailable: true,
      supervisionLocationIds: [],
      dayLabel: 'Monday',
    }),
    null,
  );
});
