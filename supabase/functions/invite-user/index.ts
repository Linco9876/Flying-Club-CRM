import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const validRoles = new Set(["admin", "senior_instructor", "instructor", "pilot", "student"]);
const defaultPortalOrigin = "https://portal.bendigoflyingclub.com.au";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normaliseEmail = (value: unknown) => String(value || "").trim().toLowerCase();

const getPrimaryRole = (roles: string[]) =>
  roles.includes("admin") ? "admin"
    : roles.includes("senior_instructor") ? "senior_instructor"
    : roles.includes("instructor") ? "instructor"
    : roles.includes("pilot") ? "pilot"
    : "student";

const getLegacyUsersRole = (primaryRole: string) =>
  primaryRole === "senior_instructor" ? "instructor"
    : primaryRole === "pilot" ? "student"
    : primaryRole;

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const resolveRedirectTo = (value: unknown) => {
  const fallback = `${Deno.env.get("PORTAL_ORIGIN") || defaultPortalOrigin}/reset-password`;
  if (typeof value !== "string" || !value.trim()) return fallback;

  try {
    const url = new URL(value.trim());
    const isSecure = url.protocol === "https:";
    const isLocalDevelopment =
      url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (!isSecure && !isLocalDevelopment) return fallback;
    url.pathname = "/reset-password";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return fallback;
  }
};

const buildScannerSafeLink = (actionLink: string, redirectTo: string) => {
  const portalUrl = new URL(redirectTo);
  portalUrl.pathname = "/accept-invitation";
  portalUrl.search = "";
  portalUrl.hash = `setup=${encodeURIComponent(actionLink)}`;
  return portalUrl.toString();
};

const sendSetupEmail = async ({
  email,
  name,
  setupLink,
}: {
  email: string;
  name: string;
  setupLink: string;
}) => {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) return { sent: false, error: "Email delivery is not configured" };

  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@bendigoflyingclub.com.au";
  const senderName = Deno.env.get("BREVO_SENDER_NAME") || "Bendigo Flying Club";
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(setupLink);

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email, name }],
      subject: "Set up your Bendigo Flying Club portal account",
      htmlContent: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 30px rgba(15,23,42,.10);">
          <tr>
            <td style="padding:34px;background:linear-gradient(135deg,#1d4ed8,#4338ca);color:#ffffff;">
              <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#dbeafe;">Bendigo Flying Club</div>
              <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">Your portal invitation</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:34px;">
              <p style="margin:0 0 16px;font-size:17px;line-height:1.6;">Hello ${safeName},</p>
              <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#475569;">
                You have been invited to the Bendigo Flying Club portal. Use it to manage bookings, flying records, club documents and your account information.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-radius:10px;background:#1d4ed8;">
                    <a href="${safeLink}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;">Set up my portal account</a>
                  </td>
                </tr>
              </table>
              <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#64748b;">
                The next page will ask you to confirm before the one-time setup link is used. If you did not expect this invitation, you can ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { sent: false, error: body || `Email delivery failed with ${response.status}` };
  }

  return { sent: true, error: null };
};

const findAuthUserByEmail = async (adminClient: SupabaseClient, email: string) => {
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const match = data.users.find((candidate) => normaliseEmail(candidate.email) === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }

  throw new Error("Unable to safely search all authentication users");
};

const generateAuthAction = async ({
  adminClient,
  email,
  name,
  phone,
  redirectTo,
  existingAuthUser,
}: {
  adminClient: SupabaseClient;
  email: string;
  name: string;
  phone?: string | null;
  redirectTo: string;
  existingAuthUser: User | null;
}) => {
  const { data, error } = existingAuthUser
    ? await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    })
    : await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        redirectTo,
        data: {
          name,
          phone: phone || null,
        },
      },
    });

  return {
    actionLink: data?.properties?.action_link || null,
    user: data?.user || existingAuthUser,
    error,
  };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerUser) return jsonResponse({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    if (body.action === "accept_current") {
      const acceptedAt = new Date().toISOString();
      const { error } = await adminClient
        .from("invitations")
        .update({ status: "accepted", accepted_at: acceptedAt })
        .eq("user_id", callerUser.id)
        .eq("status", "pending");
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ accepted: true, acceptedAt });
    }

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUser.id);
    if (callerRolesError) return jsonResponse({ error: callerRolesError.message }, 500);
    if (!(callerRoles || []).some((row) => row.role === "admin")) {
      return jsonResponse({ error: "Only admins can invite users" }, 403);
    }

    const email = normaliseEmail(body.email);
    const name = String(body.name || "").trim();
    const phone = body.phone ? String(body.phone).trim() : null;
    const resend = Boolean(body.resend);
    const requestedRoles = Array.isArray(body.roles) && body.roles.length > 0 ? body.roles : ["student"];
    const userRoles = Array.from(new Set(requestedRoles))
      .map((role) => String(role).trim())
      .filter((role) => validRoles.has(role));

    if (!email || !name) return jsonResponse({ error: "email and name are required" }, 400);
    if (userRoles.length === 0) return jsonResponse({ error: "At least one valid role is required" }, 400);
    if (userRoles.includes("student") && userRoles.length > 1) {
      return jsonResponse({ error: "Student cannot be combined with any other role" }, 400);
    }

    const { data: existingProfile, error: profileLookupError } = await adminClient
      .from("users")
      .select("id,email")
      .ilike("email", email)
      .maybeSingle();
    if (profileLookupError) return jsonResponse({ error: profileLookupError.message }, 500);

    const { data: pendingInvitations, error: invitationLookupError } = await adminClient
      .from("invitations")
      .select("id,status,user_id")
      .ilike("email", email)
      .eq("status", "pending")
      .order("invited_at", { ascending: false })
      .limit(1);
    if (invitationLookupError) return jsonResponse({ error: invitationLookupError.message }, 500);
    const pendingInvitation = pendingInvitations?.[0] || null;

    if (existingProfile && !resend) {
      return jsonResponse({
        error: pendingInvitation
          ? "A pending invite already exists for this email. Use resend to send a fresh setup email."
          : "A user with this email already exists",
      }, 409);
    }
    if (existingProfile && resend && !pendingInvitation) {
      return jsonResponse({ error: "This user has already completed their invitation" }, 409);
    }

    const existingAuthUser = await findAuthUserByEmail(adminClient, email);
    if (existingProfile && !existingAuthUser) {
      return jsonResponse({
        error: "The CRM profile exists but its login is missing. Contact support before resending.",
      }, 409);
    }

    const redirectTo = resolveRedirectTo(body.redirectTo);
    const { actionLink, user: actionUser, error: actionError } = await generateAuthAction({
      adminClient,
      email,
      name,
      phone,
      redirectTo,
      existingAuthUser,
    });

    if (actionError || !actionLink || !actionUser) {
      return jsonResponse({ error: actionError?.message || "Failed to generate a fresh setup link" }, 500);
    }

    const userId = existingProfile?.id || actionUser.id;

    if (existingProfile && existingAuthUser && existingAuthUser.id !== existingProfile.id) {
      return jsonResponse({
        error: "The CRM profile and login refer to different accounts. Contact support before resending.",
      }, 409);
    }

    const primaryRole = getPrimaryRole(userRoles);
    const { error: profileWriteError } = await adminClient.from("users").upsert({
      id: userId,
      email,
      name,
      phone,
      role: getLegacyUsersRole(primaryRole),
      is_active: true,
    });
    if (profileWriteError) throw profileWriteError;

    const { error: roleDeleteError } = await adminClient.from("user_roles").delete().eq("user_id", userId);
    if (roleDeleteError) throw roleDeleteError;
    const { error: roleInsertError } = await adminClient
      .from("user_roles")
      .insert(userRoles.map((role) => ({ user_id: userId, role })));
    if (roleInsertError) throw roleInsertError;

    const invitationValues = {
      email,
      name,
      phone,
      role: primaryRole,
      invited_by: callerUser.id,
      invited_at: new Date().toISOString(),
      status: "pending",
      accepted_at: null,
      user_id: userId,
    };
    if (pendingInvitation) {
      const { error } = await adminClient
        .from("invitations")
        .update(invitationValues)
        .eq("id", pendingInvitation.id);
      if (error) throw error;
    } else {
      const { error } = await adminClient.from("invitations").insert(invitationValues);
      if (error) throw error;
    }

    const scannerSafeLink = buildScannerSafeLink(actionLink, redirectTo);
    const delivery = await sendSetupEmail({ email, name, setupLink: scannerSafeLink });

    return jsonResponse({
      emailSent: delivery.sent,
      manualLink: delivery.sent ? undefined : scannerSafeLink,
      message: delivery.sent
        ? existingAuthUser && !existingProfile
          ? "The existing login was recovered, the CRM profile was restored, and a fresh setup email was sent."
          : "A fresh scanner-safe setup email was sent."
        : `The account is ready, but email delivery failed: ${delivery.error}. Copy the setup link and send it securely.`,
      recoveredExistingAuth: Boolean(existingAuthUser && !existingProfile),
      userId,
    });
  } catch (error) {
    console.error("invite-user failed", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "The invitation could not be completed",
    }, 500);
  }
});
