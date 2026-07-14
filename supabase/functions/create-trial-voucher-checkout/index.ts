import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { trialVoucherProductBookingSetup } from "../_shared/trialVoucherReadiness.ts";
import { getConnectedStripeAccountId, stripeHeaders, stripeIdempotencyKey } from "../_shared/stripeConnectAccount.ts";
import { addStripeModeMetadata, getActiveStripeMode, stripeModeColumns, stripePriceIdForMode } from "../_shared/stripeMode.ts";

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

const isUniqueViolation = (error: any) => error?.code === "23505";

const cleanEmail = (value: unknown) => String(value || "").trim().toLowerCase();
const cleanText = (value: unknown) => String(value || "").trim();
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);
const overlaps = (aStart: Date | string, aEnd: Date | string, bStart: Date | string, bEnd: Date | string) =>
  new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);
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
    const connectedAccountId = await getConnectedStripeAccountId(adminClient);
    if (!connectedAccountId) {
      return json({ error: "Online checkout is not connected yet. Please contact Bendigo Flying Club to purchase this voucher." }, 503);
    }

    const body = await req.json();
    const productId = cleanText(body.productId);
    const purchaserName = cleanText(body.purchaserName);
    const purchaserEmail = cleanEmail(body.purchaserEmail);
    const purchaserPhone = cleanText(body.purchaserPhone);
    const recipientName = cleanText(body.recipientName);
    const recipientEmail = cleanEmail(body.recipientEmail);
    const sendToRecipient = Boolean(body.sendToRecipient);
    const recipientDeliveryAt = cleanText(body.recipientDeliveryAt);
    const checkoutIntent = cleanText(body.checkoutIntent) === "book_now" ? "book_now" : "gift_certificate";
    const heldAircraftId = cleanText(body.slot?.aircraftId);
    const heldInstructorId = cleanText(body.slot?.instructorId);
    const heldStartTime = body.slot?.startTime ? new Date(String(body.slot.startTime)) : null;
    const selectedAddonIds = Array.isArray(body.addonIds)
      ? Array.from(new Set(body.addonIds.map((value: unknown) => cleanText(value)).filter(Boolean)))
      : [];
    const successUrl = safeReturnUrl(body.successUrl, "/trial-flight-gift-vouchers?checkout=success");
    const cancelUrl = safeReturnUrl(body.cancelUrl, "/trial-flight-gift-vouchers?checkout=cancelled");

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
    if (checkoutIntent === "book_now" && (
      !heldAircraftId ||
      !heldInstructorId ||
      !heldStartTime ||
      !Number.isFinite(heldStartTime.getTime())
    )) {
      return json({ error: "Choose an available trial flight time before checkout" }, 400);
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
      .select("id,name,description,aircraft_mode,aircraft_ids,instructor_ids,duration_minutes,price,stripe_test_price_id,stripe_live_price_id,is_active")
      .eq("id", productId)
      .maybeSingle();

    if (productError) return json({ error: productError.message }, 500);
    if (!product?.is_active) return json({ error: "This voucher product is not currently available" }, 410);
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
        error: `Online checkout is temporarily unavailable: ${setup.issue || "this voucher does not currently have both a serviceable eligible aircraft and a qualified eligible instructor configured"}.`,
      }, 409);
    }
    const stripePriceId = stripePriceIdForMode(product, stripeMode.mode);
    if (!stripePriceId) {
      return json({ error: `Online checkout is not configured for Stripe ${stripeMode.mode} mode yet. Please contact Bendigo Flying Club.` }, 409);
    }
    if (Number(product.price || 0) <= 0) {
      return json({ error: "Online checkout is not enabled until this voucher has a valid price." }, 409);
    }

    let holdFields: Record<string, unknown> = {};
    if (checkoutIntent === "book_now") {
      const heldEndTime = addMinutes(heldStartTime!, Number(product.duration_minutes || 0) + 30);
      const holdExpiresAt = addMinutes(new Date(), 10);
      const productAircraftIds = new Set<string>(product.aircraft_ids || []);
      const productInstructorIds = new Set<string>(product.instructor_ids || []);
      const aircraft = (aircraftRows || []).find((row: any) => row.id === heldAircraftId);

      if (!aircraft || aircraft.status !== "serviceable" || aircraft.is_archived === true) {
        return json({ error: "Selected aircraft is not available for this voucher" }, 409);
      }
      if (!productAircraftIds.has(heldAircraftId)) {
        return json({ error: "Selected aircraft is not eligible for this voucher" }, 409);
      }
      if (!productInstructorIds.has(heldInstructorId)) {
        return json({ error: "Selected instructor is not eligible for this voucher" }, 409);
      }

      const { data: instructorAvailable, error: instructorAvailabilityError } = await adminClient.rpc("trial_voucher_instructor_available_for_slot", {
        p_instructor_id: heldInstructorId,
        p_start_time: heldStartTime!.toISOString(),
        p_end_time: heldEndTime.toISOString(),
      });
      if (instructorAvailabilityError) return json({ error: instructorAvailabilityError.message }, 500);
      if (!instructorAvailable) {
        return json({ error: "Selected instructor is no longer available for that time" }, 409);
      }

      const { data: conflictingBookings, error: bookingConflictError } = await adminClient
        .from("bookings")
        .select("id,start_time,end_time,aircraft_id,instructor_id")
        .is("deleted_at", null)
        .in("status", ["confirmed", "pending_approval"])
        .or(`aircraft_id.eq.${heldAircraftId},instructor_id.eq.${heldInstructorId}`);
      if (bookingConflictError) return json({ error: bookingConflictError.message }, 500);
      if ((conflictingBookings || []).some((booking: any) =>
        overlaps(heldStartTime!, heldEndTime, booking.start_time, booking.end_time)
      )) {
        return json({ error: "That time is no longer available. Please choose another time." }, 409);
      }

      const { data: activeHolds, error: holdsError } = await adminClient
        .from("trial_flight_vouchers")
        .select("id,held_start_time,held_end_time,held_aircraft_id,held_instructor_id")
        .eq("checkout_intent", "book_now")
        .eq("payment_status", "pending")
        .gt("hold_expires_at", new Date().toISOString())
        .or(`held_aircraft_id.eq.${heldAircraftId},held_instructor_id.eq.${heldInstructorId}`);
      if (holdsError) return json({ error: holdsError.message }, 500);
      if ((activeHolds || []).some((hold: any) =>
        overlaps(heldStartTime!, heldEndTime, hold.held_start_time, hold.held_end_time)
      )) {
        return json({ error: "That time is being held for another checkout. Please choose another time." }, 409);
      }

      holdFields = {
        checkout_intent: "book_now",
        held_aircraft_id: heldAircraftId,
        held_instructor_id: heldInstructorId,
        held_start_time: heldStartTime!.toISOString(),
        held_end_time: heldEndTime.toISOString(),
        hold_expires_at: holdExpiresAt.toISOString(),
      };
    }

    let selectedAddons: any[] = [];
    if (selectedAddonIds.length > 0) {
      const { data: addonRows, error: addonError } = await adminClient
        .from("trial_flight_voucher_product_addons")
        .select("addon:trial_flight_voucher_addons(id,name,description,price,is_active)")
        .eq("product_id", product.id)
        .in("addon_id", selectedAddonIds);
      if (addonError) return json({ error: addonError.message }, 500);
      selectedAddons = (addonRows || [])
        .map((row: any) => Array.isArray(row.addon) ? row.addon[0] : row.addon)
        .filter((addon: any) => addon?.is_active !== false && selectedAddonIds.includes(addon.id))
        .map((addon: any) => ({
          id: addon.id,
          name: addon.name,
          description: addon.description || "",
          price: Number(addon.price || 0),
        }));

      if (selectedAddons.length !== selectedAddonIds.length) {
        return json({ error: "One or more selected add-ons are no longer available for this voucher." }, 409);
      }
    }

    const totalAmount = Number(product.price || 0) + selectedAddons.reduce((total, addon) => total + Number(addon.price || 0), 0);

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
          status: "draft",
          payment_status: "pending",
          payment_source: "stripe",
          payment_amount: totalAmount,
          payment_currency: "AUD",
          selected_addons: selectedAddons,
          notes: checkoutIntent === "book_now"
            ? "Created from public Stripe checkout with a held booking time"
            : "Created from public Stripe checkout",
          checkout_intent: checkoutIntent,
          ...stripeModeColumns(stripeMode.mode),
          ...holdFields,
        })
        .select("id,code")
        .single();

      voucher = result.data;
      voucherError = result.error;
      if (!voucherError || !isUniqueViolation(voucherError)) break;
    }

    if (voucherError || !voucher) {
      return json({ error: voucherError?.message || "Could not create voucher checkout record" }, 500);
    }

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("line_items[0][price]", stripePriceId);
    form.set("line_items[0][quantity]", "1");
    selectedAddons.forEach((addon, index) => {
      const lineIndex = index + 1;
      form.set(`line_items[${lineIndex}][price_data][currency]`, "aud");
      form.set(`line_items[${lineIndex}][price_data][product_data][name]`, addon.name);
      if (addon.description) form.set(`line_items[${lineIndex}][price_data][product_data][description]`, addon.description);
      form.set(`line_items[${lineIndex}][price_data][unit_amount]`, String(Math.round(Number(addon.price || 0) * 100)));
      form.set(`line_items[${lineIndex}][quantity]`, "1");
    });
    form.set("success_url", `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", cancelUrl);
    form.set("customer_email", purchaserEmail);
    form.set("client_reference_id", voucher.id);
    addStripeModeMetadata(form, stripeMode.mode);
    form.set("metadata[voucher_id]", voucher.id);
    form.set("metadata[voucher_code]", voucher.code);
    form.set("metadata[product_id]", product.id);
    form.set("metadata[purchaser_email]", purchaserEmail);
    form.set("metadata[checkout_intent]", checkoutIntent);
    if (selectedAddons.length > 0) form.set("metadata[addon_ids]", selectedAddons.map(addon => addon.id).join(","));
    if (recipientEmail) form.set("metadata[recipient_email]", recipientEmail);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": stripeIdempotencyKey("voucher-public-checkout", voucher.id, product.id, totalAmount),
      }),
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
        stripe_checkout_url: session.url || null,
        updated_at: new Date().toISOString(),
        ...stripeModeColumns(stripeMode.mode),
      })
      .eq("id", voucher.id);

    return json({
      checkoutUrl: session.url,
      sessionId: session.id,
      voucherId: voucher.id,
      stripeMode: stripeMode.mode,
      isTestMode: stripeMode.isTestMode,
    });
  } catch (error) {
    console.error("create-trial-voucher-checkout error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
