import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  onRequestOptions,
  onRequestPost,
} from './instructor-comment-cleanup.js';

const readyEnvironment = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'public-anon-key',
  AI: { run: async () => ({ response: 'Cleaned comment.' }) },
};

test('AI Rewrite readiness fails safely when a production binding is missing', async () => {
  const response = await onRequestOptions({
    env: {
      SUPABASE_URL: readyEnvironment.SUPABASE_URL,
      SUPABASE_ANON_KEY: readyEnvironment.SUPABASE_ANON_KEY,
    },
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'AI Rewrite is temporarily unavailable. Please try again shortly.',
  });
});

test('AI Rewrite readiness confirms Supabase and Workers AI are attached', async () => {
  const response = await onRequestOptions({ env: readyEnvironment });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('x-bfc-ai-rewrite-ready'), 'true');
});

test('AI Rewrite checks deployment configuration before authentication', async () => {
  const response = await onRequestPost({
    env: {},
    request: new Request('https://portal.example/api/instructor-comment-cleanup', {
      method: 'POST',
    }),
  });

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /temporarily unavailable/i);
});

test('the authoritative Wrangler config repeats every non-inheritable production binding', async () => {
  const wrangler = await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
  const withoutComments = wrangler.replace(/^\s*\/\/.*$/gm, '');
  const config = JSON.parse(withoutComments);

  assert.equal(config.vars.SUPABASE_URL, config.env.production.vars.SUPABASE_URL);
  assert.equal(config.vars.SUPABASE_ANON_KEY, config.env.production.vars.SUPABASE_ANON_KEY);
  assert.equal(config.ai.binding, 'AI');
  assert.equal(config.env.production.ai.binding, 'AI');
});
