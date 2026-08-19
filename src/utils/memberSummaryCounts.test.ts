import assert from 'node:assert/strict';
import test from 'node:test';
import { getActiveMemberSummaryCounts } from './memberSummaryCounts.ts';

test('archived members are excluded from All and every role total', () => {
  const counts = getActiveMemberSummaryCounts([
    { role: 'admin', roles: ['admin'], isActive: true },
    { role: 'pilot', roles: ['pilot', 'student'], isActive: true },
    { role: 'instructor', roles: ['instructor', 'pilot'], isActive: false },
    { role: 'student', roles: ['student'], isActive: false },
  ]);

  assert.deepEqual(counts, {
    active: 2,
    archived: 2,
    total: 2,
    roles: { admin: 1, instructor: 0, pilot: 1, student: 1 },
  });
});

test('members without an explicit active flag remain active for legacy compatibility', () => {
  assert.equal(getActiveMemberSummaryCounts([
    { role: 'student' },
    { role: 'student', isActive: false },
  ]).total, 1);
});
