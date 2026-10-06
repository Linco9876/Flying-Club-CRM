import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { backup, verify } from './index.mjs';

class Bucket {
  items = new Map();
  async put(key, value, options = {}) {
    if (options.onlyIf?.etagDoesNotMatch === '*' && this.items.has(key)) return null;
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.items.set(key, bytes.slice()); return { key, size: bytes.byteLength };
  }
  async get(key) {
    const bytes = this.items.get(key); if (!bytes) return null;
    return { size: bytes.byteLength, body: bytes.slice(), json: async () => JSON.parse(new TextDecoder().decode(bytes)), arrayBuffer: async () => bytes.slice().buffer };
  }
  async head(key) { return this.get(key); }
  async delete(key) { this.items.delete(key); }
}

test('incremental backup, retained deletions and overwrites, checksum recovery, and failure preserves good snapshot', async () => {
  const original = globalThis.fetch;
  const env = { BACKUPS: new Bucket(), SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'test' };
  let files = [{ name: 'report.pdf', id: '1', updated_at: '2026-10-06', metadata: { size: 3 } }, { name: 'keep.pdf', id: '2', updated_at: '2026-10-06', metadata: { size: 3 } }];
  let downloads = 0, fail = false, content = 'one';
  globalThis.fetch = async url => {
    if (fail) return new Response('', { status: 503 });
    if (url.includes('/rest/')) return Response.json({ buckets: [{ id: 'evidence', public: false }], files: files.map(file => ({...file,bucket:'evidence',path:file.name})) });
    downloads++; return new Response(content);
  };
  try {
    await backup(env); assert.equal(downloads, 2);
    assert.equal((await verify(env)).files, 2);
    await backup(env); assert.equal(downloads, 2, 'unchanged files are not downloaded');
    const first = await (await env.BACKUPS.get('latest.json')).json();
    content = 'two'; files = [{ ...files[0], updated_at: '2026-10-07' }];
    await backup(env); assert.equal(downloads, 3);
    assert.ok(await env.BACKUPS.get(first.files[1].key), 'deleted source stays in backup');
    assert.equal(new TextDecoder().decode(await (await env.BACKUPS.get(first.files[0].key)).arrayBuffer()), 'one', 'old version stays recoverable');
    const latest = await (await env.BACKUPS.get('latest.json')).json();
    fail = true; await assert.rejects(backup(env));
    assert.deepEqual(await (await env.BACKUPS.get('latest.json')).json(), latest);
    await env.BACKUPS.put(latest.files[0].key, 'bad');
    await assert.rejects(verify(env), /integrity failure/);
  } finally { globalThis.fetch = original; }
});

test('operator endpoints reject unauthenticated access and stale backups fail health check', async () => {
  const env = { BACKUPS: new Bucket(), OPERATOR_TOKEN: 'secret' };
  assert.equal((await worker.fetch(new Request('https://backup/status'), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://backup/status', { headers: { Authorization: 'Bearer secret' } }), env)).status, 503);
});

test('large initial copies resume without redownloading; missing files remain explicitly degraded', async () => {
  const original = globalThis.fetch;
  const env = { BACKUPS: new Bucket(), SUPABASE_URL: 'https://example.supabase.co' };
  const files = Array.from({ length: 22 }, (_, id) => ({ bucket: 'docs', path: `${id}.pdf`, id, updated_at: '2026-10-06', metadata: { size: 3 } }));
  let downloads = 0;
  globalThis.fetch = async url => {
    if (url.includes('/rest/')) return Response.json({ buckets: [], files });
    downloads++;
    if (url.endsWith('/21.pdf')) return Response.json({ statusCode: '404', error: 'Not found' }, { status: 400 });
    return new Response('abc');
  };
  try {
    assert.equal((await backup(env)).pending, 2);
    assert.equal(await env.BACKUPS.get('latest.json'), null);
    const result = await backup(env);
    assert.equal(downloads, 22);
    assert.equal(result.files, 21);
    assert.equal(result.missing, 1);
    assert.equal(result.ok, false);
    await backup(env); assert.equal(downloads, 22);
    assert.equal((await verify(env)).files, 21);
  } finally { globalThis.fetch = original; }
});

test('scheduled failures notify the owner once per unchanged incident', async () => {
  const original = globalThis.fetch;
  const env = { BACKUPS: new Bucket(), SUPABASE_URL: 'https://example.supabase.co', OWNER_USER_ID: 'owner' };
  let notifications = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/notifications')) {
      assert.equal(JSON.parse(options.body).user_id, 'owner'); notifications++;
      return new Response(null, { status: 201 });
    }
    return new Response(null, { status: 503 });
  };
  try {
    await assert.rejects(worker.scheduled({}, env));
    await assert.rejects(worker.scheduled({}, env));
    assert.equal(notifications, 1);
  } finally { globalThis.fetch = original; }
});
