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
const pastVisitorsDirectory = readFileSync(
  new URL('../../supabase/migrations/20260819110000_add_past_visitors_directory.sql', import.meta.url),
  'utf8',
).toLowerCase();
const bookingForm = readFileSync(
  new URL('../components/Bookings/BookingForm.tsx', import.meta.url),
  'utf8',
);
const membersPage = readFileSync(
  new URL('../components/Students/StudentList.tsx', import.meta.url),
  'utf8',
);
const pastVisitorsModal = readFileSync(
  new URL('../components/Students/PastVisitorsModal.tsx', import.meta.url),
  'utf8',
);
const conversionFunction = readFileSync(
  new URL('../../supabase/functions/convert-guest-booking-to-member/index.ts', import.meta.url),
  'utf8',
);
const optionalGuestEmailMigration = readFileSync(
  new URL('../../supabase/migrations/20260905113000_allow_guest_bookings_without_email.sql', import.meta.url),
  'utf8',
).toLowerCase();
const bookingsHook = readFileSync(
  new URL('../hooks/useBookings.ts', import.meta.url),
  'utf8',
);
const promotionModal = readFileSync(
  new URL('../components/Bookings/GuestPromotionModal.tsx', import.meta.url),
  'utf8',
);
const xeroSyncFunction = readFileSync(
  new URL('../../supabase/functions/xero-sync/index.ts', import.meta.url),
  'utf8',
);

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

test('new bookings stay minimal while visitor recovery lives in Members', () => {
  assert.doesNotMatch(bookingForm, /Special booking/);
  assert.doesNotMatch(bookingForm, /Find returning visitor/);
  assert.doesNotMatch(bookingForm, /search_casual_contacts/);
  assert.match(bookingForm, />\s*Visitor\s*</);
  assert.match(bookingForm, /Link unused gift voucher/);
  assert.match(membersPage, /Past visitors/);
  assert.match(membersPage, /PastVisitorsModal/);
  assert.match(pastVisitorsModal, /Upgrade to portal user/);
  assert.match(pastVisitorsModal, /Restore portal user/);
});

test('the past visitor directory returns every real visit with portal-profile state', () => {
  assert.match(pastVisitorsDirectory, /create or replace function public\.list_past_visitors/);
  assert.match(pastVisitorsDirectory, /public\.current_user_has_staff_role\(\)/);
  assert.match(pastVisitorsDirectory, /contact\.status <> 'merged'/);
  assert.match(pastVisitorsDirectory, /coalesce\(visit\.booking_count, 0\) > 0/);
  assert.match(pastVisitorsDirectory, /guest_booking_count/);
  assert.match(pastVisitorsDirectory, /promoted_user_is_active/);
  assert.match(pastVisitorsDirectory, /offset greatest\(coalesce\(p_offset, 0\), 0\)/);
  assert.match(pastVisitorsDirectory, /select private\.assert_function_permission_manifest\(\)/);
});

test('visitor promotion can resolve a contact directly and restore an archived profile', () => {
  assert.match(conversionFunction, /const casualContactId = cleanText\(body\.casualContactId\)/);
  assert.match(conversionFunction, /const reactivateProfile = body\.reactivateProfile === true/);
  assert.match(conversionFunction, /portal_access_scope: needsFullAccess \? "full"/);
  assert.match(conversionFunction, /action: profileReactivated \? "reactivated_profile"/);
  assert.match(conversionFunction, /\.eq\("casual_contact_id", contact\.id\)/);
});

test('guest bookings allow a missing email while retaining a reusable visitor identity', () => {
  assert.match(optionalGuestEmailMigration, /alter column email drop not null/);
  assert.match(optionalGuestEmailMigration, /if new\.guest_name is null then/);
  assert.match(optionalGuestEmailMigration, /elsif new\.guest_phone is not null then/);
  assert.match(optionalGuestEmailMigration, /regexp_replace\(coalesce\(contact\.phone/);
  assert.match(optionalGuestEmailMigration, /email = coalesce\(new\.guest_email, email\)/);
  assert.doesNotMatch(bookingForm, /Guest email is required/);
  assert.match(bookingForm, /Guest email \(optional\)/);
  assert.doesNotMatch(bookingsHook, /if \(!resolvedGuestEmail\) throw new Error\('Guest email is required'\)/);
});

test('promotion requires and records a valid email without changing booking snapshots', () => {
  assert.match(promotionModal, /Email address/);
  assert.match(promotionModal, /isValidGuestPromotionEmail/);
  assert.match(conversionFunction, /const requestedEmail = cleanText\(body\.email\)\.toLowerCase\(\)/);
  assert.match(conversionFunction, /Enter a valid email address before upgrading this visitor/);
  assert.match(conversionFunction, /\.from\("casual_contacts"\)[\s\S]*\.update\(\{ email: guest\.email/);
  assert.match(conversionFunction, /point-in-time guest_email snapshot untouched/);
});

test('Xero can create a stable visitor contact without an email', () => {
  assert.doesNotMatch(xeroSyncFunction, /Guest booking is missing a guest email/);
  assert.match(xeroSyncFunction, /if \(guestEmail\) payloadContact\.EmailAddress = guestEmail/);
  assert.match(xeroSyncFunction, /BFC Visitor/);
  assert.match(xeroSyncFunction, /xero_contact_email: clean\(contact\?\.EmailAddress\) \|\| guestEmail \|\| null/);
});
