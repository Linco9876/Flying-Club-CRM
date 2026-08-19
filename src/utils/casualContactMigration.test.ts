import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260818090000_add_casual_contact_lifecycle.sql', import.meta.url),
  'utf8',
).toLowerCase();
const bookingEventForeignKeyRepair = readFileSync(
  new URL('../../supabase/migrations/20260819103000_defer_casual_contact_booking_event_fk.sql', import.meta.url),
  'utf8',
).toLowerCase();
const singleBookingRelinkHardening = readFileSync(
  new URL('../../supabase/migrations/20260819104500_harden_single_guest_booking_relink.sql', import.meta.url),
  'utf8',
).toLowerCase();

test('casual contact migration keeps a reusable identity and booking snapshot link', () => {
  assert.match(migration, /create table if not exists public\.casual_contacts/);
  assert.match(migration, /add column if not exists casual_contact_id/);
  assert.match(migration, /add column if not exists booking_purpose/);
  assert.match(migration, /new\.guest_name/);
  assert.match(migration, /new\.guest_email/);
});

test('casual contact booking events defer their foreign key until the booking insert completes', () => {
  assert.match(
    migration,
    /booking_id uuid references public\.bookings\(id\) on delete set null deferrable initially deferred/,
  );
  assert.match(bookingEventForeignKeyRepair, /drop constraint if exists casual_contact_events_booking_id_fkey/);
  assert.match(bookingEventForeignKeyRepair, /foreign key \(booking_id\)/);
  assert.match(bookingEventForeignKeyRepair, /deferrable initially deferred/);
});

test('promotion transfers every operational record class tied to the visit', () => {
  for (const table of [
    'public.bookings',
    'public.flight_logs',
    'public.training_records',
    'public.student_matrix_assessments',
    'public.training_deficiencies',
    'public.flight_review_records',
    'public.flight_review_attachments',
    'public.account_transactions',
    'public.notifications',
    'public.trial_flight_vouchers',
  ]) {
    assert.match(migration, new RegExp(`update ${table.replace('.', '\\.')}`));
  }
});

test('formal reviews and tests cannot use a guest placeholder identity', () => {
  assert.match(migration, /bookings_guest_formal_record_check/);
  assert.match(migration, /external_flight_review/);
  assert.match(migration, /external_flight_test/);
  assert.match(migration, /revoke all on function public\.promote_casual_contact_history.*authenticated/);
});

test('a single-booking correction never transfers contact-wide Xero or promotion identity', () => {
  for (const source of [migration, singleBookingRelinkHardening]) {
    assert.match(source, /if p_link_all then\s+update public\.users target/);
    assert.match(source, /case when p_link_all then 'promoted' else 'booking_linked' end/);
    assert.match(source, /else\s+update public\.casual_contacts\s+set updated_at = now\(\)/);
  }
  assert.match(singleBookingRelinkHardening, /select private\.assert_function_permission_manifest\(\)/);
});
