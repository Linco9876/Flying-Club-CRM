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
const TOPUP_INCREMENT_CENTS = 100000;

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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
      accept: "application/json",
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

const buildTopupEmail = ({
  memberName,
  amount,
  checkoutUrl,
}: {
  memberName: string;
  amount: number;
  checkoutUrl: string;
}) => `<!doctype html>
<html>
  <body style="margin:0;background:#f3f6fb;font-family:Inter,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #dbe3ef;">
            <tr>
              <td style="background:#0f2b5f;color:#ffffff;padding:28px 28px 24px;">
                <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#bfdbfe;">Bendigo Flying Club</p>
                <h1 style="margin:0;font-size:26px;line-height:1.2;">Pilot account top-up</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Hi ${escapeHtml(memberName)},</p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">
                  Your pilot account needs a positive Xero credit balance and enough funds to cover prepaid flying. Top-ups are only available in <strong>$1,000 increments</strong>. Use the secure link below to add <strong>$${amount.toFixed(2)}</strong>.
                </p>
                <p style="margin:0 0 24px;">
                  <a href="${escapeHtml(checkoutUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;border-radius:14px;padding:14px 22px;">Add funds securely</a>
                </p>
                <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">If the button does not work, copy this link into your browser:</p>
                <p style="margin:8px 0 0;color:#2563eb;font-size:13px;line-height:1.6;word-break:break-all;">${escapeHtml(checkoutUrl)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey) {
      return json({ error: "Top-up checkout is not fully configured." }, 503);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user?.id) return json({ error: "Invalid session." }, 401);

    const body = await req.json();
    const requestedUserId = cleanText(body.userId) || authData.user.id;
    const amountCents = dollarsToCents(body.amount || 1000);
    const sendPaymentEmail = body.sendEmail !== false;
    const dedupeWindowMinutes = Math.max(0, Number(body.dedupeWindowMinutes || 0));
    const triggerReason = cleanText(body.triggerReason) || "manual";
    const successUrl = safeReturnUrl(body.successUrl, "/billing?topup=success");
    const cancelUrl = safeReturnUrl(body.cancelUrl, "/billing?topup=cancelled");

    if (!amountCents || amountCents < TOPUP_INCREMENT_CENTS || amountCents % TOPUP_INCREMENT_CENTS !== 0) {
      return json({ error: "Top-up amount must be a multiple of $1000.00." }, 400);
    }

    const isSelf = requestedUserId === authData.user.id;
    if (!isSelf && !(await hasStaffRole(adminClient, authData.user.id))) {
      return json({ error: "Only staff can create a top-up link for another member." }, 403);
    }

    const connectedAccountId = await getConnectedStripeAccountId(adminClient);
    if (!connectedAccountId) {
      return json({ error: "Connect this club's Stripe account in Settings > Integrations first." }, 503);
    }

    const { data: stripeMethod, error: methodError } = await adminClient
      .from("payment_methods")
      .select("id,name,active,system_key,allow_account_topup")
      .eq("system_key", "stripe_card")
      .maybeSingle();
    if (methodError) throw methodError;
    if (!stripeMethod?.active || stripeMethod.allow_account_topup === false) {
      return json({ error: "Activate Stripe Card Payment for pilot account top-ups in Billing & Rates first." }, 409);
    }

    const { data: member, error: memberError } = await adminClient
      .from("users")
      .select("id,name,email,xero_contact_id")
      .eq("id", requestedUserId)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) return json({ error: "Member not found." }, 404);

    const memberName = cleanText(member.name) || cleanText(member.email) || "Member";
    const memberEmail = cleanText(member.email);
    if (sendPaymentEmail && !memberEmail) {
      return json({ error: "No email address is stored for this member." }, 409);
    }

    const amount = centsToDollars(amountCents);
    if (sendPaymentEmail && dedupeWindowMinutes > 0) {
      const since = new Date(Date.now() - dedupeWindowMinutes * 60 * 1000).toISOString();
      const { data: recentNotification, error: recentError } = await adminClient
        .from("member_topup_link_notifications")
        .select("id,created_at,email_to,email_sent,email_error,checkout_session_id,amount")
        .eq("user_id", requestedUserId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recentError) throw recentError;
      if (recentNotification) {
        return json({
          skipped: true,
          reason: "recent_topup_link_sent",
          notificationId: recentNotification.id,
          recentCreatedAt: recentNotification.created_at,
          emailTo: recentNotification.email_to,
          emailSent: recentNotification.email_sent,
          emailError: recentNotification.email_error,
          sessionId: recentNotification.checkout_session_id,
          amount: Number(recentNotification.amount || amount),
        });
      }
    }

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("line_items[0][price_data][currency]", "aud");
    form.set("line_items[0][price_data][unit_amount]", String(amountCents));
    form.set("line_items[0][price_data][product_data][name]", "Pilot account top-up");
    form.set("line_items[0][price_data][product_data][description]", `${memberName} prepaid pilot account top-up`);
    form.set("line_items[0][quantity]", "1");
    form.set("success_url", `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", cancelUrl);
    form.set("client_reference_id", requestedUserId);
    form.set("metadata[crm_payment_type]", "member_topup");
    form.set("metadata[user_id]", requestedUserId);
    form.set("metadata[payment_method_id]", stripeMethod.id);
    form.set("metadata[topup_amount]", amount.toFixed(2));
    if (member.xero_contact_id) form.set("metadata[xero_contact_id]", member.xero_contact_id);
    if (memberEmail) form.set("customer_email", memberEmail);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": stripeIdempotencyKey("member-topup", requestedUserId, amountCents, Date.now()),
      }),
      body: form,
    });

    const session = await stripeResponse.json();
    if (!stripeResponse.ok) {
      return json({ error: session?.error?.message || "Stripe checkout could not be created." }, 502);
    }

    let emailSent = false;
    let emailError: string | null = null;
    if (sendPaymentEmail && memberEmail) {
      const emailResult = await sendEmail({
        to: memberEmail,
        toName: memberName,
        subject: `Pilot account top-up link - $${amount.toFixed(2)}`,
        html: buildTopupEmail({
          memberName,
          amount,
          checkoutUrl: session.url,
        }),
      });
      emailSent = emailResult.sent;
      emailError = emailResult.error;
    }

    const { error: notificationError } = await adminClient
      .from("member_topup_link_notifications")
      .insert({
        user_id: requestedUserId,
        checkout_session_id: session.id,
        amount,
        trigger_reason: triggerReason,
        email_to: memberEmail || null,
        email_sent: emailSent,
        email_error: emailError,
        created_by: authData.user.id,
      });
    if (notificationError) {
      console.error("Failed to record member top-up link notification:", notificationError);
    }

    return json({
      checkoutUrl: session.url,
      sessionId: session.id,
      userId: requestedUserId,
      emailSent,
      emailError,
      emailTo: memberEmail || null,
      amount,
    });
  } catch (error) {
    console.error("create-member-topup-checkout error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
