import assert from 'node:assert/strict';
import test from 'node:test';

import { canCreatePortalUsers, portalRolesUserMayCreate } from './portalUserCreation.ts';

test('admins retain all existing user-creation choices', () => {
  assert.deepEqual(
    portalRolesUserMayCreate(['admin']),
    ['student', 'pilot', 'instructor', 'admin'],
  );
});

test('instructor-grade users can create only Student or Pilot users', () => {
  for (const role of ['instructor', 'senior_instructor', 'cfi'] as const) {
    assert.deepEqual(portalRolesUserMayCreate([role]), ['student', 'pilot']);
    assert.equal(canCreatePortalUsers([role]), true);
  }
});

test('pilots and students cannot create portal users', () => {
  assert.deepEqual(portalRolesUserMayCreate(['pilot']), []);
  assert.deepEqual(portalRolesUserMayCreate(['student']), []);
  assert.equal(canCreatePortalUsers(['pilot']), false);
});
