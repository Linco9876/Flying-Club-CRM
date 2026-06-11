import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const normaliseCode = (value: unknown) =>
  String(value || "").trim().toUpperCase().replace(/\s+/g, "-");

const asString = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
};

const stripeAmountToDollars = (value: unknown) => {
  const cents = Number(value);
  return Number.isFinite(cents) ? cents / 100 : null;
};

const stripeCurrency = (value: unknown) => {
  const currency = asString(value).trim().toUpperCase();
  return currency || "AUD";
};

const stripePaymentFields = (session: any) => {
  const amount = stripeAmountToDollars(session.amount_total);
  return {
    ...(amount === null ? {} : { payment_amount: amount }),
    payment_currency: stripeCurrency(session.currency),
  };
};

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);
const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const overlaps = (aStart: Date | string, aEnd: Date | string, bStart: Date | string, bEnd: Date | string) =>
  new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const sendVoucherAccountSetupEmail = async ({
  email,
  fullName,
  productName,
  setupLink,
}: {
  email: string;
  fullName: string;
  productName: string;
  setupLink: string;
}) => {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) return { sent: false, error: "BREVO_API_KEY is not configured" };

  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@bendigoflyingclub.com.au";
  const senderName = Deno.env.get("BREVO_SENDER_NAME") || "Bendigo Flying Club";
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.14);">
            <tr>
              <td style="background:linear-gradient(135deg,#06152f,#0d3b78);padding:30px;color:#ffffff;">
                <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#bfdbfe;font-weight:700;">Bendigo Flying Club</p>
                <h1 style="margin:0;font-size:28px;line-height:1.2;">Finish setting up your trial flight booking account</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 30px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Hi ${escapeHtml(fullName || "there")},</p>
                <p style="margin:0 0 16px;line-height:1.65;color:#334155;">Your ${escapeHtml(productName || "trial flight voucher")} has been linked to a restricted Bendigo Flying Club booking account.</p>
                <p style="margin:0 0 22px;line-height:1.65;color:#334155;">Use the button below to set your password and choose from the available trial flight times. This account only allows you to book the voucher flight.</p>
                <p style="margin:26px 0;">
                  <a href="${escapeHtml(setupLink)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;border-radius:14px;padding:14px 22px;">Set password and book</a>
                </p>
                <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">If the button does not work, copy and paste this link into your browser: ${escapeHtml(setupLink)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email, name: fullName || email }],
      subject: "Set up your Bendigo Flying Club trial flight booking account",
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { sent: false, error: body || `Brevo email failed with ${response.status}` };
  }

  return { sent: true, error: null };
};

const sendTrialBookingConfirmationEmail = async ({
  voucher,
  product,
  booking,
}: {
  voucher: any;
  product: any;
  booking: any;
}) => {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) return { sent: false, error: "BREVO_API_KEY is not configured" };

  const to = voucher.recipient_email || voucher.purchaser_email;
  if (!to) return { sent: false, error: "Voucher has no confirmation email address" };

  const toName = voucher.recipient_name || voucher.purchaser_name || to;
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@bendigoflyingclub.com.au";
  const senderName = Deno.env.get("BREVO_SENDER_NAME") || "Bendigo Flying Club";
  const timeZone = "Australia/Sydney";
  const dateLabel = new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(booking.startTime));
  const timeLabel = `${new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(booking.startTime))} - ${new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(booking.endTime))}`;
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.14);">
            <tr>
              <td style="background:linear-gradient(135deg,#06152f,#0d3b78);padding:30px;color:#ffffff;">
                <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#bfdbfe;font-weight:700;">Bendigo Flying Club</p>
                <h1 style="margin:0;font-size:28px;line-height:1.2;">Your trial flight is booked</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 30px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Hi ${escapeHtml(toName)},</p>
                <p style="margin:0 0 18px;line-height:1.65;color:#334155;">Your ${escapeHtml(product.name || "trial instructional flight")} has been booked.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border:1px solid #dbeafe;border-radius:18px;background:#f8fbff;">
                  <tr><td style="padding:16px 18px;border-bottom:1px solid #dbeafe;"><strong style="display:block;color:#0f172a;">Date</strong><span style="color:#475569;">${escapeHtml(dateLabel)}</span></td></tr>
                  <tr><td style="padding:16px 18px;border-bottom:1px solid #dbeafe;"><strong style="display:block;color:#0f172a;">Time</strong><span style="color:#475569;">${escapeHtml(timeLabel)}</span></td></tr>
                  <tr><td style="padding:16px 18px;border-bottom:1px solid #dbeafe;"><strong style="display:block;color:#0f172a;">Aircraft</strong><span style="color:#475569;">${escapeHtml(booking.aircraftLabel || "Aircraft")}</span></td></tr>
                  <tr><td style="padding:16px 18px;"><strong style="display:block;color:#0f172a;">Instructor</strong><span style="color:#475569;">${escapeHtml(booking.instructorName || "Instructor")}</span></td></tr>
                </table>
                <p style="margin:0 0 14px;line-height:1.65;color:#334155;">Please arrive with enough time for the pre-flight briefing and any paperwork. The booking block includes the flight time plus 30 minutes.</p>
                <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">Voucher code: ${escapeHtml(voucher.code)}. Contact Bendigo Flying Club if you need help changing this booking.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to, name: toName }],
      subject: "Your Bendigo Flying Club trial flight is booked",
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { sent: false, error: body || `Brevo email failed with ${response.status}` };
  }

  return { sent: true, error: null };
};

const getAuthenticatedUser = async (req: Request, supabaseUrl: string) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { user: null, error: "missing_authorization" };

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await callerClient.auth.getUser();
  if (error || !user) return { user: null, error: error?.message || "invalid_session" };
  return { user, error: null };
};

const aircraftMatchesProduct = (aircraft: any, product: any) => {
  const attachedIds = new Set<string>(product.aircraft_ids || []);
  if (attachedIds.size > 0) return attachedIds.has(aircraft.id);

  const label = `${aircraft.registration || ""} ${aircraft.make || ""} ${aircraft.model || ""}`.toLowerCase();
  const compactLabel = label.replace(/[^a-z0-9]/g, "");
  if (product.aircraft_mode === "specific") return false;
  if (product.aircraft_mode === "tecnam") return label.includes("tecnam");
  if (product.aircraft_mode === "archer") {
    return label.includes("archer") || compactLabel.includes("pa28") || compactLabel.includes("piperpa28");
  }
  return false;
};

const normaliseEndorsementType = (value: unknown) => String(value || "").trim().toLowerCase();

const instructorHasAircraftEndorsement = (
  instructorId: string,
  aircraft: any,
  endorsementsByInstructor: Map<string, any[]>,
) => {
  const requiredType = normaliseEndorsementType(aircraft.required_endorsement_type);
  if (!requiredType) return true;

  const today = dateKey(new Date());
  return (endorsementsByInstructor.get(instructorId) || []).some((endorsement: any) =>
    endorsement.is_active !== false &&
    normaliseEndorsementType(endorsement.type) === requiredType &&
    (!endorsement.expiry_date || String(endorsement.expiry_date) >= today)
  );
};

const productBookingSetup = (product: any, aircraftRows: any[] = [], endorsementRows: any[] = []) => {
  const serviceableAircraft = aircraftRows
    .filter((aircraft: any) => aircraft.status === "serviceable")
    .filter((aircraft: any) => aircraftMatchesProduct(aircraft, product));
  const instructorIds = product.instructor_ids || [];
  const endorsementsByInstructor = new Map<string, any[]>();
  endorsementRows.forEach((endorsement: any) => {
    const instructorEndorsements = endorsementsByInstructor.get(endorsement.student_id) || [];
    instructorEndorsements.push(endorsement);
    endorsementsByInstructor.set(endorsement.student_id, instructorEndorsements);
  });
  const qualifiedInstructorIds = instructorIds.filter((instructorId: string) =>
    serviceableAircraft.some((aircraft: any) =>
      instructorHasAircraftEndorsement(instructorId, aircraft, endorsementsByInstructor)
    )
  );
  const issues = [
    ...(serviceableAircraft.length === 0 ? ["No eligible aircraft are currently serviceable"] : []),
    ...(instructorIds.length === 0 ? ["No eligible instructors are configured"] : []),
    ...(instructorIds.length > 0 && qualifiedInstructorIds.length === 0 ? ["No selected instructor currently holds the required aircraft endorsement"] : []),
  ];

  return {
    bookingAvailable: issues.length === 0,
    serviceableAircraftCount: serviceableAircraft.length,
    instructorCount: instructorIds.length,
    qualifiedInstructorCount: qualifiedInstructorIds.length,
    issue: issues.join(". "),
  };
};

const getProductBookingSetup = async (adminClient: ReturnType<typeof createClient>, product: any) => {
  const instructorIds = product.instructor_ids || [];
  const [{ data: aircraftRows, error: aircraftError }, { data: endorsementRows, error: endorsementError }] = await Promise.all([
    adminClient.from("aircraft").select("id,registration,make,model,status,required_endorsement_type"),
    instructorIds.length > 0
      ? adminClient
        .from("endorsements")
        .select("student_id,type,expiry_date,is_active")
        .in("student_id", instructorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (aircraftError) throw aircraftError;
  if (endorsementError) throw endorsementError;
  return productBookingSetup(product, aircraftRows || [], endorsementRows || []);
};

const timeForDate = (date: Date, time: string, fallbackHour: number, fallbackMinute = 0) => {
  const [hourRaw, minuteRaw] = String(time || "").slice(0, 5).split(":").map(Number);
  const hour = Number.isFinite(hourRaw) ? hourRaw : fallbackHour;
  const minute = Number.isFinite(minuteRaw) ? minuteRaw : fallbackMinute;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
};

const absenceBlocksTime = (absence: any, start: Date, end: Date) => {
  const startDate = dateKey(start);
  if (startDate < absence.start_date || startDate > absence.end_date) return false;
  const absenceStart = timeForDate(start, absence.start_time || "00:00", 0);
  const absenceEnd = timeForDate(start, absence.end_time || "23:59", 23, 59);
  return overlaps(start, end, absenceStart, absenceEnd);
};

const toPublicVoucher = (voucher: any, product: any) => ({
  code: voucher.code,
  status: voucher.status,
  recipientName: voucher.recipient_name,
  recipientEmail: voucher.recipient_email,
  product: {
    name: product.name,
    description: product.description,
    aircraftMode: product.aircraft_mode,
    durationMinutes: product.duration_minutes,
    bookingBlockMinutes: Number(product.duration_minutes || 0) + 30,
    bookingInstructions: product.booking_instructions,
  },
});

const toPublicProduct = (product: any, aircraftRows: any[] = [], endorsementRows: any[] = []) => {
  const setup = productBookingSetup(product, aircraftRows, endorsementRows);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    aircraftMode: product.aircraft_mode,
    durationMinutes: product.duration_minutes,
    bookingBlockMinutes: Number(product.duration_minutes || 0) + 30,
    price: Number(product.price || 0),
    checkoutAvailable: Boolean(product.stripe_price_id) && Number(product.price || 0) > 0 && setup.bookingAvailable,
    bookingAvailable: setup.bookingAvailable,
    bookingSetupMessage: setup.issue,
    bookingInstructions: product.booking_instructions,
  };
};

const sendVoucherEmailFromCheckoutStatus = async ({
  supabaseUrl,
  internalSecret,
  voucherId,
}: {
  supabaseUrl: string;
  internalSecret: string;
  voucherId: string;
}) => {
  const response = await fetch(`${supabaseUrl}/functions/v1/send-trial-voucher-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": internalSecret,
    },
    body: JSON.stringify({
      voucherId,
      redirectOrigin: Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au",
    }),
  });

  const bodyText = await response.text();
  let body: any = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = { raw: bodyText };
  }

  if (!response.ok) {
    throw new Error(body?.error || `Voucher email failed with ${response.status}`);
  }

  return body;
};

const retrieveStripeCheckoutSession = async (sessionId: string) => {
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecretKey) return null;

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Stripe checkout lookup failed with ${response.status}`);
  }

  return await response.json();
};

const reconcileCheckoutSession = async ({
  adminClient,
  supabaseUrl,
  voucher,
  sessionId,
}: {
  adminClient: ReturnType<typeof createClient>;
  supabaseUrl: string;
  voucher: any;
  sessionId: string;
}) => {
  if (voucher.payment_status === "paid" || voucher.delivered_at) {
    return { reconciled: false, email: null };
  }

  const stripeSession = await retrieveStripeCheckoutSession(sessionId);
  if (!stripeSession) return { reconciled: false, email: null };
  if (stripeSession.id !== sessionId) throw new Error("Stripe checkout session mismatch");
  if (stripeSession.client_reference_id && stripeSession.client_reference_id !== voucher.id) {
    throw new Error("Stripe checkout session does not match this voucher");
  }
  if (stripeSession.metadata?.voucher_id && stripeSession.metadata.voucher_id !== voucher.id) {
    throw new Error("Stripe checkout metadata does not match this voucher");
  }

  if (stripeSession.status === "expired") {
    await adminClient
      .from("trial_flight_vouchers")
      .update({
        payment_status: "failed",
        stripe_payment_intent_id: asString(stripeSession.payment_intent) || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", voucher.id)
      .neq("payment_status", "paid");
    return { reconciled: true, email: null };
  }

  if (stripeSession.payment_status !== "paid") {
    await adminClient
      .from("trial_flight_vouchers")
      .update({
        payment_status: "pending",
        stripe_payment_intent_id: asString(stripeSession.payment_intent) || null,
        ...stripePaymentFields(stripeSession),
        updated_at: new Date().toISOString(),
      })
      .eq("id", voucher.id);
    return { reconciled: true, email: null };
  }

  const { error: updateError } = await adminClient
    .from("trial_flight_vouchers")
    .update({
      status: voucher.status === "draft" ? "issued" : voucher.status,
      payment_status: "paid",
      stripe_payment_intent_id: asString(stripeSession.payment_intent) || null,
      ...stripePaymentFields(stripeSession),
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", voucher.id);

  if (updateError) throw updateError;

  const internalSecret = Deno.env.get("TRIAL_VOUCHER_INTERNAL_SECRET");
  const email = internalSecret
    ? await sendVoucherEmailFromCheckoutStatus({ supabaseUrl, internalSecret, voucherId: voucher.id })
    : null;

  return { reconciled: true, email };
};

const getBookingSummary = async (adminClient: ReturnType<typeof createClient>, bookingId?: string | null) => {
  if (!bookingId) return null;

  const { data: booking, error: bookingError } = await adminClient
    .from("bookings")
    .select("id,start_time,end_time,aircraft_id,instructor_id")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) throw bookingError;
  if (!booking) return null;

  const [{ data: aircraft }, { data: instructor }] = await Promise.all([
    booking.aircraft_id
      ? adminClient.from("aircraft").select("id,registration,make,model").eq("id", booking.aircraft_id).maybeSingle()
      : Promise.resolve({ data: null }),
    booking.instructor_id
      ? adminClient.from("users").select("id,name").eq("id", booking.instructor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    bookingId: booking.id,
    startTime: booking.start_time,
    endTime: booking.end_time,
    aircraftId: booking.aircraft_id,
    aircraftLabel: aircraft
      ? `${aircraft.registration || ""} ${aircraft.make || ""} ${aircraft.model || ""}`.trim()
      : "Aircraft",
    instructorId: booking.instructor_id,
    instructorName: instructor?.name || "Instructor",
  };
};

const assertVoucherAccount = async (adminClient: ReturnType<typeof createClient>, userId: string) => {
  const { data: linkedUser, error } = await adminClient
    .from("users")
    .select("id,email,name,portal_access_scope,is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!linkedUser || linkedUser.portal_access_scope !== "trial_voucher" || linkedUser.is_active === false) {
    return {
      ok: false,
      error: "Sign in with the restricted voucher booking account linked to this voucher.",
    };
  }

  return { ok: true, user: linkedUser };
};

const buildAvailableSlots = async (adminClient: ReturnType<typeof createClient>, product: any) => {
  const blockMinutes = Number(product.duration_minutes || 0) + 30;
  const allowedInstructorIds = new Set<string>(product.instructor_ids || []);
  if (!blockMinutes || allowedInstructorIds.size === 0) return [];

  const [
    { data: aircraftRows, error: aircraftError },
    { data: bookings, error: bookingsError },
    { data: schedules, error: schedulesError },
    { data: absences, error: absencesError },
    { data: users, error: usersError },
    { data: endorsements, error: endorsementsError },
  ] = await Promise.all([
    adminClient.from("aircraft").select("id,registration,make,model,status,required_endorsement_type"),
    adminClient.from("bookings").select("id,aircraft_id,instructor_id,start_time,end_time,status,deleted_at,has_conflict"),
    adminClient.from("instructor_weekly_schedules").select("*"),
    adminClient.from("instructor_absences").select("*"),
    adminClient.from("users").select("id,name").in("id", Array.from(allowedInstructorIds)),
    adminClient
      .from("endorsements")
      .select("student_id,type,expiry_date,is_active")
      .in("student_id", Array.from(allowedInstructorIds)),
  ]);

  if (aircraftError) throw aircraftError;
  if (bookingsError) throw bookingsError;
  if (schedulesError) throw schedulesError;
  if (absencesError) throw absencesError;
  if (usersError) throw usersError;
  if (endorsementsError) throw endorsementsError;

  const eligibleAircraft = (aircraftRows || [])
    .filter((aircraft: any) => aircraft.status === "serviceable")
    .filter((aircraft: any) => aircraftMatchesProduct(aircraft, product));
  const userMap = new Map((users || []).map((user: any) => [user.id, user.name]));
  const endorsementsByInstructor = new Map<string, any[]>();
  (endorsements || []).forEach((endorsement: any) => {
    const instructorEndorsements = endorsementsByInstructor.get(endorsement.student_id) || [];
    instructorEndorsements.push(endorsement);
    endorsementsByInstructor.set(endorsement.student_id, instructorEndorsements);
  });
  const now = new Date();
  const horizon = addMinutes(now, 60 * 24 * 45);
  const activeBookings = (bookings || []).filter((booking: any) =>
    !booking.deleted_at &&
    ["confirmed", "pending_approval"].includes(booking.status) &&
    new Date(booking.end_time) >= now &&
    new Date(booking.start_time) <= horizon
  );

  const slots: any[] = [];

  for (let dayOffset = 0; dayOffset < 45; dayOffset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const dayOfWeek = day.getDay();
    const daySchedules = (schedules || []).filter((schedule: any) =>
      schedule.is_available &&
      Number(schedule.day_of_week) === dayOfWeek &&
      allowedInstructorIds.has(schedule.user_id || schedule.instructor_id)
    );

    for (const schedule of daySchedules) {
      const instructorId = schedule.user_id || schedule.instructor_id;
      const windows = [
        [schedule.start_time, schedule.end_time],
        [schedule.afternoon_start_time || schedule.start_time_2, schedule.afternoon_end_time || schedule.end_time_2],
      ].filter(([start, end]) => start && end);

      for (const [windowStartRaw, windowEndRaw] of windows) {
        const windowStart = timeForDate(day, windowStartRaw, 9);
        const windowEnd = timeForDate(day, windowEndRaw, 17);
        for (let cursor = new Date(windowStart); addMinutes(cursor, blockMinutes) <= windowEnd; cursor = addMinutes(cursor, 30)) {
          const start = new Date(cursor);
          const end = addMinutes(start, blockMinutes);
          if (start < addMinutes(now, 120)) continue;
          if ((absences || []).some((absence: any) => (absence.user_id || absence.instructor_id) === instructorId && absenceBlocksTime(absence, start, end))) {
            continue;
          }

          const aircraft = eligibleAircraft.find((candidate: any) =>
            instructorHasAircraftEndorsement(instructorId, candidate, endorsementsByInstructor) &&
            !activeBookings.some((booking: any) =>
              overlaps(start, end, booking.start_time, booking.end_time) &&
              (booking.aircraft_id === candidate.id || booking.instructor_id === instructorId)
            )
          );

          if (!aircraft) continue;

          slots.push({
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            aircraftId: aircraft.id,
            aircraftLabel: `${aircraft.registration} ${aircraft.make || ""} ${aircraft.model || ""}`.trim(),
            instructorId,
            instructorName: userMap.get(instructorId) || "Instructor",
          });

          if (slots.length >= 60) return slots;
        }
      }
    }
  }

  return slots;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const action = String(body.action || "verify");
    const code = normaliseCode(body.code);

    if (action === "products") {
      const [{ data: products, error: productsError }, { data: aircraftRows, error: aircraftError }] = await Promise.all([
        adminClient
          .from("trial_flight_voucher_products")
          .select("id,name,description,aircraft_mode,aircraft_ids,instructor_ids,duration_minutes,price,stripe_price_id,booking_instructions,is_active")
          .eq("is_active", true)
          .order("duration_minutes", { ascending: true }),
        adminClient.from("aircraft").select("id,registration,make,model,status,required_endorsement_type"),
      ]);

      if (productsError) return json({ error: productsError.message }, 500);
      if (aircraftError) return json({ error: aircraftError.message }, 500);

      const instructorIds = Array.from(new Set(
        (products || []).flatMap((product: any) => product.instructor_ids || [])
      ));
      const { data: endorsementRows, error: endorsementError } = instructorIds.length > 0
        ? await adminClient
          .from("endorsements")
          .select("student_id,type,expiry_date,is_active")
          .in("student_id", instructorIds)
        : { data: [], error: null };

      if (endorsementError) return json({ error: endorsementError.message }, 500);
      return json({ products: (products || []).map((product: any) => toPublicProduct(product, aircraftRows || [], endorsementRows || [])) });
    }

    if (action === "checkout-status") {
      const sessionId = String(body.sessionId || "").trim();
      if (!sessionId) return json({ error: "Checkout session is required" }, 400);

      const { data: initialVoucher, error: voucherError } = await adminClient
        .from("trial_flight_vouchers")
        .select(`
          id,
          status,
          payment_status,
          purchaser_email,
          recipient_email,
          send_to_recipient,
          recipient_delivery_at,
          delivered_at,
          stripe_checkout_session_id,
          trial_flight_voucher_products(name)
        `)
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();

      if (voucherError) return json({ error: voucherError.message }, 500);
      if (!initialVoucher) return json({ error: "Checkout session was not found yet" }, 404);

      let checkoutEmail: any = null;
      let checkoutWarning = "";
      if (initialVoucher.payment_status !== "paid") {
        try {
          const reconciliation = await reconcileCheckoutSession({
            adminClient,
            supabaseUrl,
            voucher: initialVoucher,
            sessionId,
          });
          checkoutEmail = reconciliation.email;
        } catch (error) {
          checkoutWarning = error instanceof Error ? error.message : "Could not reconcile Stripe checkout yet";
          console.warn("Stripe checkout reconciliation skipped:", error);
        }
      }

      const { data: voucher, error: refreshedError } = await adminClient
        .from("trial_flight_vouchers")
        .select(`
          status,
          payment_status,
          purchaser_email,
          recipient_email,
          send_to_recipient,
          recipient_delivery_at,
          delivered_at,
          trial_flight_voucher_products(name)
        `)
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();

      if (refreshedError) return json({ error: refreshedError.message }, 500);
      if (!voucher) return json({ error: "Checkout session was not found after reconciliation" }, 404);

      const emailTo = voucher.send_to_recipient
        ? voucher.recipient_email
        : voucher.purchaser_email;
      const product = Array.isArray(voucher.trial_flight_voucher_products)
        ? voucher.trial_flight_voucher_products[0]
        : voucher.trial_flight_voucher_products;

      return json({
        checkout: {
          status: voucher.status,
          paymentStatus: voucher.payment_status,
          productName: product?.name || "Trial flight voucher",
          emailTo,
          sendToRecipient: Boolean(voucher.send_to_recipient),
          recipientDeliveryAt: voucher.recipient_delivery_at,
          deliveredAt: voucher.delivered_at,
          email: checkoutEmail,
          warning: checkoutWarning || undefined,
        },
      });
    }

    if (action === "my-voucher") {
      const { user } = await getAuthenticatedUser(req, supabaseUrl);
      if (!user) return json({ error: "You need to sign in to view your voucher" }, 401);

      const { data: voucher, error: voucherError } = await adminClient
        .from("trial_flight_vouchers")
        .select(`
          *,
          trial_flight_voucher_products(
            id,
            name,
            description,
            aircraft_mode,
            aircraft_ids,
            instructor_ids,
            duration_minutes,
            booking_instructions,
            is_active
          )
        `)
        .eq("redeemed_by_user_id", user.id)
        .in("status", ["redeemed", "booked"])
        .order("redeemed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (voucherError) return json({ error: voucherError.message }, 500);
      if (!voucher) return json({ error: "No linked trial flight voucher was found for this account" }, 404);

      const product = voucher.trial_flight_voucher_products;
      if (!product?.is_active) return json({ error: "This voucher product is not currently available" }, 410);

      const voucherAccount = await assertVoucherAccount(adminClient, user.id);
      if (!voucherAccount.ok) return json({ error: voucherAccount.error }, 403);

      const publicVoucher = toPublicVoucher(voucher, product);
      const slots = voucher.status === "redeemed" ? await buildAvailableSlots(adminClient, product) : [];
      const booking = voucher.status === "booked" ? await getBookingSummary(adminClient, voucher.booked_booking_id) : null;
      return json({ voucher: publicVoucher, slots, booking });
    }

    if (!code) return json({ error: "Voucher code is required" }, 400);

    const { data: voucher, error: voucherError } = await adminClient
      .from("trial_flight_vouchers")
      .select(`
        *,
        trial_flight_voucher_products(
          id,
          name,
          description,
          aircraft_mode,
          aircraft_ids,
          instructor_ids,
          duration_minutes,
          booking_instructions,
          is_active
        )
      `)
      .eq("code", code)
      .maybeSingle();

    if (voucherError) return json({ error: voucherError.message }, 500);
    if (!voucher) return json({ error: "Voucher code was not found" }, 404);
    if (voucher.status === "cancelled" || voucher.status === "expired") {
      return json({ error: "This voucher is no longer valid" }, 410);
    }
    if (voucher.expires_at && new Date(voucher.expires_at).getTime() < Date.now()) {
      await adminClient.from("trial_flight_vouchers").update({ status: "expired" }).eq("id", voucher.id);
      return json({ error: "This voucher has expired" }, 410);
    }
    if (!["issued", "redeemed", "booked"].includes(voucher.status)) {
      return json({
        error: "This voucher is not ready to redeem yet. If it was purchased online, wait for payment confirmation or contact Bendigo Flying Club.",
      }, 409);
    }

    const product = voucher.trial_flight_voucher_products;
    if (!product?.is_active) return json({ error: "This voucher product is not currently available" }, 410);

    const publicVoucher = toPublicVoucher(voucher, product);

    if (action === "verify") {
      return json({ voucher: publicVoucher });
    }

    if (action === "resend-setup") {
      if (voucher.status === "booked") return json({ error: "This voucher has already been booked" }, 409);
      if (voucher.status !== "redeemed" || !voucher.redeemed_by_user_id) {
        return json({ error: "Redeem this voucher before requesting a setup link" }, 409);
      }

      const { data: linkedUser, error: linkedUserError } = await adminClient
        .from("users")
        .select("email,name,portal_access_scope")
        .eq("id", voucher.redeemed_by_user_id)
        .maybeSingle();

      if (linkedUserError) return json({ error: linkedUserError.message }, 500);
      if (!linkedUser?.email || linkedUser.portal_access_scope !== "trial_voucher") {
        return json({ error: "The linked voucher account could not be found. Contact Bendigo Flying Club for help." }, 409);
      }

      const redirectTo = String(body.redirectTo || "").trim() || undefined;
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: linkedUser.email,
        options: redirectTo ? { redirectTo } : undefined,
      });

      if (linkError) return json({ error: linkError.message }, 500);

      const setupLink = linkData?.properties?.action_link || null;
      const setupEmail = setupLink
        ? await sendVoucherAccountSetupEmail({
            email: linkedUser.email,
            fullName: linkedUser.name || "there",
            productName: product.name,
            setupLink,
          })
        : { sent: false, error: "No setup link was generated" };

      return json({
        setupLink,
        setupEmailSent: setupEmail.sent,
        email: linkedUser.email,
      });
    }

    if (action === "availability") {
      if (voucher.status === "booked" || voucher.booked_booking_id) {
        return json({ error: "This voucher has already been booked" }, 409);
      }
      if (voucher.status !== "redeemed" || !voucher.redeemed_by_user_id) {
        return json({ error: "Redeem this voucher and sign in before viewing available times" }, 409);
      }

      const { user } = await getAuthenticatedUser(req, supabaseUrl);
      if (!user) return json({ error: "Sign in to your voucher account before viewing available times" }, 401);
      if (user.id !== voucher.redeemed_by_user_id) {
        return json({ error: "This voucher is linked to a different account" }, 403);
      }
      const voucherAccount = await assertVoucherAccount(adminClient, user.id);
      if (!voucherAccount.ok) return json({ error: voucherAccount.error }, 403);

      if (!["redeemed"].includes(voucher.status)) {
        return json({ error: "This voucher is not available for booking" }, 409);
      }

      const slots = await buildAvailableSlots(adminClient, product);
      return json({ voucher: publicVoucher, slots });
    }

    if (action === "book") {
      if (!voucher.redeemed_by_user_id) {
        return json({ error: "Redeem this voucher before booking a time" }, 409);
      }
      if (voucher.status === "booked" || voucher.booked_booking_id) {
        return json({ error: "This voucher already has a booking" }, 409);
      }

      const { user } = await getAuthenticatedUser(req, supabaseUrl);
      if (!user) return json({ error: "Sign in to your voucher account before booking a time" }, 401);
      if (user.id !== voucher.redeemed_by_user_id) {
        return json({ error: "This voucher is linked to a different account" }, 403);
      }
      const voucherAccount = await assertVoucherAccount(adminClient, user.id);
      if (!voucherAccount.ok) return json({ error: voucherAccount.error }, 403);

      const startTime = new Date(String(body.startTime || ""));
      const aircraftId = String(body.aircraftId || "");
      const instructorId = String(body.instructorId || "");
      const blockMinutes = Number(product.duration_minutes || 0) + 30;
      const endTime = addMinutes(startTime, blockMinutes);

      if (!Number.isFinite(startTime.getTime()) || !aircraftId || !instructorId) {
        return json({ error: "A valid time, aircraft and instructor are required" }, 400);
      }

      const slots = await buildAvailableSlots(adminClient, product);
      const matchingSlot = slots.find((slot: any) =>
        slot.startTime === startTime.toISOString() &&
        slot.aircraftId === aircraftId &&
        slot.instructorId === instructorId
      );

      if (!matchingSlot) {
        return json({ error: "That time is no longer available. Please choose another time." }, 409);
      }

      const { data: bookingId, error: bookingError } = await adminClient.rpc("book_trial_flight_voucher_slot", {
        p_voucher_id: voucher.id,
        p_student_id: voucher.redeemed_by_user_id,
        p_aircraft_id: aircraftId,
        p_instructor_id: instructorId,
        p_start_time: startTime.toISOString(),
        p_end_time: endTime.toISOString(),
        p_notes: `Trial flight voucher ${voucher.code} - ${product.name}`,
      });

      if (bookingError || !bookingId) {
        const message = bookingError?.message || "Could not create booking";
        const status = /no longer available|not available|already|not ready/i.test(message) ? 409 : 500;
        return json({ error: message }, status);
      }

      const bookedSummary = { ...matchingSlot, bookingId };
      const confirmationEmail = await sendTrialBookingConfirmationEmail({
        voucher,
        product,
        booking: bookedSummary,
      });

      return json({
        voucher: { ...publicVoucher, status: "booked" },
        bookingId,
        booking: bookedSummary,
        confirmationEmailSent: confirmationEmail.sent,
      });
    }

    if (action !== "redeem") return json({ error: "Unsupported action" }, 400);

    if (voucher.status === "booked") return json({ error: "This voucher has already been booked" }, 409);
    if (voucher.status === "redeemed") {
      return json({ error: "This voucher is already linked to an account. Sign in with that voucher account to choose a time." }, 409);
    }
    if (voucher.status !== "issued") {
      return json({ error: "This voucher is not ready to redeem yet. Contact Bendigo Flying Club for help." }, 409);
    }

    const bookingSetup = await getProductBookingSetup(adminClient, product);
    if (!bookingSetup.bookingAvailable) {
      return json({
        error: `This voucher is valid, but booking setup is not ready yet: ${bookingSetup.issue || "no bookable aircraft or instructor is configured"}. Contact Bendigo Flying Club for help.`,
      }, 409);
    }

    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();

    if (!fullName || !email || !phone) {
      return json({ error: "Full name, email and phone are required" }, 400);
    }

    const { data: existingProfile } = await adminClient
      .from("users")
      .select("id,email,portal_access_scope")
      .eq("email", email)
      .maybeSingle();

    let userId = existingProfile?.id;

    if (existingProfile && existingProfile.portal_access_scope !== "trial_voucher") {
      return json({
        error: "This email already belongs to a full Bendigo Flying Club account. Use a different email for this restricted voucher booking account, or contact the club for help linking the voucher.",
      }, 409);
    }

    if (!userId) {
      const tempPassword = crypto.randomUUID() + "A1!";
      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { name: fullName, phone },
      });

      if (authError || !authData.user) {
        return json({ error: authError?.message || "Failed to create voucher account" }, 500);
      }

      userId = authData.user.id;

      const { error: userError } = await adminClient.from("users").upsert({
        id: userId,
        email,
        name: fullName,
        phone,
        role: "student",
        portal_access_scope: "trial_voucher",
      });

      if (userError) return json({ error: userError.message }, 500);

      await adminClient.from("user_roles").upsert({ user_id: userId, role: "student" }, { onConflict: "user_id,role" });
      await adminClient.from("students").upsert({ id: userId, prepaid_balance: 0 }, { onConflict: "id" });
    } else {
      await adminClient.from("users").update({
        name: fullName,
        phone,
        role: "student",
        portal_access_scope: "trial_voucher",
      }).eq("id", userId);
      await adminClient.from("user_roles").upsert({ user_id: userId, role: "student" }, { onConflict: "user_id,role" });
      await adminClient.from("students").upsert({ id: userId, prepaid_balance: 0 }, { onConflict: "id" });
    }

    const { error: redeemError } = await adminClient
      .from("trial_flight_vouchers")
      .update({
        status: voucher.status === "issued" ? "redeemed" : voucher.status,
        redeemed_at: voucher.redeemed_at || new Date().toISOString(),
        redeemed_by_user_id: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", voucher.id);

    if (redeemError) return json({ error: redeemError.message }, 500);

    const redirectTo = String(body.redirectTo || "").trim() || undefined;
    const { data: linkData } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });
    const setupLink = linkData?.properties?.action_link || null;
    const setupEmail = setupLink
      ? await sendVoucherAccountSetupEmail({
          email,
          fullName,
          productName: product.name,
          setupLink,
        })
      : { sent: false, error: "No setup link was generated" };

    return json({
      voucher: { ...publicVoucher, status: "redeemed" },
      userId,
      setupLink,
      setupEmailSent: setupEmail.sent,
      message: "Voucher verified. Account created and voucher linked.",
    });
  } catch (error) {
    console.error("trial-voucher-public error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
