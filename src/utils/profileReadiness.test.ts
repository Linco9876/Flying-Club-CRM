import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDatedReadinessStatus,
  getMembershipIdentityLabel,
  getOverallReadiness,
  getProfileReadinessDestination,
  isSelfDeclaredMedical,
  requiresFlightReview,
  shouldShowMembershipAmountDue,
  usesRaausCredentials,
} from './profileReadiness.ts';

const now = new Date('2026-07-27T10:00:00+10:00');

test('classifies current, due-soon, expired and missing credentials', () => {
  assert.equal(getDatedReadinessStatus(new Date('2027-01-01'), now).level, 'ready');
  assert.equal(getDatedReadinessStatus(new Date('2026-08-15'), now).level, 'warning');
  assert.equal(getDatedReadinessStatus(new Date('2026-07-26'), now).level, 'action');
  assert.equal(getDatedReadinessStatus(undefined, now).level, 'warning');
});

test('uses the most urgent item for the overall readiness state', () => {
  assert.equal(getOverallReadiness(['ready', 'warning']).level, 'warning');
  assert.equal(getOverallReadiness(['ready', 'action', 'warning']).level, 'action');
  assert.equal(getOverallReadiness(['ready', 'ready']).level, 'ready');
});

test('only applies RAAus readiness to members with an RAAus identity or licence', () => {
  assert.equal(usesRaausCredentials({ raausId: '123456', licences: [] }), true);
  assert.equal(usesRaausCredentials({
    licences: [{ type: 'RAAus Pilot Certificate', issuingAuthority: null }],
  }), true);
  assert.equal(usesRaausCredentials({
    licences: [{ type: 'CASA Private Pilot Licence (PPL)', issuingAuthority: 'CASA' }],
  }), false);
});

test('recognises self-declared medicals without demanding an expiry date', () => {
  assert.equal(isSelfDeclaredMedical('RAAus Medical Declaration'), true);
  assert.equal(isSelfDeclaredMedical('Self-declared medical'), true);
  assert.equal(isSelfDeclaredMedical('Class 2 medical'), false);
});

test('requires a flight review for qualified flying roles but not students or administrators alone', () => {
  assert.equal(requiresFlightReview(['student']), false);
  assert.equal(requiresFlightReview(['admin']), false);
  assert.equal(requiresFlightReview(['student', 'pilot']), true);
  assert.equal(requiresFlightReview(['instructor']), true);
});

test('does not describe the annual membership fee as due after financial clearance', () => {
  assert.equal(shouldShowMembershipAmountDue({ amountDue: 144.32, financiallyCleared: true }), false);
  assert.equal(shouldShowMembershipAmountDue({ amountDue: 144.32, financiallyCleared: false }), true);
  assert.equal(shouldShowMembershipAmountDue({ amountDue: 0, financiallyCleared: false }), false);
});

test('readiness destinations open the exact settings section or pilot-file tab', () => {
  assert.equal(
    getProfileReadinessDestination('raaus'),
    '/settings?tab=account-info&focus=aviation-credentials',
  );
  assert.equal(
    getProfileReadinessDestination('medical'),
    '/settings?tab=account-info&focus=aviation-credentials',
  );
  assert.equal(
    getProfileReadinessDestination('flight-review'),
    '/pilot-file?subtab=reviews',
  );
  assert.equal(
    getProfileReadinessDestination('profile', ['phone', 'address']),
    '/settings?tab=account-info&focus=contact-details',
  );
  assert.equal(
    getProfileReadinessDestination('profile', ['emergency contact']),
    '/settings?tab=account-info&focus=emergency-contact',
  );
});

test('a current legal membership never appears unestablished when its class label is unavailable', () => {
  assert.equal(
    getMembershipIdentityLabel({
      legalStatus: 'current',
      membershipClassName: null,
      hasVotingRights: null,
    }),
    'Current BFC membership',
  );
  assert.equal(
    getMembershipIdentityLabel({
      legalStatus: 'current',
      membershipClassName: 'Full',
      hasVotingRights: true,
    }),
    'Full · Voting member',
  );
  assert.equal(
    getMembershipIdentityLabel({
      legalStatus: null,
      membershipClassName: null,
      hasVotingRights: null,
    }),
    'BFC membership not established',
  );
});
