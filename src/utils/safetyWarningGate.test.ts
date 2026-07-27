import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldOpenSafetyWarning } from './safetyWarningGate.ts';

const completeWarning = {
  userId: 'pilot-1',
  dataReady: true,
  dismissed: false,
  concernCount: 1,
};

test('does not open a recency warning while flight and profile data are loading', () => {
  assert.equal(shouldOpenSafetyWarning({
    ...completeWarning,
    dataReady: false,
  }), false);
});

test('opens a warning only after complete data contains a concern', () => {
  assert.equal(shouldOpenSafetyWarning(completeWarning), true);
});

test('does not reopen an acknowledged warning during the session', () => {
  assert.equal(shouldOpenSafetyWarning({
    ...completeWarning,
    dismissed: true,
  }), false);
});

test('does not replace a warning already displayed for the current user', () => {
  assert.equal(shouldOpenSafetyWarning({
    ...completeWarning,
    displayedUserId: 'pilot-1',
  }), false);
});
