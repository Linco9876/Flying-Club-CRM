import assert from 'node:assert/strict';
import test from 'node:test';
import { getInvitationActionLink, getPasswordSetupMode } from './invitationSetup.ts';

const supabaseUrl = 'https://example-project.supabase.co';

test('accepts an invite or recovery action hosted by the configured Supabase project', () => {
  const actionLink =
    `${supabaseUrl}/auth/v1/verify?token=secret&type=invite&redirect_to=https%3A%2F%2Fportal.example.com%2Freset-password`;
  const hash = `#setup=${encodeURIComponent(actionLink)}`;

  assert.equal(getInvitationActionLink(hash, supabaseUrl), actionLink);
});

test('rejects links for other hosts, non-auth paths, and unsupported action types', () => {
  const malicious = 'https://attacker.example/auth/v1/verify?token=secret&type=invite';
  const wrongPath = `${supabaseUrl}/storage/v1/object?token=secret&type=invite`;
  const wrongType = `${supabaseUrl}/auth/v1/verify?token=secret&type=magiclink`;

  assert.equal(getInvitationActionLink(`#setup=${encodeURIComponent(malicious)}`, supabaseUrl), null);
  assert.equal(getInvitationActionLink(`#setup=${encodeURIComponent(wrongPath)}`, supabaseUrl), null);
  assert.equal(getInvitationActionLink(`#setup=${encodeURIComponent(wrongType)}`, supabaseUrl), null);
  assert.equal(getInvitationActionLink('', supabaseUrl), null);
});

test('distinguishes password resets from invitations without trusting arbitrary modes', () => {
  assert.equal(getPasswordSetupMode('#mode=password-reset&setup=example'), 'password-reset');
  assert.equal(getPasswordSetupMode('#mode=account-claim&setup=example'), 'account-claim');
  assert.equal(getPasswordSetupMode('#mode=invitation&setup=example'), 'invitation');
  assert.equal(getPasswordSetupMode('#mode=unexpected&setup=example'), 'invitation');
});
