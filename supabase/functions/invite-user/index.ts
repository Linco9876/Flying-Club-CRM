import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "npm:@supabase/supabase-js@2";
import {
  createPendingAccountPassword,
  isValidPendingAccountEmail,
  nextPendingAccountClaimWindow,
  normalisePendingAccountEmail,
  pendingAccountClaimIsAvailable,
  pendingAccountClaimIsWithinWindowLimit,
  pendingAccountClaimResponse,
  resolvePendingAccountRedirect,
} from "../_shared/pendingPortalAccount.ts";
import { brandPortalEmailHtml } from "../_shared/emailBranding.ts";
import { buildPasswordResetEmail } from "../_shared/passwordResetEmail.ts";
import {
  nextPasswordResetRequestWindow,
  passwordResetRequestIsAvailable,
  passwordResetRequestIsWithinWindowLimit,
  publicPasswordResetResponse,
} from "../_shared/passwordResetRequest.ts";
import {
  provisioningAccessFor,
  validProvisionedUserRoles,
} from "../_shared/userProvisioningRules.ts";
import { authenticateAal2AdminOrWorker } from "../_shared/edgeSecurity.ts";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const defaultPortalOrigin = "https://portal.bendigoflyingclub.com.au";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normaliseEmail = normalisePendingAccountEmail;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normaliseFactor = (factor: Record<string, unknown>) => ({
  id: String(factor.id || ""),
  type: String(factor.factor_type || factor.type || "unknown"),
  status: String(factor.status || "unknown"),
  friendlyName: typeof factor.friendly_name === "string"
    ? factor.friendly_name
    : null,
});

const getPrimaryRole = (roles: string[]) =>
  roles.includes("admin")
    ? "admin"
    : roles.includes("senior_instructor")
    ? "senior_instructor"
    : roles.includes("instructor")
    ? "instructor"
    : roles.includes("pilot")
    ? "pilot"
    : "student";

const getLegacyUsersRole = (primaryRole: string) =>
  primaryRole === "senior_instructor"
    ? "instructor"
    : primaryRole === "pilot"
    ? "student"
    : primaryRole;

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const resolveRedirectTo = (value: unknown) => {
  const fallback = `${
    Deno.env.get("PORTAL_ORIGIN") || defaultPortalOrigin
  }/reset-password`;
  if (typeof value !== "string" || !value.trim()) return fallback;

  try {
    const url = new URL(value.trim());
    const isSecure = url.protocol === "https:";
    const isLocalDevelopment = url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (!isSecure && !isLocalDevelopment) return fallback;
    url.pathname = "/reset-password";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return fallback;
  }
};

type SetupEmailPurpose = "invite" | "password_reset" | "account_claim";

const buildScannerSafeLink = (
  actionLink: string,
  redirectTo: string,
  purpose: SetupEmailPurpose = "invite",
) => {
  const portalUrl = new URL(redirectTo);
  portalUrl.pathname = "/accept-invitation";
  portalUrl.search = "";
  portalUrl.hash = new URLSearchParams({
    mode: purpose === "password_reset"
      ? "password-reset"
      : purpose === "account_claim"
      ? "account-claim"
      : "invitation",
    setup: actionLink,
  }).toString();
  return portalUrl.toString();
};

const sendSetupEmail = async ({
  email,
  name,
  setupLink,
  purpose = "invite",
}: {
  email: string;
  name: string;
  setupLink: string;
  purpose?: SetupEmailPurpose;
}) => {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) {
    return { sent: false, error: "Email delivery is not configured" };
  }

  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") ||
    "no-reply@bendigoflyingclub.com.au";
  const senderName = Deno.env.get("BREVO_SENDER_NAME") || "Bendigo Flying Club";
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(setupLink);
  const isPasswordReset = purpose === "password_reset";
  const isAccountClaim = purpose === "account_claim";
  const subject = isPasswordReset
    ? "Reset your Bendigo Flying Club portal password"
    : isAccountClaim
    ? "Verify your Bendigo Flying Club portal account"
    : "Set up your Bendigo Flying Club portal account";
  const heading = isPasswordReset
    ? "Reset your portal password"
    : isAccountClaim
    ? "Verify your portal account"
    : "Your portal invitation";
  const introduction = isPasswordReset
    ? "A secure password reset was requested for your Bendigo Flying Club portal account. Use the link below to choose a new password."
    : isAccountClaim
    ? "The club has already added your details to the portal. Use this secure link to verify your email address and choose your own password."
    : "You have been invited to the Bendigo Flying Club portal. Use it to manage bookings, flying records, club documents and your account information.";
  const buttonLabel = isPasswordReset
    ? "Reset my portal password"
    : isAccountClaim
    ? "Verify email and set password"
    : "Set up my portal account";
  const unexpectedMessage = isPasswordReset
    ? "If you did not expect a password reset, do not continue and contact Bendigo Flying Club."
    : isAccountClaim
    ? "If you did not try to create a portal account, you can ignore this email."
    : "If you did not expect this invitation, you can ignore this email.";
  const passwordResetEmail = isPasswordReset
    ? await buildPasswordResetEmail({ name, setupLink })
    : null;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email, name }],
      subject: passwordResetEmail?.subject || subject,
      htmlContent: passwordResetEmail?.htmlContent ||
        await brandPortalEmailHtml(`<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 30px rgba(15,23,42,.10);">
          <tr>
            <td style="padding:34px;background:linear-gradient(135deg,#1d4ed8,#4338ca);color:#ffffff;">
              <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#dbeafe;">Bendigo Flying Club</div>
              <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">${heading}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:34px;">
              <p style="margin:0 0 16px;font-size:17px;line-height:1.6;">Hello ${safeName},</p>
              <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#475569;">
                ${introduction}
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-radius:10px;background:#1d4ed8;">
                    <a href="${safeLink}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;">${buttonLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#64748b;">
                The next page will ask you to confirm before the one-time setup link is used. ${unexpectedMessage}
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return {
      sent: false,
      error: body || `Email delivery failed with ${response.status}`,
    };
  }

  return { sent: true, error: null };
};

const findAuthUserByEmail = async (
  adminClient: SupabaseClient,
  email: string,
) => {
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    const match = data.users.find((candidate) =>
      normaliseEmail(candidate.email) === email
    );
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

const handlePendingAccountClaim = async ({
  adminClient,
  emailValue,
  redirectValue,
}: {
  adminClient: SupabaseClient;
  emailValue: unknown;
  redirectValue: unknown;
}) => {
  if (!isValidPendingAccountEmail(emailValue)) return;

  const email = normaliseEmail(emailValue);
  const { data: candidates, error: lookupError } = await adminClient
    .from("pending_portal_accounts")
    .select(
      "user_id,email,claim_email_reserved_at,claim_email_window_started_at,claim_email_count",
    )
    .eq("email", email)
    .is("claimed_at", null)
    .limit(1);

  if (lookupError) {
    console.warn("Pending portal account lookup failed", lookupError.message);
    return;
  }

  const candidate = candidates?.[0] || null;
  if (
    !candidate ||
    !pendingAccountClaimIsAvailable(candidate.claim_email_reserved_at) ||
    !pendingAccountClaimIsWithinWindowLimit(
      candidate.claim_email_count,
      candidate.claim_email_window_started_at,
    )
  ) {
    return;
  }

  const reservedAt = new Date().toISOString();
  const nextWindow = nextPendingAccountClaimWindow(
    candidate.claim_email_count,
    candidate.claim_email_window_started_at,
    Date.parse(reservedAt),
  );
  const reservation = adminClient
    .from("pending_portal_accounts")
    .update({
      claim_email_reserved_at: reservedAt,
      claim_email_window_started_at: nextWindow.windowStartedAt,
      claim_email_count: nextWindow.claimCount,
    })
    .eq("user_id", candidate.user_id)
    .is("claimed_at", null);
  const { data: reserved, error: reservationError } =
    candidate.claim_email_reserved_at
      ? await reservation
        .eq("claim_email_reserved_at", candidate.claim_email_reserved_at)
        .select("user_id,email")
        .maybeSingle()
      : await reservation
        .is("claim_email_reserved_at", null)
        .select("user_id,email")
        .maybeSingle();

  if (reservationError) {
    console.warn(
      "Pending portal account reservation failed",
      reservationError.message,
    );
    return;
  }
  if (!reserved) return;

  const { data: profile, error: profileError } = await adminClient
    .from("users")
    .select("id,email,name")
    .eq("id", reserved.user_id)
    .maybeSingle();
  if (
    profileError ||
    !profile ||
    normaliseEmail(profile.email) !== email ||
    normaliseEmail(reserved.email) !== email
  ) {
    if (profileError) {
      console.warn(
        "Pending portal profile lookup failed",
        profileError.message,
      );
    }
    return;
  }

  const { data: authData, error: authError } = await adminClient.auth.admin
    .getUserById(profile.id);
  const authUser = authData?.user || null;
  if (authError || !authUser || normaliseEmail(authUser.email) !== email) {
    if (authError) {
      console.warn(
        "Pending portal authentication lookup failed",
        authError.message,
      );
    }
    return;
  }

  const redirectTo = resolvePendingAccountRedirect(
    redirectValue,
    Deno.env.get("PORTAL_ORIGIN") || defaultPortalOrigin,
  );
  const { actionLink, error: actionError } = await generateAuthAction({
    adminClient,
    email,
    name: profile.name || email,
    phone: null,
    redirectTo,
    existingAuthUser: authUser,
  });
  if (actionError || !actionLink) {
    console.warn(
      "Pending portal setup link generation failed",
      actionError?.message || "No action link",
    );
    return;
  }

  const setupLink = buildScannerSafeLink(
    actionLink,
    redirectTo,
    "account_claim",
  );
  const delivery = await sendSetupEmail({
    email,
    name: profile.name || email,
    setupLink,
    purpose: "account_claim",
  });
  if (!delivery.sent) {
    console.warn("Pending portal setup email delivery failed", delivery.error);
  }
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

type PasswordResetRequestRow = {
  user_id: string;
  email_hash: string;
  reserved_at: string;
  window_started_at: string;
  request_count: number;
  updated_at: string;
};

type PasswordResetReservation = {
  userId: string;
  reservedAt: string;
  previous: PasswordResetRequestRow | null;
};

const reservePasswordResetEmail = async ({
  adminClient,
  userId,
  email,
}: {
  adminClient: SupabaseClient;
  userId: string;
  email: string;
}) => {
  const { data: existing, error: lookupError } = await adminClient
    .from("password_reset_email_requests")
    .select(
      "user_id,email_hash,reserved_at,window_started_at,request_count,updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (lookupError) {
    console.warn(
      "Password reset reservation lookup failed",
      lookupError.message,
    );
    return null;
  }

  if (
    existing &&
    (!passwordResetRequestIsAvailable(existing.reserved_at) ||
      !passwordResetRequestIsWithinWindowLimit(
        existing.request_count,
        existing.window_started_at,
      ))
  ) {
    return null;
  }

  const reservedAt = new Date().toISOString();
  const nextWindow = nextPasswordResetRequestWindow(
    existing?.request_count,
    existing?.window_started_at,
    Date.parse(reservedAt),
  );
  const values = {
    email_hash: await sha256Hex(email),
    reserved_at: reservedAt,
    window_started_at: nextWindow.windowStartedAt,
    request_count: nextWindow.requestCount,
    updated_at: reservedAt,
  };

  if (!existing) {
    const { error } = await adminClient
      .from("password_reset_email_requests")
      .insert({ user_id: userId, ...values });
    if (error) {
      if (error.code !== "23505") {
        console.warn("Password reset reservation insert failed", error.message);
      }
      return null;
    }
    return {
      userId,
      reservedAt,
      previous: null,
    } satisfies PasswordResetReservation;
  }

  const { data: reserved, error: reservationError } = await adminClient
    .from("password_reset_email_requests")
    .update(values)
    .eq("user_id", userId)
    .eq("reserved_at", existing.reserved_at)
    .select("user_id")
    .maybeSingle();
  if (reservationError) {
    console.warn(
      "Password reset reservation update failed",
      reservationError.message,
    );
    return null;
  }
  if (!reserved) return null;
  return {
    userId,
    reservedAt,
    previous: existing as PasswordResetRequestRow,
  } satisfies PasswordResetReservation;
};

const releasePasswordResetReservation = async (
  adminClient: SupabaseClient,
  reservation: PasswordResetReservation,
) => {
  if (!reservation.previous) {
    const { error } = await adminClient
      .from("password_reset_email_requests")
      .delete()
      .eq("user_id", reservation.userId)
      .eq("reserved_at", reservation.reservedAt);
    if (error) {
      console.warn("Password reset reservation release failed", error.message);
    }
    return;
  }

  const { user_id: _userId, ...previousValues } = reservation.previous;
  const { error } = await adminClient
    .from("password_reset_email_requests")
    .update(previousValues)
    .eq("user_id", reservation.userId)
    .eq("reserved_at", reservation.reservedAt);
  if (error) {
    console.warn("Password reset reservation restore failed", error.message);
  }
};

const handlePublicPasswordReset = async ({
  adminClient,
  emailValue,
  redirectValue,
}: {
  adminClient: SupabaseClient;
  emailValue: unknown;
  redirectValue: unknown;
}) => {
  if (!isValidPendingAccountEmail(emailValue)) return;
  const email = normaliseEmail(emailValue);
  const authUser = await findAuthUserByEmail(adminClient, email);
  if (!authUser || normaliseEmail(authUser.email) !== email) return;

  const reservation = await reservePasswordResetEmail({
    adminClient,
    userId: authUser.id,
    email,
  });
  if (!reservation) return;

  let delivered = false;
  try {
    const { data: profile, error: profileError } = await adminClient
      .from("users")
      .select("name,email")
      .eq("id", authUser.id)
      .maybeSingle();
    if (profileError) {
      console.warn(
        "Password reset profile lookup failed",
        profileError.message,
      );
    }
    if (profile?.email && normaliseEmail(profile.email) !== email) {
      console.warn(
        "Password reset profile and authentication emails do not match",
      );
      return;
    }

    const name =
      String(profile?.name || authUser.user_metadata?.name || email).trim() ||
      email;
    const redirectTo = resolvePendingAccountRedirect(
      redirectValue,
      Deno.env.get("PORTAL_ORIGIN") || defaultPortalOrigin,
    );
    const { actionLink, error: actionError } = await generateAuthAction({
      adminClient,
      email,
      name,
      phone: null,
      redirectTo,
      existingAuthUser: authUser,
    });
    if (actionError || !actionLink) {
      console.warn(
        "Public password reset link generation failed",
        actionError?.message || "No action link",
      );
      return;
    }

    const delivery = await sendSetupEmail({
      email,
      name,
      setupLink: buildScannerSafeLink(actionLink, redirectTo, "password_reset"),
      purpose: "password_reset",
    });
    delivered = delivery.sent;
    if (!delivery.sent) {
      console.warn(
        "Public password reset email delivery failed",
        delivery.error,
      );
    }
  } finally {
    if (!delivered) {
      await releasePasswordResetReservation(adminClient, reservation);
    }
  }
};

const removeProvisionedAuthUser = async (
  adminClient: SupabaseClient,
  userId: string,
) => {
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) {
    console.error(
      "Failed to roll back provisioned authentication user",
      error.message,
    );
  }
};

const getProfileAndMfaFactors = async (
  adminClient: SupabaseClient,
  targetUserId: string,
) => {
  if (!uuidPattern.test(targetUserId)) {
    return { error: jsonResponse({ error: "A valid user is required" }, 400) };
  }

  const { data: targetProfile, error: targetError } = await adminClient
    .from("users")
    .select("id,email,name")
    .eq("id", targetUserId)
    .maybeSingle();
  if (targetError) {
    return { error: jsonResponse({ error: targetError.message }, 500) };
  }
  if (!targetProfile?.email) {
    return {
      error: jsonResponse(
        { error: "This user does not have a CRM profile with a login email" },
        404,
      ),
    };
  }

  const { data: authData, error: authError } = await adminClient.auth.admin
    .getUserById(targetProfile.id);
  const authUser = authData?.user || null;
  if (authError || !authUser) {
    return {
      error: jsonResponse({
        error: "This CRM profile does not have an authentication account",
      }, 409),
    };
  }
  if (normaliseEmail(authUser.email) !== normaliseEmail(targetProfile.email)) {
    return {
      error: jsonResponse({
        error: "The CRM profile and authentication account email do not match",
      }, 409),
    };
  }

  const { data: factorsData, error: factorsError } = await adminClient.auth
    .admin.mfa.listFactors({ userId: targetProfile.id });
  if (factorsError) {
    return { error: jsonResponse({ error: factorsError.message }, 500) };
  }

  const factors = (factorsData?.factors || [])
    .map((factor: Record<string, unknown>) => normaliseFactor(factor))
    .filter((factor) => factor.id);

  return { targetProfile, factors };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const body = await req.json();

    if (body.action === "request_pending_account_setup") {
      const claimTask = handlePendingAccountClaim({
        adminClient,
        emailValue: body.email,
        redirectValue: body.redirectTo,
      }).catch((error) => {
        console.warn(
          "Pending portal account claim failed",
          error instanceof Error ? error.message : "Unknown error",
        );
      });
      EdgeRuntime.waitUntil(claimTask);
      return jsonResponse(pendingAccountClaimResponse());
    }

    if (body.action === "request_password_reset") {
      const resetTask = handlePublicPasswordReset({
        adminClient,
        emailValue: body.email,
        redirectValue: body.redirectTo,
      }).catch((error) => {
        console.warn(
          "Public password reset request failed",
          error instanceof Error ? error.message : "Unknown error",
        );
      });
      EdgeRuntime.waitUntil(resetTask);
      return jsonResponse(publicPasswordResetResponse());
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No authorization header" }, 401);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user: callerUser }, error: callerError } =
      await callerClient.auth.getUser();
    if (callerError || !callerUser) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (body.action === "accept_current") {
      const acceptedAt = new Date().toISOString();
      const { data: pendingAccount, error: pendingLookupError } =
        await adminClient
          .from("pending_portal_accounts")
          .select("user_id")
          .eq("user_id", callerUser.id)
          .is("claimed_at", null)
          .maybeSingle();
      if (pendingLookupError) {
        return jsonResponse({ error: pendingLookupError.message }, 500);
      }

      if (pendingAccount) {
        const { error: confirmError } = await adminClient.auth.admin
          .updateUserById(callerUser.id, {
            email_confirm: true,
          });
        if (confirmError) {
          return jsonResponse({ error: confirmError.message }, 500);
        }
      }

      const [invitationResult, pendingAccountResult] = await Promise.all([
        adminClient
          .from("invitations")
          .update({ status: "accepted", accepted_at: acceptedAt })
          .eq("user_id", callerUser.id)
          .eq("status", "pending"),
        adminClient
          .from("pending_portal_accounts")
          .update({ claimed_at: acceptedAt })
          .eq("user_id", callerUser.id)
          .is("claimed_at", null)
          .select("user_id"),
      ]);
      if (invitationResult.error) {
        return jsonResponse({ error: invitationResult.error.message }, 500);
      }
      if (pendingAccountResult.error) {
        return jsonResponse({ error: pendingAccountResult.error.message }, 500);
      }

      const claimedPendingAccount = Boolean(pendingAccountResult.data?.length);
      return jsonResponse({
        accepted: true,
        acceptedAt,
        claimedPendingAccount,
      });
    }

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUser.id);
    if (callerRolesError) {
      return jsonResponse({ error: callerRolesError.message }, 500);
    }
    const callerRoleNames = (callerRoles || []).map((row) => String(row.role));
    const callerIsAdmin = callerRoleNames.includes("admin");

    if (body.action === "get_mfa_status") {
      if (!callerIsAdmin) {
        return jsonResponse({ error: "Only admins can view 2FA status" }, 403);
      }

      const targetUserId = String(body.userId || "").trim();
      const result = await getProfileAndMfaFactors(adminClient, targetUserId);
      if (result.error) return result.error;

      const verifiedFactorCount = result.factors.filter((factor) =>
        factor.status === "verified"
      ).length;
      return jsonResponse({
        userId: result.targetProfile!.id,
        hasMfa: result.factors.length > 0,
        factorCount: result.factors.length,
        verifiedFactorCount,
      });
    }

    if (body.action === "reset_mfa") {
      const mfaAdmin = await authenticateAal2AdminOrWorker({
        req,
        supabaseUrl,
        anonKey,
        adminClient,
        mfaPurpose: "resetting a member's 2FA",
      });
      if (!mfaAdmin.ok) {
        return jsonResponse({ error: mfaAdmin.error }, mfaAdmin.status);
      }

      const targetUserId = String(body.userId || "").trim();
      const result = await getProfileAndMfaFactors(adminClient, targetUserId);
      if (result.error) return result.error;

      const beforeFactors = result.factors;
      for (const factor of beforeFactors) {
        const { error: deleteFactorError } = await adminClient.auth.admin.mfa
          .deleteFactor({
            userId: result.targetProfile!.id,
            id: factor.id,
          });
        if (deleteFactorError) {
          return jsonResponse({ error: deleteFactorError.message }, 500);
        }
      }

      await adminClient.from("operations_audit_events").insert({
        entity_type: "user",
        entity_id: result.targetProfile!.id,
        action: "RESET_MFA",
        actor_id: mfaAdmin.userId,
        before_data: {
          factors: beforeFactors.map((factor) => ({
            type: factor.type,
            status: factor.status,
            friendlyName: factor.friendlyName,
          })),
        },
        after_data: { factors: [] },
        metadata: {
          targetEmail: result.targetProfile!.email,
          factorsRemoved: beforeFactors.length,
        },
      });

      return jsonResponse({
        reset: true,
        userId: result.targetProfile!.id,
        factorsRemoved: beforeFactors.length,
        message: beforeFactors.length > 0
          ? `2FA reset for ${result.targetProfile!.email}. They can enrol a new authenticator next time they sign in.`
          : `No 2FA factors were found for ${result.targetProfile!.email}.`,
      });
    }

    if (body.action === "send_password_reset") {
      if (!callerIsAdmin) {
        return jsonResponse({ error: "Only admins can manage password resets" }, 403);
      }
      const targetUserId = String(body.userId || "").trim();
      if (!uuidPattern.test(targetUserId)) {
        return jsonResponse({ error: "A valid user is required" }, 400);
      }

      const { data: targetProfile, error: targetError } = await adminClient
        .from("users")
        .select("id,email,name")
        .eq("id", targetUserId)
        .maybeSingle();
      if (targetError) return jsonResponse({ error: targetError.message }, 500);
      if (!targetProfile?.email) {
        return jsonResponse(
          { error: "This user does not have a login email" },
          404,
        );
      }

      const targetEmail = normaliseEmail(targetProfile.email);
      const targetAuthUser = await findAuthUserByEmail(
        adminClient,
        targetEmail,
      );
      if (!targetAuthUser) {
        return jsonResponse({
          error: "This CRM profile does not have an authentication account",
        }, 409);
      }
      if (targetAuthUser.id !== targetProfile.id) {
        return jsonResponse({
          error: "The CRM profile and authentication account do not match",
        }, 409);
      }

      const redirectTo = resolveRedirectTo(body.redirectTo);
      const { actionLink, error: actionError } = await generateAuthAction({
        adminClient,
        email: targetEmail,
        name: targetProfile.name || targetEmail,
        phone: null,
        redirectTo,
        existingAuthUser: targetAuthUser,
      });
      if (actionError || !actionLink) {
        return jsonResponse({
          error: actionError?.message ||
            "Failed to generate a password reset link",
        }, 500);
      }

      const scannerSafeLink = buildScannerSafeLink(
        actionLink,
        redirectTo,
        "password_reset",
      );
      const delivery = await sendSetupEmail({
        email: targetEmail,
        name: targetProfile.name || targetEmail,
        setupLink: scannerSafeLink,
        purpose: "password_reset",
      });
      if (!delivery.sent) {
        return jsonResponse({
          error:
            `The reset link was generated, but the email could not be sent: ${delivery.error}`,
        }, 502);
      }

      return jsonResponse({
        emailSent: true,
        message: `Password reset email sent to ${targetEmail}.`,
        userId: targetProfile.id,
      });
    }

    const email = normaliseEmail(body.email);
    const name = String(body.name || "").trim();
    const phone = body.phone ? String(body.phone).trim() : null;
    const sendInvitation = body.sendInvitation !== false;
    const resend = sendInvitation && Boolean(body.resend);
    const requestedRoles = Array.isArray(body.roles) && body.roles.length > 0
      ? body.roles
      : ["student"];
    const userRoles = Array.from(new Set(requestedRoles))
      .map((role) => String(role).trim())
      .filter((role) => validProvisionedUserRoles.has(role));

    if (!isValidPendingAccountEmail(email) || !name) {
      return jsonResponse(
        { error: "A valid email and name are required" },
        400,
      );
    }
    if (name.length > 200 || (phone && phone.length > 50)) {
      return jsonResponse({ error: "Name or phone number is too long" }, 400);
    }
    if (userRoles.length === 0) {
      return jsonResponse(
        { error: "At least one valid role is required" },
        400,
      );
    }
    if (userRoles.includes("student") && userRoles.length > 1) {
      return jsonResponse({
        error: "Student cannot be combined with any other role",
      }, 400);
    }
    const provisioningAccess = provisioningAccessFor(callerRoleNames, userRoles);
    if (!provisioningAccess.allowed) {
      return jsonResponse({ error: provisioningAccess.error || "User access is not permitted" }, 403);
    }

    const { data: existingProfile, error: profileLookupError } =
      await adminClient
        .from("users")
        .select("id,email")
        .ilike("email", email)
        .maybeSingle();
    if (profileLookupError) {
      return jsonResponse({ error: profileLookupError.message }, 500);
    }

    const { data: pendingInvitations, error: invitationLookupError } =
      await adminClient
        .from("invitations")
        .select("id,status,user_id")
        .ilike("email", email)
        .eq("status", "pending")
        .order("invited_at", { ascending: false })
        .limit(1);
    if (invitationLookupError) {
      return jsonResponse({ error: invitationLookupError.message }, 500);
    }
    const pendingInvitation = pendingInvitations?.[0] || null;

    if (existingProfile && !resend) {
      return jsonResponse({
        error: !sendInvitation
          ? "A user with this email already exists"
          : pendingInvitation
          ? "A pending invite already exists for this email. Use resend to send a fresh setup email."
          : "A user with this email already exists",
      }, 409);
    }
    if (existingProfile && resend && !pendingInvitation) {
      return jsonResponse({
        error: "This user has already completed their invitation",
      }, 409);
    }

    const existingAuthUser = await findAuthUserByEmail(adminClient, email);
    if (existingProfile && !existingAuthUser) {
      return jsonResponse({
        error:
          "The CRM profile exists but its login is missing. Contact support before resending.",
      }, 409);
    }

    const redirectTo = resolveRedirectTo(body.redirectTo);
    let actionLink: string | null = null;
    let actionUser: User | null = null;
    let createdAuthUser = false;

    if (sendInvitation) {
      const generated = await generateAuthAction({
        adminClient,
        email,
        name,
        phone,
        redirectTo,
        existingAuthUser,
      });
      actionLink = generated.actionLink;
      actionUser = generated.user;
      createdAuthUser = !existingAuthUser;

      if (generated.error || !actionLink || !actionUser) {
        return jsonResponse({
          error: generated.error?.message ||
            "Failed to generate a fresh setup link",
        }, 500);
      }
    } else {
      if (existingAuthUser) {
        return jsonResponse({
          error:
            "An authentication account already exists for this email. Review it before adding portal access.",
        }, 409);
      }

      const { data: created, error: createError } = await adminClient.auth.admin
        .createUser({
          email,
          password: createPendingAccountPassword(),
          email_confirm: false,
          user_metadata: { name, phone },
        });
      if (createError || !created.user) {
        return jsonResponse({
          error: createError?.message || "Failed to create the portal login",
        }, 500);
      }
      actionUser = created.user;
      createdAuthUser = true;
    }

    const userId = existingProfile?.id || actionUser!.id;

    if (
      existingProfile && existingAuthUser &&
      existingAuthUser.id !== existingProfile.id
    ) {
      if (createdAuthUser) {
        await removeProvisionedAuthUser(adminClient, actionUser!.id);
      }
      return jsonResponse({
        error:
          "The CRM profile and login refer to different accounts. Contact support before resending.",
      }, 409);
    }

    const primaryRole = getPrimaryRole(userRoles);
    try {
      const { error: profileWriteError } = await adminClient.from("users")
        .upsert({
          id: userId,
          email,
          name,
          phone,
          role: getLegacyUsersRole(primaryRole),
          is_active: true,
        });
      if (profileWriteError) throw profileWriteError;

      const { error: roleDeleteError } = await adminClient.from("user_roles")
        .delete().eq("user_id", userId);
      if (roleDeleteError) throw roleDeleteError;
      const { error: roleInsertError } = await adminClient
        .from("user_roles")
        .insert(userRoles.map((role) => ({ user_id: userId, role })));
      if (roleInsertError) throw roleInsertError;

      if (!sendInvitation) {
        const { error: pendingAccountError } = await adminClient.from(
          "pending_portal_accounts",
        ).insert({
          user_id: userId,
          email,
          created_by: callerUser.id,
        });
        if (pendingAccountError) throw pendingAccountError;
      } else {
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
          const { error } = await adminClient.from("invitations").insert(
            invitationValues,
          );
          if (error) throw error;
        }
      }
    } catch (writeError) {
      if (createdAuthUser) await removeProvisionedAuthUser(adminClient, userId);
      throw writeError;
    }

    if (!sendInvitation) {
      return jsonResponse({
        accountCreatedWithoutInvite: true,
        emailSent: false,
        message:
          "User added without sending an email. When they create an account with this address, they can verify it and choose a password.",
        userId,
      });
    }

    const scannerSafeLink = buildScannerSafeLink(
      actionLink!,
      redirectTo,
      "invite",
    );
    const delivery = await sendSetupEmail({
      email,
      name,
      setupLink: scannerSafeLink,
    });

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
      error: error instanceof Error
        ? error.message
        : "The invitation could not be completed",
    }, 500);
  }
});
