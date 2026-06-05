import fs from 'node:fs/promises';

function parseArgs() {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    const [key, ...valueParts] = arg.replace(/^--/, '').split('=');
    args.set(key, valueParts.join('=') || 'true');
  }
  return args;
}

async function loadEnv(filePath) {
  if (!filePath) return;
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
    throw new Error(`Missing ${name}. Add it to the backup environment or GitHub Actions secrets.`);
  }
  return value;
}

async function supabaseJson(url, serviceRoleKey, endpoint, options = {}) {
  const response = await fetch(`${url}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${endpoint} failed with ${response.status}: ${body.slice(0, 500)}`);
  }

  return response.status === 204 ? null : response.json();
}

async function getAdminUserIds(url, serviceRoleKey) {
  const [primaryAdmins, roleRows] = await Promise.all([
    supabaseJson(url, serviceRoleKey, '/rest/v1/users?select=id&role=eq.admin'),
    supabaseJson(url, serviceRoleKey, '/rest/v1/user_roles?select=user_id&role=eq.admin'),
  ]);

  const adminIds = new Set();
  for (const row of primaryAdmins || []) {
    if (row.id) adminIds.add(row.id);
  }
  for (const row of roleRows || []) {
    if (row.user_id) adminIds.add(row.user_id);
  }

  return [...adminIds];
}

function buildNotification() {
  const title = process.env.ADMIN_NOTIFICATION_TITLE || process.env.ALERT_TITLE || 'CRM backup failed';
  const message = process.env.ADMIN_NOTIFICATION_MESSAGE || process.env.ALERT_SUMMARY || 'A CRM backup job failed and needs admin attention.';
  const status = process.env.ADMIN_NOTIFICATION_STATUS || process.env.ALERT_STATUS || 'failure';
  const workflow = process.env.ADMIN_NOTIFICATION_WORKFLOW || process.env.ALERT_WORKFLOW || process.env.GITHUB_WORKFLOW || '';
  const runUrl = process.env.ADMIN_NOTIFICATION_URL
    || process.env.ALERT_RUN_URL
    || (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '');

  return {
    title,
    message,
    metadata: {
      alert_type: process.env.ADMIN_NOTIFICATION_ALERT_TYPE || 'backup_failure',
      status,
      workflow,
      run_url: runUrl,
      created_by: 'backup-monitor',
    },
  };
}

async function main() {
  const args = parseArgs();
  await loadEnv(args.get('env'));

  const url = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const adminUserIds = await getAdminUserIds(url, serviceRoleKey);

  if (adminUserIds.length === 0) {
    console.warn('No admin users found; in-app backup failure notification was not created.');
    return;
  }

  const notification = buildNotification();
  const rows = adminUserIds.map((userId) => ({
    user_id: userId,
    type: 'system',
    title: notification.title,
    message: notification.message,
    metadata: notification.metadata,
    is_read: false,
  }));

  await supabaseJson(url, serviceRoleKey, '/rest/v1/notifications', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });

  console.log(`Created backup failure notification for ${rows.length} admin user(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
