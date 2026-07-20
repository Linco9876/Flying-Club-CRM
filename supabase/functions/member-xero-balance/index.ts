import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getConnectedStripeAccountId, stripeHeaders, stripeIdempotencyKey } from "../_shared/stripeConnectAccount.ts";
import { addStripeModeMetadata, getActiveStripeMode, stripeModeColumns } from "../_shared/stripeMode.ts";

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const parseRetryAfterMs = (value: string | null) => {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
};
const MINIMUM_PREPAID_PACK = 1000;
const siteOrigin = () => (Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
const isDevelopmentOrigin = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin) ||
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(?::\d+)?$/i.test(origin);
const isAllowedReturnOrigin = (origin: string) => origin === siteOrigin() || isDevelopmentOrigin(origin);
const safeReturnUrl = (value: unknown, fallbackPath: string) => {
  const fallback = `${siteOrigin()}${fallbackPath}`;
  const raw = clean(value);
  if (!raw) return fallback;
  try {
    const url = new URL(raw, siteOrigin());
    if (!isAllowedReturnOrigin(url.origin)) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
};
const dollarsToCents = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
};

const isStaffRole = (role: string) => ["admin", "senior_instructor", "instructor"].includes(role);
const XERO_READ_CACHE_MS = 90_000;
const xeroReadCache = new Map<string, { expiresAt: number; promise: Promise<any> }>();

const cachedXeroRead = async <T>(key: string, loader: () => Promise<T>, ttlMs = XERO_READ_CACHE_MS, forceRefresh = false) => {
  const now = Date.now();
  const cached = xeroReadCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > now) return cached.promise as Promise<T>;

  const promise = loader().catch((error) => {
    xeroReadCache.delete(key);
    throw error;
  });
  xeroReadCache.set(key, { expiresAt: now + ttlMs, promise });
  return promise;
};

const clearContactReadCache = (contactId: string) => {
  const marker = `:${contactId}:`;
  for (const key of Array.from(xeroReadCache.keys())) {
    if (key.includes(marker)) xeroReadCache.delete(key);
  }
};

let xeroRateLimitAdminClient: SupabaseAdminClient | null = null;
const xeroMaxCallsPerMinute = Math.max(1, Number(Deno.env.get("XERO_RATE_LIMIT_PER_MINUTE") || 40));
const xeroMaxCallsPerDay = Math.max(1, Number(Deno.env.get("XERO_RATE_LIMIT_PER_DAY") || 4500));
const xeroSpacingMs = Math.max(0, Number(Deno.env.get("XERO_RATE_LIMIT_SPACING_MS") || 1300));
const xeroMaxWaitMs = Math.max(1000, Number(Deno.env.get("XERO_RATE_LIMIT_MAX_WAIT_MS") || 30_000));

const waitForXeroApiSlot = async (options: { bypassLocalPause?: boolean } = {}) => {
  if (options.bypassLocalPause) return;
  if (!xeroRateLimitAdminClient) return;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const { data, error } = await xeroRateLimitAdminClient.rpc("claim_xero_api_slot", {
      max_calls_per_minute: xeroMaxCallsPerMinute,
      max_calls_per_day: xeroMaxCallsPerDay,
      spacing_ms: xeroSpacingMs,
    });

    if (error) {
      console.warn("Xero rate-limit guard unavailable:", error.message);
      return;
    }

    if (data?.granted) return;

    const waitMs = Math.max(250, Number(data?.waitMs || xeroSpacingMs || 1000));
    if (waitMs > xeroMaxWaitMs) {
      const retryAfterSeconds = Math.ceil(waitMs / 1000);
      throw Object.assign(
        new Error(`Xero is busy. The CRM is pausing Xero calls and will retry in about ${retryAfterSeconds} seconds.`),
        { status: 429, retryAfterSeconds },
      );
    }

    await sleep(waitMs);
  }
};

const noteXeroRateLimit = async (retryAfterSeconds: number | null) => {
  if (!xeroRateLimitAdminClient) return;
  const { error } = await xeroRateLimitAdminClient.rpc("note_xero_rate_limit", {
    retry_after_seconds: retryAfterSeconds,
  });
  if (error) console.warn("Failed to record Xero rate-limit pause:", error.message);
};

const xeroRequest = async ({
  method = "GET",
  path,
  tenantId,
  accessToken,
  body,
  bypassLocalPause = false,
}: {
  method?: string;
  path: string;
  tenantId: string;
  accessToken: string;
  body?: Record<string, unknown>;
  bypassLocalPause?: boolean;
}) => {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForXeroApiSlot({ bypassLocalPause });

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
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      if (attempt < maxAttempts && retryAfterMs > 0 && retryAfterMs <= 15_000) {
        await noteXeroRateLimit(Math.ceil(retryAfterMs / 1000));
        await sleep(retryAfterMs + 250);
        continue;
      }
      const seconds = retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : null;
      await noteXeroRateLimit(seconds);
      throw Object.assign(
        new Error(seconds
          ? `Xero is rate limiting the CRM. Please wait about ${seconds} seconds and try again.`
          : "Xero is rate limiting the CRM. Please wait a few minutes and try again."),
        { status: 429, retryAfterSeconds: seconds },
      );
    }
    if (!response.ok) {
      const message = payload?.Message || payload?.Title || payload?.Detail || `Xero request failed with HTTP ${response.status}`;
      throw Object.assign(new Error(message), { status: response.status });
    }
    return payload;
  }
  throw new Error("Xero request failed after retrying.");
};

const xeroPdfRequest = async ({
  path,
  tenantId,
  accessToken,
}: {
  path: string;
  tenantId: string;
  accessToken: string;
}) => {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForXeroApiSlot();

    const response = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/pdf",
      },
    });

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      if (attempt < maxAttempts && retryAfterMs > 0 && retryAfterMs <= 15_000) {
        await noteXeroRateLimit(Math.ceil(retryAfterMs / 1000));
        await sleep(retryAfterMs + 250);
        continue;
      }
      const seconds = retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : null;
      await noteXeroRateLimit(seconds);
      throw Object.assign(
        new Error(seconds
          ? `Xero is rate limiting the CRM. Please wait about ${seconds} seconds and try again.`
          : "Xero is rate limiting the CRM. Please wait a few minutes and try again."),
        { status: 429, retryAfterSeconds: seconds },
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let payload: any = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = {};
      }
      const message = payload?.Message || payload?.Title || payload?.Detail || `Xero PDF request failed with HTTP ${response.status}`;
      throw Object.assign(new Error(message), { status: response.status });
    }

    return await response.arrayBuffer();
  }
  throw new Error("Xero PDF request failed after retrying.");
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
    const tokenError = clean(token?.error_description || token?.error);
    if (response.status === 401 || response.status === 403 || tokenError.toLowerCase().includes("unauthorized") || tokenError.toLowerCase().includes("invalid_grant")) {
      throw new Error("Xero is no longer authorised. Reconnect Xero in Settings > Integrations, then refresh this page.");
    }
    throw new Error(tokenError || `Xero token refresh failed with HTTP ${response.status}`);
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
  const [{ data: connection, error }, { data: settings, error: settingsError }] = await Promise.all([
    adminClient
      .from("xero_connection_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle(),
    adminClient
      .from("xero_sync_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle(),
  ]);
  if (error) throw error;
  if (settingsError) throw settingsError;

  const connected = Boolean(connection?.tenant_id && !connection?.disconnected_at);
  if (!connected) {
    return { connected: false as const };
  }

  return {
    connected: true as const,
    connection: await refreshAccessToken(adminClient, connection),
    settings: settings || {},
  };
};

const getRemainingCreditAmount = (item: any) => {
  const remainingCredit = item?.RemainingCredit ?? item?.RemainingCreditAmount ?? item?.RemainingAmount;
  if (remainingCredit === undefined || remainingCredit === null || remainingCredit === "") return 0;
  return Math.max(0, money(remainingCredit));
};

const getCreditId = (item: any, kind: "overpayment" | "prepayment") =>
  clean(kind === "overpayment" ? item?.OverpaymentID : item?.PrepaymentID);

const normaliseCredits = (items: any[], contactId: string) =>
  (items || []).reduce((sum: number, item: any) => {
    const itemContactId = clean(item?.Contact?.ContactID || item?.ContactID);
    if (!itemContactId || itemContactId !== contactId) return sum;
    const status = clean(item?.Status).toUpperCase();
    if (["VOIDED", "DELETED", "CANCELLED"].includes(status)) return sum;
    return sum + getRemainingCreditAmount(item);
  }, 0);

const normaliseCreditItems = (items: any[], contactId: string, kind: "overpayment" | "prepayment") =>
  (items || [])
    .map((item: any) => {
      const itemContactId = clean(item?.Contact?.ContactID || item?.ContactID);
      const status = clean(item?.Status).toUpperCase();
      const amount = getRemainingCreditAmount(item);
      return {
        id: getCreditId(item, kind),
        kind,
        status,
        amount,
        contactId: itemContactId,
      };
    })
    .filter((item) =>
      item.id &&
      item.contactId === contactId &&
      item.amount > 0.005 &&
      !["VOIDED", "DELETED", "CANCELLED"].includes(item.status)
    );

const fetchContactCreditItems = async (ctx: any, contactId: string) => {
  const where = encodeURIComponent(`Contact.ContactID==Guid("${xeroStringLiteral(contactId)}")`);
  const [overpaymentResult, prepaymentResult] = await Promise.all([
    xeroRequest({
      path: `Overpayments?where=${where}`,
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
      bypassLocalPause: Boolean(ctx.priorityRefresh),
    }),
    xeroRequest({
      path: `Prepayments?where=${where}`,
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
      bypassLocalPause: Boolean(ctx.priorityRefresh),
    }),
  ]);

  return [
    ...normaliseCreditItems(overpaymentResult?.Overpayments || [], contactId, "overpayment"),
    ...normaliseCreditItems(prepaymentResult?.Prepayments || [], contactId, "prepayment"),
  ];
};

const fetchContactCredit = async (ctx: any, contactId: string) => {
  if (!ctx.connected) {
    return {
      overpaymentCredit: 0,
      prepaymentCredit: 0,
      availableCredit: 0,
      eligibleForPrepaid: false,
    };
  }

  const where = encodeURIComponent(`Contact.ContactID==Guid("${xeroStringLiteral(contactId)}")`);
  const cacheKey = `credit:${contactId}:${ctx.connection.tenant_id}`;
  const [overpaymentResult, prepaymentResult] = await cachedXeroRead(cacheKey, () => Promise.all([
      xeroRequest({
        path: `Overpayments?where=${where}`,
        tenantId: ctx.connection.tenant_id,
        accessToken: ctx.connection.access_token,
        bypassLocalPause: Boolean(ctx.priorityRefresh),
      }),
      xeroRequest({
        path: `Prepayments?where=${where}`,
        tenantId: ctx.connection.tenant_id,
        accessToken: ctx.connection.access_token,
        bypassLocalPause: Boolean(ctx.priorityRefresh),
      }),
    ]),
    XERO_READ_CACHE_MS,
    Boolean(ctx.priorityRefresh),
  );

  const overpaymentCredit = money(normaliseCredits(overpaymentResult?.Overpayments || [], contactId));
  const prepaymentCredit = money(normaliseCredits(prepaymentResult?.Prepayments || [], contactId));
  const availableCredit = money(overpaymentCredit + prepaymentCredit);

  return {
    overpaymentCredit,
    prepaymentCredit,
    availableCredit,
    eligibleForPrepaid: availableCredit > 0.005,
  };
};

const xeroStringLiteral = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const getInvoiceUrl = async (ctx: any, invoiceId: string) => {
  try {
    const result = await xeroRequest({
      path: `Invoices/${encodeURIComponent(invoiceId)}/OnlineInvoice`,
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
    });
    const onlineInvoice = Array.isArray(result?.OnlineInvoices) ? result.OnlineInvoices[0] : result?.OnlineInvoice;
    return clean(onlineInvoice?.OnlineInvoiceUrl || onlineInvoice?.Url);
  } catch (error) {
    console.warn("Unable to fetch Xero online invoice URL:", error);
    return "";
  }
};

const mapInvoice = async (ctx: any, invoice: any) => {
  const invoiceId = clean(invoice?.InvoiceID);
  const amountDue = money(invoice?.AmountDue);
  return {
    invoiceId,
    invoiceNumber: clean(invoice?.InvoiceNumber),
    reference: clean(invoice?.Reference),
    status: clean(invoice?.Status),
    date: clean(invoice?.DateString || invoice?.Date),
    dueDate: clean(invoice?.DueDateString || invoice?.DueDate),
    currency: clean(invoice?.CurrencyCode) || "AUD",
    total: money(invoice?.Total),
    amountPaid: money(invoice?.AmountPaid),
    amountCredited: money(invoice?.AmountCredited),
    amountDue,
    url: "",
  };
};

const listContactInvoices = async (ctx: any, contactId: string) => {
  const cacheKey = `invoices:${contactId}:${ctx.connection.tenant_id}`;
  const result = await cachedXeroRead(cacheKey, () => xeroRequest({
      path: `Invoices?ContactIDs=${encodeURIComponent(contactId)}&order=Date%20DESC`,
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
      bypassLocalPause: Boolean(ctx.priorityRefresh),
    }),
    XERO_READ_CACHE_MS,
    Boolean(ctx.priorityRefresh),
  );
  const invoices = Array.isArray(result?.Invoices) ? result.Invoices : [];
  return Promise.all(invoices.map((invoice: any) => mapInvoice(ctx, invoice)));
};

const syncMembershipPeriodsFromInvoices = async (adminClient: any, userId: string, invoices: any[]) => {
  const { data: membership } = await adminClient
    .from("club_memberships")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership?.id) return;
  const { data: periods } = await adminClient
    .from("membership_financial_periods")
    .select("id,xero_invoice_id,fee_disposition")
    .eq("membership_id", membership.id)
    .not("xero_invoice_id", "is", null);
  const invoiceMap = new Map((invoices || []).map(invoice => [clean(invoice.invoiceId), invoice]));
  for (const period of periods || []) {
    const invoice = invoiceMap.get(clean(period.xero_invoice_id));
    if (!invoice) continue;
    const status = clean(invoice.status).toUpperCase();
    const amountDue = money(invoice.amountDue);
    const paid = status === "PAID" || amountDue <= 0.005;
    await adminClient.from("membership_financial_periods").update({
      xero_invoice_number: clean(invoice.invoiceNumber) || null,
      xero_invoice_status: status || null,
      xero_amount_due: amountDue,
      xero_last_synced_at: new Date().toISOString(),
      xero_sync_error: null,
      fee_disposition: paid ? "paid" : (period.fee_disposition === "overdue" ? "overdue" : "invoiced"),
      financially_cleared_at: paid ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", period.id);
  }
};

const getOutstandingInvoiceTotal = (invoices: Array<{ amountDue?: number }>) =>
  money((invoices || []).reduce((total, invoice) => total + Math.max(0, Number(invoice.amountDue || 0)), 0));

const getContactInvoice = async (ctx: any, invoiceId: string, contactId: string) => {
  const result = await xeroRequest({
    path: `Invoices/${encodeURIComponent(invoiceId)}`,
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
  });
  const invoice = Array.isArray(result?.Invoices) ? result.Invoices[0] : null;
  if (!invoice) throw new Error("Xero invoice not found.");
  const invoiceContactId = clean(invoice?.Contact?.ContactID || invoice?.ContactID);
  if (invoiceContactId !== contactId) {
    throw Object.assign(new Error("This invoice does not belong to your linked Xero contact."), { status: 403 });
  }
  return invoice;
};

const getInvoiceById = async (ctx: any, invoiceId: string) => {
  const result = await xeroRequest({
    path: `Invoices/${encodeURIComponent(invoiceId)}`,
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
  });
  const invoice = Array.isArray(result?.Invoices) ? result.Invoices[0] : null;
  if (!invoice) throw new Error("Xero invoice not found.");
  return invoice;
};

const allocateCreditToInvoice = async (ctx: any, invoiceId: string, credit: any, amount: number) => {
  const path = credit.kind === "overpayment"
    ? `Overpayments/${encodeURIComponent(credit.id)}/Allocations`
    : `Prepayments/${encodeURIComponent(credit.id)}/Allocations`;
  const result = await xeroRequest({
    method: "PUT",
    path,
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Allocations: [{
        Invoice: { InvoiceID: invoiceId },
        Amount: amount,
        Date: new Date().toISOString().slice(0, 10),
      }],
    },
  });
  return Array.isArray(result?.Allocations) ? result.Allocations[0] : null;
};

const applyAvailableCreditToInvoice = async (ctx: any, invoiceId: string, contactId: string, amountDue: number) => {
  let remaining = money(amountDue);
  let applied = 0;
  const allocations: Array<Record<string, unknown>> = [];
  if (remaining <= 0) return { applied, allocations, remaining: 0 };

  const credits = await fetchContactCreditItems(ctx, contactId);
  for (const credit of credits) {
    if (remaining <= 0.005) break;
    const amount = Math.min(remaining, money(credit.amount));
    if (amount <= 0) continue;
    const allocation = await allocateCreditToInvoice(ctx, invoiceId, credit, amount);
    allocations.push({
      creditId: credit.id,
      kind: credit.kind,
      amount,
      allocationId: clean(allocation?.AllocationID),
    });
    applied = money(applied + amount);
    remaining = money(remaining - amount);
  }

  return { applied, allocations, remaining };
};

const recordFlightPaymentTransaction = async ({
  adminClient,
  flightLog,
  amount,
  paymentMethodId,
  description,
  reference,
  invoiceId,
  xeroPaymentId,
  stripeMode,
}: {
  adminClient: SupabaseAdminClient;
  flightLog: any;
  amount: number;
  paymentMethodId: string | null;
  description: string;
  reference: string;
  invoiceId: string;
  xeroPaymentId: string;
  stripeMode: "test" | "live";
}) => {
  if (money(amount) <= 0 || !reference) return;
  const { data: existing, error: existingError } = await adminClient
    .from("account_transactions")
    .select("id")
    .eq("flight_log_id", flightLog.id)
    .eq("type", "flight_charge")
    .ilike("description", `%${reference}%`)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return;

  const { error } = await adminClient.from("account_transactions").insert({
    user_id: flightLog.student_id,
    type: "flight_charge",
    amount: money(amount),
    description,
    flight_log_id: flightLog.id,
    payment_method_id: paymentMethodId,
    balance_after: null,
    verified_status: "verified",
    xero_invoice_id: invoiceId,
    xero_payment_id: xeroPaymentId,
    xero_synced_at: new Date().toISOString(),
    xero_sync_status: "synced",
    xero_sync_error: null,
    ...stripeModeColumns(stripeMode),
  });
  if (error) throw error;
};

const syncFlightLogInvoicePaymentState = async ({
  adminClient,
  invoiceId,
  invoicePaid,
  creditApplied = 0,
  allocations = [],
  stripeAmount = 0,
  stripePaymentIntentId = "",
  xeroPaymentId = "",
  stripeMode,
}: {
  adminClient: SupabaseAdminClient;
  invoiceId: string;
  invoicePaid: boolean;
  creditApplied?: number;
  allocations?: Array<{ creditId?: string; allocationId?: string }>;
  stripeAmount?: number;
  stripePaymentIntentId?: string;
  xeroPaymentId?: string;
  stripeMode: "test" | "live";
}) => {
  const { data: flightLog, error: flightError } = await adminClient
    .from("flight_logs")
    .select("id,student_id,start_time,payment_status")
    .eq("xero_invoice_id", invoiceId)
    .maybeSingle();
  if (flightError) throw flightError;
  if (!flightLog) return;

  const [{ data: pilotAccountMethod, error: pilotMethodError }, { data: stripeMethod, error: stripeMethodError }] =
    await Promise.all([
      adminClient.from("payment_methods").select("id").eq("system_key", "pilot_account").maybeSingle(),
      adminClient.from("payment_methods").select("id").eq("system_key", "stripe_card").maybeSingle(),
    ]);
  if (pilotMethodError) throw pilotMethodError;
  if (stripeMethodError) throw stripeMethodError;

  const allocationReference = allocations
    .map((allocation) => clean(allocation.allocationId || allocation.creditId))
    .filter(Boolean)
    .join(",") || `invoice-credit:${invoiceId}`;
  if (money(creditApplied) > 0) {
    await recordFlightPaymentTransaction({
      adminClient,
      flightLog,
      amount: creditApplied,
      paymentMethodId: pilotAccountMethod?.id || null,
      description: `Xero credit allocation (${allocationReference}) for invoice ${invoiceId}`,
      reference: allocationReference,
      invoiceId,
      xeroPaymentId: `credit-allocation:${allocationReference}`,
      stripeMode,
    });
  }

  if (money(stripeAmount) > 0 && stripePaymentIntentId) {
    await recordFlightPaymentTransaction({
      adminClient,
      flightLog,
      amount: stripeAmount,
      paymentMethodId: stripeMethod?.id || null,
      description: `Stripe saved-card invoice payment (${stripePaymentIntentId}) for invoice ${invoiceId}`,
      reference: stripePaymentIntentId,
      invoiceId,
      xeroPaymentId,
      stripeMode,
    });
  }

  const now = new Date().toISOString();
  const paymentType = money(stripeAmount) > 0
    ? (money(creditApplied) > 0 ? "Split Payment" : "Stripe Card Payment")
    : "Pilot Account";
  const creditPaymentReference = allocations
    .map((allocation) => clean(allocation.allocationId || allocation.creditId))
    .filter(Boolean)
    .join(",");
  const update: Record<string, unknown> = {
    payment_status: invoicePaid ? "paid" : "pending",
    payment_type: paymentType,
    xero_payment_id: clean(xeroPaymentId) || (creditPaymentReference ? `credit-allocation:${creditPaymentReference}` : null),
    updated_at: now,
    ...stripeModeColumns(stripeMode),
  };
  if (stripePaymentIntentId) {
    update.stripe_payment_intent_id = stripePaymentIntentId;
    update.stripe_payment_status = "succeeded";
    update.stripe_paid_at = invoicePaid ? now : null;
    update.stripe_payment_error = null;
  }

  const { error: updateError } = await adminClient.from("flight_logs").update(update).eq("id", flightLog.id);
  if (updateError) throw updateError;
};

const createInvoicePaymentCheckout = async ({
  adminClient,
  ctx,
  member,
  invoice,
  amount,
  successUrl,
  cancelUrl,
}: {
  adminClient: SupabaseAdminClient;
  ctx: any;
  member: any;
  invoice: any;
  amount: number;
  successUrl: string;
  cancelUrl: string;
}) => {
  const stripeMode = await getActiveStripeMode(adminClient);
  const stripeSecretKey = stripeMode.secretKey;

  const connectedAccountId = await getConnectedStripeAccountId(adminClient);
  if (!connectedAccountId) throw new Error("Stripe is not connected for this club.");

  const { data: stripeMethod, error: methodError } = await adminClient
    .from("payment_methods")
    .select("id,name,active,system_key")
    .eq("system_key", "stripe_card")
    .maybeSingle();
  if (methodError) throw methodError;
  if (!stripeMethod?.active) {
    throw new Error("Activate Stripe Card Payment in Billing & Rates before taking invoice payments.");
  }

  const invoiceId = clean(invoice?.InvoiceID);
  const invoiceNumber = clean(invoice?.InvoiceNumber);
  const amountCents = dollarsToCents(amount);
  if (!amountCents || amountCents <= 0) throw new Error("Invoice payment amount must be greater than $0.");

  const { data: paymentRecord, error: recordError } = await adminClient
    .from("xero_invoice_portal_payments")
    .insert({
      user_id: member.id,
      xero_contact_id: clean(member.xero_contact_id),
      xero_invoice_id: invoiceId,
      xero_invoice_number: invoiceNumber || null,
      amount,
      currency: clean(invoice?.CurrencyCode) || "AUD",
      status: "pending",
      ...stripeModeColumns(stripeMode.mode),
    })
    .select("id")
    .single();
  if (recordError) throw recordError;

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][price_data][currency]", (clean(invoice?.CurrencyCode) || "AUD").toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(amountCents));
  form.set("line_items[0][price_data][product_data][name]", invoiceNumber ? `Xero invoice ${invoiceNumber}` : "Xero invoice payment");
  form.set("line_items[0][price_data][product_data][description]", `Bendigo Flying Club invoice payment`);
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", cancelUrl);
  form.set("client_reference_id", paymentRecord.id);
  if (clean(member.email)) form.set("customer_email", clean(member.email));
  form.set("metadata[crm_payment_type]", "xero_invoice_payment");
  addStripeModeMetadata(form, stripeMode.mode);
  form.set("metadata[payment_record_id]", paymentRecord.id);
  form.set("metadata[user_id]", member.id);
  form.set("metadata[xero_contact_id]", clean(member.xero_contact_id));
  form.set("metadata[xero_invoice_id]", invoiceId);
  form.set("metadata[xero_invoice_number]", invoiceNumber);
  form.set("metadata[payment_method_id]", stripeMethod.id);

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": stripeIdempotencyKey("xero-invoice-checkout", paymentRecord.id, invoiceId, amountCents),
    }),
    body: form,
  });

  const session = await stripeResponse.json();
  if (!stripeResponse.ok) {
    await adminClient.from("xero_invoice_portal_payments").update({
      status: "failed",
      error: session?.error?.message || "Stripe checkout could not be created.",
      updated_at: new Date().toISOString(),
    }).eq("id", paymentRecord.id);
    throw new Error(session?.error?.message || "Stripe checkout could not be created.");
  }

  await adminClient.from("xero_invoice_portal_payments").update({
    stripe_checkout_session_id: session.id,
    updated_at: new Date().toISOString(),
    ...stripeModeColumns(stripeMode.mode),
  }).eq("id", paymentRecord.id);

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    paymentRecordId: paymentRecord.id,
  };
};

const createXeroInvoicePayment = async ({
  ctx,
  invoiceId,
  amount,
  reference,
}: {
  ctx: any;
  invoiceId: string;
  amount: number;
  reference: string;
}) => {
  const accountCode = clean(ctx.settings?.stripe_payment_account_code);
  if (!accountCode) throw new Error("Set the Xero Stripe clearing account before taking invoice payments.");

  const paymentResult = await xeroRequest({
    method: "POST",
    path: "Payments",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Payments: [{
        Invoice: { InvoiceID: invoiceId },
        Account: { Code: accountCode },
        Date: new Date().toISOString().slice(0, 10),
        Amount: money(amount),
        Reference: reference,
      }],
    },
  });
  const xeroPayment = paymentResult?.Payments?.[0];
  const xeroPaymentId = clean(xeroPayment?.PaymentID);
  if (!xeroPaymentId) throw new Error("Xero did not return a payment ID.");
  return xeroPaymentId;
};

const createInvoiceSavedCardPayment = async ({
  adminClient,
  ctx,
  member,
  invoice,
  amount,
}: {
  adminClient: SupabaseAdminClient;
  ctx: any;
  member: any;
  invoice: any;
  amount: number;
}) => {
  const stripeMode = await getActiveStripeMode(adminClient);
  const stripeSecretKey = stripeMode.secretKey;

  const connectedAccountId = await getConnectedStripeAccountId(adminClient);
  if (!connectedAccountId) throw new Error("Stripe is not connected for this club.");

  const { data: stripeMethod, error: methodError } = await adminClient
    .from("payment_methods")
    .select("id,name,active,system_key")
    .eq("system_key", "stripe_card")
    .maybeSingle();
  if (methodError) throw methodError;
  if (!stripeMethod?.active) {
    throw new Error("Activate Stripe Card Payment in Billing & Rates before taking invoice payments.");
  }

  const { data: savedCard, error: cardError } = await adminClient
    .from("member_stripe_payment_methods")
    .select("id,stripe_customer_id,stripe_payment_method_id,card_brand,card_last4,active,is_default,consent_accepted_at,stripe_mode")
    .eq("user_id", member.id)
    .eq("active", true)
    .eq("is_default", true)
    .eq("stripe_mode", stripeMode.mode)
    .maybeSingle();
  if (cardError) throw cardError;
  if (!savedCard) throw new Error("You do not have a saved card for invoice payments.");
  if (!savedCard.consent_accepted_at) {
    throw new Error("Your saved card authority is incomplete. Save your card again before using it.");
  }

  const invoiceId = clean(invoice?.InvoiceID);
  const invoiceNumber = clean(invoice?.InvoiceNumber);
  const amountCents = dollarsToCents(amount);
  if (!amountCents || amountCents <= 0) throw new Error("Invoice payment amount must be greater than $0.");

  const { data: paymentRecord, error: recordError } = await adminClient
    .from("xero_invoice_portal_payments")
    .insert({
      user_id: member.id,
      xero_contact_id: clean(member.xero_contact_id),
      xero_invoice_id: invoiceId,
      xero_invoice_number: invoiceNumber || null,
      amount,
      currency: clean(invoice?.CurrencyCode) || "AUD",
      status: "pending",
      ...stripeModeColumns(stripeMode.mode),
    })
    .select("id")
    .single();
  if (recordError) throw recordError;

  const form = new URLSearchParams();
  form.set("amount", String(amountCents));
  form.set("currency", (clean(invoice?.CurrencyCode) || "AUD").toLowerCase());
  form.set("customer", savedCard.stripe_customer_id);
  form.set("payment_method", savedCard.stripe_payment_method_id);
  form.set("off_session", "true");
  form.set("confirm", "true");
  form.set("description", invoiceNumber ? `Bendigo Flying Club invoice ${invoiceNumber}` : "Bendigo Flying Club invoice payment");
  form.set("metadata[crm_payment_type]", "xero_invoice_payment");
  addStripeModeMetadata(form, stripeMode.mode);
  form.set("metadata[payment_record_id]", paymentRecord.id);
  form.set("metadata[user_id]", member.id);
  form.set("metadata[xero_contact_id]", clean(member.xero_contact_id));
  form.set("metadata[xero_invoice_id]", invoiceId);
  form.set("metadata[xero_invoice_number]", invoiceNumber);
  form.set("metadata[payment_method_id]", stripeMethod.id);

  const paymentResponse = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": stripeIdempotencyKey("xero-invoice-saved-card", paymentRecord.id, invoiceId, amountCents),
    }),
    body: form,
  });
  const paymentIntent = await paymentResponse.json();
  const now = new Date().toISOString();

  if (!paymentResponse.ok) {
    await adminClient.from("xero_invoice_portal_payments").update({
      status: "failed",
      stripe_payment_intent_id: clean(paymentIntent?.error?.payment_intent?.id) || null,
      error: paymentIntent?.error?.message || "Stripe saved-card payment failed.",
      updated_at: now,
      ...stripeModeColumns(stripeMode.mode),
    }).eq("id", paymentRecord.id);
    throw new Error(paymentIntent?.error?.message || "Stripe saved-card payment failed.");
  }

  if (paymentIntent.status !== "succeeded") {
    await adminClient.from("xero_invoice_portal_payments").update({
      status: "pending",
      stripe_payment_intent_id: clean(paymentIntent.id),
      error: paymentIntent.status === "requires_action"
        ? "The cardholder needs to authenticate this payment before it can be completed."
        : null,
      updated_at: now,
      ...stripeModeColumns(stripeMode.mode),
    }).eq("id", paymentRecord.id);
    throw Object.assign(new Error("Saved-card payment did not complete. Use checkout instead."), { status: 402 });
  }

  const latestInvoice = await getContactInvoice(ctx, invoiceId, clean(member.xero_contact_id));
  const liveAmountDue = money(latestInvoice?.AmountDue);
  const amountToApply = Math.min(money(amount), liveAmountDue);
  if (amountToApply <= 0.005) {
    await adminClient.from("xero_invoice_portal_payments").update({
      status: "needs_review",
      stripe_payment_intent_id: clean(paymentIntent.id),
      error: "Stripe payment succeeded but the Xero invoice has no amount due. Review refund or allocation manually.",
      updated_at: now,
      ...stripeModeColumns(stripeMode.mode),
    }).eq("id", paymentRecord.id);
    throw new Error("Stripe payment succeeded but the Xero invoice has no amount due. Review this payment manually.");
  }

  const xeroPaymentId = await createXeroInvoicePayment({
    ctx,
    invoiceId,
    amount: amountToApply,
    reference: `Stripe saved-card invoice payment ${clean(paymentIntent.id)}`,
  });

  await adminClient.from("xero_invoice_portal_payments").update({
    status: money(amount) > amountToApply + 0.005 ? "needs_review" : "paid",
    stripe_payment_intent_id: clean(paymentIntent.id),
    xero_payment_id: xeroPaymentId,
    amount: amountToApply,
    error: money(amount) > amountToApply + 0.005
      ? `Stripe collected ${money(amount).toFixed(2)} but only ${amountToApply.toFixed(2)} was applied to Xero. Review the difference.`
      : null,
    updated_at: now,
    ...stripeModeColumns(stripeMode.mode),
  }).eq("id", paymentRecord.id);

  return {
    paymentRecordId: paymentRecord.id,
    stripePaymentIntentId: clean(paymentIntent.id),
    xeroPaymentId,
    amountApplied: amountToApply,
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
    xeroRateLimitAdminClient = adminClient;

    const caller = await getCaller({ req, supabaseUrl, anonKey, adminClient });
    if (!caller.ok) return json({ error: caller.error }, caller.status);

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action || "self").toLowerCase();
    const ctx: any = await getXeroContext(adminClient);
    ctx.priorityRefresh = body.priorityRefresh === true;

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
    const emptyCredit = {
      overpaymentCredit: 0,
      prepaymentCredit: 0,
      availableCredit: 0,
      eligibleForPrepaid: false,
    };

    if (action === "invoices") {
      if (!contactId) {
        return json({
          connected: true,
          userId: member.id,
          linked: false,
          invoices: [],
          minimumPrepaidPack: MINIMUM_PREPAID_PACK,
          ...emptyCredit,
        });
      }

      const [credit, invoices] = await Promise.all([
        fetchContactCredit(ctx, contactId),
        listContactInvoices(ctx, contactId),
      ]);
      await syncMembershipPeriodsFromInvoices(adminClient, member.id, invoices);
      const outstandingInvoiceTotal = getOutstandingInvoiceTotal(invoices);

      return json({
        connected: true,
        userId: member.id,
        name: clean(member.name),
        email: clean(member.email),
        xeroContactId: contactId,
        linked: true,
        minimumPrepaidPack: MINIMUM_PREPAID_PACK,
        ...credit,
        outstandingInvoiceTotal,
        netBalance: money(Number(credit.availableCredit || 0) - outstandingInvoiceTotal),
        invoices,
      });
    }

    const credit = contactId ? await fetchContactCredit(ctx, contactId) : emptyCredit;

    if (action === "pay-invoice") {
      if (!contactId) return json({ error: "This member is not linked to a Xero contact." }, 409);
      clearContactReadCache(contactId);
      const invoiceId = clean(body.invoiceId);
      if (!invoiceId) return json({ error: "Missing invoiceId" }, 400);
      const paymentMode = clean(body.paymentMode).toLowerCase() === "saved_card" ? "saved_card" : "checkout";

      let invoice = await getContactInvoice(ctx, invoiceId, contactId);
      let amountDue = money(invoice?.AmountDue);
      const creditResult = body.useCredit === false
        ? { applied: 0, allocations: [], remaining: amountDue }
        : await applyAvailableCreditToInvoice(ctx, invoiceId, contactId, amountDue);

      if (creditResult.applied > 0) {
        invoice = await getContactInvoice(ctx, invoiceId, contactId);
        amountDue = money(invoice?.AmountDue);
      } else {
        amountDue = money(creditResult.remaining);
      }

      const { data: stripeSettings } = await adminClient
        .from("stripe_connect_settings")
        .select("stripe_mode")
        .eq("id", true)
        .maybeSingle();
      const configuredStripeMode: "test" | "live" = stripeSettings?.stripe_mode === "test" ? "test" : "live";
      if (creditResult.applied > 0) {
        await syncFlightLogInvoicePaymentState({
          adminClient,
          invoiceId,
          invoicePaid: amountDue <= 0.005,
          creditApplied: creditResult.applied,
          allocations: creditResult.allocations,
          stripeMode: configuredStripeMode,
        });
      }

      if (amountDue <= 0.005) {
        return json({
          paidWithCredit: creditResult.applied > 0,
          creditApplied: creditResult.applied,
          allocations: creditResult.allocations,
          invoice: await mapInvoice(ctx, invoice),
        });
      }

      if (paymentMode === "saved_card") {
        const savedCardPayment = await createInvoiceSavedCardPayment({
          adminClient,
          ctx,
          member,
          invoice,
          amount: amountDue,
        });
        const updatedInvoice = await getContactInvoice(ctx, invoiceId, contactId);
        await syncFlightLogInvoicePaymentState({
          adminClient,
          invoiceId,
          invoicePaid: money(updatedInvoice?.AmountDue) <= 0.005,
          creditApplied: creditResult.applied,
          allocations: creditResult.allocations,
          stripeAmount: savedCardPayment.amountApplied,
          stripePaymentIntentId: savedCardPayment.stripePaymentIntentId,
          xeroPaymentId: savedCardPayment.xeroPaymentId,
          stripeMode: configuredStripeMode,
        });
        return json({
          paidWithSavedCard: true,
          creditApplied: creditResult.applied,
          allocations: creditResult.allocations,
          amountToPay: amountDue,
          paymentRecordId: savedCardPayment.paymentRecordId,
          stripePaymentIntentId: savedCardPayment.stripePaymentIntentId,
          xeroPaymentId: savedCardPayment.xeroPaymentId,
          invoice: await mapInvoice(ctx, updatedInvoice),
        });
      }

      const checkout = await createInvoicePaymentCheckout({
        adminClient,
        ctx,
        member,
        invoice,
        amount: amountDue,
        successUrl: safeReturnUrl(body.successUrl, "/billing?xero_invoice=success"),
        cancelUrl: safeReturnUrl(body.cancelUrl, "/billing?xero_invoice=cancelled"),
      });

      return json({
        creditApplied: creditResult.applied,
        allocations: creditResult.allocations,
        amountToPay: amountDue,
        ...checkout,
      });
    }

    if (action === "invoice-pdf") {
      const invoiceId = clean(body.invoiceId);
      if (!invoiceId) return json({ error: "Missing invoiceId" }, 400);

      const invoice = caller.isStaff
        ? await getInvoiceById(ctx, invoiceId)
        : contactId
          ? await getContactInvoice(ctx, invoiceId, contactId)
          : null;
      if (!invoice) return json({ error: "This member is not linked to a Xero contact." }, 409);
      const invoiceNumber = clean(invoice?.InvoiceNumber) || clean(invoiceId) || "invoice";
      const filename = `BFC-Invoice-${invoiceNumber}`.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const pdf = await xeroPdfRequest({
        path: `Invoices/${encodeURIComponent(invoiceId)}`,
        tenantId: ctx.connection.tenant_id,
        accessToken: ctx.connection.access_token,
      });

      return new Response(pdf, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename || "BFC-Invoice"}.pdf"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    }

    const invoices = contactId ? await listContactInvoices(ctx, contactId) : [];
    const outstandingInvoiceTotal = getOutstandingInvoiceTotal(invoices);

    return json({
      connected: true,
      userId: member.id,
      name: clean(member.name),
      email: clean(member.email),
      xeroContactId: contactId || null,
      linked: Boolean(contactId),
      minimumPrepaidPack: MINIMUM_PREPAID_PACK,
      outstandingInvoiceTotal,
      netBalance: money(Number(credit.availableCredit || 0) - outstandingInvoiceTotal),
      ...credit,
    });
  } catch (error) {
    console.error("member-xero-balance error", error);
    const status = typeof (error as any)?.status === "number" ? (error as any).status : 500;
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, status);
  }
});
