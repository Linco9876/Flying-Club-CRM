import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getConnectedStripeAccountId, stripeHeaders, stripeIdempotencyKey } from "../_shared/stripeConnectAccount.ts";

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
const dollarsToCents = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
};
const firstJoinRow = (value: unknown) => Array.isArray(value) ? value[0] : value;
const centsToDollars = (value: number) => Math.round((value / 100 + Number.EPSILON) * 100) / 100;

const getAuthUser = async (adminClient: any, req: Request) => {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("Authentication is required."), { status: 401 });
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user?.id) throw Object.assign(new Error("Invalid session."), { status: 401 });
  return data.user;
};

const hasStaffRole = async (adminClient: any, userId: string) => {
  const { data, error } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "instructor", "senior_instructor"]);
  if (error) throw error;
  return (data || []).length > 0;
};

const markFlightPaid = async ({
  adminClient,
  flightLog,
  paymentMethod,
  paymentIntent,
  amountDollars,
}: {
  adminClient: any;
  flightLog: any;
  paymentMethod: any;
  paymentIntent: any;
  amountDollars: number;
}) => {
  const now = new Date().toISOString();
  const aircraft = firstJoinRow(flightLog.aircraft) as { registration?: unknown } | undefined;
  const aircraftRegistration = cleanText(aircraft?.registration) || "aircraft";
  const flightDate = flightLog.start_time ? new Date(flightLog.start_time).toLocaleDateString("en-AU") : "flight";
  const description = `Stripe saved card payment (${paymentIntent.id}) - ${aircraftRegistration} flight on ${flightDate}`;
  const flightCost = Number(flightLog.calculated_cost || 0);

  const { data: existingTx, error: existingTxError } = await adminClient
    .from("account_transactions")
    .select("id")
    .eq("flight_log_id", flightLog.id)
    .eq("type", "flight_charge")
    .ilike("description", `%${paymentIntent.id}%`)
    .maybeSingle();
  if (existingTxError) throw existingTxError;

  const { data: currentPayments, error: currentPaymentsError } = await adminClient
    .from("account_transactions")
    .select("amount")
    .eq("flight_log_id", flightLog.id)
    .eq("type", "flight_charge")
    .eq("verified_status", "verified");
  if (currentPaymentsError) throw currentPaymentsError;

  const paidBefore = (currentPayments || []).reduce((sum: number, tx: any) => sum + Number(tx.amount || 0), 0);
  const remaining = Math.max(0, centsToDollars(dollarsToCents(flightCost - paidBefore) || 0));
  const appliedAmount = existingTx ? 0 : Math.max(0, Math.min(amountDollars, remaining));
  const totalPaidDollars = paidBefore + appliedAmount;
  const isFullyPaid = totalPaidDollars + 0.005 >= flightCost;

  const { error: updateError } = await adminClient
    .from("flight_logs")
    .update({
      payment_status: isFullyPaid ? "paid" : "pending",
      payment_type: paymentMethod?.name || "Stripe Card Payment",
      stripe_payment_intent_id: paymentIntent.id,
      stripe_payment_status: paymentIntent.status,
      stripe_paid_at: isFullyPaid ? now : null,
      stripe_charge_attempted_at: now,
      stripe_payment_error: null,
      updated_at: now,
    })
    .eq("id", flightLog.id);
  if (updateError) throw updateError;

  if (!existingTx && appliedAmount > 0) {
    const { error: txError } = await adminClient
      .from("account_transactions")
      .insert({
        user_id: flightLog.student_id,
        type: "flight_charge",
        amount: appliedAmount,
        description,
        flight_log_id: flightLog.id,
        payment_method_id: paymentMethod?.id || null,
        balance_after: null,
        verified_status: "verified",
      });
    if (txError) throw txError;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) return json({ error: "Stripe is not configured." }, 503);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const user = await getAuthUser(adminClient, req);
    if (!(await hasStaffRole(adminClient, user.id))) {
      return json({ error: "Only staff can charge a saved card." }, 403);
    }

    const connectedAccountId = await getConnectedStripeAccountId(adminClient);
    if (!connectedAccountId) return json({ error: "Stripe is not connected for this club." }, 503);

    const body = await req.json();
    const flightLogId = cleanText(body.flightLogId);
    const requestedAmountCents = dollarsToCents(body.amount);
    if (!flightLogId) return json({ error: "Flight log ID is required." }, 400);

    const { data: stripeMethod, error: methodError } = await adminClient
      .from("payment_methods")
      .select("id,name,active,system_key")
      .eq("system_key", "stripe_card")
      .maybeSingle();
    if (methodError) throw methodError;
    if (!stripeMethod?.active) return json({ error: "Stripe Card Payment is not active in Billing & Rates." }, 409);

    const { data: flightLog, error: flightError } = await adminClient
      .from("flight_logs")
      .select(`
        id,
        booking_id,
        student_id,
        start_time,
        flight_duration,
        calculated_cost,
        payment_status,
        payment_type,
        aircraft!flight_logs_aircraft_id_fkey(registration),
        users!flight_logs_student_id_fkey(name, email),
        flight_types(name)
      `)
      .eq("id", flightLogId)
      .maybeSingle();
    if (flightError) throw flightError;
    if (!flightLog) return json({ error: "Flight log not found." }, 404);
    if (flightLog.payment_status === "paid") return json({ error: "This flight is already paid." }, 409);

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

    const { data: savedCard, error: cardError } = await adminClient
      .from("member_stripe_payment_methods")
      .select("id,stripe_customer_id,stripe_payment_method_id,card_brand,card_last4,active,is_default,consent_accepted_at")
      .eq("user_id", flightLog.student_id)
      .eq("active", true)
      .eq("is_default", true)
      .maybeSingle();
    if (cardError) throw cardError;
    if (!savedCard) {
      return json({ error: "This member has not saved a card for automatic flight payments." }, 409);
    }
    if (!savedCard.consent_accepted_at) {
      return json({ error: "This member's saved card authority is incomplete. Ask them to save their card again before charging it." }, 409);
    }

    const aircraft = firstJoinRow(flightLog.aircraft) as { registration?: unknown } | undefined;
    const student = firstJoinRow(flightLog.users) as { name?: unknown; email?: unknown } | undefined;
    const flightType = firstJoinRow(flightLog.flight_types) as { name?: unknown } | undefined;
    const aircraftRegistration = cleanText(aircraft?.registration) || "aircraft";
    const studentName = cleanText(student?.name) || "Member";
    const flightTypeName = cleanText(flightType?.name) || "Flight";
    const flightDate = flightLog.start_time ? new Date(flightLog.start_time).toLocaleDateString("en-AU") : "flight";

    const form = new URLSearchParams();
    form.set("amount", String(amountCents));
    form.set("currency", "aud");
    form.set("customer", savedCard.stripe_customer_id);
    form.set("payment_method", savedCard.stripe_payment_method_id);
    form.set("off_session", "true");
    form.set("confirm", "true");
    form.set("description", `${flightTypeName} - ${aircraftRegistration} - ${studentName} - ${flightDate}`);
    form.set("metadata[crm_payment_type]", "flight_log_off_session");
    form.set("metadata[flight_log_id]", flightLog.id);
    form.set("metadata[student_id]", flightLog.student_id || "");
    form.set("metadata[payment_method_id]", stripeMethod.id);
    form.set("metadata[charged_by_user_id]", user.id);
    form.set("metadata[split_payment_amount]", centsToDollars(amountCents).toFixed(2));
    form.set("metadata[split_payment_remaining_before]", centsToDollars(remainingCents).toFixed(2));

    const paymentResponse = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": stripeIdempotencyKey(
          "flight-saved-card",
          flightLog.id,
          flightLog.student_id,
          amountCents,
          remainingCents,
          user.id,
        ),
      }),
      body: form,
    });

    const paymentIntent = await paymentResponse.json();
    const now = new Date().toISOString();
    if (!paymentResponse.ok) {
      const errorMessage = paymentIntent?.error?.message || "Stripe payment failed.";
      await adminClient
        .from("flight_logs")
        .update({
          payment_status: "pending",
          payment_type: stripeMethod.name,
          stripe_payment_intent_id: paymentIntent?.error?.payment_intent?.id || null,
          stripe_payment_status: paymentIntent?.error?.payment_intent?.status || "failed",
          stripe_payment_error: errorMessage,
          stripe_charge_attempted_at: now,
          updated_at: now,
        })
        .eq("id", flightLog.id);
      return json({ error: errorMessage, requiresAction: paymentIntent?.error?.code === "authentication_required" }, 402);
    }

    if (paymentIntent.status === "succeeded") {
      await markFlightPaid({
        adminClient,
        flightLog,
        paymentMethod: stripeMethod,
        paymentIntent,
        amountDollars: amountCents / 100,
      });
      return json({ ok: true, status: paymentIntent.status, paymentIntentId: paymentIntent.id });
    }

    await adminClient
      .from("flight_logs")
      .update({
        payment_status: "pending",
        payment_type: stripeMethod.name,
        stripe_payment_intent_id: paymentIntent.id,
        stripe_payment_status: paymentIntent.status,
        stripe_payment_error: paymentIntent.status === "requires_action"
          ? "The cardholder needs to authenticate this payment before it can be completed."
          : null,
        stripe_charge_attempted_at: now,
        updated_at: now,
      })
      .eq("id", flightLog.id);

    return json({
      ok: false,
      status: paymentIntent.status,
      paymentIntentId: paymentIntent.id,
      requiresAction: paymentIntent.status === "requires_action",
    }, 202);
  } catch (error) {
    const status = typeof (error as any)?.status === "number" ? (error as any).status : 500;
    console.error("charge-flight-saved-card error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, status);
  }
});
