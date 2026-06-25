import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isValidEmail = (email: string) => /\S+@\S+\.\S+/.test(email);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerUser) return jsonResponse({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const requestBody = await req.json().catch(() => ({}));
    const action = typeof requestBody?.action === "string" ? requestBody.action.trim() : "";

    if (action === "sync_verified_email") {
      const confirmedEmail = String(callerUser.email || "").trim().toLowerCase();
      if (!confirmedEmail || !isValidEmail(confirmedEmail)) {
        return jsonResponse({ error: "Authenticated user does not have a valid email" }, 400);
      }

      const { data: existingProfile, error: existingProfileError } = await adminClient
        .from("users")
        .select("id,email")
        .eq("id", callerUser.id)
        .maybeSingle();

      if (existingProfileError) return jsonResponse({ error: existingProfileError.message }, 500);
      if (!existingProfile) return jsonResponse({ error: "User profile not found" }, 404);

      const { data: emailOwner, error: emailOwnerError } = await adminClient
        .from("users")
        .select("id")
        .eq("email", confirmedEmail)
        .neq("id", callerUser.id)
        .maybeSingle();

      if (emailOwnerError) return jsonResponse({ error: emailOwnerError.message }, 500);
      if (emailOwner) return jsonResponse({ error: "Another CRM member already uses this email" }, 409);

      const { error: profileUpdateError } = await adminClient
        .from("users")
        .update({
          email: confirmedEmail,
          updated_at: new Date().toISOString(),
        })
        .eq("id", callerUser.id);

      if (profileUpdateError) return jsonResponse({ error: profileUpdateError.message }, 500);

      return jsonResponse({
        synced: true,
        userId: callerUser.id,
        email: confirmedEmail,
      });
    }

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUser.id);

    if (callerRolesError) return jsonResponse({ error: callerRolesError.message }, 500);
    const isAdmin = (callerRoles || []).some((roleRow) => roleRow.role === "admin");
    if (!isAdmin) return jsonResponse({ error: "Only admins can change another user's login email" }, 403);

    const { userId, newEmail, redirectTo } = requestBody;
    const cleanUserId = typeof userId === "string" ? userId.trim() : "";
    const cleanEmail = typeof newEmail === "string" ? newEmail.trim().toLowerCase() : "";
    const cleanRedirectTo = typeof redirectTo === "string" && redirectTo.trim()
      ? redirectTo.trim()
      : undefined;

    if (!cleanUserId) return jsonResponse({ error: "userId is required" }, 400);
    if (!cleanEmail || !isValidEmail(cleanEmail)) return jsonResponse({ error: "A valid new email is required" }, 400);

    const { data: currentUser, error: currentUserError } = await adminClient
      .from("users")
      .select("id,email")
      .eq("id", cleanUserId)
      .maybeSingle();

    if (currentUserError) return jsonResponse({ error: currentUserError.message }, 500);
    if (!currentUser) return jsonResponse({ error: "User not found" }, 404);

    const currentEmail = String(currentUser.email || "").trim().toLowerCase();
    if (currentEmail === cleanEmail) {
      return jsonResponse({ changed: false, message: "Email is unchanged" });
    }

    const { data: existingProfile, error: existingProfileError } = await adminClient
      .from("users")
      .select("id")
      .eq("email", cleanEmail)
      .neq("id", cleanUserId)
      .maybeSingle();

    if (existingProfileError) return jsonResponse({ error: existingProfileError.message }, 500);
    if (existingProfile) return jsonResponse({ error: "Another member already uses that email" }, 409);

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "email_change_new",
      email: currentEmail,
      newEmail: cleanEmail,
      options: cleanRedirectTo ? { redirectTo: cleanRedirectTo } : undefined,
    });

    if (linkError) return jsonResponse({ error: linkError.message || "Failed to create email verification link" }, 500);

    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) return jsonResponse({ error: "Supabase did not return an email verification link" }, 500);

    return jsonResponse({
      changed: true,
      oldEmail: currentEmail,
      newEmail: cleanEmail,
      manualLink: actionLink,
      message: "Email change verification link generated. The CRM email will update after the new email is verified.",
    });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
