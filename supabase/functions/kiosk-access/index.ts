import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  authenticateAal2AdminOrWorker,
  corsHeadersForRequest,
  isAllowedBrowserOrigin,
} from "../_shared/edgeSecurity.ts";
import {
  createKioskAccessToken,
  createKioskSessionGrant,
  decryptKioskToken,
  encryptKioskToken,
  isKioskAccessToken,
  isKioskSessionGrant,
  kioskSessionExpiry,
  sha256Hex,
} from "../_shared/kioskAccess.ts";

const clean = (value: unknown) => String(value || "").trim();

const json = (
  req: Request,
  payload: Record<string, unknown>,
  status = 200,
) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const bearerToken = (req: Request) =>
  clean(req.headers.get("Authorization")).replace(/^Bearer\s+/i, "").trim();

const activeAdminIdentity = async (adminClient: any, userId: string) => {
  const [{ data: profile, error: profileError }, { data: roles, error: rolesError }, authResult] =
    await Promise.all([
      adminClient
        .from("users")
        .select("id,email,role,is_active")
        .eq("id", userId)
        .maybeSingle(),
      adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", userId),
      adminClient.auth.admin.getUserById(userId),
    ]);

  if (profileError || rolesError || authResult.error) {
    throw profileError || rolesError || authResult.error;
  }
  const hasAdminRole = clean(profile?.role) === "admin" ||
    (roles || []).some((row: any) => clean(row.role) === "admin");
  const email = clean(authResult.data?.user?.email || profile?.email).toLowerCase();
  if (!profile || profile.is_active === false || !hasAdminRole || !email) return null;

  return { id: userId, email };
};

const requireCaller = async (
  req: Request,
  supabaseUrl: string,
  anonKey: string,
) => {
  const token = bearerToken(req);
  if (!token) return null;
  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await callerClient.auth.getUser();
  return error || !user?.id ? null : user;
};

Deno.serve(async (req: Request) => {
  let action = "";
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeadersForRequest(req),
    });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }
  if (!isAllowedBrowserOrigin(req)) {
    return json(req, { error: "This browser origin is not allowed." }, 403);
  }

  try {
    const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
    const anonKey = clean(Deno.env.get("SUPABASE_ANON_KEY"));
    const serviceRoleKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase function credentials are not configured.");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const body = await req.json().catch(() => ({}));
    action = clean(body?.action).toLowerCase();

    if (action === "login") {
      const token = clean(body?.token);
      if (!isKioskAccessToken(token)) {
        return json(req, { error: "The kiosk access key is not valid." }, 401);
      }

      const tokenHash = await sha256Hex(token);
      const { data: accessToken, error: accessError } = await adminClient
        .from("kiosk_access_tokens")
        .select("id,created_by")
        .eq("token_hash", tokenHash)
        .is("revoked_at", null)
        .maybeSingle();
      if (accessError) throw accessError;
      if (!accessToken?.id || !accessToken.created_by) {
        return json(req, { error: "The kiosk access key is not valid." }, 401);
      }

      const identity = await activeAdminIdentity(adminClient, accessToken.created_by);
      if (!identity) {
        return json(
          req,
          { error: "The kiosk access key owner is no longer an active administrator. Rotate the key in Admin Settings." },
          403,
        );
      }

      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: identity.email,
        options: { redirectTo: "https://portal.bendigoflyingclub.com.au/kiosk" },
      });
      const magicLinkTokenHash = clean(linkData?.properties?.hashed_token);
      if (linkError || !magicLinkTokenHash) {
        throw linkError || new Error("Unable to create the kiosk session.");
      }

      const sessionGrant = createKioskSessionGrant();
      const expiresAt = kioskSessionExpiry();
      const { error: sessionError } = await adminClient
        .from("kiosk_access_sessions")
        .insert({
          access_token_id: accessToken.id,
          auth_user_id: identity.id,
          session_hash: await sha256Hex(sessionGrant),
          expires_at: expiresAt,
        });
      if (sessionError) throw sessionError;

      const { error: usedError } = await adminClient
        .from("kiosk_access_tokens")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", accessToken.id)
        .is("revoked_at", null);
      if (usedError) throw usedError;

      return json(req, {
        tokenHash: magicLinkTokenHash,
        verificationType: "magiclink",
        sessionGrant,
        expiresAt,
      });
    }

    if (action === "validate-session") {
      const sessionGrant = clean(body?.sessionGrant);
      if (!isKioskSessionGrant(sessionGrant)) {
        return json(req, { error: "The kiosk session is not valid." }, 401);
      }
      const caller = await requireCaller(req, supabaseUrl, anonKey);
      if (!caller?.id) {
        return json(req, { error: "The kiosk session has expired. Enter the kiosk key again." }, 401);
      }

      const { data: session, error: sessionError } = await adminClient
        .from("kiosk_access_sessions")
        .select("id,access_token_id,auth_user_id,expires_at")
        .eq("session_hash", await sha256Hex(sessionGrant))
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session?.id || session.auth_user_id !== caller.id) {
        return json(req, { error: "The kiosk session is no longer active. Enter the kiosk key again." }, 401);
      }

      const { data: accessToken, error: tokenError } = await adminClient
        .from("kiosk_access_tokens")
        .select("id")
        .eq("id", session.access_token_id)
        .is("revoked_at", null)
        .maybeSingle();
      if (tokenError) throw tokenError;
      if (!accessToken?.id) {
        return json(req, { error: "The kiosk key has been rotated or disabled." }, 401);
      }

      const identity = await activeAdminIdentity(adminClient, caller.id);
      if (!identity) {
        return json(req, { error: "The kiosk access account is no longer an active administrator." }, 403);
      }

      const expiresAt = kioskSessionExpiry();
      const { error: updateError } = await adminClient
        .from("kiosk_access_sessions")
        .update({ last_seen_at: new Date().toISOString(), expires_at: expiresAt })
        .eq("id", session.id)
        .is("revoked_at", null);
      if (updateError) throw updateError;

      return json(req, { valid: true, userId: caller.id, expiresAt });
    }

    if (action === "close-session") {
      const sessionGrant = clean(body?.sessionGrant);
      if (isKioskSessionGrant(sessionGrant)) {
        const { error } = await adminClient
          .from("kiosk_access_sessions")
          .update({ revoked_at: new Date().toISOString() })
          .eq("session_hash", await sha256Hex(sessionGrant))
          .is("revoked_at", null);
        if (error) throw error;
      }
      return json(req, { closed: true });
    }

    if (!["get-settings", "rotate", "disable"].includes(action)) {
      return json(req, { error: "Unsupported kiosk access action." }, 400);
    }

    const auth = await authenticateAal2AdminOrWorker({
      req,
      supabaseUrl,
      anonKey,
      adminClient,
      mfaPurpose: "kiosk access settings",
    });
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);
    if (auth.actorType !== "user" || !auth.userId) {
      return json(req, { error: "Administrator access is required." }, 403);
    }
    const actorUserId = auth.userId;

    if (action === "get-settings") {
      const { data: activeToken, error } = await adminClient
        .from("kiosk_access_tokens")
        .select("id,token_prefix,token_ciphertext,created_at,last_used_at,created_by")
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!activeToken) return json(req, { configured: false });

      try {
        const token = await decryptKioskToken(activeToken.token_ciphertext);
        return json(req, {
          configured: true,
          token,
          prefix: activeToken.token_prefix,
          createdAt: activeToken.created_at,
          lastUsedAt: activeToken.last_used_at,
          createdBy: activeToken.created_by,
        });
      } catch (decryptError) {
        console.error("Active kiosk key could not be decrypted", decryptError);
        return json(req, {
          configured: true,
          tokenUnavailable: true,
          prefix: activeToken.token_prefix,
          createdAt: activeToken.created_at,
          lastUsedAt: activeToken.last_used_at,
          createdBy: activeToken.created_by,
        });
      }
    }

    if (action === "disable") {
      const { error } = await adminClient.rpc("disable_kiosk_access_internal", {
        p_actor_user_id: actorUserId,
      });
      if (error) throw error;
      return json(req, { configured: false });
    }

    const token = createKioskAccessToken();
    const tokenPrefix = token.slice(0, 18);
    const tokenHash = await sha256Hex(token);
    const tokenCiphertext = await encryptKioskToken(token);
    const { data: createdRows, error: createError } = await adminClient
      .rpc("rotate_kiosk_access_token_internal", {
        p_token_prefix: tokenPrefix,
        p_token_hash: tokenHash,
        p_token_ciphertext: tokenCiphertext,
        p_actor_user_id: actorUserId,
      });
    if (createError) throw createError;
    const created = Array.isArray(createdRows) ? createdRows[0] : createdRows;
    if (!created?.id) throw new Error("The kiosk key could not be saved.");

    return json(req, {
      configured: true,
      token,
      prefix: tokenPrefix,
      createdAt: created.created_at,
      lastUsedAt: null,
      createdBy: actorUserId,
    });
  } catch (error) {
    console.error("kiosk-access failed", error);
    const publicAction = ["login", "validate-session", "close-session"].includes(action);
    return json(
      req,
      {
        error: publicAction
          ? "Kiosk access could not be completed. Please try again."
          : error instanceof Error
            ? error.message
            : "Kiosk access could not be completed.",
      },
      500,
    );
  }
});
