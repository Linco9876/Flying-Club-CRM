import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

    if (action === "validate-stripe-price") {
      const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeSecretKey) {
        return json({
          error: "Stripe secret key is not configured in Supabase Edge Function secrets.",
          configured: false,
        }, 503);
      }

      const stripePriceId = cleanText(body.stripePriceId);
      const expectedAmount = Number(body.expectedAmount || 0);
      if (!/^price_[A-Za-z0-9_]+$/.test(stripePriceId)) {
        return json({ error: "Stripe Price ID must start with price_." }, 400);
      }

      const stripeResponse = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(stripePriceId)}?expand[]=product`, {
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
        },
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
