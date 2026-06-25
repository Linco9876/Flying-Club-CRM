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

const clean = (value: unknown) => String(value || "").trim();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Authentication is required." }, 401);

    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData?.user?.id) return json({ error: "Invalid session." }, 401);

    const { data: roles, error: rolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id)
      .in("role", ["admin", "instructor", "senior_instructor"]);
    if (rolesError) throw rolesError;
    if (!(roles || []).length) return json({ error: "Only staff can prepare the guest account." }, 403);

    const guestEmail = "guest-booking-placeholder@membersflight.local";

    const { data: existingUser, error: existingUserError } = await adminClient
      .from("users")
      .select("id")
      .eq("email", guestEmail)
      .maybeSingle();
    if (existingUserError) throw existingUserError;

    if (existingUser?.id) {
      await adminClient
        .from("users")
        .update({
          name: "Guest / Casual Booking",
          role: "student",
          portal_access_scope: "guest_placeholder",
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingUser.id);

      return json({ userId: existingUser.id });
    }

    const randomPassword = crypto.randomUUID() + "Aa1!";
    const { data: createdAuthUser, error: createAuthError } = await adminClient.auth.admin.createUser({
      email: guestEmail,
      password: randomPassword,
      email_confirm: true,
      user_metadata: {
        name: "Guest / Casual Booking",
        role: "student",
      },
    });
    if (createAuthError) throw createAuthError;

    const userId = clean(createdAuthUser.user?.id);
    if (!userId) throw new Error("Guest booking auth account could not be created.");

    const { error: updateUserError } = await adminClient
      .from("users")
      .update({
        name: "Guest / Casual Booking",
        role: "student",
        portal_access_scope: "guest_placeholder",
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (updateUserError) throw updateUserError;

    return json({ userId });
  } catch (error) {
    console.error("ensure-guest-account error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
