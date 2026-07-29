import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  authenticateAal2AdminOrWorker,
  corsHeadersForRequest,
  isAllowedBrowserOrigin,
} from "../_shared/edgeSecurity.ts";
import { decryptSecret, encryptSecret } from "../_shared/secretEncryption.ts";
import {
  getXeroConnection,
  isXeroConnected,
  storeEncryptedXeroTokens,
} from "../_shared/xeroConnection.ts";
import { organisationConfirmationPhrase } from "../_shared/xeroSafety.ts";

type SupabaseAdminClient = any;
const clean = (value: unknown) => String(value || "").trim();
const appUrl = () =>
  (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("SITE_URL") ||
    "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
const callbackUrl = (supabaseUrl: string) =>
  `${supabaseUrl.replace(/\/$/, "")}/functions/v1/xero-connect`;
const settingsUrl = (params: Record<string, string>) => {
  const url = new URL(`${appUrl()}/settings`);
  url.searchParams.set("tab", "integrations");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
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
  "accounting.banktransactions",
  "accounting.manualjournals",
].join(" ");
const randomState = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const basicAuthHeader = (clientId: string, clientSecret: string) =>
  `Basic ${btoa(`${clientId}:${clientSecret}`)}`;

const exchangeCodeForToken = async (
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
) => {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
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
    throw new Error(
      clean(body?.error_description || body?.error) ||
        `Xero token exchange failed with HTTP ${response.status}`,
    );
  }
  return body;
};

const fetchXeroConnections = async (accessToken: string) => {
  const response = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(
      clean(body?.Detail || body?.title) ||
        `Xero connections request failed with HTTP ${response.status}`,
    );
  }
  return (Array.isArray(body) ? body : []).map((tenant: any) => ({
    tenantId: clean(tenant.tenantId),
    tenantName: clean(tenant.tenantName),
    tenantType: clean(tenant.tenantType),
    createdDateUtc: clean(tenant.createdDateUtc) || null,
    updatedDateUtc: clean(tenant.updatedDateUtc) || null,
  })).filter((tenant: any) => tenant.tenantId);
};

const revokeRefreshToken = async (
  refreshToken: string,
  clientId: string,
  clientSecret: string,
) => {
  const response = await fetch("https://identity.xero.com/connect/revocation", {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token: refreshToken }),
  });
  if (!response.ok) throw new Error(`Xero token revocation failed with HTTP ${response.status}`);
};

const getStatus = async (
  adminClient: SupabaseAdminClient,
  supabaseUrl: string,
  requestedBy: string,
) => {
  const [{ data: connection, error: connectionError }, { data: settings, error: settingsError }, { data: pending }] =
    await Promise.all([
      adminClient.from("xero_connection_settings")
        .select("tenant_id,tenant_name,tenant_type,expected_tenant_id,connection_mode,posting_enabled,scope,expires_at,connected_at,updated_at,disconnected_at,last_inventory_at,last_inventory_summary")
        .eq("id", true).maybeSingle(),
      adminClient.from("xero_sync_settings").select("*").eq("id", true).maybeSingle(),
      adminClient.from("xero_pending_connections")
        .select("id,available_tenants,expires_at_confirmation,created_at")
        .eq("requested_by", requestedBy).is("confirmed_at", null).is("rejected_at", null)
        .gt("expires_at_confirmation", new Date().toISOString())
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
  if (connectionError) throw connectionError;
  if (settingsError) throw settingsError;
  return {
    connected: Boolean(connection?.tenant_id && !connection?.disconnected_at),
    tenantId: connection?.tenant_id || null,
    tenantName: connection?.tenant_name || null,
    tenantType: connection?.tenant_type || null,
    expectedTenantId: connection?.expected_tenant_id || null,
    connectionMode: connection?.connection_mode || "disconnected",
    postingEnabled: Boolean(connection?.posting_enabled),
    contained: connection?.connection_mode === "inventory_only" ||
      !connection?.posting_enabled,
    scope: connection?.scope || null,
    expiresAt: connection?.expires_at || null,
    connectedAt: connection?.connected_at || null,
    updatedAt: connection?.updated_at || null,
    lastInventoryAt: connection?.last_inventory_at || null,
    lastInventorySummary: connection?.last_inventory_summary || {},
    configured: Boolean(Deno.env.get("XERO_CLIENT_ID") && Deno.env.get("XERO_CLIENT_SECRET") &&
      Deno.env.get("XERO_TOKEN_ENCRYPTION_KEY")),
    hasClientId: Boolean(Deno.env.get("XERO_CLIENT_ID")),
    hasClientSecret: Boolean(Deno.env.get("XERO_CLIENT_SECRET")),
    hasEncryptionKey: Boolean(Deno.env.get("XERO_TOKEN_ENCRYPTION_KEY")),
    callbackUrl: callbackUrl(supabaseUrl),
    scopes: xeroScopes,
    pendingConnection: pending
      ? {
        id: pending.id,
        organisations: pending.available_tenants || [],
        expiresAt: pending.expires_at_confirmation,
      }
      : null,
    syncSettings: settings || {},
  };
};

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersForRequest(req, "GET, POST, OPTIONS");
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  const redirect = (url: string) =>
    new Response(null, { status: 302, headers: { ...corsHeaders, Location: url } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (!isAllowedBrowserOrigin(req)) return json({ error: "Origin is not allowed." }, 403);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (req.method === "GET") {
      const url = new URL(req.url);
      const oauthError = url.searchParams.get("error");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (oauthError || !state || !code) {
        return redirect(settingsUrl({
          xero_connect: "error",
          xero_error: url.searchParams.get("error_description") || oauthError ||
            "Xero did not return a valid connection code.",
        }));
      }
      const { data: oauthState, error: stateError } = await adminClient
        .from("xero_oauth_states")
        .select("id,requested_by,expires_at,used_at,requested_aal,confirmation_phrase")
        .eq("state", state).maybeSingle();
      if (
        stateError || !oauthState || oauthState.used_at ||
        oauthState.requested_aal !== "aal2" ||
        new Date(oauthState.expires_at).getTime() < Date.now()
      ) {
        return redirect(settingsUrl({
          xero_connect: "error",
          xero_error: "The MFA-protected Xero link request expired. Please try again.",
        }));
      }
      const clientId = clean(Deno.env.get("XERO_CLIENT_ID"));
      const clientSecret = clean(Deno.env.get("XERO_CLIENT_SECRET"));
      const token = await exchangeCodeForToken(
        code,
        clientId,
        clientSecret,
        callbackUrl(supabaseUrl),
      );
      const accessToken = clean(token?.access_token);
      const refreshToken = clean(token?.refresh_token);
      if (!accessToken || !refreshToken) throw new Error("Xero did not return a usable token pair.");
      const organisations = await fetchXeroConnections(accessToken);
      if (!organisations.length) throw new Error("No Xero organisations were returned.");
      const expiresIn = Number(token?.expires_in || 0);
      const expiresAt = expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null;
      const { data: pending, error: pendingError } = await adminClient
        .from("xero_pending_connections")
        .insert({
          requested_by: oauthState.requested_by,
          access_token_ciphertext: await encryptSecret(accessToken),
          refresh_token_ciphertext: await encryptSecret(refreshToken),
          id_token_ciphertext: await encryptSecret(clean(token?.id_token)),
          token_type: clean(token?.token_type) || null,
          scope: clean(token?.scope) || null,
          expires_at: expiresAt,
          available_tenants: organisations,
          requested_aal: "aal2",
        }).select("id").single();
      if (pendingError) throw pendingError;
      await adminClient.from("xero_oauth_states").update({
        used_at: new Date().toISOString(),
        pending_connection_id: pending.id,
      }).eq("id", oauthState.id);
      return redirect(settingsUrl({
        xero_connect: "select",
        xero_pending: pending.id,
      }));
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const auth = await authenticateAal2AdminOrWorker({
      req,
      supabaseUrl,
      anonKey,
      adminClient,
      allowWorker: false,
    });
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (auth.actorType !== "user") {
      return json({ error: "Administrator access is required." }, 403);
    }
    const body = await req.json().catch(() => ({}));
    const action = clean(body.action);

    if (action === "status") {
      return json(await getStatus(adminClient, supabaseUrl, auth.userId));
    }

    if (action === "start") {
      if (clean(body.confirmation) !== "CONNECT XERO") {
        return json({
          error: 'Type "CONNECT XERO" to begin. You will select the exact organisation after Xero authorisation.',
          confirmationRequired: "CONNECT XERO",
        }, 400);
      }
      if (
        !Deno.env.get("XERO_CLIENT_ID") || !Deno.env.get("XERO_CLIENT_SECRET") ||
        !Deno.env.get("XERO_TOKEN_ENCRYPTION_KEY")
      ) {
        return json({ error: "Xero credentials and token encryption are not configured." }, 503);
      }
      const state = randomState();
      const { error } = await adminClient.from("xero_oauth_states").insert({
        state,
        requested_by: auth.userId,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        requested_aal: "aal2",
        confirmation_phrase: "CONNECT XERO",
      });
      if (error) throw error;
      const url = new URL("https://login.xero.com/identity/connect/authorize");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", Deno.env.get("XERO_CLIENT_ID")!);
      url.searchParams.set("redirect_uri", callbackUrl(supabaseUrl));
      url.searchParams.set("scope", xeroScopes);
      url.searchParams.set("state", state);
      return json({ url: url.toString() });
    }

    if (action === "confirm-organisation") {
      const pendingId = clean(body.pendingConnectionId);
      const tenantId = clean(body.tenantId);
      const typedConfirmation = clean(body.confirmation);
      const { data: pending, error } = await adminClient
        .from("xero_pending_connections").select("*")
        .eq("id", pendingId).eq("requested_by", auth.userId)
        .is("confirmed_at", null).is("rejected_at", null).maybeSingle();
      if (error) throw error;
      if (!pending || new Date(pending.expires_at_confirmation).getTime() < Date.now()) {
        return json({ error: "This organisation selection has expired. Start again." }, 410);
      }
      const organisation = (pending.available_tenants || [])
        .find((item: any) => clean(item.tenantId) === tenantId);
      if (!organisation) return json({ error: "Select one of the organisations returned by Xero." }, 400);
      const required = organisationConfirmationPhrase(organisation.tenantName);
      if (typedConfirmation.toUpperCase() !== required) {
        return json({ error: `Type "${required}" to confirm the exact organisation.`, confirmationRequired: required }, 400);
      }
      const existing = await getXeroConnection(adminClient);
      if (existing?.expected_tenant_id && existing.expected_tenant_id !== tenantId) {
        return json({
          error: "This CRM is pinned to a different Xero tenant. The immutable Bendigo Flying Club tenant cannot be switched.",
        }, 409);
      }
      await storeEncryptedXeroTokens(adminClient, {
        accessToken: await decryptSecret(pending.access_token_ciphertext),
        refreshToken: await decryptSecret(pending.refresh_token_ciphertext),
        idToken: await decryptSecret(pending.id_token_ciphertext),
        tokenType: pending.token_type,
        scope: pending.scope,
        expiresAt: pending.expires_at,
      }, {
        tenant_id: tenantId,
        tenant_name: clean(organisation.tenantName),
        tenant_type: clean(organisation.tenantType),
        expected_tenant_id: existing?.expected_tenant_id || tenantId,
        connection_mode: "draft_only",
        posting_enabled: false,
        connected_by: auth.userId,
        connected_at: new Date().toISOString(),
        disconnected_at: null,
      });
      await adminClient.from("xero_pending_connections")
        .update({ confirmed_at: new Date().toISOString() }).eq("id", pending.id);
      await adminClient.from("xero_connection_audit").insert({
        event_type: "organisation_explicitly_selected",
        tenant_id: tenantId,
        tenant_name: clean(organisation.tenantName),
        actor_id: auth.userId,
        actor_type: "user",
        reason: "MFA and typed organisation confirmation completed; posting remains disabled.",
        request_id: req.headers.get("X-Request-Id") || crypto.randomUUID(),
      });
      return json(await getStatus(adminClient, supabaseUrl, auth.userId));
    }

    if (action === "save-settings") {
      const settings = body.settings || {};
      const syncAccountTopups = Boolean(settings.syncAccountTopups);
      const topupReceipt = clean(settings.topupReceiptAccountCode);
      if (syncAccountTopups && (!topupReceipt || topupReceipt.toUpperCase() === "TOPUPRCPT")) {
        return json({ error: "Select an existing active Xero bank account for top-up receipts." }, 400);
      }
      const payload = {
        id: true,
        create_contacts: Boolean(settings.createContacts),
        sync_flight_charges: false,
        sync_account_topups: false,
        sync_gift_vouchers: false,
        default_sync_mode: "manual-review",
        default_invoice_status: "DRAFT",
        revenue_account_code: clean(settings.revenueAccountCode) || null,
        topup_account_code: clean(settings.topupAccountCode) || null,
        topup_receipt_account_code: topupReceipt || null,
        voucher_account_code: clean(settings.voucherAccountCode) || null,
        tax_type: clean(settings.taxType) || null,
        stripe_payment_account_code: clean(settings.stripePaymentAccountCode) || null,
        prepaid_payment_account_code: clean(settings.prepaidPaymentAccountCode) || null,
        stripe_fee_expense_account_code: clean(settings.stripeFeeExpenseAccountCode) || null,
        auto_queue_flight_invoices: false,
        auto_apply_verified_payments: false,
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      };
      const { error } = await adminClient.from("xero_sync_settings")
        .upsert(payload, { onConflict: "id" });
      if (error) throw error;
      return json(await getStatus(adminClient, supabaseUrl, auth.userId));
    }

    if (action === "disconnect") {
      if (clean(body.confirmation) !== "DISCONNECT XERO") {
        return json({ error: 'Type "DISCONNECT XERO" to disconnect.', confirmationRequired: "DISCONNECT XERO" }, 400);
      }
      const existing = await getXeroConnection(adminClient);
      let revoked = false;
      if (isXeroConnected(existing) && existing.refresh_token) {
        try {
          await revokeRefreshToken(
            existing.refresh_token,
            clean(Deno.env.get("XERO_CLIENT_ID")),
            clean(Deno.env.get("XERO_CLIENT_SECRET")),
          );
          revoked = true;
        } catch (error) {
          console.warn("Xero revocation failed; local connection will still be contained.", error);
        }
      }
      const { error } = await adminClient.from("xero_connection_settings").update({
        tenant_id: null,
        tenant_name: null,
        tenant_type: null,
        access_token: null,
        refresh_token: null,
        id_token: null,
        access_token_ciphertext: null,
        refresh_token_ciphertext: null,
        id_token_ciphertext: null,
        expires_at: null,
        connection_mode: "disconnected",
        posting_enabled: false,
        disconnected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", true);
      if (error) throw error;
      return json({ disconnected: true, revoked });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("xero-connect error:", error);
    return json({ error: error instanceof Error ? error.message : "Xero connection failed" }, 500);
  }
});
