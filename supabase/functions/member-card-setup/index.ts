import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getConnectedStripeAccountId, stripeHeaders, stripeIdempotencyKey } from "../_shared/stripeConnectAccount.ts";
import { addStripeModeMetadata, getActiveStripeMode, stripeModeColumns } from "../_shared/stripeMode.ts";

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
const STRIPE_TIMEOUT_MS = 15000;

const fetchStripe = async (url: string, init: RequestInit, label: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STRIPE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? `${label} timed out. Please try again.`
      : `${label} failed before Stripe responded.`;
    throw Object.assign(new Error(message), { status: 504 });
  } finally {
    clearTimeout(timer);
  }
};

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

const consentText = [
  "I authorise Bendigo Flying Club to securely store my card with Stripe and charge my saved card for flight charges, aircraft hire, training flights, and related flying charges that are logged and confirmed in the Members Flight Management System.",
  "I understand the final amount may be calculated after the flight from the aircraft rate, flight type, tach/flight time, instructor charges, and any approved adjustments.",
  "I understand my card details are stored by Stripe, not by the CRM, and I can remove or replace my saved card from my portal.",
  "If a charge fails, I remain responsible for the outstanding balance.",
].join(" ");

const getAuthUser = async (adminClient: any, req: Request) => {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("Authentication is required."), { status: 401 });
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user?.id) throw Object.assign(new Error("Invalid session."), { status: 401 });
  return data.user;
};

const getDefaultCard = async (adminClient: any, userId: string, stripeMode: string) => {
  const { data, error } = await adminClient
    .from("member_stripe_payment_methods")
    .select("id,user_id,stripe_customer_id,stripe_payment_method_id,card_brand,card_last4,card_exp_month,card_exp_year,active,is_default,consent_accepted_at,stripe_mode")
    .eq("user_id", userId)
    .eq("active", true)
    .eq("is_default", true)
    .eq("stripe_mode", stripeMode)
    .order("created_at", { ascending: false })
    .maybeSingle();
  if (error) throw error;
  return data;
};

const getReusableCustomerId = async (adminClient: any, userId: string, stripeMode: string) => {
  const card = await getDefaultCard(adminClient, userId, stripeMode);
  if (card?.stripe_customer_id) return card.stripe_customer_id;

  const { data, error } = await adminClient
    .from("member_stripe_card_setup_sessions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .eq("stripe_mode", stripeMode)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.stripe_customer_id || null;
};

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

    const user = await getAuthUser(adminClient, req);
    const body = await req.json();
    const action = cleanText(body.action || "status");

    if (action === "status") {
      const connectedAccountId = await getConnectedStripeAccountId(adminClient);
      const card = await getDefaultCard(adminClient, user.id, stripeMode.mode);
      return json({
        configured: Boolean(stripeSecretKey),
        stripeMode: stripeMode.mode,
        isTestMode: stripeMode.isTestMode,
        connected: Boolean(connectedAccountId),
        consentText,
        card: card ? {
          id: card.id,
          brand: card.card_brand,
          last4: card.card_last4,
          expMonth: card.card_exp_month,
          expYear: card.card_exp_year,
          consentAcceptedAt: card.consent_accepted_at,
        } : null,
      });
    }

    const connectedAccountId = await getConnectedStripeAccountId(adminClient);
    if (!connectedAccountId) return json({ error: "Stripe is not connected for this club." }, 503);

    if (action === "remove") {
      const card = await getDefaultCard(adminClient, user.id, stripeMode.mode);
      if (!card) return json({ ok: true, removed: false });

      const detachResponse = await fetchStripe(`https://api.stripe.com/v1/payment_methods/${encodeURIComponent(card.stripe_payment_method_id)}/detach`, {
        method: "POST",
        headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }, "Stripe card removal");

      if (!detachResponse.ok) {
        const detachBody = await detachResponse.json().catch(() => ({}));
        console.warn("Stripe payment method detach failed:", detachBody);
      }

      const { error: updateError } = await adminClient
        .from("member_stripe_payment_methods")
        .update({
          active: false,
          is_default: false,
          removed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", card.id)
        .eq("user_id", user.id);
      if (updateError) throw updateError;

      return json({ ok: true, removed: true });
    }

    if (action !== "start") return json({ error: "Unknown action." }, 400);
    if (body.consentAccepted !== true) {
      return json({ error: "You must accept the card-on-file authority before saving a card." }, 400);
    }

    const { data: profile, error: profileError } = await adminClient
      .from("users")
      .select("id,name,email")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    let stripeCustomerId = await getReusableCustomerId(adminClient, user.id, stripeMode.mode);
    if (!stripeCustomerId) {
      const customerForm = new URLSearchParams();
      if (profile?.email || user.email) customerForm.set("email", profile?.email || user.email || "");
      if (profile?.name) customerForm.set("name", profile.name);
      customerForm.set("metadata[crm_user_id]", user.id);

      const customerResponse = await fetchStripe("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": stripeIdempotencyKey("member-card-customer", user.id),
        }),
        body: customerForm,
      }, "Stripe customer setup");
      const customer = await customerResponse.json();
      if (!customerResponse.ok) return json({ error: customer?.error?.message || "Stripe customer could not be created." }, 502);
      stripeCustomerId = customer.id;
    }

    const { data: setupRecord, error: setupError } = await adminClient
      .from("member_stripe_card_setup_sessions")
      .insert({
        user_id: user.id,
        stripe_customer_id: stripeCustomerId,
        consent_text: consentText,
        consent_accepted_at: new Date().toISOString(),
        consent_ip: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null,
        consent_user_agent: req.headers.get("user-agent") || null,
        ...stripeModeColumns(stripeMode.mode),
      })
      .select("id")
      .single();
    if (setupError) throw setupError;

    const successUrl = safeReturnUrl(body.successUrl, "/billing?card_setup=success");
    const cancelUrl = safeReturnUrl(body.cancelUrl, "/billing?card_setup=cancelled");
    const form = new URLSearchParams();
    form.set("mode", "setup");
    form.set("currency", "aud");
    form.set("customer", stripeCustomerId);
    form.set("success_url", `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", cancelUrl);
    form.set("client_reference_id", user.id);
    form.set("metadata[crm_payment_type]", "member_card_setup");
    addStripeModeMetadata(form, stripeMode.mode);
    form.set("metadata[user_id]", user.id);
    form.set("metadata[setup_session_id]", setupRecord.id);
    form.set("setup_intent_data[metadata][crm_payment_type]", "member_card_setup");
    form.set("setup_intent_data[metadata][stripe_mode]", stripeMode.mode);
    form.set("setup_intent_data[metadata][test_mode]", stripeMode.isTestMode ? "true" : "false");
    form.set("setup_intent_data[metadata][user_id]", user.id);
    form.set("setup_intent_data[metadata][setup_session_id]", setupRecord.id);

    const checkoutResponse = await fetchStripe("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": stripeIdempotencyKey("member-card-setup-session", setupRecord.id, user.id),
      }),
      body: form,
    }, "Stripe card setup page");
    const session = await checkoutResponse.json();
    if (!checkoutResponse.ok) {
      await adminClient
        .from("member_stripe_card_setup_sessions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", setupRecord.id);
      return json({ error: session?.error?.message || "Stripe card setup could not be created." }, 502);
    }

    await adminClient
      .from("member_stripe_card_setup_sessions")
      .update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() })
      .eq("id", setupRecord.id);

    return json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (error) {
    const status = typeof (error as any)?.status === "number" ? (error as any).status : 500;
    console.error("member-card-setup error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, status);
  }
});
