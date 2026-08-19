import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  type SupabaseClient,
  type User as AuthUser,
} from "npm:@supabase/supabase-js@2";
import { assessOrphanAuthReconciliation } from "../_shared/accountEmailReconciliation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normaliseEmail = (value: unknown) =>
  String(value ?? "").trim().toLowerCase();
const isValidEmail = (email: string) => /\S+@\S+\.\S+/.test(email);

const findAuthUserByEmail = async (
  adminClient: SupabaseClient,
  email: string,
): Promise<AuthUser | null> => {
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

const resolveResetRedirect = (
  resetRedirectTo?: string,
  emailRedirectTo?: string,
) => {
  const requested = resetRedirectTo?.trim() || emailRedirectTo?.trim();
  if (requested) {
    try {
      return new URL("/reset-password", requested).toString();
    } catch {
      // Fall through to the configured production portal.
    }
  }
  const portalOrigin = Deno.env.get("PORTAL_ORIGIN")?.trim() ||
    "https://portal.bendigoflyingclub.com.au";
  return `${portalOrigin.replace(/\/$/, "")}/reset-password`;
};

const queuePasswordResetEmail = async ({
  supabaseUrl,
  anonKey,
  email,
  redirectTo,
}: {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  redirectTo: string;
}) => {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/invite-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        Apikey: anonKey,
      },
      body: JSON.stringify({
        action: "request_password_reset",
        email,
        redirectTo,
      }),
    });
    return response.ok;
  } catch (error) {
    console.warn(
      "Could not queue the reconciled account password reset email",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callerUser }, error: callerError } =
      await callerClient.auth.getUser();
    if (callerError || !callerUser) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const requestBody = await req.json().catch(() => ({}));
    const action = typeof requestBody?.action === "string"
      ? requestBody.action.trim()
      : "";

    if (action === "sync_verified_email") {
      const confirmedEmail = normaliseEmail(callerUser.email);
      if (!confirmedEmail || !isValidEmail(confirmedEmail)) {
        return jsonResponse({
          error: "Authenticated user does not have a valid email",
        }, 400);
      }

      const { data: existingProfile, error: existingProfileError } =
        await adminClient
          .from("users")
          .select("id,email")
          .eq("id", callerUser.id)
          .maybeSingle();
      if (existingProfileError) {
        return jsonResponse({ error: existingProfileError.message }, 500);
      }
      if (!existingProfile) {
        return jsonResponse({ error: "User profile not found" }, 404);
      }

      const { data: emailOwner, error: emailOwnerError } = await adminClient
        .from("users")
        .select("id")
        .eq("email", confirmedEmail)
        .neq("id", callerUser.id)
        .maybeSingle();
      if (emailOwnerError) {
        return jsonResponse({ error: emailOwnerError.message }, 500);
      }
      if (emailOwner) {
        return jsonResponse({
          error: "Another CRM member already uses this email",
        }, 409);
      }

      const { error: profileUpdateError } = await adminClient
        .from("users")
        .update({ email: confirmedEmail, updated_at: new Date().toISOString() })
        .eq("id", callerUser.id);
      if (profileUpdateError) {
        return jsonResponse({ error: profileUpdateError.message }, 500);
      }

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
    if (callerRolesError) {
      return jsonResponse({ error: callerRolesError.message }, 500);
    }
    const isAdmin = (callerRoles || []).some((roleRow) =>
      roleRow.role === "admin"
    );
    if (!isAdmin) {
      return jsonResponse({
        error: "Only admins can change another user's login email",
      }, 403);
    }

    const { userId, newEmail, redirectTo, resetRedirectTo } = requestBody;
    const cleanUserId = typeof userId === "string" ? userId.trim() : "";
    const cleanEmail = normaliseEmail(newEmail);
    const cleanRedirectTo = typeof redirectTo === "string" && redirectTo.trim()
      ? redirectTo.trim()
      : undefined;
    const cleanResetRedirectTo =
      typeof resetRedirectTo === "string" && resetRedirectTo.trim()
        ? resetRedirectTo.trim()
        : undefined;

    if (!cleanUserId) return jsonResponse({ error: "userId is required" }, 400);
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      return jsonResponse({ error: "A valid new email is required" }, 400);
    }

    const { data: currentUser, error: currentUserError } = await adminClient
      .from("users")
      .select("id,email,name")
      .eq("id", cleanUserId)
      .maybeSingle();
    if (currentUserError) {
      return jsonResponse({ error: currentUserError.message }, 500);
    }
    if (!currentUser) return jsonResponse({ error: "User not found" }, 404);

    const currentEmail = normaliseEmail(currentUser.email);
    if (currentEmail === cleanEmail) {
      return jsonResponse({ changed: false, message: "Email is unchanged" });
    }

    const { data: existingProfile, error: existingProfileError } =
      await adminClient
        .from("users")
        .select("id")
        .eq("email", cleanEmail)
        .neq("id", cleanUserId)
        .maybeSingle();
    if (existingProfileError) {
      return jsonResponse({ error: existingProfileError.message }, 500);
    }
    if (existingProfile) {
      return jsonResponse({
        code: "CRM_EMAIL_IN_USE",
        error: "Another member already uses that email",
      }, 409);
    }

    const { data: targetAuthData, error: targetAuthError } = await adminClient
      .auth.admin
      .getUserById(cleanUserId);
    if (targetAuthError || !targetAuthData.user) {
      return jsonResponse({
        code: "CRM_LOGIN_MISSING",
        error:
          "This CRM profile does not have a matching authentication account.",
      }, 409);
    }
    const targetAuthUser = targetAuthData.user;
    if (normaliseEmail(targetAuthUser.email) !== currentEmail) {
      return jsonResponse({
        code: "CRM_LOGIN_MISMATCH",
        error:
          "The CRM profile and its authentication account have different current emails.",
      }, 409);
    }

    const conflictingAuthUser = await findAuthUserByEmail(
      adminClient,
      cleanEmail,
    );
    if (conflictingAuthUser && conflictingAuthUser.id !== cleanUserId) {
      const { data: conflictingProfile, error: conflictingProfileError } =
        await adminClient
          .from("users")
          .select("id,name,email")
          .eq("id", conflictingAuthUser.id)
          .maybeSingle();
      if (conflictingProfileError) {
        return jsonResponse({ error: conflictingProfileError.message }, 500);
      }

      const assessment = assessOrphanAuthReconciliation({
        targetProfileName: currentUser.name,
        orphanAuthName: conflictingAuthUser.user_metadata?.name,
        orphanHasProfile: Boolean(conflictingProfile),
      });
      if (!assessment.allowed) {
        return jsonResponse({
          code: assessment.code,
          canReconcile: false,
          error: assessment.error ||
            "That authentication account cannot be automatically linked.",
        }, 409);
      }

      if (action !== "reconcile_orphan_auth") {
        return jsonResponse({
          code: "ORPHAN_AUTH_ACCOUNT",
          canReconcile: true,
          conflictEmail: cleanEmail,
          error:
            "That email already has a login but no CRM profile. Confirm that the unused login should be linked to this member.",
        }, 409);
      }
      if (requestBody.confirmOrphanReplacement !== true) {
        return jsonResponse({
          code: "RECONCILIATION_CONFIRMATION_REQUIRED",
          error:
            "Explicit confirmation is required before replacing the unused login.",
        }, 400);
      }

      const parkedEmail =
        `replaced-${conflictingAuthUser.id}@account-recovery.bendigoflyingclub.com.au`;
      const now = new Date().toISOString();
      const orphanWasConfirmed = Boolean(
        conflictingAuthUser.email_confirmed_at,
      );
      const targetWasConfirmed = Boolean(targetAuthUser.email_confirmed_at);
      const orphanMetadata = {
        ...(conflictingAuthUser.user_metadata || {}),
        replaced_by_profile_id: cleanUserId,
        replaced_at: now,
      };
      let orphanParked = false;
      let targetAuthChanged = false;
      let profileChanged = false;

      const restoreAuthState = async () => {
        if (targetAuthChanged) {
          const { error } = await adminClient.auth.admin.updateUserById(
            cleanUserId,
            {
              email: currentEmail,
              email_confirm: targetWasConfirmed,
            },
          );
          if (error) {
            console.error(
              "Failed to roll back the target authentication email",
              error.message,
            );
          }
        }
        if (orphanParked) {
          const { error } = await adminClient.auth.admin.updateUserById(
            conflictingAuthUser.id,
            {
              email: cleanEmail,
              email_confirm: orphanWasConfirmed,
              user_metadata: conflictingAuthUser.user_metadata || {},
            },
          );
          if (error) {
            console.error(
              "Failed to roll back the orphan authentication email",
              error.message,
            );
          }
        }
      };

      try {
        const { error: parkError } = await adminClient.auth.admin
          .updateUserById(
            conflictingAuthUser.id,
            {
              email: parkedEmail,
              email_confirm: false,
              user_metadata: orphanMetadata,
            },
          );
        if (parkError) throw parkError;
        orphanParked = true;

        const { error: targetUpdateError } = await adminClient.auth.admin
          .updateUserById(
            cleanUserId,
            { email: cleanEmail, email_confirm: true },
          );
        if (targetUpdateError) throw targetUpdateError;
        targetAuthChanged = true;

        const { data: updatedProfile, error: profileUpdateError } =
          await adminClient
            .from("users")
            .update({ email: cleanEmail, updated_at: now })
            .eq("id", cleanUserId)
            .select("id")
            .maybeSingle();
        if (profileUpdateError || !updatedProfile) {
          throw profileUpdateError ||
            new Error("The CRM profile email could not be updated");
        }
        profileChanged = true;

        const { error: pendingUpdateError } = await adminClient
          .from("pending_portal_accounts")
          .update({
            email: cleanEmail,
            claim_email_reserved_at: null,
            claim_email_window_started_at: null,
            claim_email_count: 0,
          })
          .eq("user_id", cleanUserId);
        if (pendingUpdateError) throw pendingUpdateError;
      } catch (reconciliationError) {
        if (profileChanged) {
          const { error } = await adminClient.from("users")
            .update({
              email: currentEmail,
              updated_at: new Date().toISOString(),
            })
            .eq("id", cleanUserId);
          if (error) {
            console.error(
              "Failed to roll back the CRM profile email",
              error.message,
            );
          }
        }
        await restoreAuthState();
        return jsonResponse({
          code: "RECONCILIATION_FAILED",
          error: reconciliationError instanceof Error
            ? reconciliationError.message
            : "The unlinked login could not be reconciled safely.",
        }, 500);
      }

      const recoveryRedirect = resolveResetRedirect(
        cleanResetRedirectTo,
        cleanRedirectTo,
      );
      const { data: recoveryData, error: recoveryError } = await adminClient
        .auth.admin
        .generateLink({
          type: "recovery",
          email: cleanEmail,
          options: { redirectTo: recoveryRedirect },
        });
      const emailQueued = await queuePasswordResetEmail({
        supabaseUrl,
        anonKey,
        email: cleanEmail,
        redirectTo: recoveryRedirect,
      });

      const { error: deleteOrphanError } = await adminClient.auth.admin
        .deleteUser(conflictingAuthUser.id);
      if (deleteOrphanError) {
        console.warn(
          "The reconciled orphan authentication account remains parked",
          deleteOrphanError.message,
        );
      }

      return jsonResponse({
        changed: true,
        reconciledOrphanAuth: true,
        loginResetRequired: true,
        emailQueued,
        oldEmail: currentEmail,
        newEmail: cleanEmail,
        manualLink: recoveryError
          ? undefined
          : recoveryData?.properties?.action_link,
        cleanupWarning: deleteOrphanError
          ? "The unused login was safely parked but could not be removed automatically."
          : undefined,
        message: emailQueued
          ? "The login was linked to this member and a password reset email was queued."
          : "The login was linked to this member. Use the generated password reset link to finish setup.",
      });
    }

    const { data: linkData, error: linkError } = await adminClient.auth.admin
      .generateLink({
        type: "email_change_new",
        email: currentEmail,
        newEmail: cleanEmail,
        options: cleanRedirectTo ? { redirectTo: cleanRedirectTo } : undefined,
      });
    if (linkError) {
      return jsonResponse({
        code: "EMAIL_CHANGE_LINK_FAILED",
        error: linkError.message || "Failed to create email verification link",
      }, 500);
    }

    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) {
      return jsonResponse({
        error: "Supabase did not return an email verification link",
      }, 500);
    }

    return jsonResponse({
      changed: true,
      oldEmail: currentEmail,
      newEmail: cleanEmail,
      manualLink: actionLink,
      message:
        "Email change verification link generated. The CRM email will update after the new email is verified.",
    });
  } catch (err) {
    console.error("change-user-email failed", err);
    return jsonResponse({
      error: err instanceof Error
        ? err.message
        : "The email address could not be changed",
    }, 500);
  }
});
