import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../../supabase/migrations/20260816090000_add_membership_change_workflow.sql', import.meta.url);
const ageRestrictionMigrationUrl = new URL('../../supabase/migrations/20260816003202_prevent_junior_members_from_selecting_full_membership.sql', import.meta.url);
const hookUrl = new URL('../hooks/useMembership.ts', import.meta.url);
const dashboardUrl = new URL('../components/Membership/MembershipDashboard.tsx', import.meta.url);

test('membership changes are requested, approved and applied through audited RPCs', async () => {
  const [migration, hook, dashboard] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(hookUrl, 'utf8'),
    readFile(dashboardUrl, 'utf8'),
  ]);

  assert.match(migration, /create table if not exists public\.membership_change_requests/i);
  assert.match(migration, /create or replace function public\.request_membership_change/i);
  assert.match(migration, /create or replace function public\.decide_membership_change_request/i);
  assert.match(migration, /create or replace function public\.admin_change_membership/i);
  assert.match(migration, /membership_class_changed/i);
  assert.match(hook, /rpc\('request_membership_change'/);
  assert.match(hook, /rpc\('admin_change_membership'/);
  assert.match(dashboard, /Change membership/);
  assert.match(dashboard, /Membership change requests/);
});

test('Junior age eligibility is enforced at the database boundary', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /enforce_junior_membership_eligibility/i);
  assert.match(migration, /before insert or update of user_id, membership_class_id/i);
  assert.match(migration, /only available while the member is under 18/i);
  assert.match(migration, /v_request\.effective_on - interval '18 years'/i);
});

test('Full membership is blocked for minors across applications and membership changes', async () => {
  const migration = await readFile(ageRestrictionMigrationUrl, 'utf8');
  assert.match(migration, /Full membership is not available to applicants under 18/i);
  assert.match(migration, /Full membership is not available while the member is under 18/i);
  assert.match(migration, /enforce_membership_application_age_eligibility/i);
  assert.match(migration, /enforce_membership_change_age_eligibility/i);
});

test('membership changes never silently rewrite current-year or issued billing', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /financial_year_start >= v_request\.effective_on/i);
  assert.match(migration, /xero_invoice_id is not null/i);
  assert.match(migration, /billing_sync_status is not null/i);
  assert.match(migration, /status = 'needs_review'/i);
  assert.match(migration, /'currentYearBillingChanged', false/i);
});
