import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
};

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1)
    .filter((values) => values.some((value) => value.trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
};

const normaliseEmail = (value) => String(value ?? '').trim().toLowerCase();
const normaliseName = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !value.startsWith('unknown@');
const cleanPhone = (value) => String(value ?? '').trim().replace(/^'/, '') || null;

const paidCsvPath = valueAfter('--paid-csv');
const wixCsvPath = valueAfter('--wix-csv');
const expectedCount = Number(valueAfter('--expected-create-count'));
const shouldApply = process.argv.includes('--apply');
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!paidCsvPath || !wixCsvPath || !Number.isInteger(expectedCount) || expectedCount < 0) {
  throw new Error('Provide --paid-csv, --wix-csv and --expected-create-count.');
}
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const [paidRows, wixRows] = await Promise.all([
  readFile(paidCsvPath, 'utf8').then(parseCsv),
  readFile(wixCsvPath, 'utf8').then(parseCsv),
]);

const uniquePaidRows = [...new Map(
  paidRows
    .filter((row) => row.Name?.trim())
    .map((row) => [`${normaliseName(row.Name)}|${normaliseEmail(row.Email)}`, row]),
).values()];

const paidEmailCounts = new Map();
for (const row of uniquePaidRows) {
  const email = normaliseEmail(row.Email);
  if (email) paidEmailCounts.set(email, (paidEmailCounts.get(email) ?? 0) + 1);
}

const wixByName = new Map();
for (const row of wixRows) {
  const name = normaliseName(`${row['First Name'] ?? ''} ${row['Last Name'] ?? ''}`);
  if (!name || wixByName.has(name)) continue;
  wixByName.set(name, row);
}

const source = uniquePaidRows.map((row) => {
  const name = row.Name.trim();
  let email = normaliseEmail(row.Email);
  const wix = wixByName.get(normaliseName(name));
  if (!email || (paidEmailCounts.get(email) ?? 0) > 1) {
    const wixEmail = normaliseEmail(wix?.['Email 1']);
    if (validEmail(wixEmail)) email = wixEmail;
  }
  return { name, email: validEmail(email) ? email : '', phone: cleanPhone(wix?.['Phone 1']) };
});

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const profiles = [];
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await supabase
    .from('users')
    .select('id,email,name,portal_access_scope')
    .range(offset, offset + 999);
  if (error) throw error;
  profiles.push(...(data ?? []));
  if ((data?.length ?? 0) < 1000) break;
}

const profileEmails = new Set(profiles.map((profile) => normaliseEmail(profile.email)));
const profileNames = new Set(profiles.map((profile) => normaliseName(profile.name)));
const candidates = source.filter((person) => (
  person.email && !profileEmails.has(person.email) && !profileNames.has(normaliseName(person.name))
));
const candidateEmails = new Set(candidates.map((person) => person.email));
if (candidateEmails.size !== candidates.length) {
  throw new Error('The import contains duplicate candidate login emails. Resolve them before provisioning.');
}
if (candidates.length !== expectedCount) {
  throw new Error(`Safety check failed: expected ${expectedCount} new profiles, found ${candidates.length}.`);
}

const authEmails = new Set();
for (let page = 1; ; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  for (const account of data.users) authEmails.add(normaliseEmail(account.email));
  if (data.users.length < 1000) break;
}
const authConflicts = candidates.filter((person) => authEmails.has(person.email));
if (authConflicts.length) {
  throw new Error(`${authConflicts.length} candidate email(s) already have an authentication account without a matching profile.`);
}

const { data: adminRoles, error: adminRoleError } = await supabase
  .from('user_roles')
  .select('user_id')
  .eq('role', 'admin')
  .order('user_id')
  .limit(1);
if (adminRoleError) throw adminRoleError;
const actorId = adminRoles?.[0]?.user_id;
if (!actorId) throw new Error('No administrator is available to own the pending account records.');

console.log(JSON.stringify({
  mode: shouldApply ? 'apply' : 'dry-run',
  paidRegisterPeople: source.length,
  existingPortalMatches: source.length - candidates.length - source.filter((person) => !person.email).length,
  profilesToCreate: candidates.length,
  skippedWithoutUsableEmail: source.filter((person) => !person.email && !profileNames.has(normaliseName(person.name))).length,
  emailsToSend: 0,
}));

if (!shouldApply) process.exit(0);

const createdIds = [];
for (let index = 0; index < candidates.length; index += 1) {
  const person = candidates[index];
  let createdUserId = null;
  try {
    const password = `${randomBytes(36).toString('base64url')}Aa1!`;
    const { data: created, error: authError } = await supabase.auth.admin.createUser({
      email: person.email,
      password,
      email_confirm: false,
      user_metadata: { name: person.name, phone: person.phone },
    });
    if (authError || !created.user) throw authError ?? new Error('Authentication account was not created.');
    createdUserId = created.user.id;

    const { error: profileError } = await supabase.from('users').upsert({
      id: createdUserId,
      email: person.email,
      name: person.name,
      phone: person.phone,
      role: 'student',
      is_active: true,
      portal_access_scope: 'full',
    });
    if (profileError) throw profileError;

    const { error: deleteRoleError } = await supabase.from('user_roles').delete().eq('user_id', createdUserId);
    if (deleteRoleError) throw deleteRoleError;
    const { error: roleError } = await supabase.from('user_roles').insert({ user_id: createdUserId, role: 'student' });
    if (roleError) throw roleError;

    const { error: pendingError } = await supabase.from('pending_portal_accounts').insert({
      user_id: createdUserId,
      email: person.email,
      created_by: actorId,
    });
    if (pendingError) throw pendingError;
    createdIds.push(createdUserId);
  } catch (error) {
    if (createdUserId) await supabase.auth.admin.deleteUser(createdUserId);
    throw new Error(`Provisioning stopped at record ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if ((index + 1) % 10 === 0 || index === candidates.length - 1) {
    console.log(`Provisioned ${index + 1}/${candidates.length} profiles; no emails sent.`);
  }
}

console.log(JSON.stringify({ profilesCreated: createdIds.length, pendingClaimsCreated: createdIds.length, emailsSent: 0 }));
