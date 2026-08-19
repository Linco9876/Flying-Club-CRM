import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildBookingScheduleChangeRows,
  buildGuestBookingEmail,
  guestBookingEmailRetryDelaySeconds,
  shouldSuppressGuestReminder,
} from "./guestBookingEmails.ts";

const details = {
  guestName: "Robin Guest",
  startTime: "2026-08-20T00:00:00.000Z",
  endTime: "2026-08-20T01:30:00.000Z",
  status: "confirmed",
  aircraftLabel: "24-4852 Tecnam P92",
  instructorName: "Lincoln Cottingham",
  location: "Bendigo",
  calendarUrl: "https://portal.bendigoflyingclub.com.au/calendar-booking?event=test",
  contactEmail: "flying@bendigoflyingclub.com.au",
  contactPhone: "(03) 5443 8395",
} as const;

Deno.test("confirmation email includes clear operational details", () => {
  const email = buildGuestBookingEmail({ ...details, kind: "confirmation" });
  assertEquals(email.subject, "Your Bendigo Flying Club flight is booked");
  assertStringIncludes(email.text, "Robin Guest");
  assertStringIncludes(email.text, "24-4852 Tecnam P92");
  assertStringIncludes(email.text, "Lincoln Cottingham");
  assertStringIncludes(email.text, "flying@bendigoflyingclub.com.au");
  assertStringIncludes(email.text, "(03) 5443 8395");
  assertStringIncludes(email.html, "mailto:flying@bendigoflyingclub.com.au");
  assertStringIncludes(email.html, "tel:+61354438395");
  assertStringIncludes(email.html, "View booking and add to calendar");
});

Deno.test("pending booking confirmation never claims final approval", () => {
  const email = buildGuestBookingEmail({
    ...details,
    kind: "confirmation",
    status: "pending_supervision",
  });
  assertStringIncludes(email.subject, "booking request");
  assertStringIncludes(email.text, "Pending supervision");
  assert(!email.text.includes("is confirmed"));
});

Deno.test("day-prior reminder has a direct, readable subject", () => {
  const email = buildGuestBookingEmail({ ...details, kind: "day_prior_reminder" });
  assertStringIncludes(email.subject, "flight is tomorrow");
  assertStringIncludes(email.text, "reminder");
});

Deno.test("booking time update clearly states the new date and time", () => {
  const email = buildGuestBookingEmail({
    ...details,
    kind: "booking_update",
    previousStartTime: "2026-08-19T00:30:00.000Z",
    previousEndTime: "2026-08-19T02:00:00.000Z",
  });
  assertStringIncludes(email.subject, "Updated:");
  assertStringIncludes(email.subject, "Thursday 20 August 2026");
  assertStringIncludes(email.text, "date or time");
  assertStringIncludes(email.text, "What changed:");
  assertStringIncludes(email.text, "Was: Wednesday 19 August 2026");
  assertStringIncludes(email.text, "Now: Thursday 20 August 2026");
  assertStringIncludes(email.text, "Was: 10:30 am - 12:00 pm");
  assertStringIncludes(email.text, "Now: 10:00 am - 11:30 am");
  assertStringIncludes(email.text, "Date: Thursday 20 August 2026");
  assertStringIncludes(email.text, "Time: 10:00 am");
  assertStringIncludes(email.html, "Your booking has been updated");
  assertStringIncludes(email.html, "What changed");
  assertStringIncludes(email.html, "<strong>Was:</strong>");
  assertStringIncludes(email.html, "<strong>Now:</strong>");
});

Deno.test("change summary includes only schedule fields that actually changed", () => {
  assertEquals(buildBookingScheduleChangeRows({
    previousStartTime: "2026-08-20T00:30:00.000Z",
    previousEndTime: "2026-08-20T02:00:00.000Z",
    startTime: details.startTime,
    endTime: details.endTime,
  }), [{
    label: "Time",
    before: "10:30 am - 12:00 pm",
    after: "10:00 am - 11:30 am",
  }]);
  assertEquals(buildBookingScheduleChangeRows({
    previousStartTime: null,
    previousEndTime: null,
    startTime: details.startTime,
    endTime: details.endTime,
  }), []);
});

Deno.test("reminder suppression uses a strict rolling twelve-hour window", () => {
  const now = new Date("2026-08-19T09:00:00.000Z");
  assertEquals(shouldSuppressGuestReminder("2026-08-19T08:59:59.000Z", now), true);
  assertEquals(shouldSuppressGuestReminder("2026-08-18T21:00:01.000Z", now), true);
  assertEquals(shouldSuppressGuestReminder("2026-08-18T21:00:00.000Z", now), false);
  assertEquals(shouldSuppressGuestReminder(null, now), false);
});

Deno.test("delivery retries back off and remain bounded", () => {
  assertEquals(guestBookingEmailRetryDelaySeconds(1), 60);
  assertEquals(guestBookingEmailRetryDelaySeconds(3), 900);
  assertEquals(guestBookingEmailRetryDelaySeconds(99), 14_400);
});

Deno.test("database outbox is idempotent, scheduled and auditable", async () => {
  const migration = await Deno.readTextFile(
    "supabase/migrations/20260818130000_add_guest_booking_email_outbox.sql",
  );
  const worker = await Deno.readTextFile(
    "supabase/functions/guest-booking-emails/index.ts",
  );
  const timeUpdateMigration = await Deno.readTextFile(
    "supabase/migrations/20260819113000_email_guest_booking_time_updates.sql",
  );
  const changeSnapshotMigration = await Deno.readTextFile(
    "supabase/migrations/20260819130500_add_guest_booking_change_snapshots.sql",
  );
  const bookingForm = await Deno.readTextFile(
    "src/components/Bookings/BookingForm.tsx",
  );
  const voucherSender = await Deno.readTextFile(
    "supabase/functions/trial-voucher-public/index.ts",
  );

  assertStringIncludes(migration, "guest_booking_email_deliveries");
  assertStringIncludes(migration, "unique");
  assertStringIncludes(migration, "interval '12 hours'");
  assertStringIncludes(migration, "day_prior_reminder");
  assertStringIncludes(migration, "09:00");
  assertStringIncludes(migration, "for update skip locked");
  assertStringIncludes(migration, "confirmation_in_flight.status in ('pending', 'processing', 'retry')");
  assertStringIncludes(migration, "trial_voucher_confirmation_fallback");
  assertStringIncludes(migration, "process-guest-booking-email-deliveries");
  assertStringIncludes(migration, "notification_push_worker_secret");
  assertStringIncludes(worker, "shouldSuppressGuestReminder");
  assertStringIncludes(worker, "brandPortalEmailHtml");
  assertStringIncludes(worker, 'replyTo: { email: CLUB_REPLY_TO_EMAIL');
  assertStringIncludes(worker, '.select("contact_email,contact_phone")');
  assertStringIncludes(worker, 'deliverySnapshot.source === "booking_time_update"');
  assertStringIncludes(worker, 'kind: isBookingTimeUpdate ? "booking_update"');
  assertStringIncludes(worker, "previous_booking_start_time,previous_booking_end_time");
  assertStringIncludes(worker, "previousStartTime: isBookingTimeUpdate");
  assertStringIncludes(voucherSender, "recordTrialBookingConfirmationDelivery");
  assertStringIncludes(voucherSender, 'replyTo: { email: CLUB_CONTACT_EMAIL');
  assertStringIncludes(voucherSender, 'const CLUB_CONTACT_PHONE = "(03) 5443 8395"');
  assertStringIncludes(voucherSender, "booking_end_time: booking.endTime || null");
  assert(/rescheduleInfoFor[\s\S]{0,600}isUpdate: true/.test(voucherSender));
  assertStringIncludes(voucherSender, "previousStartTime: currentBooking.start_time");
  assertStringIncludes(voucherSender, "previousEndTime: currentBooking.end_time");
  assertStringIncludes(timeUpdateMigration, "after update of start_time, end_time");
  assertStringIncludes(timeUpdateMigration, "old.start_time is distinct from new.start_time");
  assertStringIncludes(timeUpdateMigration, "old.end_time is distinct from new.end_time");
  assertStringIncludes(timeUpdateMigration, "booking_end_time");
  assertStringIncludes(timeUpdateMigration, "booking_time_update");
  assertStringIncludes(changeSnapshotMigration, "previous_booking_start_time");
  assertStringIncludes(changeSnapshotMigration, "previous_booking_end_time");
  assertStringIncludes(changeSnapshotMigration, "delivery.source = 'booking_time_update'");
  assertStringIncludes(changeSnapshotMigration, "old.start_time");
  assertStringIncludes(changeSnapshotMigration, "old.end_time");
  assert(!timeUpdateMigration.includes("after update of instructor_id"));
  assert(!timeUpdateMigration.includes("after update of aircraft_id"));
  assert(!bookingForm.includes("Email the updated booking details?"));
  assert(!bookingForm.includes("staff-booking-update-email"));
});
