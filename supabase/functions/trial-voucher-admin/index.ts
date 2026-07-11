import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getConnectedStripeAccountId, stripeHeaders, stripeIdempotencyKey } from "../_shared/stripeConnectAccount.ts";
import { addStripeModeMetadata, getActiveStripeMode, stripeModeColumns, testModeSubject } from "../_shared/stripeMode.ts";
import { trialVoucherProductBookingSetup } from "../_shared/trialVoucherReadiness.ts";

type SupabaseAdminClient = any;

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

const isStaffRole = (role: string) => ["admin", "senior_instructor", "instructor"].includes(role);
const cleanText = (value: unknown) => String(value || "").trim();
const cleanEmail = (value: unknown) => String(value || "").trim().toLowerCase();
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isUniqueViolation = (error: any) => error?.code === "23505";

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const generateVoucherCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomPart = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `BFC-${randomPart()}-${randomPart()}-${randomPart()}`;
};

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

const sendBrevoEmail = async ({
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
      "api-key": apiKey,
      "Content-Type": "application/json",
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

const buildPaymentLinkEmail = ({
  purchaserName,
  product,
  checkoutUrl,
  amount,
}: {
  purchaserName: string;
  product: any;
  checkoutUrl: string;
  amount: number;
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
                <h1 style="margin:0;font-size:28px;line-height:1.15;">Complete your trial flight voucher payment</h1>
                <p style="margin:14px 0 0;color:#dbeafe;font-size:15px;line-height:1.6;">Your voucher will be emailed after Stripe confirms payment.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 30px;">
                <p style="margin:0 0 16px;font-size:17px;line-height:1.6;color:#0f172a;">Hi ${escapeHtml(purchaserName || "there")},</p>
                <p style="margin:0 0 18px;line-height:1.65;color:#334155;">Bendigo Flying Club has prepared a ${escapeHtml(product.name || "trial flight voucher")} for you. Use the secure Stripe button below to complete payment.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;border:1px solid #dbeafe;border-radius:18px;background:#f8fbff;">
                  <tr>
                    <td style="padding:18px;">
                      <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#2563eb;font-weight:700;">Amount due</p>
                      <p style="margin:0;font-size:28px;font-weight:800;color:#0f172a;">AUD $${escapeHtml(amount.toFixed(2))}</p>
                      <p style="margin:8px 0 0;color:#475569;font-size:14px;">${escapeHtml(product.name || "Trial flight voucher")}</p>
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

type StaffAuthResult =
  | { ok: true; userId: string }
  | { ok: false; error: string; status: number };

const authenticateStaff = async ({
  req,
  supabaseUrl,
  anonKey,
  adminClient,
}: {
  req: Request;
  supabaseUrl: string;
  anonKey: string;
  adminClient: SupabaseAdminClient;
}): Promise<StaffAuthResult> => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, error: "No authorization header", status: 401 };

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerUser) return { ok: false, error: "Unauthorized", status: 401 };

  const [{ data: callerRoles, error: rolesError }, { data: callerProfile, error: profileError }] = await Promise.all([
    adminClient.from("user_roles").select("role").eq("user_id", callerUser.id),
    adminClient.from("users").select("role").eq("id", callerUser.id).maybeSingle(),
  ]);
  if (rolesError) return { ok: false, error: rolesError.message, status: 500 };
  if (profileError) return { ok: false, error: profileError.message, status: 500 };

  const callerIsStaff = isStaffRole(String(callerProfile?.role || "")) ||
    (callerRoles || []).some((row: any) => isStaffRole(String(row.role)));
  if (!callerIsStaff) return { ok: false, error: "Only staff can manage trial vouchers", status: 403 };

  return { ok: true, userId: callerUser.id };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const body = await req.json();
    const action = String(body.action || "");

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const staffAuth = await authenticateStaff({ req, supabaseUrl, anonKey, adminClient });
    if (!staffAuth.ok) return json({ error: staffAuth.error }, staffAuth.status);

    if (action === "send-payment-link") {
      const stripeMode = await getActiveStripeMode(adminClient);
      const stripeSecretKey = stripeMode.secretKey;

      const connectedAccountId = await getConnectedStripeAccountId(adminClient);
      if (!connectedAccountId) {
        return json({ error: "Connect this club's Stripe account in Settings > Integrations before sending payment links." }, 409);
      }

      const productId = cleanText(body.productId);
      const purchaserName = cleanText(body.purchaserName);
      const purchaserEmail = cleanEmail(body.purchaserEmail);
      const purchaserPhone = cleanText(body.purchaserPhone);
      const recipientName = cleanText(body.recipientName);
      const recipientEmail = cleanEmail(body.recipientEmail);
      const sendToRecipient = Boolean(body.sendToRecipient);
      const recipientDeliveryAt = cleanText(body.recipientDeliveryAt);
      const expiresAt = cleanText(body.expiresAt);
      const notes = cleanText(body.notes);
      const successUrl = safeReturnUrl(body.successUrl, "/gift-vouchers?stripe_voucher=success");
      const cancelUrl = safeReturnUrl(body.cancelUrl, "/gift-vouchers?stripe_voucher=cancelled");

      if (!productId || !purchaserName || !purchaserEmail) {
        return json({ error: "Voucher, purchaser name and purchaser email are required." }, 400);
      }
      if (!isValidEmail(purchaserEmail)) return json({ error: "Enter a valid purchaser email address." }, 400);
      if (sendToRecipient && !recipientEmail) {
        return json({ error: "Recipient email is required when sending direct to recipient." }, 400);
      }
      if (sendToRecipient && recipientEmail && !isValidEmail(recipientEmail)) {
        return json({ error: "Enter a valid recipient email address." }, 400);
      }

      let recipientDeliveryAtIso: string | null = null;
      if (sendToRecipient && recipientDeliveryAt) {
        const deliveryAt = new Date(recipientDeliveryAt);
        if (!Number.isFinite(deliveryAt.getTime())) return json({ error: "Choose a valid recipient send date/time." }, 400);
        if (deliveryAt.getTime() < Date.now()) return json({ error: "Recipient send date/time must be in the future." }, 400);
        recipientDeliveryAtIso = deliveryAt.toISOString();
      }

      let expiresAtIso: string | null = null;
      if (expiresAt) {
        const expiry = new Date(expiresAt);
        if (!Number.isFinite(expiry.getTime())) return json({ error: "Choose a valid expiry date." }, 400);
        expiresAtIso = expiry.toISOString();
      }

      const { data: product, error: productError } = await adminClient
        .from("trial_flight_voucher_products")
        .select("id,name,description,aircraft_mode,aircraft_ids,instructor_ids,duration_minutes,price,stripe_price_id,is_active")
        .eq("id", productId)
        .maybeSingle();

      if (productError) return json({ error: productError.message }, 500);
      if (!product?.is_active) return json({ error: "This voucher product is not active." }, 410);
      if (!product.stripe_price_id) return json({ error: "Create the Stripe checkout price for this voucher product first." }, 409);

      const price = Number(product.price || 0);
      if (!Number.isFinite(price) || price <= 0) return json({ error: "This voucher product needs a valid sale price." }, 409);

      const { data: aircraftRows, error: aircraftError } = await adminClient
        .from("aircraft")
        .select("id,registration,make,model,status,required_endorsement_type,is_archived");
      if (aircraftError) return json({ error: aircraftError.message }, 500);

      const instructorIds = product.instructor_ids || [];
      const { data: endorsementRows, error: endorsementError } = instructorIds.length > 0
        ? await adminClient
          .from("endorsements")
          .select("student_id,type,expiry_date,is_active")
          .in("student_id", instructorIds)
        : { data: [], error: null };

      if (endorsementError) return json({ error: endorsementError.message }, 500);

      const setup = trialVoucherProductBookingSetup(product, aircraftRows || [], endorsementRows || []);
      if (!setup.bookingAvailable) {
        return json({
          error: `This voucher is not bookable yet: ${setup.issue || "configure eligible aircraft and instructors first"}.`,
        }, 409);
      }

      let voucher: any = null;
      let voucherError: any = null;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await adminClient
          .from("trial_flight_vouchers")
          .insert({
            product_id: product.id,
            code: generateVoucherCode(),
            purchaser_name: purchaserName,
            purchaser_email: purchaserEmail,
            purchaser_phone: purchaserPhone || null,
            recipient_name: recipientName || null,
            recipient_email: recipientEmail || null,
            send_to_recipient: sendToRecipient,
            recipient_delivery_at: recipientDeliveryAtIso,
            expires_at: expiresAtIso,
            status: "draft",
            payment_status: "pending",
            payment_source: "stripe",
            payment_amount: price,
            payment_currency: "AUD",
            notes: notes ? `${notes}\nPayment link sent by staff ${staffAuth.userId}.` : `Payment link sent by staff ${staffAuth.userId}.`,
            created_by: staffAuth.userId,
            ...stripeModeColumns(stripeMode.mode),
          })
          .select("id,code")
          .single();

        voucher = result.data;
        voucherError = result.error;
        if (!voucherError || !isUniqueViolation(voucherError)) break;
      }

      if (voucherError || !voucher) {
        return json({ error: voucherError?.message || "Could not create voucher payment link record." }, 500);
      }

      const form = new URLSearchParams();
      form.set("mode", "payment");
      form.set("line_items[0][price]", product.stripe_price_id);
      form.set("line_items[0][quantity]", "1");
      form.set("success_url", `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`);
      form.set("cancel_url", cancelUrl);
      form.set("customer_email", purchaserEmail);
      form.set("client_reference_id", voucher.id);
      addStripeModeMetadata(form, stripeMode.mode);
      form.set("metadata[voucher_id]", voucher.id);
      form.set("metadata[voucher_code]", voucher.code);
      form.set("metadata[product_id]", product.id);
      form.set("metadata[purchaser_email]", purchaserEmail);
      form.set("metadata[created_by_staff]", staffAuth.userId);
      if (recipientEmail) form.set("metadata[recipient_email]", recipientEmail);

      const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": stripeIdempotencyKey("voucher-admin-payment-link", voucher.id, product.id, purchaserEmail),
        }),
        body: form,
      });

      const session = await stripeResponse.json();
      if (!stripeResponse.ok) {
        await adminClient
          .from("trial_flight_vouchers")
          .update({
            payment_status: "failed",
            notes: `${notes ? `${notes}\n` : ""}Stripe payment link failed: ${session?.error?.message || stripeResponse.status}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", voucher.id);
        return json({ error: session?.error?.message || "Stripe checkout could not be created." }, 502);
      }

      const { error: updateError } = await adminClient
        .from("trial_flight_vouchers")
        .update({
          stripe_checkout_session_id: session.id,
          updated_at: new Date().toISOString(),
          ...stripeModeColumns(stripeMode.mode),
        })
        .eq("id", voucher.id);

      if (updateError) return json({ error: updateError.message }, 500);

      const emailHtml = buildPaymentLinkEmail({
        purchaserName,
        product,
        checkoutUrl: session.url,
        amount: price,
      });
      const emailResult = await sendBrevoEmail({
        to: purchaserEmail,
        toName: purchaserName,
        subject: testModeSubject(stripeMode.mode, `Payment link for your ${product.name || "Bendigo Flying Club voucher"}`),
        html: emailHtml,
      });

      if (!emailResult.sent) {
        return json({
          error: emailResult.error || "Payment link was created, but the email could not be sent.",
          checkoutUrl: session.url,
          sessionId: session.id,
          voucherId: voucher.id,
        }, 502);
      }

      return json({
        sent: true,
        checkoutUrl: session.url,
        sessionId: session.id,
        voucherId: voucher.id,
        to: purchaserEmail,
        stripeMode: stripeMode.mode,
        isTestMode: stripeMode.isTestMode,
      });
    }

    if (action === "validate-stripe-price") {
      let stripeSecretKey = "";
      try {
        stripeSecretKey = (await getActiveStripeMode(adminClient)).secretKey;
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "Stripe secret key is not configured in Supabase Edge Function secrets.",
          configured: false,
        }, 503);
      }

      const stripePriceId = cleanText(body.stripePriceId);
      const expectedAmount = Number(body.expectedAmount || 0);
      if (!/^price_[A-Za-z0-9_]+$/.test(stripePriceId)) {
        return json({ error: "Stripe Price ID must start with price_." }, 400);
      }

      const connectedAccountId = await getConnectedStripeAccountId(adminClient);
      if (!connectedAccountId) {
        return json({
          error: "Connect this club's Stripe account in Settings > Integrations before validating voucher prices.",
          configured: true,
          connected: false,
          valid: false,
        }, 409);
      }

      const stripeResponse = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(stripePriceId)}?expand[]=product`, {
        headers: stripeHeaders(stripeSecretKey, connectedAccountId),
      });
      const stripePrice = await stripeResponse.json();

      if (!stripeResponse.ok) {
        return json({
          error: stripePrice?.error?.message || "Stripe price could not be loaded.",
          configured: true,
          valid: false,
        }, 502);
      }

      const currency = String(stripePrice.currency || "").toUpperCase();
      const unitAmount = typeof stripePrice.unit_amount === "number" ? stripePrice.unit_amount / 100 : null;
      const product = typeof stripePrice.product === "object" ? stripePrice.product : null;
      const issues = [
        ...(stripePrice.active ? [] : ["Stripe price is inactive."]),
        ...(product && product.active === false ? ["Stripe product is inactive."] : []),
        ...(currency === "AUD" ? [] : [`Stripe price currency is ${currency || "unknown"}, expected AUD.`]),
        ...(unitAmount === null ? ["Stripe price does not have a fixed unit amount."] : []),
        ...(unitAmount !== null && expectedAmount > 0 && Math.round(unitAmount * 100) !== Math.round(expectedAmount * 100)
          ? [`Stripe amount ${currency} ${unitAmount.toFixed(2)} does not match CRM price AUD ${expectedAmount.toFixed(2)}.`]
          : []),
      ];

      return json({
        configured: true,
        connected: true,
        accountId: connectedAccountId,
        valid: issues.length === 0,
        issues,
        price: {
          id: stripePrice.id,
          active: Boolean(stripePrice.active),
          currency,
          unitAmount,
          type: stripePrice.type,
          billingScheme: stripePrice.billing_scheme,
          productId: product?.id || (typeof stripePrice.product === "string" ? stripePrice.product : null),
          productName: product?.name || null,
          productActive: product?.active ?? null,
          livemode: Boolean(stripePrice.livemode),
        },
      });
    }

    if (action === "create-stripe-price") {
      let stripeSecretKey = "";
      let stripeMode = null as null | Awaited<ReturnType<typeof getActiveStripeMode>>;
      try {
        stripeMode = await getActiveStripeMode(adminClient);
        stripeSecretKey = stripeMode.secretKey;
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "Stripe secret key is not configured in Supabase Edge Function secrets.",
          configured: false,
        }, 503);
      }

      const connectedAccountId = await getConnectedStripeAccountId(adminClient);
      if (!connectedAccountId) {
        return json({
          error: "Connect this club's Stripe account in Settings > Integrations before creating voucher prices.",
          configured: true,
          connected: false,
        }, 409);
      }

      const productId = cleanText(body.productId);
      const replaceExisting = Boolean(body.replaceExisting);
      if (!productId) return json({ error: "productId is required" }, 400);

      const { data: product, error: productError } = await adminClient
        .from("trial_flight_voucher_products")
        .select("id,name,description,aircraft_mode,duration_minutes,price,stripe_price_id,is_active")
        .eq("id", productId)
        .maybeSingle();

      if (productError) return json({ error: productError.message }, 500);
      if (!product) return json({ error: "Voucher product not found" }, 404);
      if (!product.is_active) return json({ error: "Activate the voucher product before creating a Stripe price." }, 409);
      if (product.stripe_price_id && !replaceExisting) {
        return json({
          error: "This voucher already has a Stripe Price ID. Validate it or remove it before creating a replacement.",
          stripePriceId: product.stripe_price_id,
        }, 409);
      }

      const price = Number(product.price || 0);
      if (!Number.isFinite(price) || price <= 0) {
        return json({ error: "Enter a real CRM sale price before creating a Stripe price." }, 400);
      }

      const amountCents = Math.round(price * 100);
      const productForm = new URLSearchParams();
      productForm.set("name", product.name || "Trial instructional flight voucher");
      if (product.description) productForm.set("description", product.description);
      productForm.set("metadata[crm_product_id]", product.id);
      addStripeModeMetadata(productForm, stripeMode.mode);
      productForm.set("metadata[voucher_type]", product.aircraft_mode || "trial_flight");
      productForm.set("metadata[duration_minutes]", String(product.duration_minutes || ""));

      const stripeProductResponse = await fetch("https://api.stripe.com/v1/products", {
        method: "POST",
        headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": stripeIdempotencyKey("voucher-product", product.id, product.name, amountCents),
        }),
        body: productForm,
      });
      const stripeProduct = await stripeProductResponse.json();
      if (!stripeProductResponse.ok) {
        return json({
          error: stripeProduct?.error?.message || "Stripe product could not be created.",
          configured: true,
        }, 502);
      }

      const priceForm = new URLSearchParams();
      priceForm.set("currency", "aud");
      priceForm.set("unit_amount", String(amountCents));
      priceForm.set("product", stripeProduct.id);
      priceForm.set("metadata[crm_product_id]", product.id);
      addStripeModeMetadata(priceForm, stripeMode.mode);
      priceForm.set("metadata[voucher_type]", product.aircraft_mode || "trial_flight");

      const stripePriceResponse = await fetch("https://api.stripe.com/v1/prices", {
        method: "POST",
        headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": stripeIdempotencyKey("voucher-price", product.id, stripeProduct.id, amountCents),
        }),
        body: priceForm,
      });
      const stripePrice = await stripePriceResponse.json();
      if (!stripePriceResponse.ok) {
        return json({
          error: stripePrice?.error?.message || "Stripe price could not be created.",
          configured: true,
          stripeProductId: stripeProduct.id,
        }, 502);
      }

      const { error: updateError } = await adminClient
        .from("trial_flight_voucher_products")
        .update({
          stripe_price_id: stripePrice.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", product.id);

      if (updateError) return json({ error: updateError.message }, 500);

      return json({
        created: true,
        productId: product.id,
        accountId: connectedAccountId,
        stripeProduct: {
          id: stripeProduct.id,
          name: stripeProduct.name,
          active: Boolean(stripeProduct.active),
          livemode: Boolean(stripeProduct.livemode),
        },
        price: {
          id: stripePrice.id,
          active: Boolean(stripePrice.active),
          currency: String(stripePrice.currency || "").toUpperCase(),
          unitAmount: typeof stripePrice.unit_amount === "number" ? stripePrice.unit_amount / 100 : null,
          livemode: Boolean(stripePrice.livemode),
        },
      });
    }

    const voucherId = String(body.voucherId || "").trim();
    if (!voucherId) return json({ error: "voucherId is required" }, 400);

    const { data: voucher, error: voucherError } = await adminClient
      .from("trial_flight_vouchers")
      .select("id,status,payment_status,booked_booking_id,code,delivered_at,redeemed_by_user_id,notes")
      .eq("id", voucherId)
      .maybeSingle();

    if (voucherError) return json({ error: voucherError.message }, 500);
    if (!voucher) return json({ error: "Voucher not found" }, 404);

    if (action === "cancel-voucher") {
      if (voucher.status === "cancelled") {
        return json({ cancelled: true, voucherId: voucher.id, alreadyCancelled: true });
      }
      if (voucher.booked_booking_id) {
        return json({ error: "Release the linked booking before cancelling this voucher." }, 409);
      }
      if (voucher.status === "booked") {
        return json({ error: "Booked vouchers cannot be cancelled until the booking is released." }, 409);
      }

      const now = new Date().toISOString();
      const reason = String(body.reason || "").trim();
      const notes = [
        voucher.notes || "",
        `Cancelled by staff ${staffAuth.userId} at ${now}.`,
        reason ? `Reason: ${reason}` : "",
      ].filter(Boolean).join(" ");

      const { error: cancelError } = await adminClient
        .from("trial_flight_vouchers")
        .update({
          status: "cancelled",
          payment_status: voucher.payment_status === "paid" ? "refunded" : voucher.payment_status,
          notes,
          updated_at: now,
        })
        .eq("id", voucher.id);

      if (cancelError) return json({ error: cancelError.message }, 500);

      return json({
        cancelled: true,
        voucherId: voucher.id,
        cancelledBy: staffAuth.userId,
      });
    }

    if (action !== "release-booking") {
      return json({ error: "Unsupported action" }, 400);
    }

    if (!voucher.booked_booking_id) return json({ error: "This voucher does not have a linked booking" }, 409);

    const { data: booking, error: bookingError } = await adminClient
      .from("bookings")
      .select("id,status,flight_logged,trial_flight_voucher_id")
      .eq("id", voucher.booked_booking_id)
      .maybeSingle();

    if (bookingError) return json({ error: bookingError.message }, 500);
    if (!booking) return json({ error: "Linked booking was not found" }, 404);
    if (booking.flight_logged) {
      return json({
        error: "This voucher booking has a flight log. Delete or correct the flight log before releasing the voucher booking.",
      }, 409);
    }
    if (booking.trial_flight_voucher_id && booking.trial_flight_voucher_id !== voucher.id) {
      return json({ error: "The linked booking belongs to another voucher" }, 409);
    }

    const now = new Date().toISOString();
    const { error: releaseBookingError } = await adminClient
      .from("bookings")
      .update({
        status: "cancelled",
        deleted_at: now,
        updated_at: now,
      })
      .eq("id", booking.id);

    if (releaseBookingError) return json({ error: releaseBookingError.message }, 500);

    const { error: releaseVoucherError } = await adminClient
      .from("trial_flight_vouchers")
      .update({
        status: "redeemed",
        booked_booking_id: null,
        updated_at: now,
      })
      .eq("id", voucher.id);

    if (releaseVoucherError) return json({ error: releaseVoucherError.message }, 500);

    return json({
      released: true,
      voucherId: voucher.id,
      bookingId: booking.id,
      releasedBy: staffAuth.userId,
    });
  } catch (error) {
    console.error("trial-voucher-admin error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
