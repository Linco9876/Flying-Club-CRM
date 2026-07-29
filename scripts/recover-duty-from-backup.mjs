import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const PERIOD_COLUMNS = [
  'id',
  'instructor_id',
  'duty_date',
  'planned_start',
  'planned_end',
  'actual_start',
  'actual_end',
  'location',
  'status',
  'is_external',
  'external_organisation',
  'flight_minutes',
  'notes',
  'amendment_reason',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at',
  'completed_at',
  'entry_source',
  'auto_started_for_booking_id',
  'auto_closed_at_limit',
  'break_confirmation',
  'break_confirmed_at',
];

const BREAK_COLUMNS = [
  'id',
  'duty_period_id',
  'break_start',
  'break_end',
  'break_type',
  'free_of_duty',
  'affects_calculation',
  'facility',
  'notes',
  'created_by',
  'created_at',
  'updated_at',
];

function parseArgs() {
  return Object.fromEntries(process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, '').split('=');
    return [key, value.join('=') || 'true'];
  }));
}

function required(value, label) {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

async function readTable(backupDir, table) {
  const filePath = path.join(backupDir, 'tables', `${table}.json`);
  const content = await fs.readFile(filePath, 'utf8');
  const rows = JSON.parse(content);
  if (!Array.isArray(rows)) throw new Error(`${table}.json is not an array.`);
  return rows;
}

function selectColumns(row, columns) {
  return Object.fromEntries(columns.filter((column) => column in row).map((column) => [column, row[column]]));
}

function periodSignature(row) {
  return [
    row.instructor_id,
    row.duty_date,
    row.actual_start || row.planned_start || '',
    row.actual_end || row.planned_end || '',
  ].join('|');
}

function breakSignature(row) {
  return [row.duty_period_id, row.break_start, row.break_end, row.break_type].join('|');
}

function dateRange(rows) {
  const dates = rows.map((row) => row.duty_date).filter(Boolean).sort();
  return {
    earliest: dates.at(0) || null,
    latest: dates.at(-1) || null,
  };
}

async function supabaseRequest(baseUrl, serviceKey, endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${endpoint} failed with ${response.status}: ${body.slice(0, 600)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getRows(baseUrl, serviceKey, table, query = '') {
  return supabaseRequest(baseUrl, serviceKey, `/rest/v1/${table}?${query}`);
}

async function insertRow(baseUrl, serviceKey, table, row) {
  await supabaseRequest(baseUrl, serviceKey, `/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
}

async function findLiveUser(baseUrl, serviceKey, email) {
  const params = new URLSearchParams({ select: 'id,email', email: `eq.${email}` });
  const rows = await getRows(baseUrl, serviceKey, 'users', params.toString());
  if (rows.length !== 1) throw new Error(`Expected one current user for ${email}; found ${rows.length}.`);
  return rows[0];
}

async function restore({ backupUsers, periods, breaks, emails, sourceRunId }) {
  if (process.env.RESTORE_CONFIRMATION !== 'RESTORE DUTY PERIODS') {
    throw new Error('Restore confirmation did not match RESTORE DUTY PERIODS.');
  }
  const baseUrl = required(process.env.SUPABASE_URL, 'SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = required(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
  const currentUsers = await getRows(baseUrl, serviceKey, 'users', 'select=id');
  const currentUserIds = new Set(currentUsers.map((row) => row.id));
  const backupToCurrentUser = new Map();

  for (const email of emails) {
    const backupUser = backupUsers.find((user) => user.email?.toLowerCase() === email);
    const currentUser = await findLiveUser(baseUrl, serviceKey, email);
    backupToCurrentUser.set(backupUser.id, currentUser.id);
  }

  const currentInstructorIds = [...backupToCurrentUser.values()];
  const currentPeriods = [];
  for (const instructorId of currentInstructorIds) {
    const params = new URLSearchParams({ select: '*', instructor_id: `eq.${instructorId}` });
    currentPeriods.push(...await getRows(baseUrl, serviceKey, 'duty_periods', params.toString()));
  }

  const currentPeriodIds = new Set(currentPeriods.map((row) => row.id));
  const currentPeriodBySignature = new Map(currentPeriods.map((row) => [periodSignature(row), row]));
  const restoredPeriodIds = new Map();
  let insertedPeriods = 0;
  let skippedPeriods = 0;

  for (const source of periods) {
    const row = selectColumns(source, PERIOD_COLUMNS);
    row.instructor_id = backupToCurrentUser.get(source.instructor_id);
    row.created_by = currentUserIds.has(row.created_by) ? row.created_by : null;
    row.updated_by = currentUserIds.has(row.updated_by) ? row.updated_by : null;
    row.auto_started_for_booking_id = null;

    const signatureMatch = currentPeriodBySignature.get(periodSignature(row));
    if (currentPeriodIds.has(row.id)) {
      restoredPeriodIds.set(source.id, row.id);
      skippedPeriods += 1;
      continue;
    }
    if (signatureMatch) {
      restoredPeriodIds.set(source.id, signatureMatch.id);
      skippedPeriods += 1;
      continue;
    }

    await insertRow(baseUrl, serviceKey, 'duty_periods', row);
    restoredPeriodIds.set(source.id, row.id);
    currentPeriodIds.add(row.id);
    currentPeriodBySignature.set(periodSignature(row), row);
    insertedPeriods += 1;
  }

  const currentBreaks = [];
  for (const dutyPeriodId of new Set(restoredPeriodIds.values())) {
    const params = new URLSearchParams({ select: '*', duty_period_id: `eq.${dutyPeriodId}` });
    currentBreaks.push(...await getRows(baseUrl, serviceKey, 'duty_breaks', params.toString()));
  }
  const currentBreakIds = new Set(currentBreaks.map((row) => row.id));
  const currentBreakSignatures = new Set(currentBreaks.map(breakSignature));
  let insertedBreaks = 0;
  let skippedBreaks = 0;

  for (const source of breaks) {
    const row = selectColumns(source, BREAK_COLUMNS);
    row.duty_period_id = restoredPeriodIds.get(source.duty_period_id);
    row.created_by = currentUserIds.has(row.created_by) ? row.created_by : null;
    if (currentBreakIds.has(row.id) || currentBreakSignatures.has(breakSignature(row))) {
      skippedBreaks += 1;
      continue;
    }
    await insertRow(baseUrl, serviceKey, 'duty_breaks', row);
    currentBreakIds.add(row.id);
    currentBreakSignatures.add(breakSignature(row));
    insertedBreaks += 1;
  }

  await insertRow(baseUrl, serviceKey, 'operations_audit_events', {
    id: randomUUID(),
    entity_type: 'duty_backup_recovery',
    entity_id: null,
    action: 'restore',
    actor_id: null,
    before_data: null,
    after_data: {
      target_emails: emails,
      inserted_periods: insertedPeriods,
      skipped_periods: skippedPeriods,
      inserted_breaks: insertedBreaks,
      skipped_breaks: skippedBreaks,
    },
    metadata: {
      source: 'encrypted_daily_backup',
      source_run_id: sourceRunId,
    },
  });

  return { insertedPeriods, skippedPeriods, insertedBreaks, skippedBreaks };
}

async function main() {
  const args = parseArgs();
  const backupDir = path.resolve(required(args['backup-dir'], '--backup-dir'));
  const mode = args.mode || 'inspect';
  if (!['inspect', 'restore'].includes(mode)) throw new Error('--mode must be inspect or restore.');
  const emails = required(args.emails, '--emails')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!emails.length) throw new Error('At least one target email is required.');

  const [backupUsers, allPeriods, allBreaks] = await Promise.all([
    readTable(backupDir, 'users'),
    readTable(backupDir, 'duty_periods'),
    readTable(backupDir, 'duty_breaks'),
  ]);
  const targetUsers = backupUsers.filter((user) => emails.includes(user.email?.toLowerCase()));
  const foundEmails = new Set(targetUsers.map((user) => user.email.toLowerCase()));
  const missingEmails = emails.filter((email) => !foundEmails.has(email));
  if (missingEmails.length) throw new Error(`Backup does not contain user(s): ${missingEmails.join(', ')}.`);

  const targetUserIds = new Set(targetUsers.map((user) => user.id));
  const periods = allPeriods.filter((period) => targetUserIds.has(period.instructor_id));
  const periodIds = new Set(periods.map((period) => period.id));
  const breaks = allBreaks.filter((item) => periodIds.has(item.duty_period_id));
  const users = emails.map((email) => {
    const user = targetUsers.find((candidate) => candidate.email.toLowerCase() === email);
    const userPeriods = periods.filter((period) => period.instructor_id === user.id);
    return {
      name: user.name || email.split('@')[0],
      periods: userPeriods.length,
      breaks: breaks.filter((item) => userPeriods.some((period) => period.id === item.duty_period_id)).length,
      ...dateRange(userPeriods),
    };
  });

  const inspection = {
    sourceRunId: args['source-run-id'] || null,
    mode,
    totalPeriods: periods.length,
    totalBreaks: breaks.length,
    users,
  };
  console.log(JSON.stringify(inspection));

  if (mode === 'restore') {
    const result = await restore({
      backupUsers: targetUsers,
      periods,
      breaks,
      emails,
      sourceRunId: args['source-run-id'] || null,
    });
    console.log(JSON.stringify({ restored: true, ...result }));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
