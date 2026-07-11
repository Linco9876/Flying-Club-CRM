import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getConnectedStripeAccountId, stripeHeaders, stripeIdempotencyKey } from "../_shared/stripeConnectAccount.ts";
import { addStripeModeMetadata, getActiveStripeMode, stripeModeColumns, testModeSubject } from "../_shared/stripeMode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const cleanText = (value: unknown) => String(value || "").trim();
const siteOrigin = () => (Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
const isDevelopmentOrigin = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin) ||
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(?::\d+)?$/i.test(origin);
const isAllowedReturnOrigin = (origin: string) => origin === siteOrigin() || isDevelopmentOrigin(origin);

const safeReturnUrl = (value: unknown, fallbackPath: string) => {
  const fallback = `${siteOrigin()}${fallbackPath}`;
  const raw = cleanText(value);
  if (!raw) return fallback;

  try {
    const url = new URL(raw, siteOrigin());
    if (!isAllowedReturnOrigin(url.origin)) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
};

const dollarsToCents = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
};
const centsToDollars = (value: number) => Math.round((value / 100 + Number.EPSILON) * 100) / 100;

const firstJoinRow = (value: unknown) => Array.isArray(value) ? value[0] : value;

const hasStaffRole = async (adminClient: any, userId: string) => {
  const { data, error } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "instructor", "senior_instructor"]);
  if (error) throw error;
  return (data || []).length > 0;
};

const sendEmail = async ({
  to,
  toName,
  subject,
  html,
}: {
  to: string;
  toName?: string;
  subject: string;
  html: string;
}) => {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) return { sent: false, error: "BREVO_API_KEY is not configured" };

  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@bendigoflyingclub.com.au";
  const senderName = Deno.env.get("BREVO_SENDER_NAME") || "Bendigo Flying Club";

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { sent: false, error: body || `Brevo email failed with ${response.status}` };
  }

  return { sent: true, error: null };
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildFlightPaymentEmail = ({
  memberName,
  aircraftRegistration,
  flightTypeName,
  flightDate,
  amount,
  checkoutUrl,
}: {
  memberName: string;
  aircraftRegistration: string;
  flightTypeName: string;
  flightDate: string;
  amount: number;
  checkoutUrl: string;
}) => `<!doctype html>
<html>
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.16);">
            <tr>
              <td style="background:linear-gradient(135deg,#06152f,#0d3b78);padding:32px 30px;color:#ffffff;">
                <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#bfdbfe;font-weight:700;">Bendigo Flying Club</p>
                <h1 style="margin:0;font-size:28px;line-height:1.15;">Your flight payment link is ready</h1>
                <p style="margin:14px 0 0;color:#dbeafe;font-size:15px;line-height:1.6;">Pay securely online using the Stripe link below.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 30px;">
                <p style="margin:0 0 16px;font-size:17px;line-height:1.6;color:#0f172a;">Hi ${escapeHtml(memberName || "there")},</p>
                <p style="margin:0 0 18px;line-height:1.65;color:#334155;">Your ${escapeHtml(flightTypeName)} on ${escapeHtml(flightDate)} in ${escapeHtml(aircraftRegistration)} has been logged and is ready for payment.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;border:1px solid #dbeafe;border-radius:18px;background:#f8fbff;">
                  <tr>
                    <td style="padding:18px;">
                      <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#2563eb;font-weight:700;">Amount due</p>
                      <p style="margin:0;font-size:28px;font-weight:800;color:#0f172a;">AUD $${escapeHtml(amount.toFixed(2))}</p>
                      <p style="margin:8px 0 0;color:#475569;font-size:14px;">${escapeHtml(flightTypeName)} · ${escapeHtml(aircraftRegistration)}</p>
                    </td>
                  </tr>
                </table>
                <p style="margin:26px 0;">
                  <a href="${escapeHtml(checkoutUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;border-radius:14px;padding:14px 22px;">Pay securely with Stripe</a>
                </p>
                <p style="margin:0 0 10px;color:#64748b;font-size:13px;line-height:1.6;">If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:0;color:#2563eb;font-size:13px;line-height:1.6;word-break:break-all;">${escapeHtml(checkoutUrl)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const stripeMode = await getActiveStripeMode(adminClient);
    const stripeSecretKey = stripeMode.secretKey;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Authentication is required." }, 401);

    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData?.user?.id) return json({ error: "Invalid session." }, 401);
    if (!(await hasStaffRole(adminClient, authData.user.id))) {
      return json({ error: "Only staff can create flight payment links." }, 403);
    }

    const connectedAccountId = await getConnectedStripeAccountId(adminClient);
    if (!connectedAccountId) {
      return json({ error: "Connect this club's Stripe account in Settings > Integrations first." }, 503);
    }

    const { data: stripeMethod, error: methodError } = await adminClient
      .from("payment_methods")
      .select("id,name,active,system_key")
      .eq("system_key", "stripe_card")
      .maybeSingle();
    if (methodError) throw methodError;
    if (!stripeMethod?.active) {
      return json({ error: "Activate Stripe Card Payment in Billing & Rates before taking flight payments." }, 409);
    }

    const body = await req.json();
    const flightLogId = cleanText(body.flightLogId);
    const requestedAmountCents = dollarsToCents(body.amount);
    const sendPaymentEmail = body.sendEmail === true;
    const successUrl = safeReturnUrl(body.successUrl, "/billing?stripe_flight=success");
    const cancelUrl = safeReturnUrl(body.cancelUrl, "/billing?stripe_flight=cancelled");

    if (!flightLogId) return json({ error: "Flight log ID is required." }, 400);

    const { data: flightLog, error: flightError } = await adminClient
      .from("flight_logs")
      .select(`
        id,
        booking_id,
        student_id,
        instructor_id,
        start_time,
        flight_duration,
        calculated_cost,
        payment_status,
        payment_type,
        stripe_checkout_session_id,
        booking:booking_id(
          is_guest_booking,
          guest_name,
          guest_email,
          guest_phone
        ),
        aircraft!flight_logs_aircraft_id_fkey(registration),
        users!flight_logs_student_id_fkey(name, email),
        flight_types(name)
      `)
      .eq("id", flightLogId)
      .maybeSingle();
    if (flightError) throw flightError;
    if (!flightLog) return json({ error: "Flight log not found." }, 404);
    if (flightLog.payment_status === "paid") return json({ error: "This flight is already marked as paid." }, 409);

    const fullAmountCents = dollarsToCents(flightLog.calculated_cost);
    if (!fullAmountCents || fullAmountCents <= 0) {
      return json({ error: "This flight does not have a charge to collect." }, 409);
    }

    const { data: paymentRows, error: paymentsError } = await adminClient
      .from("account_transactions")
      .select("amount")
      .eq("flight_log_id", flightLog.id)
      .eq("type", "flight_charge")
      .eq("verified_status", "verified");
    if (paymentsError) throw paymentsError;

    const paidCents = (paymentRows || []).reduce((total: number, tx: any) => {
      const cents = dollarsToCents(tx.amount);
      return total + (cents || 0);
    }, 0);
    const remainingCents = Math.max(0, fullAmountCents - paidCents);
    if (remainingCents <= 0) return json({ error: "This flight is already fully paid." }, 409);

    const amountCents = requestedAmountCents && requestedAmountCents > 0
      ? Math.min(requestedAmountCents, remainingCents)
      : remainingCents;
    if (amountCents <= 0) return json({ error: "Enter an amount greater than $0." }, 400);

    const student = firstJoinRow(flightLog.users) as { name?: unknown; email?: unknown } | undefined;
    const booking = firstJoinRow((flightLog as any).booking) as {
      is_guest_booking?: unknown;
      guest_name?: unknown;
      guest_email?: unknown;
    } | undefined;
    const aircraft = firstJoinRow(flightLog.aircraft) as { registration?: unknown } | undefined;
    const flightType = firstJoinRow(flightLog.flight_types) as { name?: unknown } | undefined;
    const isGuestBooking = Boolean(booking?.is_guest_booking);
    const studentName = cleanText(isGuestBooking ? booking?.guest_name : student?.name) || "Member";
    const studentEmail = cleanText(isGuestBooking ? booking?.guest_email : student?.email);
    const aircraftRegistration = cleanText(aircraft?.registration) || "aircraft";
    const flightTypeName = cleanText(flightType?.name) || "Flight";
    const flightDate = flightLog.start_time ? new Date(flightLog.start_time).toLocaleDateString("en-AU") : "flight";

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("line_items[0][price_data][currency]", "aud");
    form.set("line_items[0][price_data][unit_amount]", String(amountCents));
    form.set("line_items[0][price_data][product_data][name]", `${flightTypeName} - ${aircraftRegistration}`);
    form.set("line_items[0][price_data][product_data][description]", `${studentName} flight charge, ${flightDate}`);
    form.set("line_items[0][quantity]", "1");
    form.set("success_url", `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", cancelUrl);
    form.set("client_reference_id", flightLog.id);
    form.set("metadata[crm_payment_type]", "flight_log");
    addStripeModeMetadata(form, stripeMode.mode);
    form.set("metadata[flight_log_id]", flightLog.id);
    form.set("metadata[student_id]", flightLog.student_id || "");
    form.set("metadata[booking_id]", flightLog.booking_id || "");
    form.set("metadata[payment_method_id]", stripeMethod.id);
    form.set("metadata[split_payment_amount]", centsToDollars(amountCents).toFixed(2));
    form.set("metadata[split_payment_remaining_before]", centsToDollars(remainingCents).toFixed(2));
    if (studentEmail) form.set("customer_email", studentEmail);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": stripeIdempotencyKey(
          "flight-checkout",
          flightLog.id,
          flightLog.student_id,
          amountCents,
          remainingCents,
        ),
      }),
      body: form,
    });

    const session = await stripeResponse.json();
    if (!stripeResponse.ok) {
      return json({ error: session?.error?.message || "Stripe checkout could not be created." }, 502);
    }

    const { error: updateError } = await adminClient
      .from("flight_logs")
      .update({
        payment_status: "pending",
        payment_type: stripeMethod.name,
        stripe_checkout_session_id: session.id,
        stripe_payment_status: session.payment_status || "unpaid",
        stripe_checkout_created_at: new Date().toISOString(),
        ...stripeModeColumns(stripeMode.mode),
      })
      .eq("id", flightLog.id);
    if (updateError) throw updateError;

    let emailSent = false;
    let emailError: string | null = null;
    if (sendPaymentEmail && studentEmail) {
      const emailResult = await sendEmail({
        to: studentEmail,
        toName: studentName,
        subject: testModeSubject(stripeMode.mode, `Flight payment link - ${flightTypeName} ${aircraftRegistration}`.trim()),
        html: buildFlightPaymentEmail({
          memberName: studentName,
          aircraftRegistration,
          flightTypeName,
          flightDate,
          amount: centsToDollars(amountCents),
          checkoutUrl: session.url,
        }),
      });
      emailSent = emailResult.sent;
      emailError = emailResult.error;
    } else if (sendPaymentEmail && !studentEmail) {
      emailError = "No email address is stored for this booking.";
    }

    return json({
      checkoutUrl: session.url,
      sessionId: session.id,
      flightLogId: flightLog.id,
      emailSent,
      emailError,
      emailTo: studentEmail || null,
    });
  } catch (error) {
    console.error("create-flight-payment-checkout error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
