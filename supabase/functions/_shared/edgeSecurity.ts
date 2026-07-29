import { createClient } from "npm:@supabase/supabase-js@2";

const clean = (value: unknown) => String(value || "").trim();

const allowedOrigins = () => {
  const configured = [
    Deno.env.get("PUBLIC_SITE_URL"),
    Deno.env.get("SITE_URL"),
    ...(Deno.env.get("ADDITIONAL_ALLOWED_ORIGINS") || "").split(","),
  ]
    .map((value) => clean(value).replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([
    "https://portal.bendigoflyingclub.com.au",
    ...configured,
  ]);
};

export const corsHeadersForRequest = (
  req: Request,
  methods = "POST, OPTIONS",
) => {
  const origin = clean(req.headers.get("Origin")).replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Client-Info, Apikey, X-Integration-Worker-Secret, X-Xero-Signature",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && allowedOrigins().has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
};

export const isAllowedBrowserOrigin = (req: Request) => {
  const origin = clean(req.headers.get("Origin")).replace(/\/$/, "");
  return !origin || allowedOrigins().has(origin);
};

const decodeJwtPayload = (token: string) => {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - normalized.length % 4) % 4),
      "=",
    );
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

const timingSafeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
};

export type IntegrationAuthResult =
  | { ok: true; actorType: "user"; userId: string; aal: "aal2" }
  | { ok: true; actorType: "worker"; userId: null; aal: null }
  | { ok: false; error: string; status: number };

export const authenticateAal2AdminOrWorker = async ({
  req,
  supabaseUrl,
  anonKey,
  adminClient,
  allowWorker = false,
  mfaPurpose = "Xero administration",
}: {
  req: Request;
  supabaseUrl: string;
  anonKey: string;
  adminClient: any;
  allowWorker?: boolean;
  mfaPurpose?: string;
}): Promise<IntegrationAuthResult> => {
  if (allowWorker) {
    const configuredWorkerSecret = clean(
      Deno.env.get("INTEGRATION_WORKER_SECRET"),
    );
    const suppliedWorkerSecret = clean(
      req.headers.get("X-Integration-Worker-Secret"),
    );
    if (
      configuredWorkerSecret && suppliedWorkerSecret &&
      timingSafeEqual(configuredWorkerSecret, suppliedWorkerSecret)
    ) {
      return { ok: true, actorType: "worker", userId: null, aal: null };
    }
  }

  const authHeader = clean(req.headers.get("Authorization"));
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { ok: false, error: "Authentication is required.", status: 401 };
  }
  const claims = decodeJwtPayload(token);
  if (clean(claims?.aal).toLowerCase() !== "aal2") {
    return {
      ok: false,
      error: `Multi-factor authentication is required for ${mfaPurpose}.`,
      status: 403,
    };
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user?.id) {
    return { ok: false, error: "Invalid or expired session.", status: 401 };
  }

  const [{ data: roles, error: rolesError }, { data: profile, error: profileError }] =
    await Promise.all([
      adminClient.from("user_roles").select("role").eq("user_id", user.id),
      adminClient.from("users").select("role").eq("id", user.id).maybeSingle(),
    ]);
  if (rolesError || profileError) {
    return {
      ok: false,
      error: rolesError?.message || profileError?.message ||
        "Unable to verify administrator access.",
      status: 500,
    };
  }
  const isAdmin = clean(profile?.role) === "admin" ||
    (roles || []).some((row: any) => clean(row.role) === "admin");
  if (!isAdmin) {
    return { ok: false, error: "Administrator access is required.", status: 403 };
  }
  return { ok: true, actorType: "user", userId: user.id, aal: "aal2" };
};

