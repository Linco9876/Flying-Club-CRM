import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nearestDutyStartLocation,
  readableDutyDistance,
  validateDutyStart,
  type DutyStartValidationInput,
} from './dutyStart.ts';

const now = new Date('2026-07-30T10:00:00+10:00');
const validInput: DutyStartValidationInput = {
  actualStart: new Date('2026-07-30T09:30:00+10:00'),
  now,
  maximumBackdateMinutes: 120,
  locationLabel: 'Bendigo Airport',
  geo: { insideGeofence: true, label: 'Bendigo Airport' },
  geofenceNotes: '',
  fitForDuty: true,
  externalDutyDeclared: true,
  sleepOpportunityConfirmed: true,
  kssScore: 3,
  privateNote: '',
};

test('finds the nearest configured duty location and formats distance', () => {
  const nearest = nearestDutyStartLocation(-36.7392, 144.3297, [
    { id: 'bendigo', name: 'Bendigo Airport', latitude: -36.7391667, longitude: 144.3297222, radiusMetres: 1200 },
    { id: 'other', name: 'Other Airport', latitude: -37.8, longitude: 144.9, radiusMetres: 1000 },
  ]);

  assert.equal(nearest.location.id, 'bendigo');
  assert.ok(nearest.distance < 10);
  assert.equal(readableDutyDistance(934), '934 m');
  assert.equal(readableDutyDistance(1540), '1.5 km');
});

test('accepts a normal in-geofence start declaration', () => {
  assert.equal(validateDutyStart(validInput), null);
});

test('enforces the same start, declaration, off-site and fatigue rules as the Duty Clock', () => {
  assert.match(validateDutyStart({ ...validInput, actualStart: new Date('2026-07-30T07:00:00+10:00') }) || '', /last 2 hours/);
  assert.match(validateDutyStart({ ...validInput, fitForDuty: false }) || '', /cannot start duty/);
  assert.match(validateDutyStart({ ...validInput, externalDutyDeclared: false }) || '', /external duty/);
  assert.match(validateDutyStart({
    ...validInput,
    geo: { insideGeofence: false, label: 'Off-site' },
    locationLabel: 'Off-site',
    geofenceNotes: 'short',
  }) || '', /at least 10 characters/);
  assert.match(validateDutyStart({
    ...validInput,
    sleepOpportunityConfirmed: false,
    privateNote: 'short',
  }) || '', /fatigue risk/);
  assert.match(validateDutyStart({
    ...validInput,
    kssScore: 7,
    privateNote: 'short',
  }) || '', /fatigue risk/);
});
