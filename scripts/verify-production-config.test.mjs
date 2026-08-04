import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPECTED_PRODUCTION_SUPABASE_HOST,
  validateProductionConfig,
  verifyAuthHealth,
} from './verify-production-config.mjs';

const validEnvironment = {
  VITE_SUPABASE_URL: `https://${EXPECTED_PRODUCTION_SUPABASE_HOST}`,
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_test-key',
};

test('accepts the CRM production project and a public key', () => {
  const config = validateProductionConfig(validEnvironment);
  assert.equal(config.url, `https://${EXPECTED_PRODUCTION_SUPABASE_HOST}`);
});

test('blocks a production build pointed at another Supabase project', () => {
  assert.throws(
    () => validateProductionConfig({
      ...validEnvironment,
      VITE_SUPABASE_URL: 'https://wrong-project.supabase.co',
    }),
    /Supabase host must be/,
  );
});

test('blocks secret keys from being embedded in the browser bundle', () => {
  assert.throws(
    () => validateProductionConfig({
      ...validEnvironment,
      VITE_SUPABASE_ANON_KEY: 'sb_secret_do-not-embed',
    }),
    /must never contain a Supabase secret key/,
  );
});

test('blocks deployment when the Auth health check is not successful', async () => {
  await assert.rejects(
    () => verifyAuthHealth(
      validateProductionConfig(validEnvironment),
      async () => ({ ok: false, status: 503 }),
    ),
    /HTTP 503/,
  );
});
