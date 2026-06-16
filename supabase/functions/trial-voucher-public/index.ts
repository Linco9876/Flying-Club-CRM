import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  aircraftMatchesTrialVoucherProduct,
  instructorHasTrialVoucherAircraftEndorsement,
  trialVoucherProductBookingSetup,
} from "../_shared/trialVoucherReadiness.ts";
import { getConnectedStripeAccountId, stripeHeaders } from "../_shared/stripeConnectAccount.ts";

type SupabaseAdminClient = any;

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
const VOUCHER_TIME_ZONE = "Australia/Sydney";
const VOUCHER_SELF_BOOKING_MIN_LEAD_DAYS = 2;
const VOUCHER_SELF_BOOKING_LOOKAHEAD_DAYS = 62;
const VOUCHER_MAX_AVAILABLE_SLOTS = 1500;
const VOUCHER_RESCHEDULE_CUTOFF_HOURS = 72;

type LocalDateParts = { year: number; month: number; day: number };

const localDateFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: VOUCHER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const localDateTimeFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: VOUCHER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const datePartsFromFormatter = (formatter: Intl.DateTimeFormat, date: Date) => {
  const parts = formatter.formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
};

const localDatePartsForInstant = (date: Date): LocalDateParts => {
  const parts = datePartsFromFormatter(localDateFormatter, date);
  return { year: parts.year, month: parts.month, day: parts.day };
};

const localDateKey = (parts: LocalDateParts) => `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;

const addLocalDays = (parts: LocalDateParts, days: number): LocalDateParts =>
  localDatePartsForInstant(new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0, 0)));

const timeZoneOffsetMinutesAt = (date: Date) => {
  const parts = datePartsFromFormatter(localDateTimeFormatter, date);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  return (localAsUtc - date.getTime()) / 60_000;
};

const zonedLocalTimeToUtc = (parts: LocalDateParts, hour: number, minute: number) => {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0);
  const firstOffset = timeZoneOffsetMinutesAt(new Date(localAsUtc));
  const firstUtc = new Date(localAsUtc - firstOffset * 60_000);
  const finalOffset = timeZoneOffsetMinutesAt(firstUtc);
  return new Date(localAsUtc - finalOffset * 60_000);
};

const slotLocalSummary = (start: Date | string, end: Date | string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const localParts = localDatePartsForInstant(startDate);
  const dateLong = new Intl.DateTimeFormat("en-AU", {
    timeZone: VOUCHER_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(startDate);
  const dateShort = new Intl.DateTimeFormat("en-AU", {
    timeZone: VOUCHER_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(startDate);
  const timeFormatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: VOUCHER_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  });

  return {
    localDateKey: localDateKey(localParts),
    localDateLabel: dateLong,
    localDateShortLabel: dateShort,
    localTimeLabel: `${timeFormatter.format(startDate)} - ${timeFormatter.format(endDate)}`,
    timeZone: VOUCHER_TIME_ZONE,
  };
};

const rescheduleDeadlineFor = (start: Date | string) =>
  addMinutes(new Date(start), -VOUCHER_RESCHEDULE_CUTOFF_HOURS * 60);

const canRescheduleBooking = (start: Date | string) =>
  Date.now() <= rescheduleDeadlineFor(start).getTime();

const rescheduleInfoFor = (start: Date | string) => ({
  rescheduleAllowed: canRescheduleBooking(start),
  rescheduleDeadline: rescheduleDeadlineFor(start).toISOString(),
});

const siteOrigin = () => (Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
const isDevelopmentOrigin = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin) ||
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(?::\d+)?$/i.test(origin);
const isAllowedRedirectOrigin = (origin: string) => origin === siteOrigin() || isDevelopmentOrigin(origin);
const safeVoucherRedirectTo = (value: unknown, code: string) => {
  const fallback = `${siteOrigin()}/trial-flight-voucher?voucherCode=${encodeURIComponent(code)}`;
  const raw = String(value || "").trim();
  if (!raw) return fallback;

  try {
    const url = new URL(raw, siteOrigin());
    if (!isAllowedRedirectOrigin(url.origin)) return fallback;
    url.pathname = "/trial-flight-voucher";
    url.searchParams.set("voucherCode", code);
    url.hash = "";
    return url.toString();
  } catch {
    return fallback;
  }
};

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
  const startTimeLabel = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(booking.startTime));
  const finishTimeLabel = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(booking.endTime));
  const flightMinutes = Number(product.duration_minutes || 0);
  const blockMinutes = flightMinutes + 30;
  const bookingUrl = `${siteOrigin()}/trial-flight-voucher?voucherCode=${encodeURIComponent(voucher.code)}`;
  const preheader = `Confirmed for ${dateLabel} at ${startTimeLabel}.`;
  const plainText = [
    `Hi ${toName},`,
    "",
    `Your ${product.name || "trial instructional flight"} is booked.`,
    "",
    `Date: ${dateLabel}`,
    `Arrive: ${startTimeLabel}`,
    `Allow: ${blockMinutes ? `about ${blockMinutes} minutes` : "time for your trial flight"}`,
    `Flight: ${flightMinutes ? `${flightMinutes} minutes` : "as listed on your voucher"}`,
    "",
    `Manage booking: ${bookingUrl}`,
    `Voucher code: ${voucher.code}`,
    "",
    "Please wear comfortable clothing and enclosed shoes. Contact Bendigo Flying Club if you need help.",
  ].join("\n");
  const html = `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  </head>
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:660px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.14);">
            <tr>
              <td style="background:#06152f;background-image:linear-gradient(135deg,#06152f,#0d3b78);padding:30px;color:#ffffff;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#bfdbfe;font-weight:700;">Bendigo Flying Club</p>
                      <h1 style="margin:0;font-size:30px;line-height:1.18;color:#ffffff;">Your trial flight is booked</h1>
                      <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#dbeafe;">We look forward to welcoming you at the club.</p>
                    </td>
                    <td align="right" width="76" style="vertical-align:top;">
                      <div style="display:inline-block;width:56px;height:56px;border-radius:18px;background:#ffffff;color:#0d3b78;text-align:center;line-height:56px;font-weight:900;font-size:18px;box-shadow:0 10px 24px rgba(0,0,0,.18);">BFC</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#0f172a;">Hi ${escapeHtml(toName)},</p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.65;color:#334155;">Your ${escapeHtml(product.name || "trial instructional flight")} is confirmed.</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="padding:0 0 12px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dbeafe;border-radius:18px;background:#f8fbff;">
                        <tr>
                          <td width="54" style="padding:18px 0 18px 18px;vertical-align:top;">
                            <div style="width:38px;height:38px;border-radius:12px;background:#dbeafe;color:#1d4ed8;text-align:center;line-height:38px;font-weight:900;">1</div>
                          </td>
                          <td style="padding:18px 18px 18px 12px;">
                            <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:#64748b;font-weight:800;">Date</p>
                            <p style="margin:0;font-size:18px;line-height:1.35;color:#0f172a;font-weight:800;">${escapeHtml(dateLabel)}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 12px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dbeafe;border-radius:18px;background:#f8fbff;">
                        <tr>
                          <td width="54" style="padding:18px 0 18px 18px;vertical-align:top;">
                            <div style="width:38px;height:38px;border-radius:12px;background:#dbeafe;color:#1d4ed8;text-align:center;line-height:38px;font-weight:900;">2</div>
                          </td>
                          <td style="padding:18px 18px 18px 12px;">
                            <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:#64748b;font-weight:800;">Arrival time</p>
                            <p style="margin:0;font-size:18px;line-height:1.35;color:#0f172a;font-weight:800;">${escapeHtml(startTimeLabel)}</p>
                            <p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:#64748b;">Expected finish around ${escapeHtml(finishTimeLabel)}.</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dbeafe;border-radius:18px;background:#f8fbff;">
                        <tr>
                          <td width="54" style="padding:18px 0 18px 18px;vertical-align:top;">
                            <div style="width:38px;height:38px;border-radius:12px;background:#dbeafe;color:#1d4ed8;text-align:center;line-height:38px;font-weight:900;">3</div>
                          </td>
                          <td style="padding:18px 18px 18px 12px;">
                            <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:#64748b;font-weight:800;">Flight</p>
                            <p style="margin:0;font-size:18px;line-height:1.35;color:#0f172a;font-weight:800;">${escapeHtml(flightMinutes ? `${flightMinutes} minutes` : "As listed on your voucher")}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;">
                  <tr>
                    <td align="center" style="border-radius:14px;background:#2563eb;">
                      <a href="${escapeHtml(bookingUrl)}" style="display:block;padding:15px 20px;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;">View or reschedule booking</a>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;border-radius:18px;background:#f1f5f9;">
                  <tr>
                    <td style="padding:18px;">
                      <p style="margin:0 0 8px;font-size:14px;font-weight:800;color:#0f172a;">Before you arrive</p>
                      <p style="margin:0;color:#475569;font-size:14px;line-height:1.65;">Please wear comfortable clothing and enclosed shoes. If you need to change your booking, you can reschedule online up to 3 days before the flight.</p>
                    </td>
                  </tr>
                </table>

                <p style="margin:0;color:#64748b;font-size:13px;line-height:1.65;">Voucher code: <strong style="color:#0f172a;">${escapeHtml(voucher.code)}</strong></p>
                <p style="margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.65;">Need help? Contact Bendigo Flying Club and we will be happy to assist.</p>
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
      textContent: plainText,
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

const getProductBookingSetup = async (adminClient: SupabaseAdminClient, product: any) => {
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
  return trialVoucherProductBookingSetup(product, aircraftRows || [], endorsementRows || []);
};

const timeForLocalDate = (day: LocalDateParts, time: string, fallbackHour: number, fallbackMinute = 0) => {
  const [hourRaw, minuteRaw] = String(time || "").slice(0, 5).split(":").map(Number);
  const hour = Number.isFinite(hourRaw) ? hourRaw : fallbackHour;
  const minute = Number.isFinite(minuteRaw) ? minuteRaw : fallbackMinute;
  return zonedLocalTimeToUtc(day, hour, minute);
};

const absenceBlocksTime = (absence: any, start: Date, end: Date) => {
  const day = localDatePartsForInstant(start);
  const startDate = localDateKey(day);
  if (startDate < absence.start_date || startDate > absence.end_date) return false;
  const absenceStart = timeForLocalDate(day, absence.start_time || "00:00", 0);
  const absenceEnd = timeForLocalDate(day, absence.end_time || "23:59", 23, 59);
  return overlaps(start, end, absenceStart, absenceEnd);
};

const instructorWindowsForDate = ({
  day,
  dayOfWeek,
  instructorId,
  schedules,
  scheduleChanges,
}: {
  day: LocalDateParts;
  dayOfWeek: number;
  instructorId: string;
  schedules: any[];
  scheduleChanges: any[];
}) => {
  const dayKey = localDateKey(day);
  const matchingChange = (scheduleChanges || [])
    .filter((change: any) =>
      (change.user_id || change.instructor_id) === instructorId &&
      Number(change.day_of_week) === dayOfWeek &&
      String(change.effective_from || change.change_date || "") <= dayKey
    )
    .sort((a: any, b: any) =>
      String(b.effective_from || b.change_date || "").localeCompare(String(a.effective_from || a.change_date || ""))
    )[0];

  const schedule = matchingChange || (schedules || []).find((weekly: any) =>
    (weekly.user_id || weekly.instructor_id) === instructorId &&
    Number(weekly.day_of_week) === dayOfWeek
  );

  if (!schedule?.is_available) return [];

  return [
    [schedule.start_time, schedule.end_time],
    [schedule.afternoon_start_time || schedule.start_time_2, schedule.afternoon_end_time || schedule.end_time_2],
  ].filter(([start, end]) => start && end);
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

const toPublicProduct = (
  product: any,
  aircraftRows: any[] = [],
  endorsementRows: any[] = [],
  stripeConnected = false,
) => {
  const setup = trialVoucherProductBookingSetup(product, aircraftRows, endorsementRows);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    aircraftMode: product.aircraft_mode,
    durationMinutes: product.duration_minutes,
    bookingBlockMinutes: Number(product.duration_minutes || 0) + 30,
    price: Number(product.price || 0),
    checkoutAvailable: stripeConnected && Boolean(product.stripe_price_id) && Number(product.price || 0) > 0 && setup.bookingAvailable,
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

const retrieveStripeCheckoutSession = async (adminClient: SupabaseAdminClient, sessionId: string) => {
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecretKey) return null;
  const connectedAccountId = await getConnectedStripeAccountId(adminClient);
  if (!connectedAccountId) return null;

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: stripeHeaders(stripeSecretKey, connectedAccountId),
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
  adminClient: SupabaseAdminClient;
  supabaseUrl: string;
  voucher: any;
  sessionId: string;
}) => {
  if (voucher.payment_status === "paid" || voucher.delivered_at) {
    return { reconciled: false, email: null };
  }

  const stripeSession = await retrieveStripeCheckoutSession(adminClient, sessionId);
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

const getBookingSummary = async (adminClient: SupabaseAdminClient, bookingId?: string | null) => {
  if (!bookingId) return null;

  const { data: booking, error: bookingError } = await adminClient
    .from("bookings")
    .select("id,start_time,end_time,aircraft_id,instructor_id,status,deleted_at")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) throw bookingError;
  if (!booking || booking.deleted_at || booking.status === "cancelled") return null;

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
    ...slotLocalSummary(booking.start_time, booking.end_time),
    ...rescheduleInfoFor(booking.start_time),
    aircraftId: booking.aircraft_id,
    aircraftLabel: aircraft
      ? `${aircraft.registration || ""} ${aircraft.make || ""} ${aircraft.model || ""}`.trim()
      : "Aircraft",
    instructorId: booking.instructor_id,
    instructorName: instructor?.name || "Instructor",
  };
};

const assertVoucherAccount = async (adminClient: SupabaseAdminClient, userId: string) => {
  const { data: linkedUser, error } = await adminClient
    .from("users")
    .select("id,email,name,portal_access_scope,is_active,trial_voucher_password_set_at")
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

const assertVoucherPasswordSet = (voucherAccount: { user?: any }) => {
  if (!voucherAccount.user?.trial_voucher_password_set_at) {
    return {
      ok: false,
      error: "Set your voucher account password before viewing available times.",
      passwordSetupRequired: true,
    };
  }

  return { ok: true };
};

const getActiveBookingForReschedule = async (adminClient: SupabaseAdminClient, bookingId?: string | null) => {
  if (!bookingId) return null;

  const { data: booking, error } = await adminClient
    .from("bookings")
    .select("id,start_time,end_time,aircraft_id,instructor_id,status,deleted_at")
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw error;
  if (!booking || booking.deleted_at || booking.status === "cancelled") return null;
  return booking;
};

const buildAvailableSlots = async (adminClient: SupabaseAdminClient, product: any) => {
  const blockMinutes = Number(product.duration_minutes || 0) + 30;
  const allowedInstructorIds = new Set<string>(product.instructor_ids || []);
  if (!blockMinutes || allowedInstructorIds.size === 0) return [];

  const [
    { data: aircraftRows, error: aircraftError },
    { data: bookings, error: bookingsError },
    { data: schedules, error: schedulesError },
    { data: scheduleChanges, error: scheduleChangesError },
    { data: absences, error: absencesError },
    { data: users, error: usersError },
    { data: endorsements, error: endorsementsError },
  ] = await Promise.all([
    adminClient.from("aircraft").select("id,registration,make,model,status,required_endorsement_type"),
    adminClient.from("bookings").select("id,aircraft_id,instructor_id,start_time,end_time,status,deleted_at,has_conflict"),
    adminClient.from("instructor_weekly_schedules").select("*"),
    adminClient.from("instructor_schedule_changes").select("*"),
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
  if (scheduleChangesError) throw scheduleChangesError;
  if (absencesError) throw absencesError;
  if (usersError) throw usersError;
  if (endorsementsError) throw endorsementsError;

  const eligibleAircraft = (aircraftRows || [])
    .filter((aircraft: any) => aircraft.status === "serviceable")
    .filter((aircraft: any) => aircraftMatchesTrialVoucherProduct(aircraft, product))
    .sort((a: any, b: any) => String(a.registration || "").localeCompare(String(b.registration || "")));
  const userMap = new Map((users || []).map((user: any) => [user.id, user.name]));
  const endorsementsByInstructor = new Map<string, any[]>();
  (endorsements || []).forEach((endorsement: any) => {
    const instructorEndorsements = endorsementsByInstructor.get(endorsement.student_id) || [];
    instructorEndorsements.push(endorsement);
    endorsementsByInstructor.set(endorsement.student_id, instructorEndorsements);
  });
  const now = new Date();
  const horizon = addMinutes(now, 60 * 24 * VOUCHER_SELF_BOOKING_LOOKAHEAD_DAYS);
  const activeBookings = (bookings || []).filter((booking: any) =>
    !booking.deleted_at &&
    ["confirmed", "pending_approval"].includes(booking.status) &&
    new Date(booking.end_time) >= now &&
    new Date(booking.start_time) <= horizon
  );

  const slots: any[] = [];
  const slotKeys = new Set<string>();
  const aircraftUseCount = new Map<string, number>();

  const today = localDatePartsForInstant(now);
  for (let dayOffset = VOUCHER_SELF_BOOKING_MIN_LEAD_DAYS; dayOffset <= VOUCHER_SELF_BOOKING_LOOKAHEAD_DAYS; dayOffset += 1) {
    const day = addLocalDays(today, dayOffset);
    const dayOfWeek = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();

    for (const instructorId of allowedInstructorIds) {
      const windows = instructorWindowsForDate({
        day,
        dayOfWeek,
        instructorId,
        schedules: schedules || [],
        scheduleChanges: scheduleChanges || [],
      });

      for (const [windowStartRaw, windowEndRaw] of windows) {
        const windowStart = timeForLocalDate(day, windowStartRaw, 9);
        const windowEnd = timeForLocalDate(day, windowEndRaw, 17);
        for (let cursor = new Date(windowStart); addMinutes(cursor, blockMinutes) <= windowEnd; cursor = addMinutes(cursor, 30)) {
          const start = new Date(cursor);
          const end = addMinutes(start, blockMinutes);
          if (start < addMinutes(now, 120)) continue;
          if (localDateKey(localDatePartsForInstant(start)) !== localDateKey(localDatePartsForInstant(end))) {
            continue;
          }
          if ((absences || []).some((absence: any) => (absence.user_id || absence.instructor_id) === instructorId && absenceBlocksTime(absence, start, end))) {
            continue;
          }

          const slotKey = `${start.toISOString()}-${end.toISOString()}`;
          if (slotKeys.has(slotKey)) continue;

          const availableAircraft = eligibleAircraft
            .filter((candidate: any) =>
              instructorHasTrialVoucherAircraftEndorsement(instructorId, candidate, endorsementsByInstructor) &&
              !activeBookings.some((booking: any) =>
                overlaps(start, end, booking.start_time, booking.end_time) &&
                (booking.aircraft_id === candidate.id || booking.instructor_id === instructorId)
              )
            )
            .sort((a: any, b: any) => {
              const useDiff = (aircraftUseCount.get(a.id) || 0) - (aircraftUseCount.get(b.id) || 0);
              if (useDiff !== 0) return useDiff;
              return String(a.registration || "").localeCompare(String(b.registration || ""));
            });

          const aircraft = availableAircraft[0];

          if (!aircraft) continue;
          slotKeys.add(slotKey);
          aircraftUseCount.set(aircraft.id, (aircraftUseCount.get(aircraft.id) || 0) + 1);

          slots.push({
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            ...slotLocalSummary(start, end),
            aircraftId: aircraft.id,
            aircraftLabel: `${aircraft.registration} ${aircraft.make || ""} ${aircraft.model || ""}`.trim(),
            instructorId,
            instructorName: userMap.get(instructorId) || "Instructor",
          });

          if (slots.length >= VOUCHER_MAX_AVAILABLE_SLOTS) return slots;
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
      const stripeConnected = Boolean(await getConnectedStripeAccountId(adminClient));
      return json({
        stripeConnected,
        products: (products || []).map((product: any) =>
          toPublicProduct(product, aircraftRows || [], endorsementRows || [], stripeConnected)
        ),
      });
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
          id,
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

      if (!checkoutEmail && voucher.payment_status === "paid" && !voucher.delivered_at) {
        const deliveryAt = voucher.recipient_delivery_at ? new Date(voucher.recipient_delivery_at) : null;
        const isFutureRecipientDelivery = Boolean(
          voucher.send_to_recipient &&
          deliveryAt &&
          deliveryAt.getTime() > Date.now()
        );

        if (!isFutureRecipientDelivery) {
          const internalSecret = Deno.env.get("TRIAL_VOUCHER_INTERNAL_SECRET");
          if (internalSecret) {
            try {
              checkoutEmail = await sendVoucherEmailFromCheckoutStatus({
                supabaseUrl,
                internalSecret,
                voucherId: voucher.id,
              });
            } catch (error) {
              checkoutWarning = error instanceof Error ? error.message : "Payment succeeded, but voucher email retry failed";
              console.warn("Voucher email retry from checkout status failed:", error);
            }
          } else {
            checkoutWarning = "Payment succeeded, but voucher email cannot be retried because the internal email secret is not configured";
          }
        }
      }

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
      const passwordStatus = assertVoucherPasswordSet(voucherAccount);
      if (!passwordStatus.ok) {
        const booking = voucher.status === "booked" ? await getBookingSummary(adminClient, voucher.booked_booking_id) : null;
        return json({
          voucher: publicVoucher,
          slots: [],
          booking,
          passwordSetupRequired: true,
          error: passwordStatus.error,
        });
      }

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

      const redirectTo = safeVoucherRedirectTo(body.redirectTo, voucher.code);
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: linkedUser.email,
        options: { redirectTo },
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
      const passwordStatus = assertVoucherPasswordSet(voucherAccount);
      if (!passwordStatus.ok) return json({ ...passwordStatus, voucher: publicVoucher, slots: [] });

      if (!["redeemed"].includes(voucher.status)) {
        return json({ error: "This voucher is not available for booking" }, 409);
      }

      const slots = await buildAvailableSlots(adminClient, product);
      return json({ voucher: publicVoucher, slots });
    }

    if (action === "reschedule-availability") {
      if (!voucher.redeemed_by_user_id) {
        return json({ error: "Redeem this voucher before changing a booking" }, 409);
      }
      if (voucher.status !== "booked" || !voucher.booked_booking_id) {
        return json({ error: "This voucher does not have a booking to reschedule" }, 409);
      }

      const { user } = await getAuthenticatedUser(req, supabaseUrl);
      if (!user) return json({ error: "Sign in to your voucher account before changing this booking" }, 401);
      if (user.id !== voucher.redeemed_by_user_id) {
        return json({ error: "This voucher is linked to a different account" }, 403);
      }
      const voucherAccount = await assertVoucherAccount(adminClient, user.id);
      if (!voucherAccount.ok) return json({ error: voucherAccount.error }, 403);
      const passwordStatus = assertVoucherPasswordSet(voucherAccount);
      if (!passwordStatus.ok) {
        const currentBooking = await getActiveBookingForReschedule(adminClient, voucher.booked_booking_id);
        return json({
          ...passwordStatus,
          voucher: publicVoucher,
          slots: [],
          booking: currentBooking ? await getBookingSummary(adminClient, currentBooking.id) : null,
        });
      }

      const currentBooking = await getActiveBookingForReschedule(adminClient, voucher.booked_booking_id);
      if (!currentBooking) return json({ error: "The current booking could not be found. Contact Bendigo Flying Club for help." }, 404);
      if (!canRescheduleBooking(currentBooking.start_time)) {
        return json({
          error: "Online rescheduling closes 3 days before the booking. Please contact Bendigo Flying Club.",
          booking: await getBookingSummary(adminClient, currentBooking.id),
        }, 409);
      }

      const [slots, booking] = await Promise.all([
        buildAvailableSlots(adminClient, product),
        getBookingSummary(adminClient, currentBooking.id),
      ]);
      return json({ voucher: publicVoucher, slots, booking });
    }

    if (action === "reschedule") {
      if (!voucher.redeemed_by_user_id) {
        return json({ error: "Redeem this voucher before changing a booking" }, 409);
      }
      if (voucher.status !== "booked" || !voucher.booked_booking_id) {
        return json({ error: "This voucher does not have a booking to reschedule" }, 409);
      }

      const { user } = await getAuthenticatedUser(req, supabaseUrl);
      if (!user) return json({ error: "Sign in to your voucher account before changing this booking" }, 401);
      if (user.id !== voucher.redeemed_by_user_id) {
        return json({ error: "This voucher is linked to a different account" }, 403);
      }
      const voucherAccount = await assertVoucherAccount(adminClient, user.id);
      if (!voucherAccount.ok) return json({ error: voucherAccount.error }, 403);
      const passwordStatus = assertVoucherPasswordSet(voucherAccount);
      if (!passwordStatus.ok) return json({ ...passwordStatus, voucher: publicVoucher });

      const currentBooking = await getActiveBookingForReschedule(adminClient, voucher.booked_booking_id);
      if (!currentBooking) return json({ error: "The current booking could not be found. Contact Bendigo Flying Club for help." }, 404);
      if (!canRescheduleBooking(currentBooking.start_time)) {
        return json({ error: "Online rescheduling closes 3 days before the booking. Please contact Bendigo Flying Club." }, 409);
      }

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

      const nowIso = new Date().toISOString();
      const { error: cancelError } = await adminClient
        .from("bookings")
        .update({ status: "cancelled", deleted_at: nowIso, updated_at: nowIso })
        .eq("id", currentBooking.id)
        .is("deleted_at", null);

      if (cancelError) return json({ error: cancelError.message }, 500);

      const { error: voucherResetError } = await adminClient
        .from("trial_flight_vouchers")
        .update({ status: "redeemed", booked_booking_id: null, updated_at: nowIso })
        .eq("id", voucher.id);

      if (voucherResetError) {
        await adminClient
          .from("bookings")
          .update({ status: currentBooking.status, deleted_at: currentBooking.deleted_at, updated_at: nowIso })
          .eq("id", currentBooking.id);
        return json({ error: voucherResetError.message }, 500);
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
        await Promise.all([
          adminClient
            .from("bookings")
            .update({ status: currentBooking.status, deleted_at: currentBooking.deleted_at, updated_at: nowIso })
            .eq("id", currentBooking.id),
          adminClient
            .from("trial_flight_vouchers")
            .update({ status: "booked", booked_booking_id: currentBooking.id, updated_at: nowIso })
            .eq("id", voucher.id),
        ]);
        const message = bookingError?.message || "Could not reschedule booking";
        const status = /no longer available|not available|already|not ready/i.test(message) ? 409 : 500;
        return json({ error: message }, status);
      }

      const bookedSummary = { ...matchingSlot, bookingId, ...rescheduleInfoFor(matchingSlot.startTime) };
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
      const passwordStatus = assertVoucherPasswordSet(voucherAccount);
      if (!passwordStatus.ok) return json({ ...passwordStatus, voucher: publicVoucher });

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

    const redirectTo = safeVoucherRedirectTo(body.redirectTo, voucher.code);
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    if (linkError) {
      return json({
        error: `Voucher linked, but the setup link could not be generated: ${linkError.message}. Use the admin resend setup link action or contact Bendigo Flying Club for help.`,
      }, 500);
    }

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
