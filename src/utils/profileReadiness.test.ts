import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDatedReadinessStatus,
  getMembershipIdentityLabel,
  getOverallReadiness,
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

test('a current legal membership never appears unestablished when its class label is unavailable', () => {
  assert.equal(
    getMembershipIdentityLabel({
      legalStatus: 'current',
      membershipClassName: null,
      hasVotingRights: false,
    }),
    'Current BFC membership · Non-voting member',
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
      hasVotingRights: false,
    }),
    'BFC membership not established',
  );
});
