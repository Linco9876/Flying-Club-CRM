import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getConnectedStripeAccountId,
  stripeHeaders,
  stripeIdempotencyKey,
} from "../_shared/stripeConnectAccount.ts";
import {
  addStripeModeMetadata,
  getActiveStripeMode,
  stripeModeColumns,
} from "../_shared/stripeMode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const clean = (value: unknown) => String(value || "").trim();
const siteOrigin = () =>
  (Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au")
    .replace(/\/$/, "");
const isAllowedOrigin = (origin: string) =>
  origin === siteOrigin() ||
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin);

const safeReturnUrl = (value: unknown, fallbackPath: string) => {
  const fallback = `${siteOrigin()}${fallbackPath}`;
  try {
    const url = new URL(clean(value) || fallback, siteOrigin());
    return isAllowedOrigin(url.origin) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
};

const getAuthUser = async (adminClient: any, req: Request) => {
  const token = clean(req.headers.get("Authorization")).replace(
    /^Bearer\s+/i,
    "",
  );
  if (!token) {
    throw Object.assign(new Error("Authentication is required."), {
      status: 401,
    });
  }
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw Object.assign(new Error("Invalid session."), { status: 401 });
  }
  return data.user;
};

const membershipAuthorityText = ({
  method,
  autoRenew,
  scholarshipEnabled,
  scholarshipAmount,
}: {
  method: "card" | "becs";
  autoRenew: boolean;
  scholarshipEnabled: boolean;
  scholarshipAmount: number;
}) => {
  const methodLabel = method === "becs"
    ? "bank account by BECS Direct Debit"
    : "saved card";
  const renewalText = autoRenew
    ? "I also authorise collection of each future annual membership renewal after advance notice, until I cancel this authority."
    : "This authority applies to the initial membership invoice only and does not authorise automatic annual renewal payments.";
  const scholarshipText = scholarshipEnabled
    ? `I have voluntarily chosen an annual $${
      scholarshipAmount.toFixed(2)
    } BFC scholarship contribution, which I can remove before a future renewal.`
    : "I have not selected a scholarship contribution.";
  return [
    `I authorise Bendigo Flying Club to securely store my payment method with Stripe and collect my membership invoice from my ${methodLabel} when membership commences.`,
    renewalText,
    scholarshipText,
    "I understand membership does not commence merely because a payment authority is saved, and I can change the payment method or cancel automatic payment in the portal.",
  ].join(" ");
};

const memberHasApplicationOrMembership = async (
  adminClient: any,
  userId: string,
) => {
  const [
    { data: application, error: applicationError },
    { data: membership, error: membershipError },
  ] = await Promise.all([
    adminClient.from("membership_applications").select("id").eq(
      "user_id",
      userId,
    ).eq("status", "pending").limit(1).maybeSingle(),
    adminClient.from("club_memberships").select("id").eq("user_id", userId)
      .eq("legal_status", "current").limit(1).maybeSingle(),
  ]);
  if (applicationError) throw applicationError;
  if (membershipError) throw membershipError;
  return Boolean(application || membership);
};

const currentPreference = async (adminClient: any, userId: string) => {
  const { data, error } = await adminClient
    .from("membership_payment_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const preferenceResponse = (preference: any) =>
  preference
    ? {
      userId: preference.user_id,
      paymentMethod: preference.payment_method,
      autoRenew: Boolean(preference.auto_renew),
      scholarshipContributionEnabled: Boolean(
        preference.scholarship_contribution_enabled,
      ),
      scholarshipContributionAmount: Number(
        preference.scholarship_contribution_amount || 0,
      ),
      authorityStatus: preference.authority_status,
      paymentMethodDisplay: preference.payment_method_display,
      consentAcceptedAt: preference.consent_accepted_at,
      lastCollectionAttemptAt: preference.last_collection_attempt_at,
      lastCollectionStatus: preference.last_collection_status,
      lastCollectionError: preference.last_collection_error,
      updatedAt: preference.updated_at,
    }
    : null;

const updateUninvoicedPeriodContribution = async (
  adminClient: any,
  userId: string,
  enabled: boolean,
  amount: number,
) => {
  const { data: membership, error: membershipError } = await adminClient
    .from("club_memberships")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return;

  const { data: periods, error: periodsError } = await adminClient
    .from("membership_financial_periods")
    .select("id,membership_fee_amount")
    .eq("membership_id", membership.id)
    .is("xero_invoice_id", null)
    .in("fee_disposition", ["invoice_required", "overdue"]);
  if (periodsError) throw periodsError;
  for (const period of periods || []) {
    const contribution = enabled ? amount : 0;
    const { error } = await adminClient.from("membership_financial_periods")
      .update({
        scholarship_contribution_amount: contribution,
        amount_due: Number(period.membership_fee_amount || 0) + contribution,
        updated_at: new Date().toISOString(),
      }).eq("id", period.id);
    if (error) throw error;
  }
};

const getReusableCustomerId = async (
  adminClient: any,
  userId: string,
  stripeMode: string,
) => {
  const preference = await currentPreference(adminClient, userId);
  if (
    preference?.stripe_mode === stripeMode &&
    clean(preference.stripe_customer_id)
  ) return clean(preference.stripe_customer_id);

  const { data: card } = await adminClient
    .from("member_stripe_payment_methods")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .eq("active", true)
    .eq("is_default", true)
    .eq("stripe_mode", stripeMode)
    .maybeSingle();
  if (clean(card?.stripe_customer_id)) return clean(card.stripe_customer_id);

  const { data: setup } = await adminClient
    .from("membership_payment_setup_sessions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .eq("stripe_mode", stripeMode)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return clean(setup?.stripe_customer_id) || null;
};

const invokeMembershipBilling = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  body: Record<string, unknown>,
) => {
  const response = await fetch(`${supabaseUrl}/functions/v1/xero-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw Object.assign(
      new Error(
        payload?.error ||
          `Membership billing failed with HTTP ${response.status}.`,
      ),
      { status: response.status },
    );
  }
  return payload;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const user = await getAuthUser(adminClient, req);
    const body = await req.json().catch(() => ({}));
    const action = clean(body.action || "status");

    if (action === "status") {
      return json({
        preference: preferenceResponse(
          await currentPreference(adminClient, user.id),
        ),
      });
    }

    if (!(await memberHasApplicationOrMembership(adminClient, user.id))) {
      return json({
        error:
          "Submit a membership application before choosing membership payment settings.",
      }, 409);
    }

    if (action === "cancel-membership") {
      const reason = clean(body.reason);
      if (reason.length < 10) {
        return json({
          error:
            "Please provide a cancellation reason of at least 10 characters.",
        }, 400);
      }
      return json(
        await invokeMembershipBilling(supabaseUrl, serviceRoleKey, {
          action: "cancel-membership",
          userId: user.id,
          requestedByUserId: user.id,
          reason,
        }),
      );
    }

    if (action !== "save") return json({ error: "Unknown action." }, 400);

    const paymentMethod = clean(body.paymentMethod).toLowerCase();
    if (!["invoice", "becs", "card"].includes(paymentMethod)) {
      return json(
        { error: "Choose Xero invoice, BECS Direct Debit or card." },
        400,
      );
    }
    const autoRenew = body.autoRenew === true;
    const scholarshipEnabled = body.scholarshipContributionEnabled === true;
    const scholarshipAmount =
      Math.round(Number(body.scholarshipContributionAmount ?? 5) * 100) / 100;
    if (
      scholarshipEnabled &&
      (!Number.isFinite(scholarshipAmount) || scholarshipAmount < 0.01)
    ) {
      return json({
        error: "Enter a scholarship contribution of at least $0.01.",
      }, 400);
    }
    const contributionAmount = scholarshipEnabled
      ? scholarshipAmount
      : Math.max(0, Number.isFinite(scholarshipAmount) ? scholarshipAmount : 5);
    const now = new Date().toISOString();

    if (paymentMethod === "invoice") {
      const { data, error } = await adminClient.from(
        "membership_payment_preferences",
      ).upsert({
        user_id: user.id,
        payment_method: "invoice",
        auto_renew: false,
        scholarship_contribution_enabled: scholarshipEnabled,
        scholarship_contribution_amount: contributionAmount,
        authority_status: "not_required",
        consent_text:
          "Member selected manual Xero invoice payment. No recurring debit authority was granted.",
        consent_accepted_at: now,
        consent_ip: req.headers.get("x-forwarded-for") ||
          req.headers.get("cf-connecting-ip") || null,
        consent_user_agent: req.headers.get("user-agent") || null,
        cancelled_at: null,
        updated_at: now,
      }, { onConflict: "user_id" }).select("*").single();
      if (error) throw error;
      await updateUninvoicedPeriodContribution(
        adminClient,
        user.id,
        scholarshipEnabled,
        contributionAmount,
      );
      return json({
        preference: preferenceResponse(data),
        setupRequired: false,
      });
    }

    if (body.authorityAccepted !== true) {
      return json(
        { error: "Accept the payment authority before continuing." },
        400,
      );
    }

    const method = paymentMethod as "card" | "becs";
    const consentText = membershipAuthorityText({
      method,
      autoRenew,
      scholarshipEnabled,
      scholarshipAmount: contributionAmount,
    });
    const stripeMode = await getActiveStripeMode(adminClient);
    const connectedAccountId = await getConnectedStripeAccountId(adminClient);
    if (!connectedAccountId) {
      return json({ error: "Stripe is not connected for this club." }, 503);
    }

    const existing = await currentPreference(adminClient, user.id);
    const existingDisplay = clean(existing?.payment_method_display);
    const existingMethodIsRecognisable = /ending\s+\d{4}$/i.test(
      existingDisplay,
    );
    if (
      existing?.payment_method === method &&
      existing?.authority_status === "ready" &&
      existing?.stripe_mode === stripeMode.mode &&
      clean(existing?.stripe_customer_id) &&
      clean(existing?.stripe_payment_method_id) &&
      existingMethodIsRecognisable &&
      body.forceSetup !== true
    ) {
      const { data, error } = await adminClient.from(
        "membership_payment_preferences",
      ).update({
        auto_renew: autoRenew,
        scholarship_contribution_enabled: scholarshipEnabled,
        scholarship_contribution_amount: contributionAmount,
        consent_text: consentText,
        consent_accepted_at: now,
        consent_ip: req.headers.get("x-forwarded-for") ||
          req.headers.get("cf-connecting-ip") || null,
        consent_user_agent: req.headers.get("user-agent") || null,
        cancelled_at: null,
        updated_at: now,
      }).eq("user_id", user.id).select("*").single();
      if (error) throw error;
      await updateUninvoicedPeriodContribution(
        adminClient,
        user.id,
        scholarshipEnabled,
        contributionAmount,
      );
      return json({
        preference: preferenceResponse(data),
        setupRequired: false,
      });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("users").select("id,name,email").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    let stripeCustomerId = await getReusableCustomerId(
      adminClient,
      user.id,
      stripeMode.mode,
    );
    if (!stripeCustomerId) {
      const customerForm = new URLSearchParams();
      if (profile?.email || user.email) {
        customerForm.set("email", profile?.email || user.email || "");
      }
      if (profile?.name) customerForm.set("name", profile.name);
      customerForm.set("metadata[crm_user_id]", user.id);
      addStripeModeMetadata(customerForm, stripeMode.mode);
      const customerResponse = await fetch(
        "https://api.stripe.com/v1/customers",
        {
          method: "POST",
          headers: stripeHeaders(stripeMode.secretKey, connectedAccountId, {
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": stripeIdempotencyKey(
              "membership-customer",
              stripeMode.mode,
              user.id,
            ),
          }),
          body: customerForm,
        },
      );
      const customer = await customerResponse.json();
      if (!customerResponse.ok) {
        return json({
          error: customer?.error?.message ||
            "Stripe customer could not be created.",
        }, 502);
      }
      stripeCustomerId = customer.id;
    }
    if (!stripeCustomerId) {
      return json(
        { error: "Stripe did not return a customer reference." },
        502,
      );
    }

    const { data: setupRecord, error: setupError } = await adminClient
      .from("membership_payment_setup_sessions")
      .insert({
        user_id: user.id,
        payment_method: method,
        stripe_customer_id: stripeCustomerId,
        consent_text: consentText,
        consent_accepted_at: now,
        consent_ip: req.headers.get("x-forwarded-for") ||
          req.headers.get("cf-connecting-ip") || null,
        consent_user_agent: req.headers.get("user-agent") || null,
        ...stripeModeColumns(stripeMode.mode),
      })
      .select("id")
      .single();
    if (setupError) throw setupError;

    const { error: preferenceError } = await adminClient.from(
      "membership_payment_preferences",
    ).upsert({
      user_id: user.id,
      payment_method: method,
      auto_renew: autoRenew,
      scholarship_contribution_enabled: scholarshipEnabled,
      scholarship_contribution_amount: contributionAmount,
      authority_status: "pending",
      stripe_customer_id: stripeCustomerId,
      stripe_payment_method_id: null,
      stripe_payment_method_type: method === "becs" ? "au_becs_debit" : "card",
      payment_method_display: null,
      consent_text: consentText,
      consent_accepted_at: now,
      consent_ip: req.headers.get("x-forwarded-for") ||
        req.headers.get("cf-connecting-ip") || null,
      consent_user_agent: req.headers.get("user-agent") || null,
      cancelled_at: null,
      updated_at: now,
      ...stripeModeColumns(stripeMode.mode),
    }, { onConflict: "user_id" });
    if (preferenceError) throw preferenceError;
    await updateUninvoicedPeriodContribution(
      adminClient,
      user.id,
      scholarshipEnabled,
      contributionAmount,
    );

    const successUrl = safeReturnUrl(
      body.successUrl,
      "/membership?payment_setup=success",
    );
    const cancelUrl = safeReturnUrl(
      body.cancelUrl,
      "/membership?payment_setup=cancelled",
    );
    const form = new URLSearchParams();
    form.set("mode", "setup");
    form.set("currency", "aud");
    form.set("customer", stripeCustomerId);
    form.set(
      "payment_method_types[0]",
      method === "becs" ? "au_becs_debit" : "card",
    );
    form.set(
      "success_url",
      `${successUrl}${
        successUrl.includes("?") ? "&" : "?"
      }session_id={CHECKOUT_SESSION_ID}`,
    );
    form.set("cancel_url", cancelUrl);
    form.set("client_reference_id", user.id);
    form.set("metadata[crm_payment_type]", "membership_payment_setup");
    form.set("metadata[user_id]", user.id);
    form.set("metadata[setup_session_id]", setupRecord.id);
    form.set("metadata[payment_method]", method);
    addStripeModeMetadata(form, stripeMode.mode);
    form.set(
      "setup_intent_data[metadata][crm_payment_type]",
      "membership_payment_setup",
    );
    form.set("setup_intent_data[metadata][user_id]", user.id);
    form.set("setup_intent_data[metadata][setup_session_id]", setupRecord.id);
    form.set("setup_intent_data[metadata][payment_method]", method);
    addStripeModeMetadata(form, stripeMode.mode);

    const checkoutResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: stripeHeaders(stripeMode.secretKey, connectedAccountId, {
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": stripeIdempotencyKey(
            "membership-payment-setup",
            setupRecord.id,
            user.id,
          ),
        }),
        body: form,
      },
    );
    const session = await checkoutResponse.json();
    if (!checkoutResponse.ok) {
      await adminClient.from("membership_payment_setup_sessions").update({
        status: "failed",
        updated_at: new Date().toISOString(),
      }).eq("id", setupRecord.id);
      await adminClient.from("membership_payment_preferences").update({
        authority_status: "failed",
        last_collection_error: session?.error?.message ||
          "Stripe setup failed.",
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id);
      return json({
        error: session?.error?.message ||
          "Stripe payment setup could not be created.",
      }, 502);
    }

    await adminClient.from("membership_payment_setup_sessions").update({
      stripe_checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    }).eq("id", setupRecord.id);

    return json({
      checkoutUrl: session.url,
      sessionId: session.id,
      setupRequired: true,
    });
  } catch (error) {
    const status = typeof (error as any)?.status === "number"
      ? (error as any).status
      : 500;
    console.error("membership-payment-setup error:", error);
    return json({
      error: error instanceof Error ? error.message : "Unexpected error",
    }, status);
  }
});
