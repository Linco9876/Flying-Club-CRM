import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type SupabaseAdminClient = any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const clean = (value: unknown) => String(value || "").trim();
const money = (value: unknown) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const basicAuthHeader = (clientId: string, clientSecret: string) =>
  `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
const MINIMUM_PREPAID_PACK = 1000;

const isStaffRole = (role: string) => ["admin", "senior_instructor", "instructor"].includes(role);

const xeroRequest = async ({
  method = "GET",
  path,
  tenantId,
  accessToken,
  body,
}: {
  method?: string;
  path: string;
  tenantId: string;
  accessToken: string;
  body?: Record<string, unknown>;
}) => {
  const response = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload?.Message || payload?.Title || payload?.Detail || `Xero request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
};

const refreshAccessToken = async (adminClient: SupabaseAdminClient, connection: any) => {
  const clientId = Deno.env.get("XERO_CLIENT_ID");
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Xero client ID and secret are not configured.");
  if (!connection?.refresh_token) throw new Error("Xero is not connected.");

  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (connection.access_token && expiresAt - Date.now() > 120_000) {
    return connection;
  }

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", connection.refresh_token);

  const response = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(token?.error_description || token?.error || `Xero token refresh failed with HTTP ${response.status}`);
  }

  const expiresInSeconds = Number(token?.expires_in || 0);
  const expires_at = expiresInSeconds > 0
    ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    : null;

  const update = {
    access_token: clean(token.access_token),
    refresh_token: clean(token.refresh_token) || connection.refresh_token,
    token_type: clean(token.token_type) || connection.token_type,
    scope: clean(token.scope) || connection.scope,
    expires_at,
    updated_at: new Date().toISOString(),
  };
  const { error } = await adminClient.from("xero_connection_settings").update(update).eq("id", true);
  if (error) throw error;
  return { ...connection, ...update };
};

const getCaller = async ({
  req,
  supabaseUrl,
  anonKey,
  adminClient,
}: {
  req: Request;
  supabaseUrl: string;
  anonKey: string;
  adminClient: SupabaseAdminClient;
}) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false as const, error: "No authorization header", status: 401 };

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await callerClient.auth.getUser();
  if (error || !user) return { ok: false as const, error: "Unauthorized", status: 401 };

  const [{ data: roles }, { data: profile, error: profileError }] = await Promise.all([
    adminClient.from("user_roles").select("role").eq("user_id", user.id),
    adminClient.from("users").select("role").eq("id", user.id).maybeSingle(),
  ]);
  if (profileError) return { ok: false as const, error: profileError.message, status: 500 };

  const roleList = Array.from(new Set([
    clean(profile?.role),
    ...((roles || []).map((row: any) => clean(row.role))),
  ].filter(Boolean)));

  return {
    ok: true as const,
    userId: user.id,
    roles: roleList,
    isStaff: roleList.some(isStaffRole),
  };
};

const getXeroContext = async (adminClient: SupabaseAdminClient) => {
  const { data: connection, error } = await adminClient
    .from("xero_connection_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;

  const connected = Boolean(connection?.tenant_id && !connection?.disconnected_at);
  if (!connected) {
    return { connected: false as const };
  }

  return {
    connected: true as const,
    connection: await refreshAccessToken(adminClient, connection),
  };
};

const getRemainingCreditAmount = (item: any) => {
  const remainingCredit = item?.RemainingCredit ?? item?.RemainingCreditAmount ?? item?.RemainingAmount;
  if (remainingCredit === undefined || remainingCredit === null || remainingCredit === "") return 0;
  return Math.max(0, money(remainingCredit));
};

const normaliseCredits = (items: any[], contactId: string) =>
  (items || []).reduce((sum: number, item: any) => {
    const itemContactId = clean(item?.Contact?.ContactID || item?.ContactID);
    if (!itemContactId || itemContactId !== contactId) return sum;
    const status = clean(item?.Status).toUpperCase();
    if (["VOIDED", "DELETED", "CANCELLED"].includes(status)) return sum;
    return sum + getRemainingCreditAmount(item);
  }, 0);

const fetchContactCredit = async (ctx: any, contactId: string) => {
  if (!ctx.connected) {
    return {
      overpaymentCredit: 0,
      prepaymentCredit: 0,
      availableCredit: 0,
      eligibleForPrepaid: false,
    };
  }

  const [overpaymentResult, prepaymentResult] = await Promise.all([
    xeroRequest({
      path: "Overpayments",
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
    }),
    xeroRequest({
      path: "Prepayments",
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
    }),
  ]);

  const overpaymentCredit = money(normaliseCredits(overpaymentResult?.Overpayments || [], contactId));
  const prepaymentCredit = money(normaliseCredits(prepaymentResult?.Prepayments || [], contactId));
  const availableCredit = money(overpaymentCredit + prepaymentCredit);

  return {
    overpaymentCredit,
    prepaymentCredit,
    availableCredit,
    eligibleForPrepaid: overpaymentCredit + 0.005 >= MINIMUM_PREPAID_PACK,
  };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const caller = await getCaller({ req, supabaseUrl, anonKey, adminClient });
    if (!caller.ok) return json({ error: caller.error }, caller.status);

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action || "self").toLowerCase();
    const ctx = await getXeroContext(adminClient);

    if (!ctx.connected) {
      return json({
        connected: false,
        minimumPrepaidPack: MINIMUM_PREPAID_PACK,
        eligibleForPrepaid: false,
      });
    }

    if (action === "all") {
      if (!caller.isStaff) return json({ error: "Only staff can view all member balances" }, 403);

      const { data: members, error } = await adminClient
        .from("users")
        .select("id,name,email,xero_contact_id")
        .not("xero_contact_id", "is", null)
        .order("name");
      if (error) throw error;

      const balances = await Promise.all((members || []).map(async (member: any) => {
        const contactId = clean(member.xero_contact_id);
        const credit = contactId ? await fetchContactCredit(ctx, contactId) : {
          overpaymentCredit: 0,
          prepaymentCredit: 0,
          availableCredit: 0,
          eligibleForPrepaid: false,
        };
        return {
          userId: member.id,
          name: clean(member.name),
          email: clean(member.email),
          xeroContactId: contactId || null,
          linked: Boolean(contactId),
          minimumPrepaidPack: MINIMUM_PREPAID_PACK,
          ...credit,
        };
      }));

      return json({
        connected: true,
        minimumPrepaidPack: MINIMUM_PREPAID_PACK,
        balances,
      });
    }

    const requestedUserId = clean(body.userId) || caller.userId;
    if (requestedUserId !== caller.userId && !caller.isStaff) {
      return json({ error: "Not authorised to view another member's Xero balance" }, 403);
    }

    const { data: member, error } = await adminClient
      .from("users")
      .select("id,name,email,xero_contact_id")
      .eq("id", requestedUserId)
      .maybeSingle();
    if (error) throw error;
    if (!member) return json({ error: "Member not found" }, 404);

    const contactId = clean(member.xero_contact_id);
    const credit = contactId ? await fetchContactCredit(ctx, contactId) : {
      overpaymentCredit: 0,
      prepaymentCredit: 0,
      availableCredit: 0,
      eligibleForPrepaid: false,
    };

    return json({
      connected: true,
      userId: member.id,
      name: clean(member.name),
      email: clean(member.email),
      xeroContactId: contactId || null,
      linked: Boolean(contactId),
      minimumPrepaidPack: MINIMUM_PREPAID_PACK,
      ...credit,
    });
  } catch (error) {
    console.error("member-xero-balance error", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
