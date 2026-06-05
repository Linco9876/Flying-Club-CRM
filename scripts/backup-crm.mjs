import fs from 'node:fs/promises';
import path from 'node:path';

const defaultTables = [
  'account_transactions',
  'aircraft',
  'aircraft_documents',
  'aircraft_rates',
  'booking_conflicts',
  'booking_field_settings',
  'booking_rules_settings',
  'bookings',
  'calendar_settings',
  'defect_history',
  'defects',
  'endorsements',
  'flight_log_field_settings',
  'flight_logs',
  'flight_types',
  'instructor_absences',
  'instructor_schedule_changes',
  'instructor_weekly_schedules',
  'invitations',
  'invoice_items',
  'invoices',
  'lesson_snapshots',
  'maintenance_audit_log',
  'maintenance_completions',
  'maintenance_milestone_templates',
  'maintenance_milestones',
  'maintenance_settings',
  'notification_settings',
  'notifications',
  'organisation_settings',
  'payment_methods',
  'portal_ux_settings',
  'resource_settings',
  'rooms',
  'safety_compliance_settings',
  'safety_documents',
  'safety_report_categories',
  'safety_reports',
  'student_documents',
  'student_exam_results',
  'students',
  'student_syllabi',
  'syllabi',
  'syllabus_items',
  'syllabus_sequences',
  'training_courses',
  'training_lessons',
  'training_records',
  'training_sequence_results',
  'training_syllabus_settings',
  'user_preferences',
  'user_roles',
  'users'
];

const defaultBuckets = [
  'aircraft-documents',
  'defect-attachments',
  'exam-uploads',
  'org-logos',
  'safety-documents',
  'student-documents',
  'user-avatars'
];

function parseArgs() {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    const [key, ...valueParts] = arg.replace(/^--/, '').split('=');
    args.set(key, valueParts.join('=') || 'true');
  }
  return args;
}

async function loadEnv(filePath) {
  const content = await fs.readFile(filePath, 'utf8').catch(() => '');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || value.includes('replace-with')) {
    throw new Error(`Missing ${name}. Add it to scripts/backup-crm.env.`);
  }
  return value;
}

function isoStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function safeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

async function supabaseFetch(url, serviceRoleKey, endpoint, options = {}) {
  const response = await fetch(`${url}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${endpoint} failed with ${response.status}: ${body.slice(0, 500)}`);
  }

  return response;
}

async function backupTable({ url, serviceRoleKey, table, outDir, pageSize }) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const response = await supabaseFetch(
      url,
      serviceRoleKey,
      `/rest/v1/${encodeURIComponent(table)}?select=*`,
      { headers: { Range: `${from}-${to}` } }
    );
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  await writeJson(path.join(outDir, `${safeName(table)}.json`), rows);
  return { table, rows: rows.length };
}

async function backupAuthUsers({ url, serviceRoleKey, outDir }) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const response = await supabaseFetch(
      url,
      serviceRoleKey,
      `/auth/v1/admin/users?page=${page}&per_page=1000`
    );
    const body = await response.json();
    const batch = Array.isArray(body.users) ? body.users : [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }

  await writeJson(path.join(outDir, 'auth_users.json'), users);
  return { users: users.length };
}

async function listBuckets({ url, serviceRoleKey }) {
  const response = await supabaseFetch(url, serviceRoleKey, '/storage/v1/bucket');
  const buckets = await response.json();
  return buckets.map((bucket) => bucket.name).filter(Boolean);
}

async function listStorageObjects({ url, serviceRoleKey, bucket, prefix = '' }) {
  const objects = [];
  const response = await supabaseFetch(
    url,
    serviceRoleKey,
    `/storage/v1/object/list/${encodeURIComponent(bucket)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } })
    }
  );
  const entries = await response.json();

  for (const entry of entries) {
    const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null || entry.metadata === null) {
      objects.push(...await listStorageObjects({ url, serviceRoleKey, bucket, prefix: objectPath }));
    } else {
      objects.push({ ...entry, path: objectPath });
    }
  }

  return objects;
}

async function backupBucket({ url, serviceRoleKey, bucket, outDir }) {
  const bucketDir = path.join(outDir, safeName(bucket));
  await ensureDir(bucketDir);

  let objects = [];
  try {
    objects = await listStorageObjects({ url, serviceRoleKey, bucket });
  } catch (error) {
    return { bucket, objects: 0, error: error.message };
  }

  for (const object of objects) {
    const response = await supabaseFetch(
      url,
      serviceRoleKey,
      `/storage/v1/object/${encodeURIComponent(bucket)}/${object.path.split('/').map(encodeURIComponent).join('/')}`
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = path.join(bucketDir, ...object.path.split('/').map(safeName));
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, buffer);
  }

  await writeJson(path.join(bucketDir, '_objects.json'), objects);
  return { bucket, objects: objects.length };
}

async function pruneOldBackups(root, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const removed = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('backup-')) continue;
    const fullPath = path.join(root, entry.name);
    const stat = await fs.stat(fullPath);
    if (stat.mtime.getTime() < cutoff) {
      await fs.rm(fullPath, { recursive: true, force: true });
      removed.push(entry.name);
    }
  }

  return removed;
}

async function main() {
  const args = parseArgs();
  const envPath = path.resolve(args.get('env') || 'scripts/backup-crm.env');
  await loadEnv(envPath);

  const url = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const backupRoot = requireEnv('BACKUP_ROOT');
  const pageSize = Number.parseInt(process.env.PAGE_SIZE || '1000', 10);
  const retentionDays = Number.parseInt(process.env.RETENTION_DAYS || '45', 10);
  const tables = (process.env.BACKUP_TABLES?.split(',').map((table) => table.trim()).filter(Boolean)) || defaultTables;
  const configuredBuckets = process.env.BACKUP_BUCKETS?.split(',').map((bucket) => bucket.trim()).filter(Boolean);
  const buckets = configuredBuckets?.length ? configuredBuckets : await listBuckets({ url, serviceRoleKey }).catch(() => defaultBuckets);

  const stamp = isoStamp();
  const backupDir = path.join(backupRoot, `backup-${stamp}`);
  const tablesDir = path.join(backupDir, 'tables');
  const storageDir = path.join(backupDir, 'storage');
  await ensureDir(tablesDir);
  await ensureDir(storageDir);

  const manifest = {
    createdAt: new Date().toISOString(),
    supabaseUrl: url,
    backupDir,
    tables: [],
    auth: null,
    storage: [],
    warnings: []
  };

  for (const table of tables) {
    try {
      manifest.tables.push(await backupTable({ url, serviceRoleKey, table, outDir: tablesDir, pageSize }));
    } catch (error) {
      manifest.warnings.push({ type: 'table', name: table, message: error.message });
    }
  }

  try {
    manifest.auth = await backupAuthUsers({ url, serviceRoleKey, outDir: backupDir });
  } catch (error) {
    manifest.warnings.push({ type: 'auth', message: error.message });
  }

  for (const bucket of buckets) {
    const result = await backupBucket({ url, serviceRoleKey, bucket, outDir: storageDir });
    manifest.storage.push(result);
    if (result.error) manifest.warnings.push({ type: 'bucket', name: bucket, message: result.error });
  }

  manifest.pruned = await pruneOldBackups(backupRoot, retentionDays);
  await writeJson(path.join(backupDir, 'manifest.json'), manifest);

  if (manifest.warnings.length) {
    console.warn(`Backup finished with ${manifest.warnings.length} warning(s): ${backupDir}`);
    process.exitCode = 2;
  } else {
    console.log(`Backup complete: ${backupDir}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
