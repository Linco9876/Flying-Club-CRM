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

const isStaffRole = (role: string) => ["admin", "senior_instructor", "instructor"].includes(role);

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
  adminClient: ReturnType<typeof createClient>;
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
    (callerRoles || []).some((row) => isStaffRole(String(row.role)));
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
