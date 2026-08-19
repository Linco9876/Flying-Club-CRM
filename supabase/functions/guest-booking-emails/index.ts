import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { brandPortalEmailHtml } from "../_shared/emailBranding.ts";
import { corsHeadersForRequest, isAllowedBrowserOrigin } from "../_shared/edgeSecurity.ts";
import {
  buildGuestBookingEmail,
  guestBookingEmailRetryDelaySeconds,
  shouldSuppressGuestReminder,
} from "../_shared/guestBookingEmails.ts";

const clean = (value: unknown, maximum = 1000) =>
  String(value ?? "").trim().slice(0, maximum);

const json = (req: Request, payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });

const timingSafeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
};

const validEmail = (value: unknown) => {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
};

const markCancelled = async (admin: any, deliveryId: string, reason: string) => {
  await admin.from("guest_booking_email_deliveries").update({
    status: "cancelled",
    suppression_reason: clean(reason, 1000),
    processing_started_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", deliveryId);
};

const markSuppressed = async (admin: any, deliveryId: string) => {
  await admin.from("guest_booking_email_deliveries").update({
    status: "suppressed",
    suppression_reason: "Confirmation email was sent within the previous 12 hours",
    processing_started_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", deliveryId);
};

const markFailed = async (admin: any, delivery: any, error: unknown) => {
  const attempts = Number(delivery.attempt_count || 1);
  const finalFailure = attempts >= 5;
  const nextAttemptAt = new Date(
    Date.now() + guestBookingEmailRetryDelaySeconds(attempts) * 1000,
  ).toISOString();
  await admin.from("guest_booking_email_deliveries").update({
    status: finalFailure ? "failed" : "retry",
    next_attempt_at: finalFailure ? new Date().toISOString() : nextAttemptAt,
    processing_started_at: null,
    last_error: clean(error instanceof Error ? error.message : error, 2000) || "Email delivery failed",
    updated_at: new Date().toISOString(),
  }).eq("id", delivery.delivery_id);
};

const ensureCalendarLink = async (admin: any, bookingId: string) => {
  const { data: existing, error: lookupError } = await admin
    .from("booking_calendar_links")
    .select("token,revoked_at")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing?.token && !existing.revoked_at) return existing.token as string;

  const { data, error } = await admin.from("booking_calendar_links").upsert({
    booking_id: bookingId,
    token: crypto.randomUUID(),
    revoked_at: null,
  }, { onConflict: "booking_id" }).select("token").single();
  if (error || !data?.token) throw error || new Error("Calendar link was not created");
  return data.token as string;
};

const recentConfirmationSentAt = async (
  admin: any,
  bookingId: string,
  recipientEmail: string,
) => {
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("guest_booking_email_deliveries")
    .select("sent_at")
    .eq("booking_id", bookingId)
    .eq("delivery_kind", "confirmation")
    .eq("status", "sent")
    .ilike("recipient_email", recipientEmail)
    .gt("sent_at", cutoff)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.sent_at || null;
};

const sendBrevoEmail = async ({
  to,
  toName,
  subject,
  html,
  text,
}: {
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
}) => {
  const apiKey = clean(Deno.env.get("BREVO_API_KEY"), 4000);
  if (!apiKey) throw new Error("BREVO_API_KEY is not configured");

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: clean(Deno.env.get("BREVO_SENDER_EMAIL"), 320) || "no-reply@bendigoflyingclub.com.au",
        name: clean(Deno.env.get("BREVO_SENDER_NAME"), 200) || "Bendigo Flying Club",
      },
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent: await brandPortalEmailHtml(html),
      textContent: text,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(responseText || `Brevo rejected the email with ${response.status}`);
  }
  try {
    return clean(JSON.parse(responseText)?.messageId, 500) || null;
  } catch {
    return null;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersForRequest(req) });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  if (!isAllowedBrowserOrigin(req)) return json(req, { error: "Origin not allowed." }, 403);

  const configuredSecret = clean(Deno.env.get("PUSH_WORKER_SECRET"), 2000);
  const suppliedSecret = clean(req.headers.get("X-Push-Worker-Secret"), 2000);
  if (!configuredSecret || !suppliedSecret || !timingSafeEqual(configuredSecret, suppliedSecret)) {
    return json(req, { error: "Worker authentication failed." }, 401);
  }

  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"), 1000);
  const serviceRoleKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), 10_000);
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { error: "Service configuration is incomplete." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const body = await req.json().catch(() => ({}));
  if (clean(body?.action, 50).toLowerCase() !== "process") {
    return json(req, { error: "Unsupported worker action." }, 400);
  }

  const { data: deliveries, error: claimError } = await admin.rpc(
    "claim_guest_booking_email_deliveries",
    { p_limit: 50 },
  );
  if (claimError) return json(req, { error: claimError.message }, 500);

  const siteUrl = (clean(Deno.env.get("PUBLIC_SITE_URL"), 1000)
    || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
  const { data: organisation } = await admin.from("organisation_settings")
    .select("contact_email")
    .limit(1)
    .maybeSingle();
  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  let suppressed = 0;

  for (const delivery of deliveries || []) {
    try {
      const { data: booking, error: bookingError } = await admin.from("bookings")
        .select("id,is_guest_booking,guest_name,guest_email,start_time,end_time,status,deleted_at,aircraft_id,instructor_id,location")
        .eq("id", delivery.booking_id)
        .maybeSingle();
      if (bookingError) throw bookingError;

      const recipientEmail = validEmail(delivery.recipient_email);
      const currentEmail = validEmail(booking?.guest_email);
      if (
        !booking
        || !booking.is_guest_booking
        || booking.deleted_at
        || ["cancelled", "no-show", "completed"].includes(booking.status)
        || booking.start_time !== delivery.booking_start_time
        || new Date(booking.start_time).getTime() <= Date.now()
        || !recipientEmail
        || currentEmail !== recipientEmail
      ) {
        await markCancelled(admin, delivery.delivery_id, "Booking is no longer active or no longer matches this delivery");
        cancelled += 1;
        continue;
      }

      if (delivery.delivery_kind === "day_prior_reminder") {
        const confirmationSentAt = await recentConfirmationSentAt(
          admin,
          booking.id,
          recipientEmail,
        );
        if (shouldSuppressGuestReminder(confirmationSentAt)) {
          await markSuppressed(admin, delivery.delivery_id);
          suppressed += 1;
          continue;
        }
      }

      const [{ data: aircraft }, { data: instructor }] = await Promise.all([
        booking.aircraft_id
          ? admin.from("aircraft").select("registration,make,model").eq("id", booking.aircraft_id).maybeSingle()
          : Promise.resolve({ data: null }),
        booking.instructor_id
          ? admin.from("users").select("name").eq("id", booking.instructor_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const calendarToken = await ensureCalendarLink(admin, booking.id);
      const email = buildGuestBookingEmail({
        kind: delivery.delivery_kind,
        guestName: clean(booking.guest_name || delivery.recipient_name, 200) || "there",
        startTime: booking.start_time,
        endTime: booking.end_time,
        status: booking.status,
        aircraftLabel: aircraft
          ? [aircraft.registration, aircraft.make, aircraft.model].filter(Boolean).join(" ")
          : "To be advised",
        instructorName: clean(instructor?.name, 200) || "To be advised",
        location: clean(booking.location, 200) || "Bendigo Flying Club",
        calendarUrl: `${siteUrl}/calendar-booking?event=${encodeURIComponent(calendarToken)}`,
        contactEmail: validEmail(organisation?.contact_email) || undefined,
      });
      const providerMessageId = await sendBrevoEmail({
        to: recipientEmail,
        toName: clean(booking.guest_name || delivery.recipient_name, 200) || recipientEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      const sentAt = new Date().toISOString();
      const { error: sentUpdateError } = await admin.from("guest_booking_email_deliveries").update({
        status: "sent",
        sent_at: sentAt,
        provider_message_id: providerMessageId,
        processing_started_at: null,
        last_error: null,
        updated_at: sentAt,
      }).eq("id", delivery.delivery_id);
      if (sentUpdateError) throw sentUpdateError;
      sent += 1;
    } catch (error) {
      console.error("Guest booking email delivery failed", delivery.delivery_id, error);
      await markFailed(admin, delivery, error);
      failed += 1;
    }
  }

  return json(req, {
    ok: true,
    claimed: (deliveries || []).length,
    sent,
    failed,
    cancelled,
    suppressed,
  });
});
