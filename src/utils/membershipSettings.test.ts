import test from 'node:test';
import assert from 'node:assert/strict';
import { positiveIntegerList, statutoryRegisterCsv } from './membershipSettings.ts';

test('membership schedule parsing keeps unique positive days', () => {
  assert.deepEqual(positiveIntegerList('30, 7, 7, -1, later', [1]), [30, 7]);
  assert.deepEqual(positiveIntegerList('', [3, 7]), [3, 7]);
});

test('statutory register CSV safely quotes values and omits unavailable details', () => {
  const csv = statutoryRegisterCsv([{
    name: 'Example, Member',
    residential_address: null,
    membership_class: null,
    commenced_at: null,
    ceased_at: '2026-07-28T00:00:00Z',
    legal_status: 'resigned',
  }]);
  assert.match(csv, /"Example, Member",,,,2026-07-28,resigned/);
  assert.doesNotMatch(csv, /undefined|null/);
});
