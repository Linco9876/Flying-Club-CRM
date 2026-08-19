import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const componentUrl = new URL('../components/Settings/BillingRatesSettings.tsx', import.meta.url);
const migrationUrl = new URL('../../supabase/migrations/20260805110000_save_billing_settings_atomically.sql', import.meta.url);

test('billing settings use one database transaction for the complete configuration', async () => {
  const [component, migration] = await Promise.all([
    readFile(componentUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ]);

  assert.match(component, /rpc\('save_billing_configuration'/);
  assert.match(migration, /create or replace function public\.save_billing_configuration[\s\S]+returns jsonb/i);
  assert.match(migration, /not public\.current_user_is_admin\(\)/i);
  assert.match(migration, /on conflict\(description_option_id, flight_type_id\) do update/i);
});

test('provider disconnects fail-close their system payment methods', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /sync_stripe_payment_method_availability/);
  assert.match(migration, /system_key = 'stripe_card'[\s\S]+active = false/i);
  assert.match(migration, /sync_xero_payment_method_availability/);
  assert.match(migration, /system_key = 'pilot_account'[\s\S]+active = false/i);
});
