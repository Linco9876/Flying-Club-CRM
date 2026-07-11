import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getConnectedStripeAccountId, stripeHeaders } from "../_shared/stripeConnectAccount.ts";
import {
  getStripeSecretKeyForMode,
  getStripeWebhookSecretForMode,
  stripeModeColumns,
  testModeSubject,
  type StripeMode,
} from "../_shared/stripeMode.ts";

type SupabaseAdminClient = any;

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const stripeModeFromEvent = (event: any): StripeMode => event?.livemode === true ? "live" : "test";

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

const parseAndVerifyStripeEvent = async ({
  rawBody,
  signatureHeader,
}: {
  rawBody: string;
  signatureHeader: string | null;
}) => {
  const secrets: Array<{ mode: StripeMode; secret: string | null }> = [
    { mode: "test", secret: getStripeWebhookSecretForMode("test") },
    { mode: "live", secret: getStripeWebhookSecretForMode("live") },
  ];
  let lastError: unknown = null;

  for (const candidate of secrets) {
    if (!candidate.secret) continue;
    try {
      await verifyStripeSignature({ rawBody, signatureHeader, secret: candidate.secret });
      const event = JSON.parse(rawBody);
      const eventMode = stripeModeFromEvent(event);
      if (eventMode !== candidate.mode) {
        throw new Error(`Stripe webhook mode mismatch. Event is ${eventMode}, but ${candidate.mode} secret verified it.`);
      }
      return { event, mode: eventMode };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Stripe webhook signature verification failed");
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
const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const stripeCurrency = (value: unknown) => {
  const currency = asString(value).trim().toUpperCase();
  return currency || "AUD";
};
const clean = asString;
const money = (value: unknown) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const basicAuthHeader = (clientId: string, clientSecret: string) =>
  `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const parseRetryAfterMs = (value: string | null) => {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
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

const xeroRequest = async ({
  method = "GET",
  path,
  tenantId,
  accessToken,
  body,
}: {
  method?: string;
  path: string;
  tenantId: string;
  accessToken: string;
  body?: Record<string, unknown>;
}) => {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      if (attempt < maxAttempts && retryAfterMs > 0 && retryAfterMs <= 15_000) {
        await sleep(retryAfterMs + 250);
        continue;
      }
      const seconds = retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : null;
      throw Object.assign(
        new Error(seconds
          ? `Xero is rate limiting the CRM. Please wait about ${seconds} seconds and try again.`
          : "Xero is rate limiting the CRM. Please wait a few minutes and try again."),
        { status: 429, retryAfterSeconds: seconds },
      );
    }
    if (!response.ok) {
      const message = payload?.Message || payload?.Title || payload?.Detail || `Xero request failed with HTTP ${response.status}`;
      throw Object.assign(new Error(message), { status: response.status });
    }
    return payload;
  }
  throw new Error("Xero request failed after retrying.");
};

const refreshXeroAccessToken = async (adminClient: SupabaseAdminClient, connection: any) => {
  const clientId = Deno.env.get("XERO_CLIENT_ID");
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Xero client ID and secret are not configured.");
  if (!connection?.refresh_token) throw new Error("Xero is not connected.");

  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (connection.access_token && expiresAt - Date.now() > 120_000) return connection;

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", connection.refresh_token);

  const response = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(token?.error_description || token?.error || `Xero token refresh failed with HTTP ${response.status}`);
  }

  const expiresInSeconds = Number(token?.expires_in || 0);
  const update = {
    access_token: clean(token.access_token),
    refresh_token: clean(token.refresh_token) || connection.refresh_token,
    token_type: clean(token.token_type) || connection.token_type,
    scope: clean(token.scope) || connection.scope,
    expires_at: expiresInSeconds > 0 ? new Date(Date.now() + expiresInSeconds * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await adminClient.from("xero_connection_settings").update(update).eq("id", true);
  if (error) throw error;
  return { ...connection, ...update };
};

const getXeroPaymentContext = async (adminClient: SupabaseAdminClient) => {
  const [{ data: connection, error: connectionError }, { data: settings, error: settingsError }] = await Promise.all([
    adminClient.from("xero_connection_settings").select("*").eq("id", true).maybeSingle(),
    adminClient.from("xero_sync_settings").select("*").eq("id", true).maybeSingle(),
  ]);
  if (connectionError) throw connectionError;
  if (settingsError) throw settingsError;
  if (!connection?.tenant_id || connection?.disconnected_at) throw new Error("Xero is not connected.");
  const accountCode = clean(settings?.stripe_payment_account_code);
  if (!accountCode) throw new Error("Set the Xero Stripe clearing account before taking invoice payments.");
  return {
    connection: await refreshXeroAccessToken(adminClient, connection),
    settings: settings || {},
    stripeClearingAccountCode: accountCode,
  };
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
        stripe_payment_intent_id,
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
        stripe_payment_intent_id,
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
      .select(`
        *,
        trial_flight_voucher_products(
          id,
          name,
          description,
          duration_minutes,
          booking_instructions
        )
      `)
      .eq("id", metadataVoucherId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  const sessionId = asString(session.id);
  if (!sessionId) return null;

  const { data, error } = await adminClient
    .from("trial_flight_vouchers")
    .select(`
      *,
      trial_flight_voucher_products(
        id,
        name,
        description,
        duration_minutes,
        booking_instructions
      )
    `)
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
      ...stripeModeColumns(stripeModeFromEvent(event)),
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
      ...stripeModeColumns(stripeModeFromEvent(event)),
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

const getVerifiedFlightPaymentTotal = async (adminClient: SupabaseAdminClient, flightLogId: string) => {
  const { data, error } = await adminClient
    .from("account_transactions")
    .select("amount")
    .eq("flight_log_id", flightLogId)
    .eq("type", "flight_charge")
    .eq("verified_status", "verified");
  if (error) throw error;
  return (data || []).reduce((sum: number, tx: any) => sum + Number(tx.amount || 0), 0);
};

const getApplicableFlightPaymentAmount = ({
  flightCost,
  paidBefore,
  receivedAmount,
  alreadyRecorded,
}: {
  flightCost: number;
  paidBefore: number;
  receivedAmount: number;
  alreadyRecorded: boolean;
}) => {
  if (alreadyRecorded) {
    return { appliedAmount: 0, paidAfter: paidBefore };
  }

  const remaining = Math.max(0, roundCurrency(flightCost - paidBefore));
  const appliedAmount = Math.max(0, Math.min(roundCurrency(receivedAmount), remaining));
  return {
    appliedAmount,
    paidAfter: roundCurrency(paidBefore + appliedAmount),
  };
};

const hasFlightPaymentReference = async (
  adminClient: SupabaseAdminClient,
  flightLogId: string,
  reference: string,
) => {
  if (!reference) return false;
  const { data, error } = await adminClient
    .from("account_transactions")
    .select("id")
    .eq("flight_log_id", flightLogId)
    .eq("type", "flight_charge")
    .ilike("description", `%${reference}%`)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
};

const handleMemberTopupStripeEvent = async ({
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
  const userId = asString(session.metadata?.user_id || session.client_reference_id);
  if (!userId) throw new Error("Member top-up checkout is missing the user id.");

  const paymentMethod = await getStripePaymentMethod(adminClient, session);
  const amount = stripeAmountToDollars(session.amount_total) ?? Number(session.metadata?.topup_amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Member top-up checkout has no valid amount.");

  if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    return json({ received: true, userId, topupStatus: "failed" });
  }

  if (session.payment_status && session.payment_status !== "paid") {
    return json({ received: true, userId, topupStatus: "pending" });
  }

  const { data: existing, error: existingError } = await adminClient
    .from("account_transactions")
    .select("id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return json({ received: true, userId, duplicate: true, topupTransactionId: existing.id });

  const { error: insertError } = await adminClient
    .from("account_transactions")
    .insert({
      user_id: userId,
      type: "topup",
      amount: roundCurrency(amount),
      description: `Stripe pilot account top-up (${sessionId})`,
      payment_method_id: paymentMethod?.id || null,
      balance_after: null,
      verified_status: "verified",
      stripe_checkout_session_id: sessionId,
      ...stripeModeColumns(stripeModeFromEvent(event)),
    });
  if (insertError) throw insertError;

  return json({ received: true, userId, topupStatus: "verified" });
};

const handleXeroInvoicePaymentStripeEvent = async ({
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
  const paymentRecordId = asString(session.metadata?.payment_record_id || session.client_reference_id);
  const invoiceId = asString(session.metadata?.xero_invoice_id);
  if (!paymentRecordId || !invoiceId) throw new Error("Xero invoice payment checkout is missing CRM metadata.");

  const { data: record, error: recordError } = await adminClient
    .from("xero_invoice_portal_payments")
    .select("*")
    .eq("id", paymentRecordId)
    .maybeSingle();
  if (recordError) throw recordError;
  if (!record) throw new Error("Xero invoice payment record not found.");
  if (record.xero_payment_id && record.status === "paid") {
    return json({ received: true, duplicate: true, paymentRecordId });
  }

  if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    await adminClient.from("xero_invoice_portal_payments").update({
      status: "failed",
      stripe_checkout_session_id: sessionId || record.stripe_checkout_session_id,
      stripe_payment_intent_id: asString(session.payment_intent) || null,
      error: event.type,
      updated_at: new Date().toISOString(),
      ...stripeModeColumns(stripeModeFromEvent(event)),
    }).eq("id", record.id).neq("status", "paid");
    return json({ received: true, paymentRecordId, status: "failed" });
  }

  if (session.payment_status && session.payment_status !== "paid") {
    await adminClient.from("xero_invoice_portal_payments").update({
      status: "pending",
      stripe_checkout_session_id: sessionId || record.stripe_checkout_session_id,
      stripe_payment_intent_id: asString(session.payment_intent) || null,
      updated_at: new Date().toISOString(),
      ...stripeModeColumns(stripeModeFromEvent(event)),
    }).eq("id", record.id);
    return json({ received: true, paymentRecordId, status: "pending" });
  }

  const ctx = await getXeroPaymentContext(adminClient);
  const invoiceResult = await xeroRequest({
    path: `Invoices/${encodeURIComponent(invoiceId)}`,
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
  });
  const invoice = Array.isArray(invoiceResult?.Invoices) ? invoiceResult.Invoices[0] : null;
  if (!invoice) throw new Error("Xero invoice not found for Stripe payment.");
  const invoiceContactId = asString(invoice?.Contact?.ContactID || invoice?.ContactID);
  if (invoiceContactId !== asString(record.xero_contact_id)) {
    throw new Error("Xero invoice contact no longer matches the CRM payment record.");
  }

  const amountPaidToStripe = stripeAmountToDollars(session.amount_total) ?? Number(record.amount || 0);
  const amountDue = money(invoice?.AmountDue);
  const amountToApply = Math.min(money(amountPaidToStripe), amountDue);
  if (amountToApply <= 0) {
    await adminClient.from("xero_invoice_portal_payments").update({
      status: "needs_review",
      stripe_checkout_session_id: sessionId || record.stripe_checkout_session_id,
      stripe_payment_intent_id: asString(session.payment_intent) || null,
      error: "Stripe payment succeeded but the Xero invoice has no amount due. Review refund or allocation manually.",
      updated_at: new Date().toISOString(),
    }).eq("id", record.id);
    return json({ received: true, paymentRecordId, status: "needs_review" });
  }

  const paymentResult = await xeroRequest({
    method: "POST",
    path: "Payments",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Payments: [{
        Invoice: { InvoiceID: invoiceId },
        Account: { Code: ctx.stripeClearingAccountCode },
        Date: new Date().toISOString().slice(0, 10),
        Amount: amountToApply,
        Reference: `Stripe invoice payment ${sessionId}`,
      }],
    },
  });
  const xeroPayment = paymentResult?.Payments?.[0];
  const xeroPaymentId = asString(xeroPayment?.PaymentID);
  if (!xeroPaymentId) throw new Error("Xero did not return a payment ID.");

  await adminClient.from("xero_invoice_portal_payments").update({
    status: money(amountPaidToStripe) > amountToApply + 0.005 ? "needs_review" : "paid",
    stripe_checkout_session_id: sessionId || record.stripe_checkout_session_id,
    stripe_payment_intent_id: asString(session.payment_intent) || null,
    xero_payment_id: xeroPaymentId,
    amount: amountToApply,
    error: money(amountPaidToStripe) > amountToApply + 0.005
      ? `Stripe collected ${money(amountPaidToStripe).toFixed(2)} but only ${amountToApply.toFixed(2)} was applied to Xero. Review the difference.`
      : null,
    updated_at: new Date().toISOString(),
  }).eq("id", record.id);

  return json({
    received: true,
    paymentRecordId: record.id,
    xeroPaymentId,
    amountApplied: amountToApply,
  });
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
      ...stripeModeColumns(stripeModeFromEvent(event)),
    }, { onConflict: "stripe_payment_method_id" });
  if (upsertError) throw upsertError;

  await adminClient
    .from("member_stripe_card_setup_sessions")
    .update({
      stripe_checkout_session_id: sessionId || null,
      status: "completed",
      updated_at: new Date().toISOString(),
      ...stripeModeColumns(stripeModeFromEvent(event)),
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
    const description = `Stripe saved card payment (${paymentIntent.id}) - ${aircraftRegistration} flight on ${flightDate}`;
    const alreadyRecorded = await hasFlightPaymentReference(adminClient, flightLog.id, paymentIntent.id);
    const paidBefore = await getVerifiedFlightPaymentTotal(adminClient, flightLog.id);
    const flightCost = Number(flightLog.calculated_cost || 0);
    const { appliedAmount, paidAfter } = getApplicableFlightPaymentAmount({
      flightCost,
      paidBefore,
      receivedAmount: amount,
      alreadyRecorded,
    });
    const isFullyPaid = paidAfter + 0.005 >= flightCost;

    const { error: updateError } = await adminClient
      .from("flight_logs")
      .update({
        payment_status: isFullyPaid ? "paid" : "pending",
        payment_type: paymentMethod?.name || "Stripe Card Payment",
        stripe_payment_intent_id: paymentIntent.id,
        stripe_payment_status: paymentIntent.status,
        stripe_paid_at: isFullyPaid ? now : null,
        stripe_payment_error: null,
        updated_at: now,
        ...stripeModeColumns(stripeModeFromEvent(event)),
      })
      .eq("id", flightLog.id);
    if (updateError) throw updateError;

    if (!alreadyRecorded && appliedAmount > 0) {
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
          ...stripeModeColumns(stripeModeFromEvent(event)),
        });
      if (txError) throw txError;
    }

    return json({ received: true, flightLogId: flightLog.id, paymentStatus: isFullyPaid ? "paid" : "pending" });
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
        ...stripeModeColumns(stripeModeFromEvent(event)),
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
      ...stripeModeColumns(stripeModeFromEvent(event)),
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
    const description = `Stripe card payment (${sessionId}) - ${aircraftRegistration} flight on ${flightDate}`;
    const alreadyRecorded = await hasFlightPaymentReference(adminClient, flightLog.id, sessionId);
    const paidBefore = await getVerifiedFlightPaymentTotal(adminClient, flightLog.id);
    const flightCost = Number(flightLog.calculated_cost || 0);
    const { appliedAmount, paidAfter } = getApplicableFlightPaymentAmount({
      flightCost,
      paidBefore,
      receivedAmount: paidAmount,
      alreadyRecorded,
    });
    const isFullyPaid = roundCurrency(paidAfter) + 0.005 >= flightCost;

    const { error: updateError } = await adminClient
      .from("flight_logs")
      .update({
        ...updateBase,
        payment_status: isFullyPaid ? "paid" : "pending",
        payment_type: paymentMethod?.name || "Stripe Card Payment",
        stripe_paid_at: isFullyPaid ? new Date().toISOString() : null,
      })
      .eq("id", flightLog.id);
    if (updateError) throw updateError;

    if (!alreadyRecorded && appliedAmount > 0) {
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

    await markFlightEventProcessed(adminClient, event.id);
    return json({
      received: true,
      flightLogId: flightLog.id,
      paymentStatus: isFullyPaid ? "paid" : "pending",
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

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const siteOrigin = () => (Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");

const sendBookNowConfirmationEmail = async ({
  to,
  toName,
  voucher,
  product,
  booking,
  audience,
}: {
  to: string;
  toName: string;
  voucher: any;
  product: any;
  booking: any;
  audience: "purchaser" | "recipient";
}) => {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) return { sent: false, error: "BREVO_API_KEY is not configured" };
  if (!to) return { sent: false, error: "No recipient email address" };

  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@bendigoflyingclub.com.au";
  const senderName = Deno.env.get("BREVO_SENDER_NAME") || "Bendigo Flying Club";
  const timeZone = "Australia/Sydney";
  const start = new Date(booking.startTime || voucher.held_start_time);
  const end = new Date(booking.endTime || voucher.held_end_time);
  const dateLabel = new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(start);
  const timeFormatter = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const bookingUrl = `${siteOrigin()}/trial-flight-voucher?voucherCode=${encodeURIComponent(voucher.code)}`;
  const subject = audience === "recipient"
    ? "Your Bendigo Flying Club trial flight is booked"
    : "Your Bendigo Flying Club trial flight booking is confirmed";
  const intro = audience === "recipient"
    ? "A trial flight has been booked for you."
    : "Your trial flight purchase and booking are confirmed.";
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:660px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.14);">
            <tr>
              <td style="background:linear-gradient(135deg,#06152f,#0d3b78);padding:30px;color:#ffffff;">
                <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#bfdbfe;font-weight:700;">Bendigo Flying Club</p>
                <h1 style="margin:0;font-size:30px;line-height:1.18;color:#ffffff;">Trial flight booked</h1>
                <p style="margin:12px 0 0;color:#dbeafe;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.65;">Hi ${escapeHtml(toName || "there")},</p>
                <p style="margin:0 0 22px;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(product?.name || "Trial instructional flight")}</p>
                <div style="border:1px solid #dbeafe;background:#f8fbff;border-radius:18px;padding:18px;margin-bottom:18px;">
                  <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:#64748b;font-weight:800;">Booking date</p>
                  <p style="margin:0;font-size:20px;line-height:1.35;color:#0f172a;font-weight:800;">${escapeHtml(dateLabel)}</p>
                </div>
                <div style="border:1px solid #dbeafe;background:#f8fbff;border-radius:18px;padding:18px;margin-bottom:22px;">
                  <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:#64748b;font-weight:800;">Time</p>
                  <p style="margin:0;font-size:20px;line-height:1.35;color:#0f172a;font-weight:800;">${escapeHtml(timeFormatter.format(start))} - ${escapeHtml(timeFormatter.format(end))}</p>
                  <p style="margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.5;">Please allow time for a short briefing before and after the flight.</p>
                </div>
                <p style="margin:0 0 22px;color:#475569;font-size:14px;line-height:1.7;">Wear comfortable clothing and enclosed shoes. You can use the button below to view or reschedule online up to 3 days before the booking.</p>
                <p style="margin:0 0 22px;">
                  <a href="${escapeHtml(bookingUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:800;border-radius:14px;padding:14px 22px;">View or reschedule booking</a>
                </p>
                <p style="margin:0;color:#64748b;font-size:13px;line-height:1.65;">Voucher code: <strong style="color:#0f172a;">${escapeHtml(voucher.code)}</strong></p>
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
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent: html,
      textContent: [
        `Hi ${toName || "there"},`,
        "",
        intro,
        `${product?.name || "Trial instructional flight"}`,
        `Date: ${dateLabel}`,
        `Time: ${timeFormatter.format(start)} - ${timeFormatter.format(end)}`,
        `View or reschedule: ${bookingUrl}`,
        `Voucher code: ${voucher.code}`,
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { sent: false, error: body || `Brevo email failed with ${response.status}` };
  }

  return { sent: true, error: null };
};

const sendBookNowAbandonedEmail = async ({ voucher }: { voucher: any }) => {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) return { sent: false, error: "BREVO_API_KEY is not configured" };
  const to = clean(voucher.purchaser_email).trim().toLowerCase();
  if (!to) return { sent: false, error: "No purchaser email address" };
  if (voucher.checkout_abandoned_email_sent_at) return { sent: false, skipped: true, error: null };

  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@bendigoflyingclub.com.au";
  const senderName = Deno.env.get("BREVO_SENDER_NAME") || "Bendigo Flying Club";
  const chooseNewTimeUrl = `${siteOrigin()}/trial-flight-gift-vouchers?checkout=cancelled`;
  const checkoutUrl = clean(voucher.stripe_checkout_url) || chooseNewTimeUrl;
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 16px 40px rgba(15,23,42,.12);">
            <tr>
              <td style="background:linear-gradient(135deg,#06152f,#0d3b78);padding:26px;color:#ffffff;">
                <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#bfdbfe;font-weight:700;">Bendigo Flying Club</p>
                <h1 style="margin:0;font-size:26px;line-height:1.2;">Finish your trial flight booking</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:26px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Hi ${escapeHtml(voucher.purchaser_name || "there")},</p>
                <p style="margin:0 0 18px;color:#334155;line-height:1.65;">It looks like checkout was not completed for your Bendigo Flying Club trial flight. Your selected time was only held temporarily.</p>
                <p style="margin:0 0 22px;color:#334155;line-height:1.65;">You can try the payment link below if it is still active, or return to the booking page and choose another available time.</p>
                <p style="margin:0 0 14px;">
                  <a href="${escapeHtml(checkoutUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:800;border-radius:14px;padding:14px 22px;">Continue checkout</a>
                </p>
                <p style="margin:0;">
                  <a href="${escapeHtml(chooseNewTimeUrl)}" style="color:#2563eb;font-weight:700;">Choose a different time</a>
                </p>
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
      to: [{ email: to, name: clean(voucher.purchaser_name) || to }],
      subject: testModeSubject(voucher?.stripe_mode === "test" || voucher?.is_test_mode === true ? "test" : "live", "Complete your Bendigo Flying Club trial flight booking"),
      htmlContent: html,
      textContent: [
        `Hi ${voucher.purchaser_name || "there"},`,
        "",
        "It looks like checkout was not completed for your Bendigo Flying Club trial flight. Your selected time was only held temporarily.",
        `Continue checkout: ${checkoutUrl}`,
        `Choose a different time: ${chooseNewTimeUrl}`,
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { sent: false, error: body || `Brevo email failed with ${response.status}` };
  }
  return { sent: true, error: null };
};

const ensureBookNowVoucherAccount = async (adminClient: SupabaseAdminClient, voucher: any) => {
  const fullName = clean(voucher.send_to_recipient ? voucher.recipient_name : voucher.purchaser_name) || clean(voucher.purchaser_name) || "Trial flight guest";
  const email = clean(voucher.send_to_recipient ? voucher.recipient_email : voucher.purchaser_email).trim().toLowerCase() || clean(voucher.purchaser_email).trim().toLowerCase();
  const phone = clean(voucher.purchaser_phone);
  if (!email) throw new Error("Book-now voucher has no booking account email");

  const { data: existingProfile, error: existingError } = await adminClient
    .from("users")
    .select("id,email,portal_access_scope")
    .eq("email", email)
    .maybeSingle();
  if (existingError) throw existingError;

  let userId = existingProfile?.id;
  if (existingProfile && existingProfile.portal_access_scope !== "trial_voucher") {
    throw new Error("The booking email already belongs to a full CRM account. Staff need to link this voucher manually.");
  }

  if (!userId) {
    const tempPassword = crypto.randomUUID() + "A1!";
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name: fullName, phone },
    });
    if (authError || !authData.user) throw new Error(authError?.message || "Failed to create voucher booking account");
    userId = authData.user.id;
  }

  const { error: userError } = await adminClient.from("users").upsert({
    id: userId,
    email,
    name: fullName,
    phone: phone || null,
    role: "student",
    portal_access_scope: "trial_voucher",
  }, { onConflict: "id" });
  if (userError) throw userError;

  await adminClient.from("user_roles").upsert({ user_id: userId, role: "student" }, { onConflict: "user_id,role" });
  await adminClient.from("students").upsert({ id: userId }, { onConflict: "id" });
  return userId;
};

const handleBookNowPaidVoucher = async (adminClient: SupabaseAdminClient, voucher: any) => {
  if (voucher.status === "booked" && voucher.booked_booking_id) {
    return { alreadyBooked: true, bookingId: voucher.booked_booking_id };
  }

  const product = firstJoinRow(voucher.trial_flight_voucher_products) || {};
  if (!voucher.held_aircraft_id || !voucher.held_instructor_id || !voucher.held_start_time || !voucher.held_end_time) {
    throw new Error("Book-now checkout is missing held booking details");
  }

  const studentId = await ensureBookNowVoucherAccount(adminClient, voucher);
  const nowIso = new Date().toISOString();
  const { error: redeemError } = await adminClient
    .from("trial_flight_vouchers")
    .update({
      status: "redeemed",
      redeemed_at: voucher.redeemed_at || nowIso,
      redeemed_by_user_id: studentId,
      updated_at: nowIso,
    })
    .eq("id", voucher.id)
    .neq("status", "booked");
  if (redeemError) throw redeemError;

  const { data: bookingId, error: bookingError } = await adminClient.rpc("book_trial_flight_voucher_slot", {
    p_voucher_id: voucher.id,
    p_student_id: studentId,
    p_aircraft_id: voucher.held_aircraft_id,
    p_instructor_id: voucher.held_instructor_id,
    p_start_time: voucher.held_start_time,
    p_end_time: voucher.held_end_time,
    p_notes: `Trial flight voucher ${voucher.code} - ${product.name || "Trial flight"}`,
  });

  if (bookingError || !bookingId) throw new Error(bookingError?.message || "Could not create the paid trial flight booking");

  const booking = {
    bookingId,
    startTime: voucher.held_start_time,
    endTime: voucher.held_end_time,
  };
  const purchaserEmail = clean(voucher.purchaser_email).trim().toLowerCase();
  const recipientEmail = clean(voucher.recipient_email).trim().toLowerCase();
  const purchaserResult = purchaserEmail
    ? await sendBookNowConfirmationEmail({
      to: purchaserEmail,
      toName: clean(voucher.purchaser_name) || purchaserEmail,
      voucher,
      product,
      booking,
      audience: "purchaser",
    })
    : { sent: false, error: "No purchaser email" };

  const shouldEmailRecipient = Boolean(voucher.send_to_recipient && recipientEmail && recipientEmail !== purchaserEmail);
  const recipientResult = shouldEmailRecipient
    ? await sendBookNowConfirmationEmail({
      to: recipientEmail,
      toName: clean(voucher.recipient_name) || recipientEmail,
      voucher,
      product,
      booking,
      audience: "recipient",
    })
    : { sent: false, error: null };

  await adminClient
    .from("trial_flight_vouchers")
    .update({
      purchaser_confirmation_sent_at: purchaserResult.sent ? new Date().toISOString() : null,
      purchaser_confirmation_error: purchaserResult.error || null,
      recipient_confirmation_sent_at: recipientResult.sent ? new Date().toISOString() : null,
      recipient_confirmation_error: recipientResult.error || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", voucher.id);

  return { bookingId, purchaserEmail: purchaserResult, recipientEmail: recipientResult };
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const internalSecret = Deno.env.get("TRIAL_VOUCHER_INTERNAL_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !internalSecret) {
    return json({ error: "Stripe voucher webhook is not fully configured" }, 503);
  }

  const rawBody = await req.text();

  let event: any;
  let webhookMode: StripeMode;
  try {
    const verified = await parseAndVerifyStripeEvent({
      rawBody,
      signatureHeader: req.headers.get("stripe-signature"),
    });
    event = verified.event;
    webhookMode = verified.mode;
  } catch (error) {
    console.warn("Stripe signature verification failed:", error);
    return json({ error: "Invalid Stripe signature" }, 400);
  }

  let stripeSecretKey = "";
  try {
    stripeSecretKey = getStripeSecretKeyForMode(webhookMode);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Stripe API key is not configured for this webhook mode." }, 503);
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

    if (asString(session.metadata?.crm_payment_type) === "member_topup") {
      return await handleMemberTopupStripeEvent({ adminClient, event, session, sessionId });
    }

    if (asString(session.metadata?.crm_payment_type) === "xero_invoice_payment") {
      return await handleXeroInvoicePaymentStripeEvent({ adminClient, event, session, sessionId });
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
      const abandonedEmail = voucher.checkout_intent === "book_now"
        ? await sendBookNowAbandonedEmail({ voucher })
        : { sent: false, error: null };
      await adminClient
        .from("trial_flight_vouchers")
        .update({
          payment_status: "failed",
          payment_source: "stripe",
          stripe_checkout_session_id: sessionId || voucher.stripe_checkout_session_id,
          stripe_payment_intent_id: asString(session.payment_intent) || null,
          checkout_abandoned_email_sent_at: abandonedEmail.sent ? new Date().toISOString() : voucher.checkout_abandoned_email_sent_at || null,
          checkout_abandoned_email_error: abandonedEmail.error || null,
          updated_at: new Date().toISOString(),
          ...stripeModeColumns(stripeModeFromEvent(event)),
        })
        .eq("id", voucher.id)
        .neq("payment_status", "paid");

      await markEventProcessed(adminClient, event.id);
      return json({ received: true, voucherId: voucher.id, expired: true });
    }

    if (event.type === "checkout.session.async_payment_failed") {
      const abandonedEmail = voucher.checkout_intent === "book_now"
        ? await sendBookNowAbandonedEmail({ voucher })
        : { sent: false, error: null };
      await adminClient
        .from("trial_flight_vouchers")
        .update({
          payment_status: "failed",
          payment_source: "stripe",
          stripe_checkout_session_id: sessionId || voucher.stripe_checkout_session_id,
          stripe_payment_intent_id: asString(session.payment_intent) || null,
          ...stripePaymentFields(session),
          checkout_abandoned_email_sent_at: abandonedEmail.sent ? new Date().toISOString() : voucher.checkout_abandoned_email_sent_at || null,
          checkout_abandoned_email_error: abandonedEmail.error || null,
          updated_at: new Date().toISOString(),
          ...stripeModeColumns(stripeModeFromEvent(event)),
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
          payment_source: "stripe",
          stripe_checkout_session_id: sessionId || voucher.stripe_checkout_session_id,
          stripe_payment_intent_id: asString(session.payment_intent) || null,
          ...stripePaymentFields(session),
          updated_at: new Date().toISOString(),
          ...stripeModeColumns(stripeModeFromEvent(event)),
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
        payment_source: "stripe",
        stripe_checkout_session_id: sessionId || voucher.stripe_checkout_session_id,
        stripe_payment_intent_id: asString(session.payment_intent) || null,
        ...stripePaymentFields(session),
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...stripeModeColumns(stripeModeFromEvent(event)),
      })
      .eq("id", voucher.id);

    if (updateError) throw updateError;

    const emailResult = voucher.checkout_intent === "book_now"
      ? await handleBookNowPaidVoucher(adminClient, {
        ...voucher,
        payment_status: "paid",
        stripe_checkout_session_id: sessionId || voucher.stripe_checkout_session_id,
        stripe_payment_intent_id: asString(session.payment_intent) || null,
      })
      : voucher.delivered_at
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
