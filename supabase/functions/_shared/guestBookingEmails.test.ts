import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
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
} as const;

Deno.test("confirmation email includes clear operational details", () => {
  const email = buildGuestBookingEmail({ ...details, kind: "confirmation" });
  assertEquals(email.subject, "Your Bendigo Flying Club flight is booked");
  assertStringIncludes(email.text, "Robin Guest");
  assertStringIncludes(email.text, "24-4852 Tecnam P92");
  assertStringIncludes(email.text, "Lincoln Cottingham");
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
  assertStringIncludes(voucherSender, "recordTrialBookingConfirmationDelivery");
});
