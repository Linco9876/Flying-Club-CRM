const MAX_FILE_BYTES = 50 * 1024 * 1024;
const json = value => JSON.stringify(value);
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const encode = value => value.split('/').map(encodeURIComponent).join('/');
const readJson = async (bucket, key) => (await bucket.get(key))?.json() ?? null;

async function source(env, path, init = {}) {
  const response = await fetch(path.startsWith('/rest/') ? `${env.SUPABASE_URL}${path}` : `${env.SUPABASE_URL}/storage/v1/${path}`, {
    ...init, redirect: 'manual', signal: AbortSignal.timeout(60000),
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(`Storage ${path.split('/')[0]} request failed (${response.status}): ${String(detail.error || detail.message || 'unknown').slice(0, 100)}`);
    error.missingObject = path.startsWith('object/') && !path.startsWith('object/list/') && (detail.code === 'NoSuchKey' || String(detail.statusCode) === '404');
    throw error;
  }
  return response;
}

export async function inventory(env) {
  const result = await (await source(env, '/rest/v1/rpc/storage_backup_inventory', { method: 'POST', body: '{}' })).json();
  if (!Array.isArray(result.buckets) || !Array.isArray(result.files)) throw new Error('Invalid inventory');
  const files = [];
  for (const entry of result.files) {
    if (!entry.updated_at || !Number.isFinite(Number(entry.metadata?.size))) throw new Error('Incomplete file metadata');
    const version = await digest(new TextEncoder().encode(json([entry.bucket, entry.path, entry.id, entry.updated_at, entry.metadata])));
    files.push({ bucket: entry.bucket, path: entry.path, id: entry.id, updatedAt: entry.updated_at, size: Number(entry.metadata.size), contentType: entry.metadata?.mimetype || 'application/octet-stream', version });
  }
  return { buckets: result.buckets, files };
}

// No delete API: removed or overwritten source files retain their old snapshots.
export async function backup(env) {
  const lock = await env.BACKUPS.put('run.lock', json({ startedAt: new Date().toISOString() }), { onlyIf: { etagDoesNotMatch: '*' } });
  if (!lock) throw new Error('Backup already running or stale lock needs operator review');
  try {
    const startedAt = new Date().toISOString();
    const previous = await readJson(env.BACKUPS, 'latest.json');
    const previousFiles = new Map((previous?.files || []).map(file => [file.version, file]));
    const { buckets, files } = await inventory(env);
    if (previous?.files?.length && !files.length) throw new Error('Unexpected empty inventory; retaining previous snapshot');
    const saved = [];
    const missing = [];
    let downloadedBytes = 0;
    let copied = 0;
    let attempted = 0;
    let pending = 0;
    for (const file of files) {
      const cached = await readJson(env.BACKUPS, `versions/${file.version}.json`);
      if (cached?.missing && Date.now() - Date.parse(cached.checkedAt) < 3600000) { missing.push(file); continue; }
      const prior = previousFiles.get(file.version) || (cached?.key ? cached : null);
      if (prior && (await env.BACKUPS.head(prior.key))?.size === prior.size) {
        saved.push(prior);
        continue;
      }
      if (attempted >= 20) { pending++; continue; }
      attempted++;
      if (file.size > MAX_FILE_BYTES) throw new Error('File exceeds backup worker limit; expand capacity before continuing');
      let response;
      try { response = await source(env, `object/${encodeURIComponent(file.bucket)}/${encode(file.path)}`); }
      catch (error) {
        if (!error.missingObject) throw error;
        await env.BACKUPS.put(`versions/${file.version}.json`, json({ missing: true, checkedAt: new Date().toISOString() }));
        missing.push(file);
        continue;
      }
      if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) throw new Error('File grew beyond backup worker limit');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== file.size) throw new Error('Source changed during backup; retry required');
      const sha256 = await digest(bytes);
      const key = `blobs/${sha256}`;
      if (!await env.BACKUPS.head(key)) await env.BACKUPS.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, sha256, httpMetadata: { contentType: file.contentType } });
      const stored = await env.BACKUPS.get(key);
      if (!stored || await digest(await stored.arrayBuffer()) !== sha256) throw new Error('Stored file checksum verification failed');
      const savedFile = { ...file, key, sha256 };
      await env.BACKUPS.put(`versions/${file.version}.json`, json(savedFile));
      saved.push(savedFile);
      copied++;
      downloadedBytes += bytes.byteLength;
    }
    if (pending) return { ok: false, pending, copied, downloadedBytes, message: 'Initial copy in progress; call again to continue' };
    // Verify source metadata did not change during the run, including deletions.
    const after = await inventory(env);
    const versions = rows => rows.map(file => file.version).sort().join(',');
    if (versions(after.files) !== versions(files)) throw new Error('Storage changed during backup; previous snapshot retained');
    const completedAt = new Date().toISOString();
    const snapshot = { format: 1, project: env.SUPABASE_URL, startedAt, completedAt, buckets, files: saved, missing };
    const snapshotKey = `snapshots/${completedAt}-${crypto.randomUUID()}.json`;
    await env.BACKUPS.put(snapshotKey, json(snapshot), { onlyIf: { etagDoesNotMatch: '*' } });
    await env.BACKUPS.put('latest.json', json(snapshot));
    const status = { ok: missing.length === 0, completedAt, snapshotKey, files: saved.length, missing: missing.length, copied, downloadedBytes };
    await env.BACKUPS.put('status.json', json(status));
    return status;
  } catch (error) {
    const last = await readJson(env.BACKUPS, 'status.json');
    await env.BACKUPS.put('status.json', json({ ...last, ok: false, failedAt: new Date().toISOString(), error: error.message }));
    throw error;
  } finally {
    await env.BACKUPS.delete('run.lock');
  }
}

export async function verify(env) {
  const snapshot = await readJson(env.BACKUPS, 'latest.json');
  if (!snapshot) throw new Error('No completed snapshot');
  let bytes = 0;
  for (const file of snapshot.files) {
    const stored = await env.BACKUPS.get(file.key);
    if (!stored) throw new Error('Backup object missing');
    const body = await stored.arrayBuffer();
    if (body.byteLength !== file.size || await digest(body) !== file.sha256) throw new Error('Backup integrity failure');
    bytes += body.byteLength;
  }
  const result = { ok: true, verifiedAt: new Date().toISOString(), snapshotCompletedAt: snapshot.completedAt, files: snapshot.files.length, bytes };
  await env.BACKUPS.put('verification.json', json(result));
  return result;
}

// Notify the portal owner only when an incident changes, not on every retry.
async function reportProblem(env, message) {
  const previous = await readJson(env.BACKUPS, 'incident.json');
  if (previous?.message === message) return;
  if (env.OWNER_USER_ID) {
    await source(env, '/rest/v1/notifications', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: json({ user_id: env.OWNER_USER_ID, type: 'system', title: 'File backup needs attention', message,
        is_read: false, metadata: { alert_type: 'storage_backup_failure', created_by: 'storage-backup-monitor' } }),
    });
  }
  await env.BACKUPS.put('incident.json', json({ message, detectedAt: new Date().toISOString() }));
}

export default {
  async scheduled(_event, env) {
    try {
      const status = await readJson(env.BACKUPS, 'status.json');
      if (status?.completedAt && Date.now() - Date.parse(status.completedAt) < 6 * 3600000) return;
      const result = await backup(env);
      if (!result.pending) {
        await verify(env);
        if (result.missing) await reportProblem(env, `${result.files} files are protected, but ${result.missing} source file references have no downloadable contents. The missing files need recovery or review; existing backup versions are retained.`);
        else await env.BACKUPS.delete('incident.json');
      } else if (!status?.completedAt || Date.now() - Date.parse(status.completedAt) > 8 * 3600000) {
        await reportProblem(env, 'The file backup is still copying its initial or changed files. No fresh complete snapshot is available yet.');
      }
    } catch (error) {
      await reportProblem(env, `The scheduled file backup or integrity check failed: ${error.message}. Existing recovery points are retained.`);
      throw error;
    }
  },
  async fetch(request, env) {
    const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (!env.OPERATOR_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.OPERATOR_TOKEN}`) return reply({ error: 'Unauthorized' }, 401);
    try {
      const path = new URL(request.url).pathname;
      if (request.method === 'POST' && path === '/backup') return reply(await backup(env));
      if (request.method === 'POST' && path === '/verify') return reply(await verify(env));
      if (request.method === 'GET' && path === '/manifest') {
        const key = new URL(request.url).searchParams.get('snapshot') || 'latest.json';
        if (key !== 'latest.json' && !/^snapshots\/[\w.:-]+\.json$/.test(key)) return reply({ error: 'Invalid snapshot' }, 400);
        return reply(await readJson(env.BACKUPS, key));
      }
      if (request.method === 'POST' && path === '/file') {
        const input = await request.json();
        const key = input.snapshot || 'latest.json';
        if (key !== 'latest.json' && !/^snapshots\/[\w.:-]+\.json$/.test(key)) return reply({ error: 'Invalid snapshot' }, 400);
        const snapshot = await readJson(env.BACKUPS, key);
        const file = snapshot?.files.find(item => item.bucket === input.bucket && item.path === input.path);
        if (!file) return reply({ error: 'File not in snapshot' }, 404);
        const object = await env.BACKUPS.get(file.key);
        if (!object) return reply({ error: 'Backup object missing' }, 500);
        return new Response(object.body, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-SHA256': file.sha256 } });
      }
      if (request.method === 'GET' && path === '/status') {
        const status = await readJson(env.BACKUPS, 'status.json');
        const verification = await readJson(env.BACKUPS, 'verification.json');
        const fresh = status?.ok && Date.now() - Date.parse(status.completedAt) < 8 * 60 * 60 * 1000;
        return reply({ ...status, fresh: Boolean(fresh), verification }, fresh ? 200 : 503);
      }
      return reply({ error: 'Not found' }, 404);
    } catch (error) { return reply({ error: error.message }, 500); }
  },
};
