import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

const stripePaymentFields = (session: any) => {
  const amount = stripeAmountToDollars(session.amount_total);
  return {
    ...(amount === null ? {} : { payment_amount: amount }),
    payment_currency: stripeCurrency(session.currency),
  };
};

const getVoucherForSession = async (adminClient: ReturnType<typeof createClient>, session: any) => {
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
  adminClient: ReturnType<typeof createClient>;
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
  adminClient: ReturnType<typeof createClient>,
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
  const internalSecret = Deno.env.get("TRIAL_VOUCHER_INTERNAL_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !webhookSecret || !internalSecret) {
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
    ].includes(event.type)) {
      return json({ received: true, ignored: true });
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
