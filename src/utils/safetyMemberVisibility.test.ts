import assert from 'node:assert/strict';
import test from 'node:test';
import { filterActiveSafetyMembers, isActiveSafetyMember } from './safetyMemberVisibility.ts';

test('archived users are excluded from safety participant lists', () => {
  const members = [
    { id: 'active', isActive: true },
    { id: 'legacy-active' },
    { id: 'archived', isActive: false },
  ];

  assert.deepEqual(filterActiveSafetyMembers(members).map(member => member.id), [
    'active',
    'legacy-active',
  ]);
});

test('only an explicit inactive flag archives a safety member', () => {
  assert.equal(isActiveSafetyMember({ isActive: false }), false);
  assert.equal(isActiveSafetyMember({ isActive: true }), true);
  assert.equal(isActiveSafetyMember({}), true);
});
