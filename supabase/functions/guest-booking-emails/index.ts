import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { brandPortalEmailHtml } from "../_shared/emailBranding.ts";
import { corsHeadersForRequest, isAllowedBrowserOrigin } from "../_shared/edgeSecurity.ts";
import {
  buildGuestBookingEmail,
  buildGuestReviewRequestEmail,
  guestBookingEmailRetryDelaySeconds,
  shouldSuppressGuestReminder,
} from "../_shared/guestBookingEmails.ts";

const clean = (value: unknown, maximum = 1000) =>
  String(value ?? "").trim().slice(0, maximum);

const CLUB_REPLY_TO_EMAIL = "bfc@bendigoflyingclub.com.au";
const CLUB_CONTACT_PHONE = "(03) 5443 8395";

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

const isAdminRole = (value: unknown) => ["admin", "cfi"].includes(clean(value, 80).toLowerCase());

const validHttpsUrl = (value: unknown) => {
  const candidate = clean(value, 2000);
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
};

const markCancelled = async (admin: any, deliveryId: string, reason: string) => {
  await admin.from("guest_booking_email_deliveries").update({
    status: "cancelled",
    suppression_reason: clean(reason, 1000),
    processing_started_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", deliveryId);
};

const markSuppressed = async (admin: any, deliveryId: string, reason = "Confirmation email was sent within the previous 12 hours") => {
  await admin.from("guest_booking_email_deliveries").update({
    status: "suppressed",
    suppression_reason: clean(reason, 1000),
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
  replyToEmail,
  businessName,
  headers,
}: {
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
  replyToEmail?: string;
  businessName?: string;
  headers?: Record<string, string>;
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
        name: clean(businessName, 200) || clean(Deno.env.get("BREVO_SENDER_NAME"), 200) || "Bendigo Flying Club",
      },
      to: [{ email: to, name: toName || to }],
      replyTo: {
        email: validEmail(replyToEmail) || CLUB_REPLY_TO_EMAIL,
        name: clean(businessName, 200) || "Bendigo Flying Club",
      },
      subject,
      htmlContent: await brandPortalEmailHtml(html),
      textContent: text,
      ...(headers ? { headers } : {}),
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

  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"), 1000);
  const serviceRoleKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), 10_000);
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { error: "Service configuration is incomplete." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const body = await req.json().catch(() => ({}));
  const action = clean(body?.action, 50).toLowerCase();
  const siteUrl = (clean(Deno.env.get("PUBLIC_SITE_URL"), 1000)
    || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
  let organisationResult = await admin.from("organisation_settings")
    .select("club_name,contact_email,contact_phone,google_review_url,guest_review_requests_enabled,guest_review_private_feedback_email")
    .limit(1)
    .maybeSingle();
  if (organisationResult.error && /column|schema cache/i.test(organisationResult.error.message || "")) {
    const fallback = await admin.from("organisation_settings")
      .select("club_name,contact_email,contact_phone")
      .limit(1)
      .maybeSingle();
    organisationResult = {
      ...fallback,
      data: fallback.data ? {
        ...fallback.data,
        google_review_url: "",
        guest_review_requests_enabled: false,
        guest_review_private_feedback_email: "",
      } : null,
    } as typeof organisationResult;
  }
  const organisation = organisationResult.data;
  const businessName = clean(organisation?.club_name, 200) || "Bendigo Flying Club";
  const replyToEmail = validEmail(organisation?.contact_email) || CLUB_REPLY_TO_EMAIL;

  if (action === "send_review_test") {
    const token = clean(req.headers.get("Authorization"), 10_000).replace(/^Bearer\s+/i, "").trim();
    if (!token) return json(req, { error: "Sign in before sending a review test." }, 401);
    let serviceTest = timingSafeEqual(token, serviceRoleKey);
    if (!serviceTest) {
      // Supabase projects can expose either the legacy JWT service-role key or a
      // newer secret key to deployment automation. The runtime's injected key
      // is not guaranteed to use the same representation, so verify the
      // caller's read-only Auth admin capability instead of relying only on a
      // string comparison. User access tokens cannot call this endpoint.
      const callerClient = createClient(supabaseUrl, token, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: serviceRoleError } = await callerClient.auth.admin.listUsers({
        page: 1,
        perPage: 1,
      });
      serviceTest = !serviceRoleError;
    }
    let recipientEmail = "";
    let recipientName = "";
    if (serviceTest) {
      recipientEmail = validEmail(body?.recipientEmail);
      recipientName = clean(body?.recipientName, 200) || recipientEmail;
      if (!recipientEmail) return json(req, { error: "A valid test recipient is required." }, 400);
    } else {
      const { data: authData, error: authError } = await admin.auth.getUser(token);
      if (authError || !authData?.user?.id || !validEmail(authData.user.email)) {
        return json(req, { error: "Your session has expired. Sign in again, then retry." }, 401);
      }
      const [{ data: profile }, { data: roleRows }] = await Promise.all([
        admin.from("users").select("name,email,role,is_active").eq("id", authData.user.id).maybeSingle(),
        admin.from("user_roles").select("role").eq("user_id", authData.user.id),
      ]);
      const adminAccess = profile?.is_active !== false && (
        isAdminRole(profile?.role) || (roleRows || []).some((row: { role?: unknown }) => isAdminRole(row.role))
      );
      if (!adminAccess) return json(req, { error: "Only administrators can send review email tests." }, 403);
      recipientEmail = validEmail(authData.user.email);
      recipientName = clean(profile?.name, 200) || recipientEmail;
    }
    const reviewUrl = validHttpsUrl(organisation?.google_review_url)
      || (serviceTest ? validHttpsUrl(body?.reviewUrl) : "");
    if (!reviewUrl) return json(req, { error: "Save a valid Google review link in Organisation Settings first." }, 400);
    const email = buildGuestReviewRequestEmail({
      guestName: recipientName || "there",
      businessName,
      flightDate: new Date().toISOString(),
      aircraftLabel: "Example aircraft",
      instructorName: "Example instructor",
      reviewUrl,
      privateFeedbackEmail: validEmail(organisation?.guest_review_private_feedback_email) || replyToEmail,
      unsubscribeUrl: `${supabaseUrl}/functions/v1/guest-review-preferences?test=1`,
      isTest: true,
    });
    try {
      const providerMessageId = await sendBrevoEmail({
        to: recipientEmail,
        toName: recipientName || recipientEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
        replyToEmail,
        businessName,
      });
      return json(req, { ok: true, sentTo: recipientEmail, providerMessageId });
    } catch (error) {
      console.error("Guest review test email failed", error);
      return json(req, { error: "The test email provider rejected the message. Try again shortly." }, 502);
    }
  }

  if (action !== "process") {
    return json(req, { error: "Unsupported worker action." }, 400);
  }

  const configuredSecret = clean(Deno.env.get("PUSH_WORKER_SECRET"), 2000);
  const suppliedSecret = clean(req.headers.get("X-Push-Worker-Secret"), 2000);
  if (!configuredSecret || !suppliedSecret || !timingSafeEqual(configuredSecret, suppliedSecret)) {
    return json(req, { error: "Worker authentication failed." }, 401);
  }

  const { data: deliveries, error: claimError } = await admin.rpc(
    "claim_guest_booking_email_deliveries",
    { p_limit: 50 },
  );
  if (claimError) return json(req, { error: claimError.message }, 500);

  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  let suppressed = 0;

  for (const delivery of deliveries || []) {
    try {
      let deliverySnapshotResult = await admin
        .from("guest_booking_email_deliveries")
        .select("source,booking_end_time,previous_booking_start_time,previous_booking_end_time,flight_log_id,unsubscribe_token")
        .eq("id", delivery.delivery_id)
        .maybeSingle();
      if (deliverySnapshotResult.error && /column|schema cache/i.test(deliverySnapshotResult.error.message || "")) {
        const fallback = await admin.from("guest_booking_email_deliveries")
          .select("source,booking_end_time,previous_booking_start_time,previous_booking_end_time")
          .eq("id", delivery.delivery_id)
          .maybeSingle();
        deliverySnapshotResult = {
          ...fallback,
          data: fallback.data ? { ...fallback.data, flight_log_id: null, unsubscribe_token: null } : null,
        } as typeof deliverySnapshotResult;
      }
      const { data: deliverySnapshot, error: deliverySnapshotError } = deliverySnapshotResult;
      if (deliverySnapshotError || !deliverySnapshot) {
        throw deliverySnapshotError || new Error("Email delivery snapshot no longer exists");
      }

      let bookingResult = await admin.from("bookings")
        .select("id,is_guest_booking,guest_name,guest_email,start_time,end_time,status,deleted_at,aircraft_id,instructor_id,location,guest_review_consent")
        .eq("id", delivery.booking_id)
        .maybeSingle();
      if (bookingResult.error && /column|schema cache/i.test(bookingResult.error.message || "")) {
        const fallback = await admin.from("bookings")
          .select("id,is_guest_booking,guest_name,guest_email,start_time,end_time,status,deleted_at,aircraft_id,instructor_id,location")
          .eq("id", delivery.booking_id)
          .maybeSingle();
        bookingResult = {
          ...fallback,
          data: fallback.data ? { ...fallback.data, guest_review_consent: false } : null,
        } as typeof bookingResult;
      }
      const { data: booking, error: bookingError } = bookingResult;
      if (bookingError) throw bookingError;

      const recipientEmail = validEmail(delivery.recipient_email);
      const currentEmail = validEmail(booking?.guest_email);
      const isBookingTimeUpdate = deliverySnapshot.source === "booking_time_update";
      const isReviewRequest = delivery.delivery_kind === "guest_review_request";
      let reviewFlight: { id?: string; booking_id?: string; end_time?: string | null } | null = null;
      let reviewSuppressed = false;
      if (isReviewRequest && deliverySnapshot.flight_log_id && recipientEmail) {
        const [{ data: flight }, { data: suppression }] = await Promise.all([
          admin.from("flight_logs").select("id,booking_id,end_time").eq("id", deliverySnapshot.flight_log_id).maybeSingle(),
          admin.from("guest_review_email_suppressions").select("email").eq("email", recipientEmail).maybeSingle(),
        ]);
        reviewFlight = flight;
        reviewSuppressed = Boolean(suppression);
      }
      const reviewEligible = isReviewRequest
        && booking
        && booking.is_guest_booking
        && !booking.deleted_at
        && !["cancelled", "no-show"].includes(booking.status)
        && Boolean(booking.guest_review_consent)
        && Boolean(organisation?.guest_review_requests_enabled)
        && Boolean(validHttpsUrl(organisation?.google_review_url))
        && Boolean(reviewFlight?.id)
        && reviewFlight?.booking_id === booking.id
        && !reviewSuppressed
        && Boolean(recipientEmail)
        && currentEmail === recipientEmail;
      const operationalEligible = !isReviewRequest
        && booking
        && booking.is_guest_booking
        && !booking.deleted_at
        && !["cancelled", "no-show", "completed"].includes(booking.status)
        && booking.start_time === delivery.booking_start_time
        && (!isBookingTimeUpdate || booking.end_time === deliverySnapshot.booking_end_time)
        && new Date(booking.start_time).getTime() > Date.now()
        && Boolean(recipientEmail)
        && currentEmail === recipientEmail;
      if (!reviewEligible && !operationalEligible) {
        if (isReviewRequest && reviewSuppressed) {
          await markSuppressed(admin, delivery.delivery_id, "Recipient previously unsubscribed from post-flight feedback email");
          suppressed += 1;
        } else {
          await markCancelled(admin, delivery.delivery_id, "Booking is no longer active or no longer matches this delivery");
          cancelled += 1;
        }
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
      const aircraftLabel = aircraft
        ? [aircraft.registration, aircraft.make, aircraft.model].filter(Boolean).join(" ")
        : "To be advised";
      const instructorName = clean(instructor?.name, 200) || "To be advised";
      const unsubscribeUrl = `${supabaseUrl}/functions/v1/guest-review-preferences?token=${encodeURIComponent(deliverySnapshot.unsubscribe_token)}`;
      const email = isReviewRequest
        ? buildGuestReviewRequestEmail({
          guestName: clean(booking.guest_name || delivery.recipient_name, 200) || "there",
          businessName,
          flightDate: reviewFlight?.end_time || booking.end_time,
          aircraftLabel,
          instructorName,
          reviewUrl: validHttpsUrl(organisation?.google_review_url),
          privateFeedbackEmail: validEmail(organisation?.guest_review_private_feedback_email) || replyToEmail,
          unsubscribeUrl,
        })
        : buildGuestBookingEmail({
          kind: isBookingTimeUpdate ? "booking_update" : delivery.delivery_kind,
          guestName: clean(booking.guest_name || delivery.recipient_name, 200) || "there",
          startTime: booking.start_time,
          endTime: booking.end_time,
          status: booking.status,
          aircraftLabel,
          instructorName,
          location: clean(booking.location, 200) || businessName,
          calendarUrl: `${siteUrl}/calendar-booking?event=${encodeURIComponent(await ensureCalendarLink(admin, booking.id))}`,
          contactEmail: replyToEmail,
          contactPhone: clean(organisation?.contact_phone, 80) || CLUB_CONTACT_PHONE,
          previousStartTime: isBookingTimeUpdate ? deliverySnapshot.previous_booking_start_time : null,
          previousEndTime: isBookingTimeUpdate ? deliverySnapshot.previous_booking_end_time : null,
          businessName,
        });
      const providerMessageId = await sendBrevoEmail({
        to: recipientEmail,
        toName: clean(booking.guest_name || delivery.recipient_name, 200) || recipientEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
        replyToEmail,
        businessName,
        ...(isReviewRequest ? {
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        } : {}),
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
