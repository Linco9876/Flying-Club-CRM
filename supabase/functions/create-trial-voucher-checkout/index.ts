import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

const generateVoucherCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomPart = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `BFC-${randomPart()}-${randomPart()}-${randomPart()}`;
};

const cleanEmail = (value: unknown) => String(value || "").trim().toLowerCase();
const cleanText = (value: unknown) => String(value || "").trim();
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return json({ error: "Online checkout is not configured yet. Please contact Bendigo Flying Club to purchase this voucher." }, 503);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const productId = cleanText(body.productId);
    const purchaserName = cleanText(body.purchaserName);
    const purchaserEmail = cleanEmail(body.purchaserEmail);
    const purchaserPhone = cleanText(body.purchaserPhone);
    const recipientName = cleanText(body.recipientName);
    const recipientEmail = cleanEmail(body.recipientEmail);
    const sendToRecipient = Boolean(body.sendToRecipient);
    const recipientDeliveryAt = cleanText(body.recipientDeliveryAt);
    const successUrl = cleanText(body.successUrl);
    const cancelUrl = cleanText(body.cancelUrl);

    if (!productId || !purchaserName || !purchaserEmail || !successUrl || !cancelUrl) {
      return json({ error: "Voucher, purchaser name, purchaser email, success URL and cancel URL are required" }, 400);
    }
    if (!isValidEmail(purchaserEmail)) {
      return json({ error: "Enter a valid purchaser email address" }, 400);
    }
    if (sendToRecipient && !recipientEmail) {
      return json({ error: "Recipient email is required when sending direct to the recipient" }, 400);
    }
    if (sendToRecipient && recipientEmail && !isValidEmail(recipientEmail)) {
      return json({ error: "Enter a valid recipient email address" }, 400);
    }
    let recipientDeliveryAtIso: string | null = null;
    if (sendToRecipient && recipientDeliveryAt) {
      const deliveryAt = new Date(recipientDeliveryAt);
      if (!Number.isFinite(deliveryAt.getTime())) {
        return json({ error: "Choose a valid recipient send date/time" }, 400);
      }
      if (deliveryAt.getTime() < Date.now()) {
        return json({ error: "Recipient send date/time must be in the future" }, 400);
      }
      recipientDeliveryAtIso = deliveryAt.toISOString();
    }

    const { data: product, error: productError } = await adminClient
      .from("trial_flight_voucher_products")
      .select("id,name,description,price,stripe_price_id,is_active")
      .eq("id", productId)
      .maybeSingle();

    if (productError) return json({ error: productError.message }, 500);
    if (!product?.is_active) return json({ error: "This voucher product is not currently available" }, 410);
    if (!product.stripe_price_id) {
      return json({ error: "Online checkout is not enabled for this voucher yet. Please contact Bendigo Flying Club to purchase it." }, 409);
    }

    const { data: voucher, error: voucherError } = await adminClient
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
        status: "draft",
        payment_status: "pending",
        payment_amount: Number(product.price || 0),
        payment_currency: "AUD",
        notes: "Created from public Stripe checkout",
      })
      .select("id,code")
      .single();

    if (voucherError || !voucher) {
      return json({ error: voucherError?.message || "Could not create voucher checkout record" }, 500);
    }

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("line_items[0][price]", product.stripe_price_id);
    form.set("line_items[0][quantity]", "1");
    form.set("success_url", `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", cancelUrl);
    form.set("customer_email", purchaserEmail);
    form.set("client_reference_id", voucher.id);
    form.set("metadata[voucher_id]", voucher.id);
    form.set("metadata[voucher_code]", voucher.code);
    form.set("metadata[product_id]", product.id);
    form.set("metadata[purchaser_email]", purchaserEmail);
    if (recipientEmail) form.set("metadata[recipient_email]", recipientEmail);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });

    const session = await stripeResponse.json();
    if (!stripeResponse.ok) {
      await adminClient
        .from("trial_flight_vouchers")
        .update({ payment_status: "failed", notes: `Stripe checkout failed: ${session?.error?.message || stripeResponse.status}` })
        .eq("id", voucher.id);
      return json({ error: session?.error?.message || "Stripe checkout could not be created" }, 502);
    }

    await adminClient
      .from("trial_flight_vouchers")
      .update({
        stripe_checkout_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", voucher.id);

    return json({
      checkoutUrl: session.url,
      sessionId: session.id,
      voucherId: voucher.id,
    });
  } catch (error) {
    console.error("create-trial-voucher-checkout error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
