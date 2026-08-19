import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  isReconcileableOrphanEmailConflict,
  orphanEmailReconciliationPrompt,
} from './accountEmailConflict.ts';

test('recognises only confirmed orphan-login conflicts', () => {
  assert.equal(isReconcileableOrphanEmailConflict({
    code: 'ORPHAN_AUTH_ACCOUNT',
    canReconcile: true,
  }), true);
  assert.equal(isReconcileableOrphanEmailConflict({
    code: 'ORPHAN_AUTH_ACCOUNT',
    canReconcile: false,
  }), false);
  assert.equal(isReconcileableOrphanEmailConflict({ code: 'EMAIL_IN_USE' }), false);
});

test('the confirmation explains the account and password impact', () => {
  const prompt = orphanEmailReconciliationPrompt('new@example.com');
  assert.match(prompt, /not attached to any CRM member/i);
  assert.match(prompt, /password-reset link/i);
  assert.match(prompt, /new@example\.com/i);
});

test('the production repair restores automatic CRM profile creation', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260818214500_restore_auth_profile_creation_trigger.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /CREATE TRIGGER on_auth_user_created/i);
  assert.match(migration, /AFTER INSERT ON auth\.users/i);
  assert.match(migration, /EXECUTE FUNCTION public\.handle_new_user\(\)/i);
  assert.match(migration, /deliberately not backfilled/i);
});
