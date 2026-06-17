import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getConnectedStripeAccountId, stripeHeaders } from "../_shared/stripeConnectAccount.ts";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return json({ error: "Stripe is not configured in Supabase Edge Function secrets." }, 503);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

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
        aircraft!flight_logs_aircraft_id_fkey(registration),
        users!flight_logs_student_id_fkey(name, email),
        flight_types(name)
      `)
      .eq("id", flightLogId)
      .maybeSingle();
    if (flightError) throw flightError;
    if (!flightLog) return json({ error: "Flight log not found." }, 404);
    if (flightLog.payment_status === "paid") return json({ error: "This flight is already marked as paid." }, 409);

    const amountCents = dollarsToCents(flightLog.calculated_cost);
    if (!amountCents || amountCents <= 0) {
      return json({ error: "This flight does not have a charge to collect." }, 409);
    }

    const student = firstJoinRow(flightLog.users) as { name?: unknown; email?: unknown } | undefined;
    const aircraft = firstJoinRow(flightLog.aircraft) as { registration?: unknown } | undefined;
    const flightType = firstJoinRow(flightLog.flight_types) as { name?: unknown } | undefined;
    const studentName = cleanText(student?.name) || "Member";
    const studentEmail = cleanText(student?.email);
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
    form.set("metadata[flight_log_id]", flightLog.id);
    form.set("metadata[student_id]", flightLog.student_id || "");
    form.set("metadata[booking_id]", flightLog.booking_id || "");
    form.set("metadata[payment_method_id]", stripeMethod.id);
    if (studentEmail) form.set("customer_email", studentEmail);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
        "Content-Type": "application/x-www-form-urlencoded",
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
      })
      .eq("id", flightLog.id);
    if (updateError) throw updateError;

    return json({
      checkoutUrl: session.url,
      sessionId: session.id,
      flightLogId: flightLog.id,
    });
  } catch (error) {
    console.error("create-flight-payment-checkout error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
