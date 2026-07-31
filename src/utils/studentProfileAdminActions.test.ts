import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowXeroContactEditor } from './studentProfileAdminActions.ts';

test('shows Xero contact editing only to admins while Xero is confirmed connected', () => {
  assert.equal(shouldShowXeroContactEditor({
    isAdmin: true,
    providerLoading: false,
    xeroConnected: true,
  }), true);

  assert.equal(shouldShowXeroContactEditor({
    isAdmin: true,
    providerLoading: false,
    xeroConnected: false,
  }), false);

  assert.equal(shouldShowXeroContactEditor({
    isAdmin: true,
    providerLoading: true,
    xeroConnected: true,
  }), false);

  assert.equal(shouldShowXeroContactEditor({
    isAdmin: false,
    providerLoading: false,
    xeroConnected: true,
  }), false);
});
