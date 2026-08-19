import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookingFieldAppliesToRole,
  getEffectiveBookingFieldRoles,
} from './bookingFieldAccess.ts';

test('senior instructors inherit instructor booking fields', () => {
  assert.deepEqual(
    getEffectiveBookingFieldRoles('senior_instructor'),
    ['senior_instructor', 'instructor'],
  );
  assert.equal(bookingFieldAppliesToRole(['instructor'], 'senior_instructor'), true);
});

test('CFIs inherit senior-instructor and instructor booking fields', () => {
  assert.deepEqual(
    getEffectiveBookingFieldRoles('cfi'),
    ['cfi', 'senior_instructor', 'instructor'],
  );
  assert.equal(bookingFieldAppliesToRole(['instructor'], 'cfi'), true);
  assert.equal(bookingFieldAppliesToRole(['senior_instructor'], 'cfi'), true);
});

test('ordinary roles only receive fields configured for that role', () => {
  assert.equal(bookingFieldAppliesToRole(['student'], 'pilot'), false);
  assert.equal(bookingFieldAppliesToRole(['pilot'], 'pilot'), true);
  assert.equal(bookingFieldAppliesToRole(['ADMIN'], ' admin '), true);
  assert.equal(bookingFieldAppliesToRole([], 'instructor'), false);
});
