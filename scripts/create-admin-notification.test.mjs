import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { supabaseJson } from './create-admin-notification.mjs';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('accepts a successful empty Supabase response', async () => {
  globalThis.fetch = async () => new Response('', { status: 201 });

  const result = await supabaseJson(
    'https://ci-placeholder.supabase.co',
    'service-role-key',
    '/rest/v1/notifications',
    {
      method: 'POST',
      body: JSON.stringify([{ title: 'Test' }]),
    },
  );

  assert.equal(result, null);
});

test('parses a successful JSON response', async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify([{ id: 'admin-id' }]),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );

  const result = await supabaseJson(
    'https://ci-placeholder.supabase.co',
    'service-role-key',
    '/rest/v1/users',
  );

  assert.deepEqual(result, [{ id: 'admin-id' }]);
});

test('reports invalid non-empty JSON without exposing credentials', async () => {
  globalThis.fetch = async () => new Response('not-json', { status: 200 });

  await assert.rejects(
    () => supabaseJson(
      'https://ci-placeholder.supabase.co',
      'secret-service-role-key',
      '/rest/v1/users',
    ),
    (error) => {
      assert.match(error.message, /returned invalid JSON with 200/);
      assert.doesNotMatch(error.message, /secret-service-role-key/);
      return true;
    },
  );
});

test('failure monitor ignores superseded main-branch workflow runs', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/actions-failure-monitor.yml', import.meta.url),
    'utf8',
  );

  assert.match(
    workflow,
    /github\.event\.workflow_run\.head_sha\s*==\s*github\.sha/,
    'The monitor must only alert for a failure on the current main commit.',
  );
});
