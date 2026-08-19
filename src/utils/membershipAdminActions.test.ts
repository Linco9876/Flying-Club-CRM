import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableMembershipStatusChanges,
  membershipLegalStatusOptions,
  membershipStatusActionLabel,
  membershipStatusChangeNeedsClass,
  membershipStatusReasonIsValid,
} from './membershipAdminActions.ts';

test('offers every legal membership status except the current value', () => {
  const options = availableMembershipStatusChanges('current');
  assert.equal(options.some(option => option.value === 'current'), false);
  assert.deepEqual(
    options.map(option => option.value),
    ['resigned', 'ceased_non_payment', 'expelled', 'deceased'],
  );
  assert.equal(new Set(membershipLegalStatusOptions.map(option => option.value)).size, 5);
});

test('restoration requires an eligible class but ending a membership does not', () => {
  assert.equal(membershipStatusChangeNeedsClass('resigned', 'current'), true);
  assert.equal(membershipStatusChangeNeedsClass('current', 'resigned'), false);
  assert.equal(membershipStatusActionLabel('current'), 'Restore membership');
  assert.equal(membershipStatusActionLabel('ceased_non_payment'), 'End membership');
});

test('requires an audit-worthy reason for a legal-status change', () => {
  assert.equal(membershipStatusReasonIsValid('too short'), false);
  assert.equal(membershipStatusReasonIsValid('Committee decision 18 August 2026'), true);
});
