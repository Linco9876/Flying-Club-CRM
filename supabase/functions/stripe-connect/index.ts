import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type SupabaseAdminClient = any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const redirect = (url: string) =>
  new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: url },
  });

const isAdminRole = (role: string) => role === "admin";

const appUrl = () =>
  (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");

const callbackUrl = (supabaseUrl: string) => `${supabaseUrl.replace(/\/$/, "")}/functions/v1/stripe-connect`;

const settingsUrl = (params: Record<string, string>) => {
  const url = new URL(`${appUrl()}/settings`);
  url.searchParams.set("tab", "billing");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

const cleanStripeId = (value: unknown) => String(value || "").trim();

type AdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; error: string; status: number };

const authenticateAdmin = async ({
  req,
  supabaseUrl,
  anonKey,
  adminClient,
}: {
  req: Request;
  supabaseUrl: string;
  anonKey: string;
  adminClient: SupabaseAdminClient;
}): Promise<AdminAuthResult> => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, error: "No authorization header", status: 401 };

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerUser) return { ok: false, error: "Unauthorized", status: 401 };

  const [{ data: roles, error: rolesError }, { data: profile, error: profileError }] = await Promise.all([
    adminClient.from("user_roles").select("role").eq("user_id", callerUser.id),
    adminClient.from("users").select("role").eq("id", callerUser.id).maybeSingle(),
  ]);
  if (rolesError) return { ok: false, error: rolesError.message, status: 500 };
  if (profileError) return { ok: false, error: profileError.message, status: 500 };

  const callerIsAdmin = isAdminRole(String(profile?.role || "")) ||
    (roles || []).some((row: any) => isAdminRole(String(row.role)));
  if (!callerIsAdmin) return { ok: false, error: "Only admins can link Stripe", status: 403 };

  return { ok: true, userId: callerUser.id };
};

const stripeFormPost = async (url: string, form: URLSearchParams, secretKey: string) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `Stripe request failed with HTTP ${response.status}`);
  }
  return body;
};

const getStatus = async (adminClient: SupabaseAdminClient, supabaseUrl: string) => {
  const { data, error } = await adminClient
    .from("stripe_connect_settings")
    .select("stripe_user_id,scope,livemode,connected_at,updated_at")
    .eq("id", true)
    .maybeSingle();

  if (error) throw error;

  const clientId = Deno.env.get("STRIPE_CONNECT_CLIENT_ID");
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  return {
    connected: Boolean(data?.stripe_user_id),
    accountId: data?.stripe_user_id || null,
    scope: data?.scope || null,
    livemode: Boolean(data?.livemode),
    connectedAt: data?.connected_at || null,
    updatedAt: data?.updated_at || null,
    configured: Boolean(clientId && secretKey),
    hasClientId: Boolean(clientId),
    hasSecretKey: Boolean(secretKey),
    callbackUrl: callbackUrl(supabaseUrl),
  };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (req.method === "GET") {
      const url = new URL(req.url);
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      if (error) {
        return redirect(settingsUrl({
          stripe_connect: "error",
          stripe_error: errorDescription || error,
        }));
      }

      if (!state || !code) {
        return redirect(settingsUrl({
          stripe_connect: "error",
          stripe_error: "Stripe did not return a valid connection code.",
        }));
      }

      const { data: oauthState, error: stateError } = await adminClient
        .from("stripe_connect_oauth_states")
        .select("id,requested_by,expires_at,used_at")
        .eq("state", state)
        .maybeSingle();

      if (stateError || !oauthState || oauthState.used_at || new Date(oauthState.expires_at).getTime() < Date.now()) {
        return redirect(settingsUrl({
          stripe_connect: "error",
          stripe_error: "The Stripe link request expired. Please try again.",
        }));
      }

      const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeSecretKey) {
        return redirect(settingsUrl({
          stripe_connect: "error",
          stripe_error: "Stripe secret key is not configured.",
        }));
      }

      const form = new URLSearchParams();
      form.set("grant_type", "authorization_code");
      form.set("code", code);

      const token = await stripeFormPost("https://connect.stripe.com/oauth/token", form, stripeSecretKey);
      const stripeUserId = cleanStripeId(token?.stripe_user_id);
      if (!/^acct_[A-Za-z0-9_]+$/.test(stripeUserId)) {
        throw new Error("Stripe did not return a connected account ID.");
      }

      const { error: upsertError } = await adminClient
        .from("stripe_connect_settings")
        .upsert({
          id: true,
          stripe_user_id: stripeUserId,
          stripe_publishable_key: cleanStripeId(token?.stripe_publishable_key) || null,
          scope: cleanStripeId(token?.scope) || null,
          livemode: Boolean(token?.livemode),
          connected_by: oauthState.requested_by || null,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });

      if (upsertError) throw upsertError;

      await adminClient
        .from("stripe_connect_oauth_states")
        .update({ used_at: new Date().toISOString() })
        .eq("id", oauthState.id);

      return redirect(settingsUrl({ stripe_connect: "success" }));
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const auth = await authenticateAdmin({ req, supabaseUrl, anonKey, adminClient });
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "status") {
      return json(await getStatus(adminClient, supabaseUrl));
    }

    if (action === "start") {
      const clientId = Deno.env.get("STRIPE_CONNECT_CLIENT_ID");
      const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!clientId || !stripeSecretKey) {
        return json({
          error: "Stripe Connect is not configured yet. Add STRIPE_CONNECT_CLIENT_ID and STRIPE_SECRET_KEY to Supabase Edge Function secrets.",
          configured: false,
          callbackUrl: callbackUrl(supabaseUrl),
        }, 503);
      }

      const state = `${crypto.randomUUID()}-${crypto.randomUUID()}`.replace(/-/g, "");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const { error: insertError } = await adminClient
        .from("stripe_connect_oauth_states")
        .insert({
          state,
          requested_by: auth.userId,
          redirect_to: `${appUrl()}/settings?tab=billing`,
          expires_at: expiresAt,
        });
      if (insertError) throw insertError;

      const authorizeUrl = new URL("https://connect.stripe.com/oauth/authorize");
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("client_id", clientId);
      authorizeUrl.searchParams.set("scope", "read_write");
      authorizeUrl.searchParams.set("redirect_uri", callbackUrl(supabaseUrl));
      authorizeUrl.searchParams.set("state", state);

      return json({ url: authorizeUrl.toString(), callbackUrl: callbackUrl(supabaseUrl) });
    }

    if (action === "disconnect") {
      const { data: existing } = await adminClient
        .from("stripe_connect_settings")
        .select("stripe_user_id")
        .eq("id", true)
        .maybeSingle();

      const clientId = Deno.env.get("STRIPE_CONNECT_CLIENT_ID");
      const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
      let deauthorized = false;

      if (existing?.stripe_user_id && clientId && stripeSecretKey) {
        try {
          const form = new URLSearchParams();
          form.set("client_id", clientId);
          form.set("stripe_user_id", existing.stripe_user_id);
          await stripeFormPost("https://connect.stripe.com/oauth/deauthorize", form, stripeSecretKey);
          deauthorized = true;
        } catch (error) {
          console.warn("Stripe deauthorize failed, disconnecting CRM record only:", error);
        }
      }

      const { error: updateError } = await adminClient
        .from("stripe_connect_settings")
        .upsert({
          id: true,
          stripe_user_id: null,
          stripe_publishable_key: null,
          scope: null,
          livemode: false,
          connected_by: null,
          connected_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
      if (updateError) throw updateError;

      return json({ disconnected: true, deauthorized });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("stripe-connect error:", error);
    return json({ error: error instanceof Error ? error.message : "Stripe connection failed" }, 500);
  }
});
