import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isExistingAccountSignupError, requestPendingAccountSetup } from './pendingAccountSetup.ts';

const inviteFunction = readFileSync(
  new URL('../../supabase/functions/invite-user/index.ts', import.meta.url),
  'utf8',
);
const pendingAccountMigration = readFileSync(
  new URL('../../supabase/migrations/20260804030000_add_pending_portal_account_claims.sql', import.meta.url),
  'utf8',
);

test('recognises only signup errors that indicate an existing identity', () => {
  assert.equal(isExistingAccountSignupError({ code: 'user_already_exists' }), true);
  assert.equal(isExistingAccountSignupError({ code: 'email_exists' }), true);
  assert.equal(isExistingAccountSignupError({ message: 'User already registered' }), true);
  assert.equal(isExistingAccountSignupError({ code: 'captcha_failed', message: 'Captcha failed' }), false);
  assert.equal(isExistingAccountSignupError({ code: 'weak_password', message: 'Password is too weak' }), false);
  assert.equal(isExistingAccountSignupError(new Error('Network request failed')), false);
});

test('submits a normalised, enumeration-safe claim request through the public Edge Function', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify({ accepted: true }), { status: 200 });
  }) as typeof fetch;

  try {
    await requestPendingAccountSetup({
      email: '  Pilot@Example.COM ',
      redirectTo: 'https://portal.example.com/reset-password',
      supabaseUrl: 'https://project.supabase.co/',
      supabaseKey: 'public-anon-key',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(capturedUrl, 'https://project.supabase.co/functions/v1/invite-user');
  assert.equal(new Headers(capturedInit?.headers).get('Apikey'), 'public-anon-key');
  assert.equal(new Headers(capturedInit?.headers).get('Authorization'), 'Bearer public-anon-key');
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    action: 'request_pending_account_setup',
    email: 'pilot@example.com',
    redirectTo: 'https://portal.example.com/reset-password',
  });
});

test('retries a transient claim request without changing its payload', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, { status: calls === 1 ? 503 : 200 });
  }) as typeof fetch;

  try {
    await requestPendingAccountSetup({
      email: 'pilot@example.com',
      redirectTo: 'https://portal.example.com/reset-password',
      supabaseUrl: 'https://project.supabase.co',
      supabaseKey: 'public-anon-key',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 2);
});

test('server handles account claims before authentication without disclosing lookup results', () => {
  const publicAction = inviteFunction.indexOf('body.action === "request_pending_account_setup"');
  const authentication = inviteFunction.indexOf('const authHeader = req.headers.get("Authorization")');
  assert.ok(publicAction >= 0 && publicAction < authentication);
  assert.match(inviteFunction, /EdgeRuntime\.waitUntil\(claimTask\)/);
  assert.match(inviteFunction, /return jsonResponse\(pendingAccountClaimResponse\(\)\)/);
  assert.match(inviteFunction, /resolvePendingAccountRedirect/);
  assert.match(inviteFunction, /\.eq\("email", email\)/);
});

test('silent provisioning creates an unconfirmed Auth identity and server-only claim state', () => {
  assert.match(inviteFunction, /auth\.admin\s*\.createUser\(\{/);
  assert.match(inviteFunction, /email_confirm: false/);
  assert.match(inviteFunction, /accountCreatedWithoutInvite: true/);
  assert.match(pendingAccountMigration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(pendingAccountMigration, /REVOKE ALL ON TABLE public\.pending_portal_accounts FROM anon/i);
  assert.match(pendingAccountMigration, /REVOKE ALL ON TABLE public\.pending_portal_accounts FROM authenticated/i);
  assert.doesNotMatch(pendingAccountMigration, /GRANT .* TO (?:anon|authenticated)/i);
});
