import assert from 'node:assert/strict';
import test from 'node:test';
import { getMemberBillingState } from './memberBillingState.ts';

test('shows billing values only when Xero and the member contact are linked', () => {
  assert.equal(
    getMemberBillingState({ xeroConnected: true, memberLinked: true }),
    'linked'
  );
});

test('requires account setup when the club has Xero but the member has no linked contact', () => {
  assert.equal(
    getMemberBillingState({ xeroConnected: true, memberLinked: false }),
    'setup-required'
  );
});

test('distinguishes an unavailable Xero connection from a missing member link', () => {
  assert.equal(
    getMemberBillingState({ xeroConnected: false, memberLinked: false }),
    'temporarily-unavailable'
  );
  assert.equal(
    getMemberBillingState({ xeroConnected: null, memberLinked: false }),
    'temporarily-unavailable'
  );
});
