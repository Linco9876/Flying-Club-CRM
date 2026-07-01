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

const appUrl = () =>
  (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");

const callbackUrl = (supabaseUrl: string) => `${supabaseUrl.replace(/\/$/, "")}/functions/v1/xero-connect`;

const settingsUrl = (params: Record<string, string>) => {
  const url = new URL(`${appUrl()}/settings`);
  url.searchParams.set("tab", "integrations");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

const xeroScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.settings",
  "accounting.contacts",
  "accounting.invoices",
  "accounting.payments",
  "accounting.transactions",
].join(" ");

const cleanString = (value: unknown) => String(value || "").trim();

const syncPilotAccountPaymentMethod = async ({
  adminClient,
  active,
}: {
  adminClient: SupabaseAdminClient;
  active: boolean;
}) => {
  const payload = {
    name: "Pilot Account",
    description: "Uses the member's Xero overpayment balance when prepaid flying is allowed for that member.",
    active,
    allow_account_topup: false,
    display_order: 80,
    is_system: true,
    system_key: "pilot_account",
    updated_at: new Date().toISOString(),
  };

  const { data: existingRows, error: selectError } = await adminClient
    .from("payment_methods")
    .select("id")
    .eq("system_key", "pilot_account");

  if (selectError) throw selectError;

  if ((existingRows || []).length > 0) {
    const { error: updateError } = await adminClient
      .from("payment_methods")
      .update(payload)
      .eq("system_key", "pilot_account");
    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await adminClient
    .from("payment_methods")
    .insert(payload);
  if (insertError) throw insertError;
};

const randomState = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const basicAuthHeader = (clientId: string, clientSecret: string) =>
  `Basic ${btoa(`${clientId}:${clientSecret}`)}`;

const isAdminRole = (role: string) => role === "admin";

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
  if (!callerIsAdmin) return { ok: false, error: "Only admins can link Xero", status: 403 };

  return { ok: true, userId: callerUser.id };
};

const exchangeCodeForToken = async ({
  code,
  clientId,
  clientSecret,
  redirectUri,
}: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) => {
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", redirectUri);

  const response = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error_description || body?.error || `Xero token exchange failed with HTTP ${response.status}`);
  }
  return body;
};

const fetchXeroConnections = async (accessToken: string) => {
  const response = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(body?.Detail || body?.title || `Xero connections request failed with HTTP ${response.status}`);
  }
  return Array.isArray(body) ? body : [];
};

const revokeRefreshToken = async (refreshToken: string, clientId: string, clientSecret: string) => {
  const form = new URLSearchParams();
  form.set("token", refreshToken);

  const response = await fetch("https://identity.xero.com/connect/revocation", {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error_description || body?.error || `Xero token revocation failed with HTTP ${response.status}`);
  }
};

const getStatus = async (adminClient: SupabaseAdminClient, supabaseUrl: string) => {
  const [{ data: connection, error: connectionError }, { data: settings, error: settingsError }] = await Promise.all([
    adminClient
      .from("xero_connection_settings")
      .select("tenant_id,tenant_name,tenant_type,scope,expires_at,connected_at,updated_at,disconnected_at")
      .eq("id", true)
      .maybeSingle(),
    adminClient
      .from("xero_sync_settings")
      .select("create_contacts,sync_flight_charges,sync_account_topups,sync_gift_vouchers,default_sync_mode,default_invoice_status,revenue_account_code,topup_account_code,topup_receipt_account_code,voucher_account_code,tax_type,stripe_payment_account_code,prepaid_payment_account_code,stripe_fee_expense_account_code,auto_queue_flight_invoices,auto_apply_verified_payments,updated_at")
      .eq("id", true)
      .maybeSingle(),
  ]);

  if (connectionError) throw connectionError;
  if (settingsError) throw settingsError;

  const hasClientId = Boolean(Deno.env.get("XERO_CLIENT_ID"));
  const hasClientSecret = Boolean(Deno.env.get("XERO_CLIENT_SECRET"));
  const connected = Boolean(connection?.tenant_id && !connection?.disconnected_at);

  return {
    connected,
    tenantId: connection?.tenant_id || null,
    tenantName: connection?.tenant_name || null,
    tenantType: connection?.tenant_type || null,
    scope: connection?.scope || null,
    expiresAt: connection?.expires_at || null,
    connectedAt: connection?.connected_at || null,
    updatedAt: connection?.updated_at || null,
    configured: hasClientId && hasClientSecret,
    hasClientId,
    hasClientSecret,
    callbackUrl: callbackUrl(supabaseUrl),
    scopes: xeroScopes,
    syncSettings: settings || {
      create_contacts: true,
      sync_flight_charges: true,
      sync_account_topups: false,
      sync_gift_vouchers: false,
      default_sync_mode: "manual-review",
      default_invoice_status: "DRAFT",
      revenue_account_code: null,
      topup_account_code: null,
      topup_receipt_account_code: null,
      voucher_account_code: null,
      tax_type: null,
      stripe_payment_account_code: null,
      prepaid_payment_account_code: null,
      stripe_fee_expense_account_code: null,
      auto_queue_flight_invoices: true,
      auto_apply_verified_payments: false,
    },
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
          xero_connect: "error",
          xero_error: errorDescription || error,
        }));
      }

      if (!state || !code) {
        return redirect(settingsUrl({
          xero_connect: "error",
          xero_error: "Xero did not return a valid connection code.",
        }));
      }

      const { data: oauthState, error: stateError } = await adminClient
        .from("xero_oauth_states")
        .select("id,requested_by,expires_at,used_at")
        .eq("state", state)
        .maybeSingle();

      if (stateError || !oauthState || oauthState.used_at || new Date(oauthState.expires_at).getTime() < Date.now()) {
        return redirect(settingsUrl({
          xero_connect: "error",
          xero_error: "The Xero link request expired. Please try again.",
        }));
      }

      const clientId = Deno.env.get("XERO_CLIENT_ID");
      const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
      if (!clientId || !clientSecret) {
        return redirect(settingsUrl({
          xero_connect: "error",
          xero_error: "Xero client ID and secret are not configured.",
        }));
      }

      const token = await exchangeCodeForToken({
        code,
        clientId,
        clientSecret,
        redirectUri: callbackUrl(supabaseUrl),
      });
      const accessToken = cleanString(token?.access_token);
      const refreshToken = cleanString(token?.refresh_token);
      if (!accessToken || !refreshToken) {
        throw new Error("Xero did not return a usable token pair.");
      }

      const connections = await fetchXeroConnections(accessToken);
      const tenant = connections[0];
      if (!tenant?.tenantId) {
        throw new Error("Xero connected, but no organisation tenant was returned.");
      }

      const expiresInSeconds = Number(token?.expires_in || 0);
      const expiresAt = expiresInSeconds > 0
        ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
        : null;

      const { error: upsertError } = await adminClient
        .from("xero_connection_settings")
        .upsert({
          id: true,
          tenant_id: cleanString(tenant.tenantId),
          tenant_name: cleanString(tenant.tenantName),
          tenant_type: cleanString(tenant.tenantType),
          token_type: cleanString(token?.token_type),
          scope: cleanString(token?.scope),
          access_token: accessToken,
          refresh_token: refreshToken,
          id_token: cleanString(token?.id_token) || null,
          expires_at: expiresAt,
          connected_by: oauthState.requested_by || null,
          connected_at: new Date().toISOString(),
          disconnected_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });

      if (upsertError) throw upsertError;

      await Promise.all([
        adminClient
          .from("xero_oauth_states")
          .update({ used_at: new Date().toISOString() })
          .eq("id", oauthState.id),
        adminClient
          .from("xero_sync_settings")
          .upsert({ id: true, updated_at: new Date().toISOString() }, { onConflict: "id" }),
        syncPilotAccountPaymentMethod({ adminClient, active: true }),
      ]);

      return redirect(settingsUrl({ xero_connect: "success" }));
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const auth = await authenticateAdmin({ req, supabaseUrl, anonKey, adminClient });
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "status") {
      const status = await getStatus(adminClient, supabaseUrl);
      await syncPilotAccountPaymentMethod({ adminClient, active: Boolean(status.connected) });
      return json(status);
    }

    if (action === "start") {
      const clientId = Deno.env.get("XERO_CLIENT_ID");
      const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
      if (!clientId || !clientSecret) {
        return json({
          error: "Xero is not configured yet. Add XERO_CLIENT_ID and XERO_CLIENT_SECRET to Supabase Edge Function secrets.",
          configured: false,
          callbackUrl: callbackUrl(supabaseUrl),
        }, 503);
      }

      const state = randomState();
      const { error: stateInsertError } = await adminClient
        .from("xero_oauth_states")
        .insert({
          state,
          requested_by: auth.userId,
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
      if (stateInsertError) throw stateInsertError;

      const url = new URL("https://login.xero.com/identity/connect/authorize");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", callbackUrl(supabaseUrl));
      url.searchParams.set("scope", xeroScopes);
      url.searchParams.set("state", state);

      return json({ url: url.toString(), callbackUrl: callbackUrl(supabaseUrl), scopes: xeroScopes });
    }

    if (action === "save-settings") {
      const settings = body.settings || {};
      const payload = {
        id: true,
        create_contacts: Boolean((settings as any).createContacts),
        sync_flight_charges: Boolean((settings as any).syncFlightCharges),
        sync_account_topups: Boolean((settings as any).syncAccountTopups),
        sync_gift_vouchers: Boolean((settings as any).syncGiftVouchers),
        default_sync_mode: ["manual-review", "auto-draft", "auto-approved"].includes(String((settings as any).defaultSyncMode))
          ? String((settings as any).defaultSyncMode)
          : "manual-review",
        default_invoice_status: ["DRAFT", "SUBMITTED", "AUTHORISED"].includes(String((settings as any).defaultInvoiceStatus))
          ? String((settings as any).defaultInvoiceStatus)
          : "DRAFT",
        revenue_account_code: cleanString((settings as any).revenueAccountCode) || null,
        topup_account_code: cleanString((settings as any).topupAccountCode) || null,
        topup_receipt_account_code: cleanString((settings as any).topupReceiptAccountCode) || null,
        voucher_account_code: cleanString((settings as any).voucherAccountCode) || null,
        tax_type: cleanString((settings as any).taxType) || null,
        stripe_payment_account_code: cleanString((settings as any).stripePaymentAccountCode) || null,
        prepaid_payment_account_code: cleanString((settings as any).prepaidPaymentAccountCode) || null,
        stripe_fee_expense_account_code: cleanString((settings as any).stripeFeeExpenseAccountCode) || null,
        auto_queue_flight_invoices: Boolean((settings as any).autoQueueFlightInvoices),
        auto_apply_verified_payments: Boolean((settings as any).autoApplyVerifiedPayments),
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await adminClient
        .from("xero_sync_settings")
        .upsert(payload, { onConflict: "id" });
      if (upsertError) throw upsertError;

      const status = await getStatus(adminClient, supabaseUrl);
      await syncPilotAccountPaymentMethod({ adminClient, active: Boolean(status.connected) });
      return json(status);
    }

    if (action === "disconnect") {
      const { data: existing } = await adminClient
        .from("xero_connection_settings")
        .select("refresh_token")
        .eq("id", true)
        .maybeSingle();

      const clientId = Deno.env.get("XERO_CLIENT_ID");
      const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
      let revoked = false;

      if (existing?.refresh_token && clientId && clientSecret) {
        try {
          await revokeRefreshToken(existing.refresh_token, clientId, clientSecret);
          revoked = true;
        } catch (error) {
          console.warn("Xero token revocation failed, disconnecting CRM record only:", error);
        }
      }

      const { error: updateError } = await adminClient
        .from("xero_connection_settings")
        .upsert({
          id: true,
          tenant_id: null,
          tenant_name: null,
          tenant_type: null,
          token_type: null,
          scope: null,
          access_token: null,
          refresh_token: null,
          id_token: null,
          expires_at: null,
          connected_by: null,
          connected_at: null,
          disconnected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
      if (updateError) throw updateError;

      await syncPilotAccountPaymentMethod({ adminClient, active: false });

      return json({ disconnected: true, revoked });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("xero-connect error:", error);
    return json({ error: error instanceof Error ? error.message : "Xero connection failed" }, 500);
  }
});
