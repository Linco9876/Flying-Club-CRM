import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getConnectedStripeAccountId, stripeHeaders } from "../_shared/stripeConnectAccount.ts";

type SupabaseAdminClient = any;

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getSignatureParts = (header: string) => {
  const parts = new Map<string, string[]>();
  header.split(",").forEach((part) => {
    const [key, value] = part.split("=");
    if (!key || !value) return;
    const values = parts.get(key) || [];
    values.push(value);
    parts.set(key, values);
  });
  return {
    timestamp: parts.get("t")?.[0],
    signatures: parts.get("v1") || [],
  };
};

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const safeHexEquals = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
};

const verifyStripeSignature = async ({
  rawBody,
  signatureHeader,
  secret,
}: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
}) => {
  if (!signatureHeader) throw new Error("Missing Stripe-Signature header");
  const { timestamp, signatures } = getSignatureParts(signatureHeader);
  if (!timestamp || signatures.length === 0) throw new Error("Invalid Stripe-Signature header");

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) throw new Error("Invalid Stripe webhook timestamp");
  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > 300) throw new Error("Stripe webhook signature timestamp is outside tolerance");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedPayload = `${timestamp}.${rawBody}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = toHex(signature);

  if (!signatures.some((candidate) => safeHexEquals(expected, candidate))) {
    throw new Error("Stripe webhook signature verification failed");
  }
};

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

const firstJoinRow = (value: unknown) => Array.isArray(value) ? value[0] : value;

const stripePaymentFields = (session: any) => {
  const amount = stripeAmountToDollars(session.amount_total);
  return {
    ...(amount === null ? {} : { payment_amount: amount }),
    payment_currency: stripeCurrency(session.currency),
  };
};

const fetchStripeObject = async ({
  adminClient,
  stripeSecretKey,
  path,
}: {
  adminClient: SupabaseAdminClient;
  stripeSecretKey: string;
  path: string;
}) => {
  const connectedAccountId = await getConnectedStripeAccountId(adminClient);
  if (!connectedAccountId) throw new Error("Stripe is not connected for this club");

  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: stripeHeaders(stripeSecretKey, connectedAccountId),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `Stripe request failed with ${response.status}`);
  return body;
};

const getFlightLogForSession = async (adminClient: SupabaseAdminClient, session: any) => {
  const metadataFlightLogId = asString(session.metadata?.flight_log_id || session.client_reference_id);
  if (metadataFlightLogId) {
    const { data, error } = await adminClient
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
        stripe_checkout_session_id,
        aircraft!flight_logs_aircraft_id_fkey(registration),
        users!flight_logs_student_id_fkey(name, email),
        flight_types(name)
      `)
      .eq("id", metadataFlightLogId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  const sessionId = asString(session.id);
  if (!sessionId) return null;

  const { data, error } = await adminClient
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
      stripe_checkout_session_id,
      aircraft!flight_logs_aircraft_id_fkey(registration),
      users!flight_logs_student_id_fkey(name, email),
      flight_types(name)
    `)
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const getVoucherForSession = async (adminClient: SupabaseAdminClient, session: any) => {
  const metadataVoucherId = asString(session.metadata?.voucher_id || session.client_reference_id);
  if (metadataVoucherId) {
    const { data, error } = await adminClient
      .from("trial_flight_vouchers")
      .select("id,status,payment_status,delivered_at,send_to_recipient,recipient_delivery_at,stripe_checkout_session_id")
      .eq("id", metadataVoucherId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  const sessionId = asString(session.id);
  if (!sessionId) return null;

  const { data, error } = await adminClient
    .from("trial_flight_vouchers")
    .select("id,status,payment_status,delivered_at,send_to_recipient,recipient_delivery_at,stripe_checkout_session_id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const recordStripeEvent = async ({
  adminClient,
  event,
  voucherId,
  sessionId,
}: {
  adminClient: SupabaseAdminClient;
  event: any;
  voucherId?: string | null;
  sessionId?: string | null;
}) => {
  const { error: insertError } = await adminClient
    .from("trial_flight_voucher_stripe_events")
    .insert({
      id: event.id,
      event_type: event.type,
      voucher_id: voucherId || null,
      stripe_checkout_session_id: sessionId || null,
      payload: event,
    });

  if (!insertError) return { duplicate: false, processed: false };

  if (insertError.code !== "23505") throw insertError;

  const { data: existing, error: existingError } = await adminClient
    .from("trial_flight_voucher_stripe_events")
    .select("processed_at")
    .eq("id", event.id)
    .maybeSingle();
  if (existingError) throw existingError;

  return { duplicate: true, processed: Boolean(existing?.processed_at) };
};

const markEventProcessed = async (
  adminClient: SupabaseAdminClient,
  eventId: string,
  processingError?: string,
) => {
  await adminClient
    .from("trial_flight_voucher_stripe_events")
    .update({
      processed_at: processingError ? null : new Date().toISOString(),
      processing_error: processingError || null,
    })
    .eq("id", eventId);
};

const recordFlightStripeEvent = async ({
  adminClient,
  event,
  flightLogId,
  sessionId,
}: {
  adminClient: SupabaseAdminClient;
  event: any;
  flightLogId?: string | null;
  sessionId?: string | null;
}) => {
  const { error: insertError } = await adminClient
    .from("flight_log_stripe_events")
    .insert({
      id: event.id,
      event_type: event.type,
      flight_log_id: flightLogId || null,
      stripe_checkout_session_id: sessionId || null,
      payload: event,
    });

  if (!insertError) return { duplicate: false, processed: false };

  if (insertError.code !== "23505") throw insertError;

  const { data: existing, error: existingError } = await adminClient
    .from("flight_log_stripe_events")
    .select("processed_at")
    .eq("id", event.id)
    .maybeSingle();
  if (existingError) throw existingError;

  return { duplicate: true, processed: Boolean(existing?.processed_at) };
};

const markFlightEventProcessed = async (
  adminClient: SupabaseAdminClient,
  eventId: string,
  processingError?: string,
) => {
  await adminClient
    .from("flight_log_stripe_events")
    .update({
      processed_at: processingError ? null : new Date().toISOString(),
      processing_error: processingError || null,
    })
    .eq("id", eventId);
};

const getStripePaymentMethod = async (adminClient: SupabaseAdminClient, session: any) => {
  const metadataPaymentMethodId = asString(session.metadata?.payment_method_id);
  if (metadataPaymentMethodId) {
    const { data, error } = await adminClient
      .from("payment_methods")
      .select("id,name")
      .eq("id", metadataPaymentMethodId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  const { data, error } = await adminClient
    .from("payment_methods")
    .select("id,name")
    .eq("system_key", "stripe_card")
    .maybeSingle();
  if (error) throw error;
  return data || { id: null, name: "Stripe Card Payment" };
};

const handleMemberCardSetupEvent = async ({
  adminClient,
  stripeSecretKey,
  event,
  session,
}: {
  adminClient: SupabaseAdminClient;
  stripeSecretKey: string;
  event: any;
  session: any;
}) => {
  const setupRecordId = asString(session.metadata?.setup_session_id);
  const userId = asString(session.metadata?.user_id || session.client_reference_id);
  const sessionId = asString(session.id);

  if (!setupRecordId || !userId) throw new Error("Stripe card setup session is missing CRM metadata");

  if (event.type === "checkout.session.expired") {
    await adminClient
      .from("member_stripe_card_setup_sessions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", setupRecordId)
      .eq("user_id", userId);
    return json({ received: true, cardSetup: "expired" });
  }

  if (event.type !== "checkout.session.completed") {
    return json({ received: true, ignored: true });
  }

  const setupIntentId = asString(session.setup_intent);
  if (!setupIntentId) throw new Error("Stripe Checkout did not include a SetupIntent");

  const setupIntent = await fetchStripeObject({
    adminClient,
    stripeSecretKey,
    path: `/v1/setup_intents/${encodeURIComponent(setupIntentId)}`,
  });
  const paymentMethodId = asString(setupIntent.payment_method);
  if (!paymentMethodId) throw new Error("Stripe SetupIntent did not include a payment method");

  const paymentMethod = await fetchStripeObject({
    adminClient,
    stripeSecretKey,
    path: `/v1/payment_methods/${encodeURIComponent(paymentMethodId)}`,
  });

  const { data: setupRecord, error: setupError } = await adminClient
    .from("member_stripe_card_setup_sessions")
    .select("id,user_id,stripe_customer_id,consent_text,consent_accepted_at,consent_ip,consent_user_agent")
    .eq("id", setupRecordId)
    .eq("user_id", userId)
    .maybeSingle();
  if (setupError) throw setupError;
  if (!setupRecord) throw new Error("CRM card setup consent record was not found");

  await adminClient
    .from("member_stripe_payment_methods")
    .update({ active: false, is_default: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("active", true);

  const card = paymentMethod.card || {};
  const { error: upsertError } = await adminClient
    .from("member_stripe_payment_methods")
    .upsert({
      user_id: userId,
      stripe_customer_id: asString(setupIntent.customer || session.customer || setupRecord.stripe_customer_id),
      stripe_payment_method_id: paymentMethodId,
      stripe_setup_intent_id: setupIntentId,
      card_brand: asString(card.brand) || null,
      card_last4: asString(card.last4) || null,
      card_exp_month: Number(card.exp_month) || null,
      card_exp_year: Number(card.exp_year) || null,
      active: true,
      is_default: true,
      consent_text: setupRecord.consent_text,
      consent_accepted_at: setupRecord.consent_accepted_at,
      consent_ip: setupRecord.consent_ip,
      consent_user_agent: setupRecord.consent_user_agent,
      removed_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "stripe_payment_method_id" });
  if (upsertError) throw upsertError;

  await adminClient
    .from("member_stripe_card_setup_sessions")
    .update({
      stripe_checkout_session_id: sessionId || null,
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", setupRecordId);

  return json({ received: true, cardSetup: "completed" });
};

const handleFlightLogPaymentIntentEvent = async ({
  adminClient,
  event,
  paymentIntent,
}: {
  adminClient: SupabaseAdminClient;
  event: any;
  paymentIntent: any;
}) => {
  const flightLogId = asString(paymentIntent.metadata?.flight_log_id);
  if (!flightLogId) return json({ received: true, ignored: true });

  const { data: flightLog, error: flightError } = await adminClient
    .from("flight_logs")
    .select(`
      id,
      student_id,
      start_time,
      calculated_cost,
      payment_status,
      aircraft!flight_logs_aircraft_id_fkey(registration)
    `)
    .eq("id", flightLogId)
    .maybeSingle();
  if (flightError) throw flightError;
  if (!flightLog) throw new Error("Flight log not found for Stripe PaymentIntent");

  const paymentMethod = await getStripePaymentMethod(adminClient, { metadata: paymentIntent.metadata || {} });
  const now = new Date().toISOString();
  const amount = stripeAmountToDollars(paymentIntent.amount_received || paymentIntent.amount) ?? Number(flightLog.calculated_cost || 0);

  if (event.type === "payment_intent.succeeded") {
    const aircraft = firstJoinRow(flightLog.aircraft) as { registration?: unknown } | undefined;
    const aircraftRegistration = asString(aircraft?.registration) || "aircraft";
    const flightDate = flightLog.start_time ? new Date(flightLog.start_time).toLocaleDateString("en-AU") : "flight";
    const description = `Stripe saved card payment - ${aircraftRegistration} flight on ${flightDate}`;

    const { error: updateError } = await adminClient
      .from("flight_logs")
      .update({
        payment_status: "paid",
        payment_type: paymentMethod?.name || "Stripe Card Payment",
        stripe_payment_intent_id: paymentIntent.id,
        stripe_payment_status: paymentIntent.status,
        stripe_paid_at: now,
        stripe_payment_error: null,
        updated_at: now,
      })
      .eq("id", flightLog.id);
    if (updateError) throw updateError;

    const { data: existingTx, error: existingTxError } = await adminClient
      .from("account_transactions")
      .select("id")
      .eq("flight_log_id", flightLog.id)
      .eq("type", "flight_charge")
      .maybeSingle();
    if (existingTxError) throw existingTxError;

    if (!existingTx && amount > 0) {
      const { error: txError } = await adminClient
        .from("account_transactions")
        .insert({
          user_id: flightLog.student_id,
          type: "flight_charge",
          amount,
          description,
          flight_log_id: flightLog.id,
          payment_method_id: paymentMethod?.id || null,
          balance_after: null,
          verified_status: "verified",
        });
      if (txError) throw txError;
    }

    return json({ received: true, flightLogId: flightLog.id, paymentStatus: "paid" });
  }

  if (event.type === "payment_intent.payment_failed") {
    const lastError = paymentIntent.last_payment_error?.message || "Stripe payment failed";
    await adminClient
      .from("flight_logs")
      .update({
        payment_status: "pending",
        payment_type: paymentMethod?.name || "Stripe Card Payment",
        stripe_payment_intent_id: paymentIntent.id,
        stripe_payment_status: paymentIntent.status || "failed",
        stripe_payment_error: lastError,
        updated_at: now,
      })
      .eq("id", flightLog.id)
      .neq("payment_status", "paid");

    return json({ received: true, flightLogId: flightLog.id, paymentStatus: "failed" });
  }

  return json({ received: true, ignored: true });
};

const handleFlightLogStripeEvent = async ({
  adminClient,
  event,
  session,
  sessionId,
}: {
  adminClient: SupabaseAdminClient;
  event: any;
  session: any;
  sessionId: string;
}) => {
  let flightLogId: string | null = null;

  try {
    const flightLog = await getFlightLogForSession(adminClient, session);
    flightLogId = flightLog?.id || null;

    const eventState = await recordFlightStripeEvent({ adminClient, event, flightLogId, sessionId });
    if (eventState.duplicate && eventState.processed) {
      return json({ received: true, duplicate: true, flightLogId });
    }

    if (!flightLog) throw new Error("No flight log matched this Stripe Checkout Session");

    const stripePaymentIntentId = asString(session.payment_intent) || null;
    const updateBase = {
      stripe_checkout_session_id: sessionId || flightLog.stripe_checkout_session_id,
      stripe_payment_intent_id: stripePaymentIntentId,
      stripe_payment_status: asString(session.payment_status || event.type),
      updated_at: new Date().toISOString(),
    };

    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      await adminClient
        .from("flight_logs")
        .update({
          ...updateBase,
          payment_status: "pending",
        })
        .eq("id", flightLog.id)
        .neq("payment_status", "paid");

      await markFlightEventProcessed(adminClient, event.id);
      return json({ received: true, flightLogId: flightLog.id, pending: true });
    }

    if (session.payment_status && session.payment_status !== "paid") {
      await adminClient
        .from("flight_logs")
        .update({
          ...updateBase,
          payment_status: "pending",
        })
        .eq("id", flightLog.id);

      await markFlightEventProcessed(adminClient, event.id);
      return json({ received: true, flightLogId: flightLog.id, pending: true });
    }

    const paymentMethod = await getStripePaymentMethod(adminClient, session);
    const paidAmount = stripeAmountToDollars(session.amount_total) ?? Number(flightLog.calculated_cost || 0);
    const flightDate = flightLog.start_time
      ? new Date(flightLog.start_time).toLocaleDateString("en-AU")
      : "flight";
    const aircraftRegistration = asString(flightLog.aircraft?.registration) || "aircraft";
    const description = `Stripe card payment - ${aircraftRegistration} flight on ${flightDate}`;

    const { error: updateError } = await adminClient
      .from("flight_logs")
      .update({
        ...updateBase,
        payment_status: "paid",
        payment_type: paymentMethod?.name || "Stripe Card Payment",
        stripe_paid_at: new Date().toISOString(),
      })
      .eq("id", flightLog.id);
    if (updateError) throw updateError;

    const { data: existingTx, error: existingTxError } = await adminClient
      .from("account_transactions")
      .select("id")
      .eq("flight_log_id", flightLog.id)
      .eq("type", "flight_charge")
      .maybeSingle();
    if (existingTxError) throw existingTxError;

    if (!existingTx && paidAmount > 0) {
      const { error: txError } = await adminClient
        .from("account_transactions")
        .insert({
          user_id: flightLog.student_id,
          type: "flight_charge",
          amount: paidAmount,
          description,
          flight_log_id: flightLog.id,
          payment_method_id: paymentMethod?.id || null,
          balance_after: null,
          verified_status: "verified",
        });
      if (txError) throw txError;
    }

    await markFlightEventProcessed(adminClient, event.id);
    return json({
      received: true,
      flightLogId: flightLog.id,
      paymentStatus: "paid",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Stripe flight payment webhook error";
    console.error("flight payment webhook error:", error);
    if (event?.id) await markFlightEventProcessed(adminClient, event.id, message);
    return json({ error: message, flightLogId }, 500);
  }
};

const sendVoucherEmail = async ({
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const internalSecret = Deno.env.get("TRIAL_VOUCHER_INTERNAL_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !webhookSecret || !internalSecret || !stripeSecretKey) {
    return json({ error: "Stripe voucher webhook is not fully configured" }, 503);
  }

  const rawBody = await req.text();

  try {
    await verifyStripeSignature({
      rawBody,
      signatureHeader: req.headers.get("stripe-signature"),
      secret: webhookSecret,
    });
  } catch (error) {
    console.warn("Stripe signature verification failed:", error);
    return json({ error: "Invalid Stripe signature" }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const session = event.data?.object || {};
  const sessionId = asString(session.id);
  let voucherId: string | null = null;

  try {
    if (![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
      "payment_intent.succeeded",
      "payment_intent.payment_failed",
    ].includes(event.type)) {
      return json({ received: true, ignored: true });
    }

    if (["payment_intent.succeeded", "payment_intent.payment_failed"].includes(event.type)) {
      if (asString(session.metadata?.crm_payment_type) === "flight_log_off_session") {
        return await handleFlightLogPaymentIntentEvent({ adminClient, event, paymentIntent: session });
      }
      return json({ received: true, ignored: true });
    }

    if (asString(session.metadata?.crm_payment_type) === "member_card_setup" || asString(session.metadata?.setup_session_id)) {
      return await handleMemberCardSetupEvent({ adminClient, stripeSecretKey, event, session });
    }

    if (asString(session.metadata?.crm_payment_type) === "flight_log" || asString(session.metadata?.flight_log_id)) {
      return await handleFlightLogStripeEvent({ adminClient, event, session, sessionId });
    }

    const voucher = await getVoucherForSession(adminClient, session);
    voucherId = voucher?.id || null;

    const eventState = await recordStripeEvent({ adminClient, event, voucherId, sessionId });
    if (eventState.duplicate && eventState.processed) {
      return json({ received: true, duplicate: true });
    }

    if (!voucher) {
      throw new Error("No trial flight voucher matched this Stripe Checkout Session");
    }

    if (event.type === "checkout.session.expired") {
      await adminClient
        .from("trial_flight_vouchers")
        .update({
          payment_status: "failed",
          stripe_checkout_session_id: sessionId || voucher.stripe_checkout_session_id,
          stripe_payment_intent_id: asString(session.payment_intent) || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", voucher.id)
        .neq("payment_status", "paid");

      await markEventProcessed(adminClient, event.id);
      return json({ received: true, voucherId: voucher.id, expired: true });
    }

    if (event.type === "checkout.session.async_payment_failed") {
      await adminClient
        .from("trial_flight_vouchers")
        .update({
          payment_status: "failed",
          stripe_checkout_session_id: sessionId || voucher.stripe_checkout_session_id,
          stripe_payment_intent_id: asString(session.payment_intent) || null,
          ...stripePaymentFields(session),
          updated_at: new Date().toISOString(),
        })
        .eq("id", voucher.id)
        .neq("payment_status", "paid");

      await markEventProcessed(adminClient, event.id);
      return json({ received: true, voucherId: voucher.id, failed: true });
    }

    if (session.payment_status && session.payment_status !== "paid") {
      await adminClient
        .from("trial_flight_vouchers")
        .update({
          payment_status: "pending",
          stripe_checkout_session_id: sessionId || voucher.stripe_checkout_session_id,
          stripe_payment_intent_id: asString(session.payment_intent) || null,
          ...stripePaymentFields(session),
          updated_at: new Date().toISOString(),
        })
        .eq("id", voucher.id);

      await markEventProcessed(adminClient, event.id);
      return json({ received: true, voucherId: voucher.id, pending: true });
    }

    const { error: updateError } = await adminClient
      .from("trial_flight_vouchers")
      .update({
        status: voucher.status === "draft" ? "issued" : voucher.status,
        payment_status: "paid",
        stripe_checkout_session_id: sessionId || voucher.stripe_checkout_session_id,
        stripe_payment_intent_id: asString(session.payment_intent) || null,
        ...stripePaymentFields(session),
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", voucher.id);

    if (updateError) throw updateError;

    const emailResult = voucher.delivered_at
      ? { sent: false, alreadyDelivered: true }
      : await sendVoucherEmail({ supabaseUrl, internalSecret, voucherId: voucher.id });

    await markEventProcessed(adminClient, event.id);

    return json({
      received: true,
      voucherId: voucher.id,
      paymentStatus: "paid",
      email: emailResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Stripe webhook error";
    console.error("trial-voucher-stripe-webhook error:", error);
    if (event?.id) await markEventProcessed(adminClient, event.id, message);
    return json({ error: message, voucherId }, 500);
  }
});
