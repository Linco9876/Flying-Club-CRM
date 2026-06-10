import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const normaliseCode = (value: unknown) =>
  String(value || "").trim().toUpperCase().replace(/\s+/g, "-");

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const action = String(body.action || "verify");
    const code = normaliseCode(body.code);

    if (!code) return json({ error: "Voucher code is required" }, 400);

    const { data: voucher, error: voucherError } = await adminClient
      .from("trial_flight_vouchers")
      .select(`
        *,
        trial_flight_voucher_products(
          id,
          name,
          description,
          aircraft_mode,
          aircraft_ids,
          instructor_ids,
          duration_minutes,
          booking_instructions,
          is_active
        )
      `)
      .eq("code", code)
      .maybeSingle();

    if (voucherError) return json({ error: voucherError.message }, 500);
    if (!voucher) return json({ error: "Voucher code was not found" }, 404);
    if (voucher.status === "cancelled" || voucher.status === "expired") {
      return json({ error: "This voucher is no longer valid" }, 410);
    }
    if (voucher.expires_at && new Date(voucher.expires_at).getTime() < Date.now()) {
      await adminClient.from("trial_flight_vouchers").update({ status: "expired" }).eq("id", voucher.id);
      return json({ error: "This voucher has expired" }, 410);
    }

    const product = voucher.trial_flight_voucher_products;
    if (!product?.is_active) return json({ error: "This voucher product is not currently available" }, 410);

    const publicVoucher = {
      code: voucher.code,
      status: voucher.status,
      recipientName: voucher.recipient_name,
      product: {
        name: product.name,
        description: product.description,
        aircraftMode: product.aircraft_mode,
        durationMinutes: product.duration_minutes,
        bookingBlockMinutes: Number(product.duration_minutes || 0) + 30,
        bookingInstructions: product.booking_instructions,
      },
    };

    if (action === "verify") {
      return json({ voucher: publicVoucher });
    }

    if (action !== "redeem") return json({ error: "Unsupported action" }, 400);

    if (voucher.status === "booked") return json({ error: "This voucher has already been booked" }, 409);

    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();

    if (!fullName || !email || !phone) {
      return json({ error: "Full name, email and phone are required" }, 400);
    }

    const { data: existingProfile } = await adminClient
      .from("users")
      .select("id,email")
      .eq("email", email)
      .maybeSingle();

    let userId = existingProfile?.id;

    if (!userId) {
      const tempPassword = crypto.randomUUID() + "A1!";
      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { name: fullName, phone },
      });

      if (authError || !authData.user) {
        return json({ error: authError?.message || "Failed to create voucher account" }, 500);
      }

      userId = authData.user.id;

      const { error: userError } = await adminClient.from("users").upsert({
        id: userId,
        email,
        name: fullName,
        phone,
        role: "student",
        portal_access_scope: "trial_voucher",
      });

      if (userError) return json({ error: userError.message }, 500);

      await adminClient.from("user_roles").upsert({ user_id: userId, role: "student" }, { onConflict: "user_id,role" });
      await adminClient.from("students").upsert({ id: userId, prepaid_balance: 0 }, { onConflict: "id" });
    }

    const { error: redeemError } = await adminClient
      .from("trial_flight_vouchers")
      .update({
        status: voucher.status === "issued" ? "redeemed" : voucher.status,
        redeemed_at: voucher.redeemed_at || new Date().toISOString(),
        redeemed_by_user_id: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", voucher.id);

    if (redeemError) return json({ error: redeemError.message }, 500);

    const redirectTo = String(body.redirectTo || "").trim() || undefined;
    const { data: linkData } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });

    return json({
      voucher: publicVoucher,
      userId,
      setupLink: linkData?.properties?.action_link || null,
      message: "Voucher verified. Account created and voucher linked.",
    });
  } catch (error) {
    console.error("trial-voucher-public error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
