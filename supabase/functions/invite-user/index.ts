import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const validRoles = new Set(["admin", "senior_instructor", "instructor", "pilot", "student"]);

const getPrimaryRole = (roles: string[]) =>
  roles.includes("admin") ? "admin"
    : roles.includes("senior_instructor") ? "senior_instructor"
    : roles.includes("instructor") ? "instructor"
    : roles.includes("pilot") ? "pilot"
    : "student";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { email, name, phone, roles, redirectTo } = await req.json();
    const requestedRoles = Array.isArray(roles) && roles.length > 0 ? roles : ["student"];
    const userRoles = Array.from(new Set(requestedRoles))
      .map((role) => String(role).trim())
      .filter((role) => validRoles.has(role));

    if (!email || !name) {
      return new Response(JSON.stringify({ error: "email and name are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (userRoles.length === 0) {
      return new Response(JSON.stringify({ error: "At least one valid role is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (userRoles.includes("student") && userRoles.length > 1) {
      return new Response(JSON.stringify({ error: "Student cannot be combined with any other role" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingUser } = await adminClient
      .from("users")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (existingUser) {
      return new Response(JSON.stringify({ error: "A user with this email already exists" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const primaryRole = getPrimaryRole(userRoles);
    const inviteOptions: {
      data: Record<string, unknown>;
      redirectTo?: string;
    } = {
      data: {
        name,
        phone: phone || null,
      },
    };

    if (typeof redirectTo === "string" && redirectTo.trim()) {
      inviteOptions.redirectTo = redirectTo.trim();
    }

    const { data: authData, error: authError } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      inviteOptions,
    );

    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: authError?.message || "Failed to send invitation email" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newUserId = authData.user.id;

    const { error: userUpsertError } = await adminClient.from("users").upsert({
      id: newUserId,
      email,
      name,
      phone: phone || null,
      role: primaryRole,
    });

    if (userUpsertError) {
      await adminClient.auth.admin.deleteUser(newUserId);
      return new Response(JSON.stringify({ error: userUpsertError.message || "Failed to create user profile" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await adminClient.from("user_roles").delete().eq("user_id", newUserId);

    const { error: roleInsertError } = await adminClient
      .from("user_roles")
      .insert(userRoles.map((role) => ({ user_id: newUserId, role })));

    if (roleInsertError) {
      await adminClient.auth.admin.deleteUser(newUserId);
      await adminClient.from("users").delete().eq("id", newUserId);
      return new Response(JSON.stringify({ error: roleInsertError.message || "Failed to assign user roles" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: invitationInsertError } = await adminClient.from("invitations").insert({
      email,
      name,
      phone: phone || null,
      role: primaryRole,
      invited_by: callerUser.id,
      status: "pending",
      accepted_at: null,
      user_id: newUserId,
    });

    if (invitationInsertError) {
      await adminClient.auth.admin.deleteUser(newUserId);
      await adminClient.from("user_roles").delete().eq("user_id", newUserId);
      await adminClient.from("users").delete().eq("id", newUserId);
      return new Response(JSON.stringify({ error: invitationInsertError.message || "Failed to record invitation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ emailSent: true, userId: newUserId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
