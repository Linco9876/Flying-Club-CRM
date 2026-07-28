import test from 'node:test';
import assert from 'node:assert/strict';
import {
  membershipProductCodeIsValid,
  membershipProductsAreValid,
  positiveIntegerList,
  scholarshipSettingsAreValid,
  statutoryRegisterCsv,
} from './membershipSettings.ts';

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

test('membership products require stable unique codes but may share accounting configuration elsewhere', () => {
  assert.equal(membershipProductCodeIsValid('social-member'), true);
  assert.equal(membershipProductCodeIsValid('Not valid'), false);
  assert.equal(membershipProductsAreValid([
    { code: 'full', name: 'Full', annualFee: 150 },
    { code: 'affiliate', name: 'Affiliate', annualFee: 45 },
  ]), true);
  assert.equal(membershipProductsAreValid([
    { code: 'full', name: 'Full', annualFee: 150 },
    { code: 'FULL', name: 'Another full', annualFee: 100 },
  ]), false);
});

test('scholarship suggestions cannot fall below the configured minimum', () => {
  assert.equal(scholarshipSettingsAreValid({ defaultAmount: 5, minimumAmount: 1 }), true);
  assert.equal(scholarshipSettingsAreValid({ defaultAmount: 0.5, minimumAmount: 1 }), false);
  assert.equal(scholarshipSettingsAreValid({ defaultAmount: 5, minimumAmount: 0 }), false);
});
