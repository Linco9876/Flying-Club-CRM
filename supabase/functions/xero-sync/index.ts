import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getConnectedStripeAccountId, stripeHeaders } from "../_shared/stripeConnectAccount.ts";
import { getStripeSecretKeyForMode, type StripeMode } from "../_shared/stripeMode.ts";

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
const quantityValue = (value: unknown) => Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;
const unitRateValue = (value: unknown) => Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;
const getErrorMessage = (error: unknown, fallback = "Xero sync failed") => {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "string") return error || fallback;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const direct = clean(value.message) || clean(value.error) || clean(value.details) || clean(value.hint);
    if (direct) return direct;
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Some thrown values are not safely serializable.
    }
  }
  return fallback;
};
const truncateText = (value: string, maxLength = 255) => {
  const text = clean(value);
  return text.length <= maxLength ? text : text.slice(0, maxLength - 1).trimEnd() + "…";
};
const isoDate = (value: unknown) => {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
};
const humanDate = (value: unknown) => {
  const date = value ? new Date(String(value)) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Sydney",
  }).format(date);
};

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
        new Error(`Xero sync is paused to stay under rate limits. It will retry in about ${retryAfterSeconds} seconds.`),
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

const isAdminRole = (role: string) => role === "admin";

const authenticateAdmin = async ({
  req,
  supabaseUrl,
  anonKey,
  adminClient,
  serviceRoleKey,
}: {
  req: Request;
  supabaseUrl: string;
  anonKey: string;
  adminClient: SupabaseAdminClient;
  serviceRoleKey: string;
}) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, error: "No authorization header", status: 401 };
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (bearerToken && bearerToken === serviceRoleKey) {
    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();
    if (roleRow?.user_id) return { ok: true, userId: roleRow.user_id };

    const { data: profileRow } = await adminClient
      .from("users")
      .select("id")
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();
    return { ok: true, userId: profileRow?.id ?? null };
  }

  const requestApiKey = clean(req.headers.get("apikey") || req.headers.get("Apikey"));
  const authApiKey = requestApiKey || anonKey;
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: authApiKey,
      Authorization: `Bearer ${bearerToken}`,
    },
  });
  if (!userResponse.ok) return { ok: false, error: `Unauthorized: auth user lookup failed (${userResponse.status})`, status: 401 };
  const user = await userResponse.json().catch(() => null);
  if (!user?.id) return { ok: false, error: "Unauthorized: auth user missing", status: 401 };

  const [{ data: roles, error: rolesError }, { data: profile, error: profileError }] = await Promise.all([
    adminClient.from("user_roles").select("role").eq("user_id", user.id),
    adminClient.from("users").select("role").eq("id", user.id).maybeSingle(),
  ]);
  if (rolesError) return { ok: false, error: rolesError.message, status: 500 };
  if (profileError) return { ok: false, error: profileError.message, status: 500 };

  const callerIsAdmin = isAdminRole(String(profile?.role || "")) ||
    (roles || []).some((row: any) => isAdminRole(String(row.role)));
  if (!callerIsAdmin) return { ok: false, error: "Only admins can sync Xero", status: 403 };

  return { ok: true, userId: user.id };
};

const xeroRequest = async ({
  method = "GET",
  path,
  tenantId,
  accessToken,
  body,
  idempotencyKey,
  bypassLocalPause = false,
}: {
  method?: string;
  path: string;
  tenantId: string;
  accessToken: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  bypassLocalPause?: boolean;
}) => {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForXeroApiSlot({ bypassLocalPause });

    const response = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(clean(idempotencyKey) ? { "Idempotency-Key": clean(idempotencyKey) } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      const fallbackDelayMs = Math.min(30_000, Math.round((1_500 * (2 ** (attempt - 1))) + Math.random() * 750));
      const waitMs = retryAfterMs > 0 ? retryAfterMs : fallbackDelayMs;
      if (attempt < maxAttempts && waitMs <= 30_000) {
        await noteXeroRateLimit(Math.ceil(waitMs / 1000));
        await sleep(waitMs + 250);
        continue;
      }
      const seconds = retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : null;
      const message = seconds
        ? `Xero is rate limiting the CRM. Please wait about ${seconds} seconds and try again.`
        : "Xero is rate limiting the CRM. Please wait a few minutes and try again.";
      const error = new Error(message) as Error & { status?: number; payload?: unknown; retryAfterSeconds?: number | null };
      error.status = response.status;
      error.payload = payload;
      error.retryAfterSeconds = seconds;
      await noteXeroRateLimit(seconds);
      throw error;
    }

    if (!response.ok) {
      const validationMessages = Array.isArray(payload?.Elements)
        ? payload.Elements
            .flatMap((element: any) => Array.isArray(element?.ValidationErrors) ? element.ValidationErrors : [])
            .map((item: any) => clean(item?.Message))
            .filter(Boolean)
        : [];
      const message = validationMessages[0] ||
        payload?.Message ||
        payload?.Title ||
        payload?.Detail ||
        `Xero request failed with HTTP ${response.status}`;
      if (response.status === 401 && path.startsWith("BankTransactions")) {
        throw makeXeroNeedsReviewError("Xero refused the prepaid credit sync. Reconnect Xero in Settings > Integrations so the CRM has bank transaction permission, then retry this sync item.");
      }
      if ((response.status === 401 || response.status === 403) && path.startsWith("ManualJournals")) {
        throw makeXeroNeedsReviewError("Xero refused the gift voucher journal. Reconnect Xero in Settings > Integrations to grant Manual Journals permission, and make sure the authorising Xero user has Reports access, then retry this sync item.");
      }
      const error = new Error(message) as Error & { status?: number; payload?: unknown };
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    const remainingMinuteCalls = Number(response.headers.get("X-MinLimit-Remaining"));
    if (Number.isFinite(remainingMinuteCalls) && remainingMinuteCalls <= 3) {
      await sleep(2_500);
    }
    return payload;
  }
  throw new Error("Xero request failed after retrying.");
};

const makeXeroNeedsReviewError = (message: string) => {
  const error = new Error(message) as Error & { queueStatus?: "needs_review" };
  error.queueStatus = "needs_review";
  return error;
};

const getRetryDelayMs = (attempt: number) => {
  if (attempt <= 1) return 2 * 60 * 1000;
  if (attempt === 2) return 10 * 60 * 1000;
  if (attempt === 3) return 30 * 60 * 1000;
  return 2 * 60 * 60 * 1000;
};

const isRetriableXeroError = (error: unknown) => {
  const status = typeof (error as any)?.status === "number" ? Number((error as any).status) : null;
  if (status === 429) return true;
  if (status !== null && status >= 500) return true;
  const message = clean((error as any)?.message).toLowerCase();
  return message.includes("timeout") || message.includes("temporarily unavailable") || message.includes("network");
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
      throw makeXeroNeedsReviewError("Xero is no longer authorised. Reconnect Xero in Settings > Integrations, then retry this sync item.");
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

const getConnectionAndSettings = async (adminClient: SupabaseAdminClient) => {
  const [{ data: connection, error: connectionError }, { data: settings, error: settingsError }] = await Promise.all([
    adminClient.from("xero_connection_settings").select("*").eq("id", true).maybeSingle(),
    adminClient.from("xero_sync_settings").select("*").eq("id", true).maybeSingle(),
  ]);
  if (connectionError) throw connectionError;
  if (settingsError) throw settingsError;
  if (!connection?.tenant_id || !connection?.refresh_token) throw new Error("Xero is not connected.");
  return { connection: await refreshAccessToken(adminClient, connection), settings: settings || {} };
};

const xeroStringLiteral = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const searchXeroContactsByEmail = async (ctx: any, email: string) => {
  const address = clean(email);
  if (!address) return [];
  const where = encodeURIComponent(`EmailAddress=="${xeroStringLiteral(address)}"`);
  const result = await xeroRequest({
    path: `Contacts?where=${where}`,
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    bypassLocalPause: Boolean(ctx.priorityTopupSync),
  });
  return Array.isArray(result?.Contacts) ? result.Contacts : [];
};

const listXeroAccounts = async (ctx: any) => {
  const result = await xeroRequest({
    path: "Accounts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    bypassLocalPause: Boolean(ctx.priorityTopupSync),
  });
  const accounts = Array.isArray(result?.Accounts) ? result.Accounts : [];
  return accounts.map((account: any) => ({
    accountId: clean(account.AccountID),
    code: clean(account.Code),
    name: clean(account.Name),
    type: clean(account.Type),
    status: clean(account.Status),
    enablePaymentsToAccount: Boolean(account.EnablePaymentsToAccount),
  }));
};

const listXeroItems = async (ctx: any) => {
  const result = await xeroRequest({
    path: "Items",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
  });
  const items = Array.isArray(result?.Items) ? result.Items : [];
  return items.map((item: any) => ({
    itemId: clean(item.ItemID),
    code: clean(item.Code),
    name: clean(item.Name),
    description: clean(item.Description),
    status: clean(item.Status),
    isTrackedAsInventory: Boolean(item.IsTrackedAsInventory),
  }));
};

const ensureFlightTypeSalesItem = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  {
    flightTypeId,
    code,
    name,
    description,
  }: {
    flightTypeId: string;
    code: string;
    name: string;
    description?: string;
  },
) => {
  const itemCode = clean(code).toUpperCase();
  if (!itemCode) throw new Error("Missing sales item code.");
  const itemName = clean(name) || itemCode;
  const revenueAccountCode = clean(ctx.settings?.revenue_account_code);
  if (!revenueAccountCode) {
    throw new Error("Set a Xero flight revenue account code before creating flight type sales items.");
  }

  const existingItems = await listXeroItems(ctx);
  const existing = existingItems.find((item: any) => item.code.toUpperCase() === itemCode);

  const payload = {
    Code: itemCode,
    Name: itemName,
    Description: clean(description) || itemName,
    IsTrackedAsInventory: false,
    SalesDetails: {
      AccountCode: revenueAccountCode,
      TaxType: clean(ctx.settings?.tax_type) || undefined,
    },
  };

  const result = await xeroRequest({
    method: "PUT",
    path: "Items",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Items: [existing?.itemId ? { ItemID: existing.itemId, ...payload } : payload],
    },
  });

  const item = result?.Items?.[0];
  const resolvedCode = clean(item?.Code) || itemCode;
  const { error } = await adminClient
    .from("flight_types")
    .update({
      xero_item_code: resolvedCode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", flightTypeId);
  if (error) throw error;

  return {
    created: !existing,
    item: {
      itemId: clean(item?.ItemID) || existing?.itemId || null,
      code: resolvedCode,
      name: clean(item?.Name) || itemName,
      status: clean(item?.Status) || existing?.status || null,
    },
  };
};

const listXeroTrackingCategories = async (ctx: any) => {
  const result = await xeroRequest({
    path: "TrackingCategories",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
  });
  const categories = Array.isArray(result?.TrackingCategories) ? result.TrackingCategories : [];
  return categories
    .map((category: any) => ({
      trackingCategoryId: clean(category.TrackingCategoryID),
      name: clean(category.Name),
      status: clean(category.Status),
      options: (Array.isArray(category.Options) ? category.Options : [])
        .map((option: any) => ({
          trackingOptionId: clean(option.TrackingOptionID),
          name: clean(option.Name),
          status: clean(option.Status),
        }))
        .sort((left: any, right: any) => left.name.localeCompare(right.name)),
    }))
    .sort((left: any, right: any) => left.name.localeCompare(right.name));
};

const ensureAircraftTrackingOption = async (
  ctx: any,
  {
    categoryName,
    optionName,
    categoryId,
  }: {
    categoryName: string;
    optionName: string;
    categoryId?: string;
  },
) => {
  const normalizedCategoryName = clean(categoryName);
  const normalizedOptionName = clean(optionName);
  const requestedCategoryId = clean(categoryId);

  if (!normalizedCategoryName) throw new Error("Tracking category name is required.");
  if (!normalizedOptionName) throw new Error("Tracking option name is required.");

  const categories = await listXeroTrackingCategories(ctx);
  let matchingCategory = categories.find((item: any) => requestedCategoryId && item.trackingCategoryId === requestedCategoryId);
  if (!matchingCategory) {
    matchingCategory = categories.find((item: any) => item.name.toLowerCase() === normalizedCategoryName.toLowerCase());
  }

  let categoryCreated = false;
  let optionCreated = false;

  if (!matchingCategory) {
    const createResult = await xeroRequest({
      method: "PUT",
      path: "TrackingCategories",
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
      body: {
        Name: normalizedCategoryName,
      },
    });

    const createdCategory = createResult?.TrackingCategories?.[0];
    if (!createdCategory) {
      throw new Error("Xero did not return the new tracking category.");
    }

    matchingCategory = {
      trackingCategoryId: clean(createdCategory.TrackingCategoryID),
      name: clean(createdCategory.Name) || normalizedCategoryName,
      status: clean(createdCategory.Status),
      options: (Array.isArray(createdCategory.Options) ? createdCategory.Options : []).map((option: any) => ({
        trackingOptionId: clean(option.TrackingOptionID),
        name: clean(option.Name),
        status: clean(option.Status),
      })),
    };
    categoryCreated = true;
    optionCreated = true;
  }

  if (clean(matchingCategory.status).toUpperCase() && clean(matchingCategory.status).toUpperCase() !== "ACTIVE") {
    throw new Error(`Xero tracking category "${matchingCategory.name}" is not active.`);
  }

  let matchingOption = (matchingCategory.options || []).find((item: any) => item.name.toLowerCase() === normalizedOptionName.toLowerCase());
  if (matchingOption && clean(matchingOption.status).toUpperCase() && clean(matchingOption.status).toUpperCase() !== "ACTIVE") {
    throw new Error(`Xero tracking option "${matchingOption.name}" exists but is not active.`);
  }

  if (!matchingOption) {
    const createOptionResult = await xeroRequest({
      method: "PUT",
      path: `TrackingCategories/${encodeURIComponent(matchingCategory.trackingCategoryId)}/Options`,
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
      body: {
        Name: normalizedOptionName,
      },
    });
    const createdOption = createOptionResult?.Options?.[0];
    if (!createdOption) {
      throw new Error("Xero did not return the new tracking option.");
    }
    matchingOption = {
      trackingOptionId: clean(createdOption.TrackingOptionID),
      name: clean(createdOption.Name) || normalizedOptionName,
      status: clean(createdOption.Status),
    };
    optionCreated = true;
  }

  return {
    categoryCreated,
    optionCreated,
    category: {
      trackingCategoryId: matchingCategory.trackingCategoryId,
      name: matchingCategory.name || normalizedCategoryName,
      status: matchingCategory.status || "ACTIVE",
    },
    option: {
      trackingOptionId: matchingOption.trackingOptionId,
      name: matchingOption.name || normalizedOptionName,
      status: matchingOption.status || "ACTIVE",
    },
  };
};

const ensureStripeClearingAccount = async (ctx: any) => {
  const existingAccounts = await listXeroAccounts(ctx);
  const existing = existingAccounts.find((account: any) =>
    account.status === "ACTIVE" &&
    account.type === "BANK" &&
    (
      account.code.toUpperCase() === "STRIPEBNK" ||
      account.code.toUpperCase() === "STRIPECLR" ||
      account.name.toLowerCase() === "stripe clearing bank" ||
      account.name.toLowerCase() === "stripe clearing"
    )
  );

  if (existing) {
    return { created: false, account: existing };
  }

  const result = await xeroRequest({
    method: "PUT",
    path: "Accounts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Accounts: [{
        Code: "STRIPEBNK",
        Name: "Stripe Clearing Bank",
        Type: "BANK",
        BankAccountNumber: "STRIPE-CLEARING",
        Description: "Stripe clearing bank account for CRM card payments and member top-ups.",
      }],
    },
  });

  const createdAccount = result?.Accounts?.[0];
  if (!createdAccount) {
    throw new Error("Xero did not return the Stripe clearing account.");
  }

  return {
    created: true,
    account: {
      accountId: clean(createdAccount.AccountID),
      code: clean(createdAccount.Code),
      name: clean(createdAccount.Name),
      type: clean(createdAccount.Type),
      status: clean(createdAccount.Status),
      enablePaymentsToAccount: Boolean(createdAccount.EnablePaymentsToAccount),
    },
  };
};

const ensurePrepaidClearingAccount = async (ctx: any) => {
  const existingAccounts = await listXeroAccounts(ctx);
  const existing = existingAccounts.find((account: any) =>
    account.status === "ACTIVE" &&
    (
      account.code.toUpperCase() === "PREPAIDCLR" ||
      account.name.toLowerCase() === "prepaid clearing" ||
      account.name.toLowerCase() === "pilot account clearing"
    )
  );

  if (existing) {
    return { created: false, account: existing };
  }

  const result = await xeroRequest({
    method: "PUT",
    path: "Accounts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Accounts: [{
        Code: "PREPAIDCLR",
        Name: "Prepaid Clearing",
        Type: "CURRENT",
        Description: "Prepaid pilot account clearing for CRM balance payments.",
        EnablePaymentsToAccount: true,
      }],
    },
  });

  const createdAccount = result?.Accounts?.[0];
  if (!createdAccount) {
    throw new Error("Xero did not return the prepaid clearing account.");
  }

  return {
    created: true,
    account: {
      accountId: clean(createdAccount.AccountID),
      code: clean(createdAccount.Code),
      name: clean(createdAccount.Name),
      type: clean(createdAccount.Type),
      status: clean(createdAccount.Status),
      enablePaymentsToAccount: Boolean(createdAccount.EnablePaymentsToAccount),
    },
  };
};

const ensureTopupReceiptAccount = async (ctx: any) => {
  const existingAccounts = await listXeroAccounts(ctx);
  const existing = existingAccounts.find((account: any) =>
    account.status === "ACTIVE" &&
    (
      account.code.toUpperCase() === "TOPUPRCPT" ||
      account.name.toLowerCase() === "member top-up receipts" ||
      account.name.toLowerCase() === "member top up receipts" ||
      account.name.toLowerCase() === "member top-up receipt account"
    )
  );

  if (existing) {
    return { created: false, account: existing };
  }

  const result = await xeroRequest({
    method: "PUT",
    path: "Accounts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Accounts: [{
        Code: "TOPUPRCPT",
        Name: "Member Top-up Receipts",
        Type: "CURRENT",
        Description: "Receipt account for member top-ups collected through the CRM.",
        EnablePaymentsToAccount: true,
      }],
    },
  });

  const createdAccount = result?.Accounts?.[0];
  if (!createdAccount) {
    throw new Error("Xero did not return the member top-up receipt account.");
  }

  return {
    created: true,
    account: {
      accountId: clean(createdAccount.AccountID),
      code: clean(createdAccount.Code),
      name: clean(createdAccount.Name),
      type: clean(createdAccount.Type),
      status: clean(createdAccount.Status),
      enablePaymentsToAccount: Boolean(createdAccount.EnablePaymentsToAccount),
    },
  };
};

const ensureStripeFeeExpenseAccount = async (ctx: any) => {
  const existingAccounts = await listXeroAccounts(ctx);
  const existing = existingAccounts.find((account: any) =>
    account.status === "ACTIVE" &&
    (
      account.code.toUpperCase() === "STRIPEFEE" ||
      account.name.toLowerCase() === "stripe fees" ||
      account.name.toLowerCase() === "stripe fee expense"
    )
  );

  if (existing) {
    return { created: false, account: existing };
  }

  const result = await xeroRequest({
    method: "PUT",
    path: "Accounts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Accounts: [{
        Code: "STRIPEFEE",
        Name: "Stripe Fees",
        Type: "EXPENSE",
        Description: "Stripe merchant and processing fees from CRM card payments.",
      }],
    },
  });

  const createdAccount = result?.Accounts?.[0];
  if (!createdAccount) {
    throw new Error("Xero did not return the Stripe fees expense account.");
  }

  return {
    created: true,
    account: {
      accountId: clean(createdAccount.AccountID),
      code: clean(createdAccount.Code),
      name: clean(createdAccount.Name),
      type: clean(createdAccount.Type),
      status: clean(createdAccount.Status),
      enablePaymentsToAccount: Boolean(createdAccount.EnablePaymentsToAccount),
    },
  };
};

const ensureVoucherLiabilityAccount = async (ctx: any) => {
  const existingAccounts = await listXeroAccounts(ctx);
  const existing = existingAccounts.find((account: any) =>
    account.status === "ACTIVE" &&
    (
      account.code.toUpperCase() === "GFTVOUCH" ||
      account.name.toLowerCase() === "gift voucher liability" ||
      account.name.toLowerCase() === "gift vouchers liability"
    )
  );

  if (existing) {
    return { created: false, account: existing };
  }

  const result = await xeroRequest({
    method: "PUT",
    path: "Accounts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Accounts: [{
        Code: "GFTVOUCH",
        Name: "Gift Voucher Liability",
        Type: "CURRLIAB",
        Description: "Gift voucher liability for CRM voucher sales until redeemed.",
      }],
    },
  });

  const createdAccount = result?.Accounts?.[0];
  if (!createdAccount) {
    throw new Error("Xero did not return the gift voucher liability account.");
  }

  return {
    created: true,
    account: {
      accountId: clean(createdAccount.AccountID),
      code: clean(createdAccount.Code),
      name: clean(createdAccount.Name),
      type: clean(createdAccount.Type),
      status: clean(createdAccount.Status),
      enablePaymentsToAccount: Boolean(createdAccount.EnablePaymentsToAccount),
    },
  };
};

const ensurePrepaidLiabilityAccount = async (ctx: any) => {
  const existingAccounts = await listXeroAccounts(ctx);
  const existing = existingAccounts.find((account: any) =>
    account.status === "ACTIVE" &&
    (
      account.code.toUpperCase() === "PREPAIDLI" ||
      account.name.toLowerCase() === "member prepaid liability" ||
      account.name.toLowerCase() === "pilot account liability" ||
      account.name.toLowerCase() === "prepaid liability"
    )
  );

  if (existing) {
    return { created: false, account: existing };
  }

  const result = await xeroRequest({
    method: "PUT",
    path: "Accounts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Accounts: [{
        Code: "PREPAIDLI",
        Name: "Member Prepaid Liability",
        Type: "CURRLIAB",
        Description: "Member prepaid balance liability used by the CRM.",
      }],
    },
  });

  const createdAccount = result?.Accounts?.[0];
  if (!createdAccount) {
    throw new Error("Xero did not return the member prepaid liability account.");
  }

  return {
    created: true,
    account: {
      accountId: clean(createdAccount.AccountID),
      code: clean(createdAccount.Code),
      name: clean(createdAccount.Name),
      type: clean(createdAccount.Type),
      status: clean(createdAccount.Status),
      enablePaymentsToAccount: Boolean(createdAccount.EnablePaymentsToAccount),
    },
  };
};

const createManualJournal = async ({
  ctx,
  date,
  narration,
  lines,
  idempotencyKey,
}: {
  ctx: any;
  date: unknown;
  narration: string;
  lines: Array<{ accountCode: string; amount: number; description: string }>;
  idempotencyKey?: string;
}) => {
  const result = await xeroRequest({
    method: "POST",
    path: "ManualJournals",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    idempotencyKey,
    body: {
      ManualJournals: [{
        Date: isoDate(date),
        Narration: narration,
        Status: "POSTED",
        LineAmountTypes: "NoTax",
        JournalLines: lines.map((line) => ({
          AccountCode: clean(line.accountCode),
          LineAmount: money(line.amount),
          Description: clean(line.description) || narration,
        })),
      }],
    },
  });

  const journal = result?.ManualJournals?.[0];
  const journalId = clean(journal?.ManualJournalID);
  if (!journalId) {
    throw new Error("Xero did not return a manual journal ID.");
  }

  return {
    journalId,
    status: clean(journal?.Status),
    date: clean(journal?.Date),
  };
};

const fetchStripeFeeDetails = async (adminClient: SupabaseAdminClient, flightLogId: string, tx: any) => {
  const txMode = tx?.stripe_mode === "test" || tx?.is_test_mode === true ? "test" : "live";
  let stripeSecretKey = "";
  try {
    stripeSecretKey = getStripeSecretKeyForMode(txMode as StripeMode);
  } catch {
    return null;
  }

  const connectedAccountId = await getConnectedStripeAccountId(adminClient);
  if (!connectedAccountId) return null;

  const description = clean(tx.description);
  const paymentIntentFromDescription = (description.match(/pi_[A-Za-z0-9]+/) || [])[0] || "";
  const checkoutSessionFromDescription = (description.match(/cs_[A-Za-z0-9]+/) || [])[0] || "";

  let paymentIntentId = paymentIntentFromDescription;
  if (!paymentIntentId) {
    const { data: flight } = await adminClient
      .from("flight_logs")
      .select("stripe_payment_intent_id")
      .eq("id", flightLogId)
      .maybeSingle();
    paymentIntentId = clean(flight?.stripe_payment_intent_id);
  }

  if (!paymentIntentId && checkoutSessionFromDescription) {
    const sessionResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(checkoutSessionFromDescription)}`, {
      headers: stripeHeaders(stripeSecretKey, connectedAccountId),
    });
    const sessionBody = await sessionResponse.json().catch(() => ({}));
    if (!sessionResponse.ok) {
      throw new Error(sessionBody?.error?.message || `Stripe checkout lookup failed with ${sessionResponse.status}`);
    }
    paymentIntentId = clean(sessionBody?.payment_intent);
  }

  if (!paymentIntentId) return null;

  const intentResponse = await fetch(
    `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge.balance_transaction`,
    { headers: stripeHeaders(stripeSecretKey, connectedAccountId) },
  );
  const intentBody = await intentResponse.json().catch(() => ({}));
  if (!intentResponse.ok) {
    throw new Error(intentBody?.error?.message || `Stripe payment intent lookup failed with ${intentResponse.status}`);
  }

  const latestCharge = intentBody?.latest_charge;
  const balanceTransaction = latestCharge?.balance_transaction;
  const feeCents = Number(balanceTransaction?.fee || 0);
  if (!Number.isFinite(feeCents) || feeCents <= 0) {
    return null;
  }

  return {
    paymentIntentId,
    feeAmount: money(feeCents / 100),
    chargeId: clean(latestCharge?.id),
    balanceTransactionId: clean(balanceTransaction?.id),
  };
};

const syncStripeFeeExpense = async ({
  adminClient,
  ctx,
  flightLogId,
  invoiceId,
  tx,
}: {
  adminClient: SupabaseAdminClient;
  ctx: any;
  flightLogId: string;
  invoiceId: string;
  tx: any;
}) => {
  if (clean(tx.xero_fee_bank_transaction_id)) {
    return { skipped: true, reason: "already_synced" };
  }

  const clearingAccountCode = clean(ctx.settings?.stripe_payment_account_code);
  const expenseAccountCode = clean(ctx.settings?.stripe_fee_expense_account_code);
  if (!clearingAccountCode || !expenseAccountCode) {
    return { skipped: true, reason: "account_mapping_missing" };
  }

  const feeDetails = await fetchStripeFeeDetails(adminClient, flightLogId, tx);
  if (!feeDetails?.feeAmount || feeDetails.feeAmount <= 0) {
    return { skipped: true, reason: "no_fee_found" };
  }

  const result = await xeroRequest({
    method: "POST",
    path: "BankTransactions",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    bypassLocalPause: Boolean(ctx.priorityTopupSync),
    body: {
      BankTransactions: [{
        Type: "SPEND",
        BankAccount: { Code: clearingAccountCode },
        Date: isoDate(tx.created_at),
        Reference: `Stripe fee ${feeDetails.paymentIntentId || tx.id}`,
        LineAmountTypes: "NoTax",
        LineItems: [{
          Description: `Stripe processing fee for CRM payment ${feeDetails.paymentIntentId || tx.id}`,
          Quantity: 1,
          UnitAmount: feeDetails.feeAmount,
          AccountCode: expenseAccountCode,
        }],
      }],
    },
  });

  const bankTransaction = result?.BankTransactions?.[0];
  const bankTransactionId = clean(bankTransaction?.BankTransactionID);
  if (!bankTransactionId) {
    throw new Error("Xero did not return a Stripe fee bank transaction ID.");
  }

  await adminClient.from("account_transactions").update({
    xero_fee_bank_transaction_id: bankTransactionId,
    xero_fee_synced_at: new Date().toISOString(),
    xero_fee_sync_error: null,
    xero_invoice_id: invoiceId,
  }).eq("id", tx.id);

  return {
    skipped: false,
    bankTransactionId,
    feeAmount: feeDetails.feeAmount,
    paymentIntentId: feeDetails.paymentIntentId,
    balanceTransactionId: feeDetails.balanceTransactionId,
  };
};

const getMember = async (adminClient: SupabaseAdminClient, userId: string) => {
  const { data, error } = await adminClient
    .from("users")
    .select("id,name,email,phone,mobile_phone,address,xero_contact_id,xero_contact_name,xero_contact_email,xero_contact_linked_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("CRM member not found.");
  return data;
};

const getRemainingCreditAmount = (item: any) => {
  const remainingCredit = item?.RemainingCredit ?? item?.RemainingCreditAmount ?? item?.RemainingAmount;
  if (remainingCredit === undefined || remainingCredit === null || remainingCredit === "") return 0;
  return Math.max(0, money(remainingCredit));
};

const getCreditId = (item: any, kind: "overpayment" | "prepayment") =>
  clean(kind === "overpayment" ? item?.OverpaymentID : item?.PrepaymentID);

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
        date: clean(item?.DateString || item?.Date) || null,
        reference: clean(item?.Reference || item?.Type) || null,
      };
    })
    .filter((item) =>
      item.id &&
      item.contactId === contactId &&
      item.amount > 0.005 &&
      !["VOIDED", "DELETED", "CANCELLED"].includes(item.status)
    );

const fetchContactCreditItems = async (ctx: any, contactId: string) => {
  const [overpaymentResult, prepaymentResult] = await Promise.all([
    xeroRequest({
      path: "Overpayments",
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
      bypassLocalPause: Boolean(ctx.priorityTopupSync),
    }),
    xeroRequest({
      path: "Prepayments",
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
      bypassLocalPause: Boolean(ctx.priorityTopupSync),
    }),
  ]);

  return [
    ...normaliseCreditItems(overpaymentResult?.Overpayments || [], contactId, "overpayment"),
    ...normaliseCreditItems(prepaymentResult?.Prepayments || [], contactId, "prepayment"),
  ];
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
        Amount: money(amount),
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
  if (remaining <= 0.005) return { applied, allocations, remaining: 0 };

  const credits = await fetchContactCreditItems(ctx, contactId);
  for (const credit of credits) {
    if (remaining <= 0.005) break;
    const amount = Math.min(remaining, money(credit.amount));
    if (amount <= 0.005) continue;

    const allocation = await allocateCreditToInvoice(ctx, invoiceId, credit, amount);
    const allocationId = clean(allocation?.AllocationID);
    allocations.push({
      allocationId,
      creditId: credit.id,
      kind: credit.kind,
      amount,
    });
    applied = money(applied + amount);
    remaining = money(remaining - amount);
  }

  return { applied, allocations, remaining };
};

const getTopupCreditCandidates = async (ctx: any, member: any, tx: any) => {
  const contactId = clean(member.xero_contact_id);
  if (!contactId) {
    return {
      contactId: null,
      candidates: [],
    };
  }

  const txAmount = money(tx.amount);
  const txDate = isoDate(tx.created_at);
  const candidates = (await fetchContactCreditItems(ctx, contactId))
    .map((candidate: any) => {
      const candidateDate = candidate.date ? isoDate(candidate.date) : null;
      const dateDistance = candidateDate
        ? Math.abs(new Date(candidateDate).getTime() - new Date(txDate).getTime())
        : Number.MAX_SAFE_INTEGER;
      return {
        ...candidate,
        exactAmount: Math.abs(money(candidate.amount) - txAmount) < 0.01,
        sameDate: candidateDate === txDate,
        dateDistance,
      };
    })
    .sort((left: any, right: any) => {
      if (left.exactAmount !== right.exactAmount) return left.exactAmount ? -1 : 1;
      if (left.sameDate !== right.sameDate) return left.sameDate ? -1 : 1;
      return left.dateDistance - right.dateDistance;
    });

  return {
    contactId,
    candidates,
  };
};

const linkTopupTransactionToCredit = async ({
  adminClient,
  transactionId,
  contactId,
  creditId,
}: {
  adminClient: SupabaseAdminClient;
  transactionId: string;
  contactId: string;
  creditId: string;
}) => {
  const now = new Date().toISOString();
  const { error } = await adminClient.from("account_transactions").update({
    xero_bank_transaction_id: creditId,
    xero_contact_id: contactId,
    xero_synced_at: now,
    xero_sync_status: "synced",
    xero_sync_error: null,
  }).eq("id", transactionId);
  if (error) throw error;
  return now;
};

const getFlightBooking = (flight: any) => Array.isArray(flight?.booking) ? flight.booking[0] : flight?.booking;

const getFlightContactLabel = (flight: any) => {
  const booking = getFlightBooking(flight);
  if (booking?.is_guest_booking) {
    return clean(booking?.guest_name) || clean(booking?.guest_email) || "Guest";
  }
  const student = Array.isArray(flight?.student) ? flight.student[0] : flight?.student;
  return clean(student?.name) || clean(student?.email) || "Member";
};

const syncGuestContact = async (ctx: any, flight: any) => {
  const booking = getFlightBooking(flight);
  if (!booking?.is_guest_booking) throw new Error("This booking is not marked as a guest booking.");

  const guestName = clean(booking?.guest_name);
  const guestEmail = clean(booking?.guest_email);
  const guestPhone = clean(booking?.guest_phone);
  if (!guestName) throw new Error("Guest booking is missing a guest name.");
  if (!guestEmail) throw new Error("Guest booking is missing a guest email.");

  const matches = await searchXeroContactsByEmail(ctx, guestEmail);
  if (matches.length > 1) {
    throw makeXeroNeedsReviewError("More than one Xero contact uses this guest email. Please link or merge the guest contact in Xero first.");
  }

  let contactId = matches.length === 1 ? clean(matches[0]?.ContactID) : "";
  const payloadContact: Record<string, unknown> = {
    Name: guestName,
    EmailAddress: guestEmail,
  };
  if (guestPhone) payloadContact.Phones = [{ PhoneType: "MOBILE", PhoneNumber: guestPhone }];
  if (contactId) payloadContact.ContactID = contactId;

  const result = await xeroRequest({
    method: "POST",
    path: "Contacts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    bypassLocalPause: Boolean(ctx.priorityTopupSync),
    body: { Contacts: [payloadContact] },
  });

  const contact = result?.Contacts?.[0] || matches[0];
  contactId = clean(contact?.ContactID) || contactId;
  if (!contactId) throw new Error("Xero did not return a guest contact ID.");

  return {
    linked: true,
    contactId,
    contactName: clean(contact?.Name) || guestName,
    contactEmail: clean(contact?.EmailAddress) || guestEmail,
  };
};

const getAccountTransaction = async (adminClient: SupabaseAdminClient, transactionId: string) => {
  const { data, error } = await adminClient
    .from("account_transactions")
    .select(`
      id,
      user_id,
      type,
      amount,
      description,
      payment_method_id,
      created_at,
      verified_status,
      stripe_checkout_session_id,
      xero_bank_transaction_id,
      xero_sync_status,
      xero_sync_error,
      payment_method:payment_method_id (
        id,
        name,
        system_key
      )
    `)
    .eq("id", transactionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Account transaction not found.");
  return data;
};

const getTopupFundingAccountCode = (ctx: any, paymentMethod: any) => {
  const paymentSystemKey = clean(paymentMethod?.system_key).toLowerCase();
  const paymentMethodName = clean(paymentMethod?.name).toLowerCase();
  const isStripePaymentMethod =
    paymentSystemKey === "stripe_card" ||
    paymentSystemKey === "stripe_card_payment" ||
    paymentSystemKey === "stripe" ||
    paymentMethodName.includes("stripe");

  if (isStripePaymentMethod) {
    return clean(ctx.settings?.stripe_payment_account_code);
  }

  return clean(ctx.settings?.topup_receipt_account_code);
};

const getXeroBankAccountCode = async (ctx: any, preferredCode: string, fallbackCode: string, fallbackName: string) => {
  const existingAccounts = await listXeroAccounts(ctx);
  const preferred = existingAccounts.find((account: any) =>
    account.status === "ACTIVE" &&
    account.type === "BANK" &&
    account.code.toUpperCase() === clean(preferredCode).toUpperCase()
  );
  if (preferred?.code) return preferred.code;

  const fallback = existingAccounts.find((account: any) =>
    account.status === "ACTIVE" &&
    account.type === "BANK" &&
    (
      account.code.toUpperCase() === fallbackCode.toUpperCase() ||
      account.name.toLowerCase() === fallbackName.toLowerCase()
    )
  );
  if (fallback?.code) return fallback.code;

  const result = await xeroRequest({
    method: "PUT",
    path: "Accounts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    bypassLocalPause: Boolean(ctx.priorityTopupSync),
    body: {
      Accounts: [{
        Code: fallbackCode,
        Name: fallbackName,
        Type: "BANK",
        BankAccountNumber: fallbackCode,
        Description: `${fallbackName} account created by the CRM for Xero bank transactions.`,
      }],
    },
  });
  const createdAccount = result?.Accounts?.[0];
  return clean(createdAccount?.Code);
};

const getXeroReceivablesAccountCode = async (ctx: any) => {
  const result = await xeroRequest({
    path: "Accounts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    bypassLocalPause: Boolean(ctx.priorityTopupSync),
  });
  const accounts = Array.isArray(result?.Accounts) ? result.Accounts : [];
  const receivablesAccount = accounts.find((account: any) =>
    clean(account?.Status) === "ACTIVE" &&
    clean(account?.SystemAccount).toUpperCase() === "DEBTORS" &&
    clean(account?.Code)
  ) || accounts.find((account: any) =>
    clean(account?.Status) === "ACTIVE" &&
    clean(account?.Name).toLowerCase().includes("accounts receivable") &&
    clean(account?.Code)
  );

  return clean(receivablesAccount?.Code);
};

const syncTopupTransaction = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  transactionId: string,
  queueId: string | null = null,
) => {
  const tx = await getAccountTransaction(adminClient, transactionId);
  if (tx.type !== "topup") {
    throw makeXeroNeedsReviewError("Only top-up transactions can be synced as member credit.");
  }
  if (clean(tx.verified_status) !== "verified") {
    throw makeXeroNeedsReviewError("Only verified top-up transactions can be synced to Xero.");
  }

  const amount = money(tx.amount);
  if (amount <= 0) {
    throw makeXeroNeedsReviewError("Top-up amount must be greater than $0.");
  }

  if (clean(tx.xero_bank_transaction_id)) {
    await markQueue(adminClient, queueId, {
      status: "synced",
      last_error: null,
      processed_at: new Date().toISOString(),
      result: {
        transactionId: tx.id,
        bankTransactionId: clean(tx.xero_bank_transaction_id),
        skipped: "already_synced",
      },
    });
    return {
      skipped: true,
      bankTransactionId: clean(tx.xero_bank_transaction_id),
    };
  }

  const paymentSystemKey = clean(tx.payment_method?.system_key).toLowerCase();
  const paymentMethodName = clean(tx.payment_method?.name).toLowerCase();
  const isStripeTopup =
    paymentSystemKey === "stripe_card" ||
    paymentSystemKey === "stripe_card_payment" ||
    paymentSystemKey === "stripe" ||
    paymentMethodName.includes("stripe");

  if (isStripeTopup && !clean(tx.stripe_checkout_session_id)) {
    const message = "This Stripe top-up has no Stripe checkout confirmation. Re-run it through Stripe checkout or manually confirm the Stripe payment before syncing to Xero.";
    await adminClient.from("account_transactions").update({
      xero_sync_status: "needs_review",
      xero_sync_error: message,
    }).eq("id", tx.id);
    throw makeXeroNeedsReviewError(message);
  }

  const member = await getMember(adminClient, tx.user_id);
  const contactResult = await syncMemberContact(adminClient, ctx, tx.user_id, queueId);
  const contactId = clean(contactResult?.contactId || member.xero_contact_id);
  if (!contactId) {
    throw makeXeroNeedsReviewError("This member is not linked to a Xero contact yet.");
  }

  if (!isStripeTopup) {
    const { candidates } = await getTopupCreditCandidates(ctx, { ...member, xero_contact_id: contactId }, tx);
    const exactMatches = candidates.filter((candidate: any) => candidate.exactAmount);

    if (exactMatches.length === 1) {
      const now = await linkTopupTransactionToCredit({
        adminClient,
        transactionId: tx.id,
        contactId,
        creditId: clean(exactMatches[0].id),
      });

      await markQueue(adminClient, queueId, {
        status: "synced",
        last_error: null,
        processed_at: now,
        xero_contact_id: contactId,
        xero_payment_id: clean(exactMatches[0].id),
        result: {
          transactionId: tx.id,
          matchedCreditId: clean(exactMatches[0].id),
          matchedCreditKind: exactMatches[0].kind,
          amount,
        },
      });

      return {
        matched: true,
        matchedCreditId: clean(exactMatches[0].id),
        matchedCreditKind: exactMatches[0].kind,
      };
    }

    await adminClient.from("account_transactions").update({
      xero_contact_id: contactId,
      xero_sync_status: "awaiting_match",
      xero_sync_error: exactMatches.length > 1
        ? "More than one matching Xero credit was found. Pick the correct match from Billing."
        : "No matching Xero overpayment or prepayment was found yet.",
    }).eq("id", tx.id);

    throw makeXeroNeedsReviewError(
      exactMatches.length > 1
        ? "More than one matching Xero credit was found. Pick the correct match from Billing."
        : "No matching Xero overpayment or prepayment was found yet.",
    );
  }

  const receivablesAccountCode = await getXeroReceivablesAccountCode(ctx);
  if (!receivablesAccountCode) {
    throw makeXeroNeedsReviewError("Xero did not return an active Accounts Receivable account for the prepaid overpayment.");
  }

  const configuredFundingAccountCode = getTopupFundingAccountCode(ctx, tx.payment_method);
  if (!configuredFundingAccountCode) {
    throw makeXeroNeedsReviewError("Set the member top-up receipt account in Xero settings before syncing Stripe top-ups.");
  }
  const fundingAccountCode = await getXeroBankAccountCode(ctx, configuredFundingAccountCode, "STRIPEBNK", "Stripe Clearing Bank");
  if (!fundingAccountCode) {
    throw makeXeroNeedsReviewError("Xero did not return a valid bank account for Stripe top-up receipts.");
  }
  if (fundingAccountCode !== configuredFundingAccountCode) {
    await adminClient.from("xero_sync_settings").update({
      stripe_payment_account_code: fundingAccountCode,
      updated_at: new Date().toISOString(),
    }).eq("id", true);
  }

  const reference = truncateText(
    [clean(member.name) || clean(member.email) || "Member", "prepaid top-up", humanDate(tx.created_at)]
      .filter(Boolean)
      .join(" - "),
    255,
  );
  const description = truncateText(clean(tx.description) || "CRM prepaid top-up", 4000);

  const result = await xeroRequest({
    method: "POST",
    path: "BankTransactions",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      BankTransactions: [{
        Type: "RECEIVE-OVERPAYMENT",
        Contact: { ContactID: contactId },
        BankAccount: { Code: fundingAccountCode },
        Date: isoDate(tx.created_at),
        Reference: reference,
        LineAmountTypes: "NoTax",
        LineItems: [{
          Description: description,
          Quantity: 1,
          UnitAmount: amount,
          AccountCode: receivablesAccountCode,
        }],
      }],
    },
  });

  const bankTransaction = result?.BankTransactions?.[0];
  const bankTransactionId = clean(bankTransaction?.BankTransactionID);
  if (!bankTransactionId) {
    throw new Error("Xero did not return a bank transaction ID for the prepaid top-up.");
  }

  const now = new Date().toISOString();
  await adminClient.from("account_transactions").update({
    xero_bank_transaction_id: bankTransactionId,
    xero_contact_id: contactId,
    xero_synced_at: now,
    xero_sync_status: "synced",
    xero_sync_error: null,
  }).eq("id", tx.id);

  await markQueue(adminClient, queueId, {
    status: "synced",
    last_error: null,
    processed_at: now,
    xero_contact_id: contactId,
    xero_payment_id: bankTransactionId,
    result: {
      transactionId: tx.id,
      bankTransactionId,
      contactId,
      amount,
      receivablesAccountCode,
    },
  });

  return {
    transactionId: tx.id,
    bankTransactionId,
    contactId,
    amount,
    receivablesAccountCode,
  };
};

const createVoucherSaleReceipt = async ({
  ctx,
  voucherId,
  voucherCode,
  productName,
  purchaserContactId,
  date,
  amount,
  fundingAccountCode,
  liabilityAccountCode,
}: {
  ctx: any;
  voucherId: string;
  voucherCode: string;
  productName: string;
  purchaserContactId: string;
  date: unknown;
  amount: number;
  fundingAccountCode: string;
  liabilityAccountCode: string;
}) => {
  const result = await xeroRequest({
    method: "POST",
    path: "BankTransactions",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    idempotencyKey: `voucher-sale-${voucherId}`,
    body: {
      BankTransactions: [{
        Type: "RECEIVE",
        Contact: { ContactID: purchaserContactId },
        BankAccount: { Code: fundingAccountCode },
        Date: isoDate(date),
        Reference: truncateText(`Voucher ${voucherCode}`),
        LineAmountTypes: "NoTax",
        LineItems: [{
          Description: truncateText(`${productName} - voucher ${voucherCode}`, 4000),
          Quantity: 1,
          UnitAmount: money(amount),
          AccountCode: liabilityAccountCode,
        }],
      }],
    },
  });

  const bankTransaction = result?.BankTransactions?.[0];
  const bankTransactionId = clean(bankTransaction?.BankTransactionID);
  if (!bankTransactionId) {
    throw new Error("Xero did not return a bank transaction ID for the voucher sale.");
  }

  return {
    bankTransactionId,
    status: clean(bankTransaction?.Status),
    reference: clean(bankTransaction?.Reference),
  };
};

const syncVoucherPurchaserContact = async (ctx: any, voucher: any) => {
  const purchaserName = clean(voucher?.purchaser_name);
  const purchaserEmail = clean(voucher?.purchaser_email).toLowerCase();
  if (!purchaserName) {
    throw makeXeroNeedsReviewError("The voucher purchaser name is missing. Add it before syncing the voucher to Xero.");
  }
  if (!purchaserEmail) {
    throw makeXeroNeedsReviewError("The voucher purchaser email is missing. Add it before syncing the voucher to Xero.");
  }

  const matches = await searchXeroContactsByEmail(ctx, purchaserEmail);
  if (matches.length > 1) {
    throw makeXeroNeedsReviewError("More than one Xero contact uses this voucher purchaser email. Link or merge the duplicate contacts in Xero before retrying.");
  }

  let contactId = clean(voucher?.xero_purchaser_contact_id) || (matches.length === 1 ? clean(matches[0]?.ContactID) : "");
  const payloadContact: Record<string, unknown> = {
    Name: purchaserName,
    EmailAddress: purchaserEmail,
  };
  if (contactId) payloadContact.ContactID = contactId;

  const response = await xeroRequest({
    method: "POST",
    path: "Contacts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    idempotencyKey: `voucher-contact-${clean(voucher?.id)}`,
    body: { Contacts: [payloadContact] },
  });

  const contact = response?.Contacts?.[0] || matches[0];
  contactId = clean(contact?.ContactID) || contactId;
  if (!contactId) throw new Error("Xero did not return a voucher purchaser contact ID.");

  return {
    contactId,
    contactName: clean(contact?.Name) || purchaserName,
    contactEmail: clean(contact?.EmailAddress) || purchaserEmail,
  };
};

const markQueue = async (adminClient: SupabaseAdminClient, queueId: string | null, update: Record<string, unknown>) => {
  if (!queueId) return;
  await adminClient.from("xero_sync_queue").update({ ...update, updated_at: new Date().toISOString() }).eq("id", queueId);
};

const clearQueueItemsForFlightLog = async (adminClient: SupabaseAdminClient, flightLogId: string) => {
  const { error } = await adminClient
    .from("xero_sync_queue")
    .delete()
    .or(`and(entity_type.eq.flight_invoice,entity_id.eq.${flightLogId}),and(entity_type.eq.flight_payment,entity_id.eq.${flightLogId})`);

  if (error) throw error;
};

const syncMemberContact = async (adminClient: SupabaseAdminClient, ctx: any, userId: string, queueId: string | null = null) => {
  await markQueue(adminClient, queueId, { status: "processing" });
  const member = await getMember(adminClient, userId);

  let contactId = clean(member.xero_contact_id);
  let contact: any = null;

  if (!contactId) {
    const matches = await searchXeroContactsByEmail(ctx, member.email);
    if (matches.length === 1) {
      contact = matches[0];
      contactId = clean(contact.ContactID);
    } else if (matches.length > 1) {
      const message = "More than one Xero contact uses this email. Link the contact manually.";
      await adminClient.from("users").update({
        xero_contact_sync_status: "needs_review",
        xero_contact_sync_error: message,
      }).eq("id", userId);
      await markQueue(adminClient, queueId, { status: "needs_review", last_error: message });
      return { linked: false, needsReview: true, reason: message, matches };
    }
  }

  const payloadContact: Record<string, unknown> = {
    Name: clean(member.name) || clean(member.email),
    EmailAddress: clean(member.email),
  };
  const phone = clean(member.mobile_phone) || clean(member.phone);
  if (phone) payloadContact.Phones = [{ PhoneType: "MOBILE", PhoneNumber: phone }];
  if (clean(member.address)) {
    payloadContact.Addresses = [{ AddressType: "STREET", AddressLine1: clean(member.address) }];
  }
  if (contactId) payloadContact.ContactID = contactId;

  const result = await xeroRequest({
    method: "POST",
    path: "Contacts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    bypassLocalPause: Boolean(ctx.priorityTopupSync),
    body: { Contacts: [payloadContact] },
  });
  contact = result?.Contacts?.[0] || contact;
  contactId = clean(contact?.ContactID) || contactId;
  if (!contactId) throw new Error("Xero did not return a contact ID.");

  const update = {
    xero_contact_id: contactId,
    xero_contact_name: clean(contact?.Name) || clean(member.name),
    xero_contact_email: clean(contact?.EmailAddress) || clean(member.email),
    xero_contact_linked_at: member.xero_contact_id ? member.xero_contact_linked_at : new Date().toISOString(),
    xero_contact_sync_status: "synced",
    xero_contact_sync_error: null,
    xero_contact_last_synced_at: new Date().toISOString(),
  };
  const { error } = await adminClient.from("users").update(update).eq("id", userId);
  if (error) throw error;

  await markQueue(adminClient, queueId, {
    status: "synced",
    processed_at: new Date().toISOString(),
    xero_contact_id: contactId,
    result: { contactId, name: update.xero_contact_name, email: update.xero_contact_email },
  });

  return { linked: true, contactId, contactName: update.xero_contact_name, contactEmail: update.xero_contact_email };
};

const linkContactManually = async (adminClient: SupabaseAdminClient, ctx: any, userId: string, contactId: string) => {
  const result = await xeroRequest({
    path: `Contacts/${encodeURIComponent(contactId)}`,
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
  });
  const contact = result?.Contacts?.[0];
  if (!contact?.ContactID) throw new Error("Xero contact not found.");
  const { error } = await adminClient.from("users").update({
    xero_contact_id: clean(contact.ContactID),
    xero_contact_name: clean(contact.Name),
    xero_contact_email: clean(contact.EmailAddress),
    xero_contact_linked_at: new Date().toISOString(),
    xero_contact_sync_status: "linked",
    xero_contact_sync_error: null,
  }).eq("id", userId);
  if (error) throw error;
  return { linked: true, contactId: clean(contact.ContactID), contactName: clean(contact.Name), contactEmail: clean(contact.EmailAddress) };
};

const getFlightLog = async (adminClient: SupabaseAdminClient, flightLogId: string) => {
  const { data, error } = await adminClient
    .from("flight_logs")
    .select(`
      id, booking_id, student_id, instructor_id, aircraft_id, start_time, end_time, flight_duration,
      calculated_cost, total_cost, payment_status, payment_type, flight_type_id,
      xero_invoice_id, xero_invoice_number, xero_invoice_status, xero_payment_id,
      booking:booking_id(
        id,
        is_guest_booking,
        guest_name,
        guest_email,
        guest_phone
      ),
      aircraft:aircraft_id(
        registration,
        make,
        model,
        xero_tracking_category_id,
        xero_tracking_category_name,
        xero_tracking_option_id,
        xero_tracking_option_name
      ),
      student:student_id(id, name, email, xero_contact_id),
      instructor:instructor_id(name),
      flight_types(name, xero_item_code)
    `)
    .eq("id", flightLogId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Flight log not found.");
  return data;
};

const getGroundSessionLog = async (adminClient: SupabaseAdminClient, groundSessionLogId: string) => {
  const { data, error } = await adminClient
    .from("ground_session_logs")
    .select(`
      id, booking_id, student_id, instructor_id, start_time, end_time, duration_hours,
      calculated_cost, payment_status, payment_type, flight_type_id, description_text,
      xero_invoice_id, xero_invoice_number, xero_invoice_status, xero_payment_id,
      student:student_id(id, name, email, xero_contact_id),
      instructor:instructor_id(name),
      ground_session_description_options(name, pricing_mode),
      flight_types(name, xero_item_code)
    `)
    .eq("id", groundSessionLogId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Ground session log not found.");
  return data;
};

const buildAircraftTrackingPayload = (aircraft: any) => {
  const categoryId = clean(aircraft?.xero_tracking_category_id);
  const categoryName = clean(aircraft?.xero_tracking_category_name);
  const optionId = clean(aircraft?.xero_tracking_option_id);
  const optionName = clean(aircraft?.xero_tracking_option_name);

  if ((!categoryId && !categoryName) || (!optionId && !optionName)) {
    return undefined;
  }

  return [{
    ...(categoryId ? { TrackingCategoryID: categoryId } : { Name: categoryName }),
    ...(optionId ? { TrackingOptionID: optionId } : { Option: optionName }),
  }];
};

const getXeroInvoice = async (ctx: any, invoiceId: string) => {
  const result = await xeroRequest({
    path: `Invoices/${encodeURIComponent(invoiceId)}`,
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
  });
  return result?.Invoices?.[0] || null;
};

const updateXeroInvoiceStatus = async (ctx: any, invoiceId: string, status: "DELETED" | "VOIDED") => {
  const result = await xeroRequest({
    method: "POST",
    path: "Invoices",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Invoices: [{
        InvoiceID: invoiceId,
        Status: status,
      }],
    },
  });

  return result?.Invoices?.[0] || null;
};

const buildFlightReference = (flight: any) => {
  const aircraft = Array.isArray(flight?.aircraft) ? flight.aircraft[0] : flight?.aircraft;
  return truncateText([
    "Flight",
    getFlightContactLabel(flight),
    clean(aircraft?.registration),
    humanDate(flight?.start_time),
  ].filter(Boolean).join(" - "));
};

const buildGroundSessionReference = (session: any) => {
  const student = Array.isArray(session?.student) ? session.student[0] : session?.student;
  return truncateText([
    "Ground",
    clean(student?.name),
    humanDate(session?.start_time),
  ].filter(Boolean).join(" - "));
};

const buildPaymentReference = (flight: any, tx: any, paymentLabel: string) => {
  const aircraft = Array.isArray(flight?.aircraft) ? flight.aircraft[0] : flight?.aircraft;
  const fallback = [
    paymentLabel,
    getFlightContactLabel(flight),
    clean(aircraft?.registration),
    humanDate(tx?.created_at || flight?.start_time),
  ].filter(Boolean).join(" - ");
  return truncateText(clean(tx?.description) || fallback);
};

const createFlightReversalCreditNote = async ({
  adminClient,
  ctx,
  flight,
}: {
  adminClient: SupabaseAdminClient;
  ctx: any;
  flight: any;
}) => {
  const cost = money(flight.calculated_cost ?? flight.total_cost);
  if (cost <= 0) throw new Error("This flight has no billable amount to reverse.");
  if (!ctx.settings?.revenue_account_code) throw new Error("Set a Xero flight revenue account code before reversing this flight.");

  const contactResult = getFlightBooking(flight)?.is_guest_booking
    ? await syncGuestContact(ctx, flight)
    : await syncMemberContact(adminClient, ctx, flight.student_id);
  if (!contactResult?.contactId) throw new Error("Could not link this member to a Xero contact.");

  const aircraft = Array.isArray(flight.aircraft) ? flight.aircraft[0] : flight.aircraft;
  const flightType = Array.isArray(flight.flight_types) ? flight.flight_types[0] : flight.flight_types;
  const instructor = Array.isArray(flight.instructor) ? flight.instructor[0] : flight.instructor;
  const description = [
    "Reversal",
    flightType?.name || "Flight",
    aircraft?.registration ? `Aircraft ${aircraft.registration}` : null,
    flight.flight_duration ? `${Number(flight.flight_duration).toFixed(1)} hr` : null,
    instructor?.name ? `Instructor ${instructor.name}` : null,
  ].filter(Boolean).join(" - ");
  const durationHours = quantityValue(flight.flight_duration);
  const hasDurationQuantity = durationHours > 0;
  const creditQuantity = hasDurationQuantity ? durationHours : 1;
  const unitAmount = hasDurationQuantity ? unitRateValue(cost / durationHours) : cost;
  const aircraftTracking = buildAircraftTrackingPayload(aircraft);

  const result = await xeroRequest({
    method: "PUT",
    path: "CreditNotes",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      CreditNotes: [{
        Type: "ACCRECCREDIT",
        Contact: { ContactID: contactResult.contactId },
        Date: isoDate(flight.start_time),
        Status: "AUTHORISED",
        Reference: truncateText([
          "Reversal",
          clean(flight.xero_invoice_number) || clean(flight.xero_invoice_id) || buildFlightReference(flight),
        ].filter(Boolean).join(" - ")),
        LineAmountTypes: "Inclusive",
        LineItems: [{
          Description: description,
          Quantity: creditQuantity,
          UnitAmount: unitAmount,
          AccountCode: clean(ctx.settings.revenue_account_code),
          ...(clean(ctx.settings.tax_type) ? { TaxType: clean(ctx.settings.tax_type) } : {}),
          ...(aircraftTracking ? { Tracking: aircraftTracking } : {}),
        }],
      }],
    },
  });

  const creditNote = result?.CreditNotes?.[0];
  const creditNoteId = clean(creditNote?.CreditNoteID);
  if (!creditNoteId) {
    throw new Error("Xero did not return a credit note ID.");
  }

  return {
    creditNoteId,
    creditNoteNumber: clean(creditNote?.CreditNoteNumber) || null,
    status: clean(creditNote?.Status) || null,
    total: cost,
  };
};

const allocateCreditNoteToInvoice = async ({
  ctx,
  creditNoteId,
  invoiceId,
  amount,
  date,
}: {
  ctx: any;
  creditNoteId: string;
  invoiceId: string;
  amount: number;
  date: unknown;
}) => {
  if (amount <= 0) return null;

  const result = await xeroRequest({
    method: "PUT",
    path: `CreditNotes/${encodeURIComponent(creditNoteId)}/Allocations`,
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Allocations: [{
        Invoice: { InvoiceID: invoiceId },
        Amount: money(amount),
        Date: isoDate(date),
      }],
    },
  });

  return result?.Allocations?.[0] || null;
};

const reverseFlightLogInXero = async ({
  adminClient,
  ctx,
  flightLogId,
  mode,
}: {
  adminClient: SupabaseAdminClient;
  ctx: any;
  flightLogId: string;
  mode: "void-delete" | "credit-note";
}) => {
  const flight = await getFlightLog(adminClient, flightLogId);
  const invoiceId = clean(flight.xero_invoice_id);
  if (!invoiceId) {
    return { ok: true, action: "crm-only", message: "No Xero invoice linked to this flight log." };
  }

  const invoice = await getXeroInvoice(ctx, invoiceId);
  if (!invoice?.InvoiceID) {
    throw new Error("The linked Xero invoice could not be found.");
  }

  const invoiceStatus = clean(invoice.Status).toUpperCase();
  const { data: paymentRows, error: paymentRowsError } = await adminClient
    .from("account_transactions")
    .select("id, xero_payment_id")
    .eq("flight_log_id", flightLogId)
    .eq("type", "flight_charge");
  if (paymentRowsError) throw paymentRowsError;

  const hasPayments = Boolean(clean(flight.xero_payment_id)) || (paymentRows || []).some((row: any) => clean(row.xero_payment_id));

  if (mode === "void-delete") {
    if (hasPayments || invoiceStatus === "PAID" || invoiceStatus === "PARTPAID") {
      throw new Error("This Xero invoice already has payments. Use the credit note reversal flow instead.");
    }

    const targetStatus = invoiceStatus === "DRAFT" || invoiceStatus === "SUBMITTED"
      ? "DELETED"
      : "VOIDED";
    const updatedInvoice = await updateXeroInvoiceStatus(ctx, invoiceId, targetStatus);

    return {
      ok: true,
      action: targetStatus.toLowerCase(),
      invoiceId,
      invoiceNumber: clean(updatedInvoice?.InvoiceNumber) || clean(invoice.InvoiceNumber) || null,
      invoiceStatus: clean(updatedInvoice?.Status) || targetStatus,
    };
  }

  const creditNote = await createFlightReversalCreditNote({ adminClient, ctx, flight });
  const invoiceAmountDue = money((invoice as any)?.AmountDue);
  let allocation: any = null;
  if (invoiceAmountDue > 0) {
    allocation = await allocateCreditNoteToInvoice({
      ctx,
      creditNoteId: creditNote.creditNoteId,
      invoiceId,
      amount: Math.min(creditNote.total || 0, invoiceAmountDue),
      date: flight.start_time,
    });
  }
  return {
    ok: true,
    action: "credit-note",
    invoiceId,
    invoiceNumber: clean(invoice.InvoiceNumber) || clean(flight.xero_invoice_number) || null,
    invoiceStatus,
    creditNoteId: creditNote.creditNoteId,
    creditNoteNumber: creditNote.creditNoteNumber,
    creditNoteStatus: creditNote.status,
    allocationAmount: allocation ? money((allocation as any)?.Amount || 0) : 0,
    settlementStatus: allocation ? "allocated_to_invoice" : "open_credit_on_contact",
  };
};

const getLinkedVoucherForFlight = async (adminClient: SupabaseAdminClient, bookingId: string | null | undefined) => {
  const id = clean(bookingId);
  if (!id) return null;

  const { data, error } = await adminClient
    .from("bookings")
    .select(`
      id,
      trial_flight_voucher_id,
      voucher:trial_flight_voucher_id(
        id,
        code,
        status,
        payment_status,
        payment_source,
        payment_amount,
        xero_sale_journal_id,
        xero_redemption_journal_id
      )
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const voucher = Array.isArray(data?.voucher) ? data?.voucher[0] : data?.voucher;
  return voucher?.id ? voucher : null;
};

const getVoucher = async (adminClient: SupabaseAdminClient, voucherId: string) => {
  const { data, error } = await adminClient
    .from("trial_flight_vouchers")
    .select(`
      id,
      code,
      product_id,
      purchaser_name,
      purchaser_email,
      status,
      payment_status,
      payment_source,
      payment_amount,
      payment_currency,
      paid_at,
      payer_user_id,
      booked_booking_id,
      xero_sale_journal_id,
      xero_sale_bank_transaction_id,
      xero_purchaser_contact_id,
      xero_redemption_journal_id,
      xero_sync_status,
      notes,
      product:product_id(name)
    `)
    .eq("id", voucherId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Voucher not found.");
  return {
    ...data,
    product: Array.isArray(data.product) ? data.product[0] : data.product,
  };
};

const getVoucherRedemptionFlight = async (adminClient: SupabaseAdminClient, bookingId: string | null | undefined) => {
  const id = clean(bookingId);
  if (!id) return null;

  const { data, error } = await adminClient
    .from("flight_logs")
    .select(`
      id,
      booking_id,
      start_time,
      calculated_cost,
      total_cost,
      xero_invoice_id,
      xero_invoice_number,
      xero_sync_status,
      aircraft:aircraft_id(registration),
      flight_types(name)
    `)
    .eq("booking_id", id)
    .order("start_time", { ascending: false })
    .limit(1);
  if (error) throw error;
  const flight = (data || [])[0];
  if (!flight) return null;
  return {
    ...flight,
    aircraft: Array.isArray(flight.aircraft) ? flight.aircraft[0] : flight.aircraft,
    flight_types: Array.isArray(flight.flight_types) ? flight.flight_types[0] : flight.flight_types,
  };
};

const createOrUpdateFlightInvoice = async (adminClient: SupabaseAdminClient, ctx: any, flightLogId: string, queueId: string | null = null) => {
  await markQueue(adminClient, queueId, { status: "processing" });
  const flight = await getFlightLog(adminClient, flightLogId);
  const linkedVoucher = await getLinkedVoucherForFlight(adminClient, flight.booking_id);
  if (linkedVoucher) {
    const voucherCode = clean(linkedVoucher.code);
    if (clean(linkedVoucher.payment_status) === "paid") {
      throw new Error(`This flight is covered by gift voucher ${voucherCode || linkedVoucher.id}. Sync the voucher liability release instead of creating a Xero invoice.`);
    }
    throw new Error(`This flight is linked to gift voucher ${voucherCode || linkedVoucher.id}, but that voucher is not fully paid. Review the voucher before creating a Xero invoice.`);
  }
  const cost = money(flight.calculated_cost ?? flight.total_cost);
  if (cost <= 0) throw new Error("This flight has no billable amount.");
  if (!ctx.settings?.revenue_account_code) throw new Error("Set a Xero flight revenue account code before syncing invoices.");

  const contactResult = getFlightBooking(flight)?.is_guest_booking
    ? await syncGuestContact(ctx, flight)
    : await syncMemberContact(adminClient, ctx, flight.student_id);
  if (!contactResult?.contactId) throw new Error("Could not link this member to a Xero contact.");

  const aircraft = Array.isArray(flight.aircraft) ? flight.aircraft[0] : flight.aircraft;
  const flightType = Array.isArray(flight.flight_types) ? flight.flight_types[0] : flight.flight_types;
  const instructor = Array.isArray(flight.instructor) ? flight.instructor[0] : flight.instructor;
  const description = [
    flightType?.name || "Flight",
    aircraft?.registration ? `Aircraft ${aircraft.registration}` : null,
    flight.flight_duration ? `${Number(flight.flight_duration).toFixed(1)} hr` : null,
    instructor?.name ? `Instructor ${instructor.name}` : null,
  ].filter(Boolean).join(" - ");
  const durationHours = quantityValue(flight.flight_duration);
  const hasDurationQuantity = durationHours > 0;
  const invoiceQuantity = hasDurationQuantity ? durationHours : 1;
  const unitAmount = hasDurationQuantity ? unitRateValue(cost / durationHours) : cost;
  const aircraftTracking = buildAircraftTrackingPayload(aircraft);

  let existingInvoice: any = null;
  if (clean(flight.xero_invoice_id)) {
    existingInvoice = await getXeroInvoice(ctx, clean(flight.xero_invoice_id));
    const existingStatus = clean(existingInvoice?.Status).toUpperCase();
    const updatableStatuses = new Set(["DRAFT", "SUBMITTED"]);
    if (!updatableStatuses.has(existingStatus)) {
      await adminClient.from("flight_logs").update({
        xero_sync_status: "needs_review",
        xero_sync_error: `Xero invoice ${clean(existingInvoice?.InvoiceNumber) || clean(flight.xero_invoice_number) || clean(flight.xero_invoice_id)} is ${existingStatus || "not editable"} and was not updated automatically.`,
      }).eq("id", flightLogId);
      throw makeXeroNeedsReviewError(
        `Xero invoice ${clean(existingInvoice?.InvoiceNumber) || clean(flight.xero_invoice_number) || clean(flight.xero_invoice_id)} is ${existingStatus || "not editable"} and should not be overwritten automatically. Review it in the Xero sync queue.`,
      );
    }
  }

  const invoicePayload: Record<string, unknown> = {
    Type: "ACCREC",
    Contact: { ContactID: contactResult.contactId },
    Date: isoDate(flight.start_time),
    DueDate: isoDate(flight.start_time),
    LineAmountTypes: "Inclusive",
    Status: ctx.settings?.default_invoice_status || "DRAFT",
    Reference: buildFlightReference(flight),
    LineItems: [{
      Description: description,
      Quantity: invoiceQuantity,
      UnitAmount: unitAmount,
      ...(clean(flightType?.xero_item_code) ? { ItemCode: clean(flightType.xero_item_code).toUpperCase() } : {}),
      AccountCode: clean(ctx.settings.revenue_account_code),
      ...(clean(ctx.settings.tax_type) ? { TaxType: clean(ctx.settings.tax_type) } : {}),
      ...(aircraftTracking ? { Tracking: aircraftTracking } : {}),
    }],
  };
  if (flight.xero_invoice_id) invoicePayload.InvoiceID = flight.xero_invoice_id;

  const result = await xeroRequest({
    method: "POST",
    path: "Invoices",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: { Invoices: [invoicePayload] },
  });
  const invoice = result?.Invoices?.[0];
  const invoiceId = clean(invoice?.InvoiceID);
  if (!invoiceId) throw new Error("Xero did not return an invoice ID.");

  const invoiceUpdate = {
    xero_invoice_id: invoiceId,
    xero_invoice_number: clean(invoice?.InvoiceNumber) || null,
    xero_invoice_status: clean(invoice?.Status) || null,
    xero_invoice_synced_at: new Date().toISOString(),
    xero_sync_status: "synced",
    xero_sync_error: null,
  };
  const { error } = await adminClient.from("flight_logs").update(invoiceUpdate).eq("id", flightLogId);
  if (error) throw error;

  await markQueue(adminClient, queueId, {
    status: "synced",
    processed_at: new Date().toISOString(),
    xero_contact_id: contactResult.contactId,
    xero_invoice_id: invoiceId,
    result: { invoiceId, invoiceNumber: invoiceUpdate.xero_invoice_number, status: invoiceUpdate.xero_invoice_status },
  });

  return { invoiceId, invoiceNumber: invoiceUpdate.xero_invoice_number, status: invoiceUpdate.xero_invoice_status };
};

const applyFlightPayments = async (adminClient: SupabaseAdminClient, ctx: any, flightLogId: string, queueId: string | null = null) => {
  await markQueue(adminClient, queueId, { status: "processing" });
  const flight = await getFlightLog(adminClient, flightLogId);
  const invoiceId = clean(flight.xero_invoice_id);
  if (!invoiceId) throw new Error("Sync the Xero invoice before applying payments.");
  const flightContactId = clean(flight?.student?.xero_contact_id);
  const latestInvoice = await getXeroInvoice(ctx, invoiceId);
  let invoiceRemaining = money(latestInvoice?.AmountDue ?? flight.calculated_cost ?? 0);

  const { data: txRows, error: txError } = await adminClient
    .from("account_transactions")
    .select("id, amount, description, payment_method_id, created_at, xero_payment_id, xero_fee_bank_transaction_id, payment_methods(name, system_key)")
    .eq("flight_log_id", flightLogId)
    .eq("type", "flight_charge")
    .eq("verified_status", "verified");
  if (txError) throw txError;

  const payments: any[] = [];
  const feeTransactions: any[] = [];
  const skippedPayments: string[] = [];
  for (const tx of txRows || []) {
    const methodName = String(tx.payment_methods?.name || "").toLowerCase();
    const systemKey = String(tx.payment_methods?.system_key || "").toLowerCase();
    const isStripe = systemKey === "stripe" || methodName.includes("stripe") || methodName.includes("card");
    const isPrepaid = systemKey === "pilot_account" || methodName.includes("pilot account") || methodName.includes("prepaid") || methodName.includes("pre-paid");
    const paymentLabel = isStripe ? "Stripe payment" : isPrepaid ? "Prepaid payment" : "Flight payment";
    let paymentIdForRow = clean(tx.xero_payment_id);
    if (!tx.xero_payment_id) {
      if (isPrepaid) {
        if (!flightContactId) {
          const reason = "This member is not linked to a Xero contact, so prepaid credit cannot be allocated.";
          skippedPayments.push(reason);
          await adminClient.from("account_transactions").update({
            xero_sync_status: "needs_review",
            xero_sync_error: reason,
          }).eq("id", tx.id);
          continue;
        }

        const amountToApply = Math.min(money(tx.amount), invoiceRemaining);
        if (amountToApply <= 0.005) {
          continue;
        }

        const creditResult = await applyAvailableCreditToInvoice(ctx, invoiceId, flightContactId, amountToApply);
        if (creditResult.applied + 0.005 < amountToApply) {
          const reason = `Only $${creditResult.applied.toFixed(2)} of Xero prepaid credit could be allocated to this invoice. $${amountToApply.toFixed(2)} was required.`;
          skippedPayments.push(reason);
          await adminClient.from("account_transactions").update({
            xero_sync_status: "needs_review",
            xero_sync_error: reason,
          }).eq("id", tx.id);
          continue;
        }

        const allocationReference = clean(creditResult.allocations.map((allocation: any) => allocation.allocationId || allocation.creditId).filter(Boolean).join(","));
        paymentIdForRow = allocationReference ? `credit-allocation:${allocationReference}` : `credit-allocation:${invoiceId}:${tx.id}`;
        invoiceRemaining = money(invoiceRemaining - creditResult.applied);
        await adminClient.from("account_transactions").update({
          xero_payment_id: paymentIdForRow,
          xero_invoice_id: invoiceId,
          xero_contact_id: flightContactId,
          xero_synced_at: new Date().toISOString(),
          xero_sync_status: "synced",
          xero_sync_error: null,
        }).eq("id", tx.id);
        payments.push({ transactionId: tx.id, paymentId: paymentIdForRow, amount: creditResult.applied, kind: "xero_credit_allocation" });
        continue;
      }

      const accountCode = isStripe
        ? clean(ctx.settings?.stripe_payment_account_code)
        : isPrepaid
          ? clean(ctx.settings?.prepaid_payment_account_code)
          : "";
      if (!accountCode) {
        const reason = !tx.payment_method_id
          ? "Payment method is missing on the flight charge transaction."
          : isPrepaid
            ? "Set the Xero prepaid payment clearing account before applying prepaid flight payments."
            : isStripe
              ? "Set the Xero Stripe clearing account before applying card flight payments."
              : `Payment method ${clean(tx.payment_methods?.name) || tx.payment_method_id} is not mapped to a Xero clearing account.`;
        skippedPayments.push(reason);
        await adminClient.from("account_transactions").update({
          xero_sync_status: "needs_review",
          xero_sync_error: reason,
        }).eq("id", tx.id);
        continue;
      }

      const result = await xeroRequest({
        method: "POST",
        path: "Payments",
        tenantId: ctx.connection.tenant_id,
        accessToken: ctx.connection.access_token,
        body: {
          Payments: [{
            Invoice: { InvoiceID: invoiceId },
            Account: { Code: accountCode },
            Date: isoDate(tx.created_at),
            Amount: money(tx.amount),
            Reference: buildPaymentReference(flight, tx, paymentLabel),
          }],
        },
      });
      const payment = result?.Payments?.[0];
      const paymentId = clean(payment?.PaymentID);
      if (paymentId) {
        paymentIdForRow = paymentId;
        await adminClient.from("account_transactions").update({
          xero_payment_id: paymentId,
          xero_invoice_id: invoiceId,
          xero_synced_at: new Date().toISOString(),
          xero_sync_status: "synced",
          xero_sync_error: null,
        }).eq("id", tx.id);
        payments.push({ transactionId: tx.id, paymentId, amount: money(tx.amount) });
      }
    }

    if (isStripe && paymentIdForRow && !tx.xero_fee_bank_transaction_id) {
      try {
        const feeResult = await syncStripeFeeExpense({
          adminClient,
          ctx,
          flightLogId,
          invoiceId,
          tx,
        });
        if (!feeResult?.skipped) {
          feeTransactions.push(feeResult);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stripe fee sync failed";
        await adminClient.from("account_transactions").update({
          xero_fee_sync_error: message,
        }).eq("id", tx.id);
      }
    }
  }

  if (skippedPayments.length > 0) {
    throw makeXeroNeedsReviewError(skippedPayments.join(" "));
  }

  if (payments.length > 0) {
    await adminClient.from("flight_logs").update({
      xero_payment_id: payments[payments.length - 1].paymentId,
      xero_payment_synced_at: new Date().toISOString(),
    }).eq("id", flightLogId);
  }

  await markQueue(adminClient, queueId, {
    status: "synced",
    processed_at: new Date().toISOString(),
    xero_invoice_id: invoiceId,
    result: { payments, feeTransactions },
  });

  return { invoiceId, payments, feeTransactions, skipped: (txRows || []).length - payments.length };
};

const deleteXeroPayment = async (ctx: any, paymentId: string) => {
  const id = clean(paymentId);
  if (!id || id.startsWith("credit-allocation:")) return null;

  const result = await xeroRequest({
    method: "POST",
    path: "Payments",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: {
      Payments: [{
        PaymentID: id,
        Status: "DELETED",
      }],
    },
  });

  return result?.Payments?.[0] || null;
};

const repairPrepaidFlightCreditAllocation = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  flightLogId: string,
) => {
  const flight = await getFlightLog(adminClient, flightLogId);
  const invoiceId = clean(flight.xero_invoice_id);
  if (!invoiceId) throw new Error("This flight log is not linked to a Xero invoice.");

  const flightContactId = clean(flight?.student?.xero_contact_id);
  if (!flightContactId) {
    throw new Error("This member is not linked to a Xero contact, so prepaid credit cannot be allocated.");
  }

  const { data: txRows, error: txError } = await adminClient
    .from("account_transactions")
    .select("id, amount, payment_method_id, xero_payment_id, payment_methods(name, system_key)")
    .eq("flight_log_id", flightLogId)
    .eq("type", "flight_charge")
    .eq("verified_status", "verified");
  if (txError) throw txError;

  const prepaidRows = (txRows || []).filter((tx: any) => {
    const methodName = String(tx.payment_methods?.name || "").toLowerCase();
    const systemKey = String(tx.payment_methods?.system_key || "").toLowerCase();
    return systemKey === "pilot_account" || methodName.includes("pilot account") || methodName.includes("prepaid") || methodName.includes("pre-paid");
  });

  if (prepaidRows.length === 0) {
    throw new Error("No verified prepaid flight-charge transaction was found for this flight log.");
  }

  const paymentIds = new Set<string>();
  const flightPaymentId = clean(flight.xero_payment_id);
  if (flightPaymentId && !flightPaymentId.startsWith("credit-allocation:")) paymentIds.add(flightPaymentId);
  for (const tx of prepaidRows) {
    const paymentId = clean(tx.xero_payment_id);
    if (paymentId && !paymentId.startsWith("credit-allocation:")) paymentIds.add(paymentId);
  }

  const deletedPayments: any[] = [];
  for (const paymentId of paymentIds) {
    const deleted = await deleteXeroPayment(ctx, paymentId);
    if (deleted) {
      deletedPayments.push({
        paymentId,
        status: clean(deleted.Status) || "DELETED",
      });
    }
  }

  const now = new Date().toISOString();
  const prepaidIds = prepaidRows.map((tx: any) => clean(tx.id)).filter(Boolean);
  if (prepaidIds.length > 0) {
    const { error: txUpdateError } = await adminClient
      .from("account_transactions")
      .update({
        xero_payment_id: null,
        xero_synced_at: null,
        xero_sync_status: "not_synced",
        xero_sync_error: null,
      })
      .in("id", prepaidIds);
    if (txUpdateError) throw txUpdateError;
  }

  const { error: flightUpdateError } = await adminClient
    .from("flight_logs")
    .update({
      xero_payment_id: null,
      xero_payment_synced_at: null,
      xero_sync_status: "pending",
      xero_sync_error: null,
      xero_last_synced_at: now,
    })
    .eq("id", flightLogId);
  if (flightUpdateError) throw flightUpdateError;

  const applied = await applyFlightPayments(adminClient, ctx, flightLogId);
  return {
    repaired: true,
    flightLogId,
    invoiceId,
    deletedPayments,
    applied,
  };
};

const createOrUpdateGroundSessionInvoice = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  groundSessionLogId: string,
  queueId: string | null = null,
) => {
  await markQueue(adminClient, queueId, { status: "processing" });
  const session = await getGroundSessionLog(adminClient, groundSessionLogId);
  const cost = money(session.calculated_cost);
  if (cost <= 0) throw new Error("This ground session has no billable amount.");
  if (!ctx.settings?.revenue_account_code) throw new Error("Set a Xero flight revenue account code before syncing invoices.");

  const contactResult = await syncMemberContact(adminClient, ctx, session.student_id);
  if (!contactResult?.contactId) throw new Error("Could not link this member to a Xero contact.");

  const sessionType = Array.isArray(session.flight_types) ? session.flight_types[0] : session.flight_types;
  const sessionDescription = Array.isArray(session.ground_session_description_options)
    ? session.ground_session_description_options[0]
    : session.ground_session_description_options;
  const instructor = Array.isArray(session.instructor) ? session.instructor[0] : session.instructor;
  const durationHours = quantityValue(session.duration_hours);
  const fixedPrice = clean(sessionDescription?.pricing_mode) === "fixed";
  const invoiceQuantity = fixedPrice ? 1 : durationHours > 0 ? durationHours : 1;
  const unitAmount = fixedPrice ? cost : durationHours > 0 ? unitRateValue(cost / durationHours) : cost;
  const description = [
    clean(session.description_text) || sessionDescription?.name || sessionType?.name || "Ground session",
    !fixedPrice && durationHours > 0 ? `${Number(session.duration_hours).toFixed(2)} hr` : null,
    instructor?.name ? `Instructor ${instructor.name}` : null,
  ].filter(Boolean).join(" - ");

  let existingInvoice: any = null;
  if (clean(session.xero_invoice_id)) {
    existingInvoice = await getXeroInvoice(ctx, clean(session.xero_invoice_id));
    const existingStatus = clean(existingInvoice?.Status).toUpperCase();
    const updatableStatuses = new Set(["DRAFT", "SUBMITTED"]);
    if (!updatableStatuses.has(existingStatus)) {
      await adminClient.from("ground_session_logs").update({
        xero_sync_status: "needs_review",
        xero_sync_error: `Xero invoice ${clean(existingInvoice?.InvoiceNumber) || clean(session.xero_invoice_number) || clean(session.xero_invoice_id)} is ${existingStatus || "not editable"} and was not updated automatically.`,
      }).eq("id", groundSessionLogId);
      throw makeXeroNeedsReviewError(
        `Xero invoice ${clean(existingInvoice?.InvoiceNumber) || clean(session.xero_invoice_number) || clean(session.xero_invoice_id)} is ${existingStatus || "not editable"} and should not be overwritten automatically. Review it in the Xero sync queue.`,
      );
    }
  }

  const invoicePayload: Record<string, unknown> = {
    Type: "ACCREC",
    Contact: { ContactID: contactResult.contactId },
    Date: isoDate(session.start_time),
    DueDate: isoDate(session.start_time),
    LineAmountTypes: "Inclusive",
    Status: ctx.settings?.default_invoice_status || "DRAFT",
    Reference: buildGroundSessionReference(session),
    LineItems: [{
      Description: description,
      Quantity: invoiceQuantity,
      UnitAmount: unitAmount,
      ...(clean(sessionType?.xero_item_code) ? { ItemCode: clean(sessionType.xero_item_code).toUpperCase() } : {}),
      AccountCode: clean(ctx.settings.revenue_account_code),
      ...(clean(ctx.settings.tax_type) ? { TaxType: clean(ctx.settings.tax_type) } : {}),
    }],
  };
  if (session.xero_invoice_id) invoicePayload.InvoiceID = session.xero_invoice_id;

  const result = await xeroRequest({
    method: "POST",
    path: "Invoices",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    body: { Invoices: [invoicePayload] },
  });
  const invoice = result?.Invoices?.[0];
  const invoiceId = clean(invoice?.InvoiceID);
  if (!invoiceId) throw new Error("Xero did not return an invoice ID.");

  const invoiceUpdate = {
    xero_invoice_id: invoiceId,
    xero_invoice_number: clean(invoice?.InvoiceNumber) || null,
    xero_invoice_status: clean(invoice?.Status) || null,
    xero_invoice_synced_at: new Date().toISOString(),
    xero_sync_status: "synced",
    xero_sync_error: null,
  };
  const { error } = await adminClient.from("ground_session_logs").update(invoiceUpdate).eq("id", groundSessionLogId);
  if (error) throw error;

  await markQueue(adminClient, queueId, {
    status: "synced",
    processed_at: new Date().toISOString(),
    xero_contact_id: contactResult.contactId,
    xero_invoice_id: invoiceId,
    result: { invoiceId, invoiceNumber: invoiceUpdate.xero_invoice_number, status: invoiceUpdate.xero_invoice_status },
  });

  return { invoiceId, invoiceNumber: invoiceUpdate.xero_invoice_number, status: invoiceUpdate.xero_invoice_status };
};

const applyGroundSessionPayments = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  groundSessionLogId: string,
  queueId: string | null = null,
) => {
  await markQueue(adminClient, queueId, { status: "processing" });
  const session = await getGroundSessionLog(adminClient, groundSessionLogId);
  const invoiceId = clean(session.xero_invoice_id);
  if (!invoiceId) throw new Error("Sync the Xero invoice before applying payments.");
  const sessionContactId = clean(session?.student?.xero_contact_id);
  const latestInvoice = await getXeroInvoice(ctx, invoiceId);
  let invoiceRemaining = money(latestInvoice?.AmountDue ?? session.calculated_cost ?? 0);

  const { data: txRows, error: txError } = await adminClient
    .from("account_transactions")
    .select("id, amount, description, payment_method_id, created_at, xero_payment_id, payment_methods(name, system_key)")
    .eq("ground_session_log_id", groundSessionLogId)
    .eq("type", "flight_charge")
    .eq("verified_status", "verified");
  if (txError) throw txError;

  const payments: any[] = [];
  const skippedPayments: string[] = [];
  for (const tx of txRows || []) {
    const methodName = String(tx.payment_methods?.name || "").toLowerCase();
    const systemKey = String(tx.payment_methods?.system_key || "").toLowerCase();
    const isPrepaid = systemKey === "pilot_account" || methodName.includes("pilot account") || methodName.includes("prepaid") || methodName.includes("pre-paid");
    if (!isPrepaid) {
      skippedPayments.push(`Payment method ${clean(tx.payment_methods?.name) || tx.payment_method_id} is not mapped to an automatic ground-session Xero payment flow.`);
      continue;
    }

    if (tx.xero_payment_id) {
      payments.push({ transactionId: tx.id, paymentId: clean(tx.xero_payment_id), amount: money(tx.amount) });
      continue;
    }

    if (!sessionContactId) {
      skippedPayments.push("This member is not linked to a Xero contact, so prepaid credit cannot be allocated.");
      await adminClient.from("account_transactions").update({
        xero_sync_status: "needs_review",
        xero_sync_error: "This member is not linked to a Xero contact, so prepaid credit cannot be allocated.",
      }).eq("id", tx.id);
      continue;
    }

    const amountToApply = Math.min(money(tx.amount), invoiceRemaining);
    if (amountToApply <= 0.005) continue;

    const creditResult = await applyAvailableCreditToInvoice(ctx, invoiceId, sessionContactId, amountToApply);
    if (creditResult.applied + 0.005 < amountToApply) {
      const reason = `Only $${creditResult.applied.toFixed(2)} of Xero prepaid credit could be allocated to this ground session invoice. $${amountToApply.toFixed(2)} was required.`;
      skippedPayments.push(reason);
      await adminClient.from("account_transactions").update({
        xero_sync_status: "needs_review",
        xero_sync_error: reason,
      }).eq("id", tx.id);
      continue;
    }

    const allocationReference = clean(creditResult.allocations.map((allocation: any) => allocation.allocationId || allocation.creditId).filter(Boolean).join(","));
    const paymentId = allocationReference ? `credit-allocation:${allocationReference}` : `credit-allocation:${invoiceId}:${tx.id}`;
    invoiceRemaining = money(invoiceRemaining - creditResult.applied);

    await adminClient.from("account_transactions").update({
      xero_payment_id: paymentId,
      xero_invoice_id: invoiceId,
      xero_contact_id: sessionContactId,
      xero_synced_at: new Date().toISOString(),
      xero_sync_status: "synced",
      xero_sync_error: null,
    }).eq("id", tx.id);
    payments.push({ transactionId: tx.id, paymentId, amount: creditResult.applied, kind: "xero_credit_allocation" });
  }

  const paidAmount = payments.reduce((total, item) => total + money(item.amount), 0);
  const now = new Date().toISOString();
  const { error: updateError } = await adminClient
    .from("ground_session_logs")
    .update({
      xero_payment_id: payments[0]?.paymentId || null,
      xero_payment_synced_at: payments.length > 0 ? now : null,
      payment_status: paidAmount >= money(session.calculated_cost) ? "paid" : "pending",
      xero_sync_status: skippedPayments.length > 0 ? "needs_review" : "synced",
      xero_sync_error: skippedPayments.length > 0 ? skippedPayments.join(" ") : null,
      xero_last_synced_at: now,
    })
    .eq("id", groundSessionLogId);
  if (updateError) throw updateError;

  await markQueue(adminClient, queueId, {
    status: skippedPayments.length > 0 ? "needs_review" : "synced",
    processed_at: now,
    xero_invoice_id: invoiceId,
    result: { payments, skippedPayments },
    last_error: skippedPayments.length > 0 ? skippedPayments.join(" ") : null,
  });

  return { invoiceId, payments, skippedPayments };
};

const refreshPaidFlightInvoices = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  flightLogIds: string[] = [],
) => {
  let query = adminClient
    .from("flight_logs")
    .select("id, xero_invoice_id, xero_invoice_number")
    .not("xero_invoice_id", "is", null)
    .or("payment_status.is.null,payment_status.eq.unpaid,payment_status.eq.pending")
    .limit(50);

  const ids = flightLogIds.map(clean).filter(Boolean);
  if (ids.length > 0) {
    query = query.in("id", ids);
  }

  const { data: flights, error } = await query;
  if (error) throw error;

  const updated: any[] = [];
  for (const flight of flights || []) {
    const invoiceId = clean(flight.xero_invoice_id);
    if (!invoiceId) continue;
    const invoice = await getXeroInvoice(ctx, invoiceId);
    const invoiceStatus = clean(invoice?.Status).toUpperCase();
    const payments = Array.isArray(invoice?.Payments) ? invoice.Payments : [];
    const latestPaymentId = clean(payments[payments.length - 1]?.PaymentID);
    const update: Record<string, unknown> = {
      xero_invoice_status: invoiceStatus || null,
      xero_invoice_number: clean(invoice?.InvoiceNumber) || clean(flight.xero_invoice_number) || null,
      xero_invoice_synced_at: new Date().toISOString(),
    };

    if (invoiceStatus === "PAID") {
      update.payment_status = "paid";
      if (latestPaymentId) {
        update.xero_payment_id = latestPaymentId;
        update.xero_payment_synced_at = new Date().toISOString();
      }
    }

    const { error: updateError } = await adminClient
      .from("flight_logs")
      .update(update)
      .eq("id", flight.id);
    if (updateError) throw updateError;

    updated.push({
      flightLogId: flight.id,
      invoiceId,
      invoiceNumber: update.xero_invoice_number,
      status: invoiceStatus || null,
      markedPaid: invoiceStatus === "PAID",
    });
  }

  return {
    checked: (flights || []).length,
    updated,
    paidCount: updated.filter(row => row.markedPaid).length,
  };
};

const syncVoucherLifecycle = async (adminClient: SupabaseAdminClient, ctx: any, voucherId: string, queueId: string | null = null) => {
  await markQueue(adminClient, queueId, { status: "processing" });
  const voucher = await getVoucher(adminClient, voucherId);
  const now = new Date().toISOString();
  const voucherCode = clean(voucher.code) || voucher.id;
  const productName = clean(voucher.product?.name) || "Trial flight voucher";
  const voucherAmount = money(voucher.payment_amount);
  const voucherLiabilityAccountCode = clean(ctx.settings?.voucher_account_code);
  const revenueAccountCode = clean(ctx.settings?.revenue_account_code);

  const setNeedsReview = async (message: string, extraResult: Record<string, unknown> = {}) => {
    await adminClient.from("trial_flight_vouchers").update({
      xero_sync_status: "needs_review",
      xero_sync_error: message,
      xero_last_synced_at: now,
    }).eq("id", voucher.id);

    await markQueue(adminClient, queueId, {
      status: "needs_review",
      last_error: message,
      result: {
        voucherId: voucher.id,
        voucherCode,
        ...extraResult,
      },
    });

    return { needsReview: true, message, ...extraResult };
  };

  if (clean(voucher.payment_status) !== "paid") {
    await adminClient.from("trial_flight_vouchers").update({
      xero_sync_status: "not_synced",
      xero_sync_error: null,
      xero_last_synced_at: now,
    }).eq("id", voucher.id);
    await markQueue(adminClient, queueId, {
      status: "cancelled",
      last_error: null,
      result: { voucherId: voucher.id, voucherCode, skipped: "voucher_not_paid" },
    });
    return { skipped: true, reason: "voucher_not_paid" };
  }

  if (voucherAmount <= 0) {
    return await setNeedsReview("Voucher payment amount is zero. Review this voucher before sending it to Xero.");
  }

  let saleJournalId = clean(voucher.xero_sale_journal_id);
  let saleBankTransactionId = clean(voucher.xero_sale_bank_transaction_id);
  let purchaserContactId = clean(voucher.xero_purchaser_contact_id);
  let redemptionJournalId = clean(voucher.xero_redemption_journal_id);
  const result: Record<string, unknown> = { voucherId: voucher.id, voucherCode };

  if (!saleJournalId && !saleBankTransactionId) {
    if (!voucherLiabilityAccountCode) {
      return await setNeedsReview("Set a Gift voucher liability account in Xero settings before syncing vouchers.");
    }

    let fundingAccountCode = "";
    let saleNarration = `Gift voucher sale ${voucherCode} - ${productName}`;

    if (clean(voucher.payment_source) === "stripe") {
      fundingAccountCode = clean(ctx.settings?.stripe_payment_account_code);
      if (!fundingAccountCode) {
        return await setNeedsReview("Set the Stripe payment clearing account before syncing Stripe-paid vouchers.");
      }

      const purchaserContact = await syncVoucherPurchaserContact(ctx, voucher);
      purchaserContactId = purchaserContact.contactId;
      const saleReceipt = await createVoucherSaleReceipt({
        ctx,
        voucherId: voucher.id,
        voucherCode,
        productName,
        purchaserContactId,
        date: voucher.paid_at || now,
        amount: voucherAmount,
        fundingAccountCode,
        liabilityAccountCode: voucherLiabilityAccountCode,
      });
      saleBankTransactionId = saleReceipt.bankTransactionId;
      result.saleBankTransactionId = saleBankTransactionId;
      result.purchaserContactId = purchaserContactId;

      await adminClient.from("trial_flight_vouchers").update({
        xero_sale_bank_transaction_id: saleBankTransactionId,
        xero_purchaser_contact_id: purchaserContactId,
        xero_sale_synced_at: now,
        xero_last_synced_at: now,
        xero_sync_status: "synced",
        xero_sync_error: null,
      }).eq("id", voucher.id);
    } else if (clean(voucher.payment_source) === "prepaid") {
      fundingAccountCode = clean(ctx.settings?.topup_account_code);
      if (!fundingAccountCode) {
        return await setNeedsReview("Set the Member prepaid liability account before syncing prepaid-funded vouchers.");
      }
      saleNarration = `Gift voucher funded from member prepaid balance ${voucherCode} - ${productName}`;
    } else if (clean(voucher.payment_source) === "manual") {
      return await setNeedsReview("Manual-paid vouchers are left for review so the club can choose the correct bank or cash account in Xero.");
    } else if (clean(voucher.payment_source) === "waived") {
      return await setNeedsReview("Complimentary or waived vouchers are not auto-posted. Review this voucher manually in Xero.");
    } else {
      return await setNeedsReview("Voucher payment source is not set. Save the voucher again or review it manually.");
    }

    if (clean(voucher.payment_source) !== "stripe") {
      const saleJournal = await createManualJournal({
        ctx,
        date: voucher.paid_at || now,
        narration: saleNarration,
        idempotencyKey: `voucher-sale-${voucher.id}`,
        lines: [
          {
            accountCode: fundingAccountCode,
            amount: voucherAmount,
            description: `Funding received for voucher ${voucherCode}`,
          },
          {
            accountCode: voucherLiabilityAccountCode,
            amount: -voucherAmount,
            description: `Voucher liability created for ${voucherCode}`,
          },
        ],
      });

      saleJournalId = saleJournal.journalId;
      result.saleJournalId = saleJournalId;
      await adminClient.from("trial_flight_vouchers").update({
        xero_sale_journal_id: saleJournalId,
        xero_sale_synced_at: now,
        xero_last_synced_at: now,
        xero_sync_status: "synced",
        xero_sync_error: null,
      }).eq("id", voucher.id);
    }
  }

  const redemptionFlight = await getVoucherRedemptionFlight(adminClient, voucher.booked_booking_id);
  if (redemptionFlight && !redemptionJournalId) {
    if (!voucherLiabilityAccountCode) {
      return await setNeedsReview("Set a Gift voucher liability account before releasing redeemed vouchers into revenue.", result);
    }
    if (!revenueAccountCode) {
      return await setNeedsReview("Set a Flight revenue account before releasing redeemed vouchers into revenue.", result);
    }
    if (clean(redemptionFlight.xero_invoice_id)) {
      return await setNeedsReview(
        `Flight log ${redemptionFlight.id} already has Xero invoice ${clean(redemptionFlight.xero_invoice_number) || clean(redemptionFlight.xero_invoice_id)}. Remove or review that invoice before syncing the voucher redemption.`,
        { ...result, flightLogId: redemptionFlight.id },
      );
    }

    const aircraftRegistration = clean(redemptionFlight.aircraft?.registration);
    const flightTypeName = clean(redemptionFlight.flight_types?.name);
    const redemptionNarration = [
      `Gift voucher redeemed ${voucherCode}`,
      productName,
      aircraftRegistration ? `Aircraft ${aircraftRegistration}` : "",
      flightTypeName,
    ].filter(Boolean).join(" - ");

    const redemptionJournal = await createManualJournal({
      ctx,
      date: redemptionFlight.start_time || now,
      narration: redemptionNarration,
      idempotencyKey: `voucher-redemption-${voucher.id}`,
      lines: [
        {
          accountCode: voucherLiabilityAccountCode,
          amount: voucherAmount,
          description: `Voucher liability released for ${voucherCode}`,
        },
        {
          accountCode: revenueAccountCode,
          amount: -voucherAmount,
          description: `Voucher revenue recognised for ${voucherCode}`,
        },
      ],
    });

    redemptionJournalId = redemptionJournal.journalId;
    result.redemptionJournalId = redemptionJournalId;
    result.flightLogId = redemptionFlight.id;
    await adminClient.from("trial_flight_vouchers").update({
      xero_redemption_journal_id: redemptionJournalId,
      xero_redemption_synced_at: now,
      xero_last_synced_at: now,
      xero_sync_status: "synced",
      xero_sync_error: null,
    }).eq("id", voucher.id);
  }

  await adminClient.from("trial_flight_vouchers").update({
    xero_sync_status: "synced",
    xero_sync_error: null,
    xero_last_synced_at: now,
  }).eq("id", voucher.id);

  await markQueue(adminClient, queueId, {
    status: "synced",
    last_error: null,
    processed_at: now,
    result: {
      ...result,
      saleJournalId: saleJournalId || null,
      saleBankTransactionId: saleBankTransactionId || null,
      purchaserContactId: purchaserContactId || null,
      redemptionJournalId: redemptionJournalId || null,
      redeemed: Boolean(redemptionJournalId),
    },
  });

  return {
    saleJournalId: saleJournalId || null,
    saleBankTransactionId: saleBankTransactionId || null,
    purchaserContactId: purchaserContactId || null,
    redemptionJournalId: redemptionJournalId || null,
    redeemed: Boolean(redemptionJournalId),
  };
};

const queueItem = async (
  adminClient: SupabaseAdminClient,
  entityType: string,
  entityId: string,
  action: string,
  requestedBy: string | null,
  payload: Record<string, unknown> = {},
) => {
  const { data, error } = await adminClient
    .from("xero_sync_queue")
    .upsert({
      entity_type: entityType,
      entity_id: entityId,
      action,
      status: "pending",
      requested_by: requestedBy,
      payload,
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "entity_type,entity_id,action,status" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

const queueStatusForEntity = async (
  adminClient: SupabaseAdminClient,
  item: any,
) => {
  if (item.entity_type === "contact") {
    const { data } = await adminClient
      .from("users")
      .select("id,name,email,xero_contact_sync_status")
      .eq("id", item.entity_id)
      .maybeSingle();
    return {
      entityLabel: clean(data?.name) || clean(data?.email) || "Member",
      entityDetail: clean(data?.email) || null,
      recordStatus: clean(data?.xero_contact_sync_status) || null,
    };
  }

  if (item.entity_type === "flight_invoice" || item.entity_type === "flight_payment") {
    const { data } = await adminClient
      .from("flight_logs")
      .select(`
        id,start_time,xero_sync_status,xero_invoice_number,
        student:student_id(name,email),
        aircraft:aircraft_id(registration)
      `)
      .eq("id", item.entity_id)
      .maybeSingle();
    const student = Array.isArray(data?.student) ? data?.student[0] : data?.student;
    const aircraft = Array.isArray(data?.aircraft) ? data?.aircraft[0] : data?.aircraft;
    const date = data?.start_time ? new Date(data.start_time).toLocaleDateString("en-AU") : "";
    return {
      entityLabel: clean(student?.name) || "Flight log",
      entityDetail: [date, clean(aircraft?.registration), clean(data?.xero_invoice_number)].filter(Boolean).join(" · ") || null,
      recordStatus: clean(data?.xero_sync_status) || null,
    };
  }

  if (item.entity_type === "voucher") {
    const { data } = await adminClient
      .from("trial_flight_vouchers")
      .select("id,code,purchaser_name,purchaser_email,status,xero_sync_status")
      .eq("id", item.entity_id)
      .maybeSingle();
    return {
      entityLabel: clean(data?.purchaser_name) || clean(data?.code) || "Voucher",
      entityDetail: [clean(data?.code), clean(data?.purchaser_email)].filter(Boolean).join(" · ") || null,
      recordStatus: clean(data?.xero_sync_status) || clean(data?.status) || null,
    };
  }

  if (item.entity_type === "account_transaction") {
    const { data } = await adminClient
      .from("account_transactions")
      .select(`
        id,
        type,
        amount,
        verified_status,
        xero_sync_status,
        description,
        user:user_id(name,email)
      `)
      .eq("id", item.entity_id)
      .maybeSingle();
    const user = Array.isArray(data?.user) ? data?.user[0] : data?.user;
    return {
      entityLabel: clean(user?.name) || clean(user?.email) || "Account transaction",
      entityDetail: [clean(data?.type), clean(data?.description), money(data?.amount).toFixed(2)].filter(Boolean).join(" · ") || null,
      recordStatus: clean(data?.xero_sync_status) || clean(data?.verified_status) || null,
    };
  }

  return {
    entityLabel: item.entity_type,
    entityDetail: null,
    recordStatus: null,
  };
};

const listQueue = async (adminClient: SupabaseAdminClient, statusFilter = "all", limit = 50) => {
  const { data: statusRows, error: statusError } = await adminClient
    .from("xero_sync_queue")
    .select("status");
  if (statusError) throw statusError;

  let query = adminClient
    .from("xero_sync_queue")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)));

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) throw error;

  const items = await Promise.all(
    (data || []).map(async (item: any) => ({
      ...item,
      ...(await queueStatusForEntity(adminClient, item)),
    })),
  );

  const counts = (statusRows || []).reduce(
    (acc: Record<string, number>, item: any) => {
      acc[item.status] = Number(acc[item.status] || 0) + 1;
      acc.all += 1;
      return acc;
    },
    { all: 0, pending: 0, processing: 0, synced: 0, needs_review: 0, failed: 0, cancelled: 0 },
  );

  return { items, counts };
};

const getStripeTestSyncAllowed = async (adminClient: SupabaseAdminClient) => {
  const { data, error } = await adminClient
    .from("stripe_connect_settings")
    .select("allow_test_mode_xero_sync")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.allow_test_mode_xero_sync);
};

const isTestModeQueueItem = async (adminClient: SupabaseAdminClient, item: any) => {
  if (item.entity_type === "flight_invoice" || item.entity_type === "flight_payment") {
    const { data, error } = await adminClient
      .from("flight_logs")
      .select("is_test_mode,stripe_mode")
      .eq("id", item.entity_id)
      .maybeSingle();
    if (error) throw error;
    return data?.is_test_mode === true || data?.stripe_mode === "test";
  }

  if (item.entity_type === "voucher") {
    const { data, error } = await adminClient
      .from("trial_flight_vouchers")
      .select("is_test_mode,stripe_mode")
      .eq("id", item.entity_id)
      .maybeSingle();
    if (error) throw error;
    return data?.is_test_mode === true || data?.stripe_mode === "test";
  }

  if (item.entity_type === "account_transaction") {
    const { data, error } = await adminClient
      .from("account_transactions")
      .select("is_test_mode,stripe_mode")
      .eq("id", item.entity_id)
      .maybeSingle();
    if (error) throw error;
    return data?.is_test_mode === true || data?.stripe_mode === "test";
  }

  return false;
};

const processQueueRecord = async (adminClient: SupabaseAdminClient, ctx: any, item: any, processedBy: string | null) => {
  await adminClient.from("xero_sync_queue").update({
    status: "processing",
    attempts: Number(item.attempts || 0) + 1,
    processed_by: processedBy,
    updated_at: new Date().toISOString(),
  }).eq("id", item.id);

  try {
    if (await isTestModeQueueItem(adminClient, item)) {
      const allowTestSync = await getStripeTestSyncAllowed(adminClient);
      if (!allowTestSync) {
        throw Object.assign(
          new Error("Skipped: this is a Stripe Test Mode record. Enable test-mode Xero sync in Settings > Integrations only if this should be sent to Xero."),
          { queueStatus: "needs_review" },
        );
      }
    }

    let result: Record<string, unknown>;
    if (item.action === "upsert_contact") {
      result = await syncMemberContact(adminClient, ctx, item.entity_id, item.id);
    } else if (item.action === "create_invoice") {
      result = await createOrUpdateFlightInvoice(adminClient, ctx, item.entity_id, item.id);
    } else if (item.action === "apply_payment") {
      result = await applyFlightPayments(adminClient, ctx, item.entity_id, item.id);
    } else if (item.action === "sync_transaction") {
      result = await syncTopupTransaction(adminClient, ctx, item.entity_id, item.id);
    } else if (item.action === "sync_voucher") {
      result = await syncVoucherLifecycle(adminClient, ctx, item.entity_id, item.id);
    } else {
      throw new Error(`Unsupported Xero queue action: ${item.action}`);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Xero sync failed";
    const attempt = Number(item.attempts || 0) + 1;
    const queueStatus = (error as any)?.queueStatus;
    if (queueStatus === "needs_review") {
      await adminClient.from("xero_sync_queue").update({
        status: "needs_review",
        last_error: message,
        processed_by: processedBy,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      return {
        needsReview: true,
        message,
      };
    }

    if (isRetriableXeroError(error) && attempt < 5) {
      const retryAfterSeconds = Number((error as any)?.retryAfterSeconds || 0);
      const retryDelayMs = retryAfterSeconds > 0
        ? Math.max(getRetryDelayMs(attempt), retryAfterSeconds * 1000)
        : getRetryDelayMs(attempt);
      const nextAttemptAt = new Date(Date.now() + retryDelayMs).toISOString();
      await adminClient.from("xero_sync_queue").update({
        status: "pending",
        last_error: message,
        processed_by: processedBy,
        next_attempt_at: nextAttemptAt,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      return {
        deferred: true,
        message,
        nextAttemptAt,
      };
    }

    await adminClient.from("xero_sync_queue").update({
      status: "failed",
      last_error: message,
      processed_by: processedBy,
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    throw error;
  }
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

    const auth = await authenticateAdmin({ req, supabaseUrl, anonKey, adminClient, serviceRoleKey });
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const ctx: any = await getConnectionAndSettings(adminClient);
    ctx.priorityTopupSync = action === "sync-transaction" && body.priorityTopupSync === true;

    if (action === "queue-member-contact") {
      const userId = clean(body.userId);
      if (!userId) return json({ error: "Missing userId" }, 400);
      const row = await queueItem(adminClient, "contact", userId, "upsert_contact", auth.userId, { reason: "manual_queue" });
      await adminClient.from("users").update({ xero_contact_sync_status: "queued", xero_contact_sync_error: null }).eq("id", userId);
      return json({ queued: true, queueItem: row });
    }

    if (action === "sync-member-contact") {
      const userId = clean(body.userId);
      if (!userId) return json({ error: "Missing userId" }, 400);
      return json(await syncMemberContact(adminClient, ctx, userId));
    }

    if (action === "search-contacts") {
      const email = clean(body.email);
      if (!email) return json({ contacts: [] });
      const contacts = await searchXeroContactsByEmail(ctx, email);
      return json({ contacts: contacts.map((contact: any) => ({
        contactId: clean(contact.ContactID),
        name: clean(contact.Name),
        email: clean(contact.EmailAddress),
      })) });
    }

    if (action === "list-accounts") {
      return json({ accounts: await listXeroAccounts(ctx) });
    }

    if (action === "list-items") {
      return json({ items: await listXeroItems(ctx) });
    }

    if (action === "list-tracking-categories") {
      return json({ categories: await listXeroTrackingCategories(ctx) });
    }

    if (action === "list-queue") {
      const status = clean(body.status || "all").toLowerCase();
      const limit = Number(body.limit || 50);
      return json(await listQueue(adminClient, status, limit));
    }

    if (action === "ensure-stripe-clearing-account") {
      return json(await ensureStripeClearingAccount(ctx));
    }

    if (action === "ensure-prepaid-clearing-account") {
      return json(await ensurePrepaidClearingAccount(ctx));
    }

    if (action === "ensure-topup-receipt-account") {
      return json(await ensureTopupReceiptAccount(ctx));
    }

    if (action === "ensure-voucher-liability-account") {
      return json(await ensureVoucherLiabilityAccount(ctx));
    }

    if (action === "ensure-prepaid-liability-account") {
      return json(await ensurePrepaidLiabilityAccount(ctx));
    }

    if (action === "ensure-stripe-fee-expense-account") {
      return json(await ensureStripeFeeExpenseAccount(ctx));
    }

    if (action === "ensure-aircraft-tracking") {
      const categoryName = clean(body.categoryName);
      const optionName = clean(body.optionName);
      const categoryId = clean(body.categoryId);
      if (!categoryName || !optionName) {
        return json({ error: "Missing categoryName or optionName" }, 400);
      }
      return json(await ensureAircraftTrackingOption(ctx, { categoryName, optionName, categoryId }));
    }

    if (action === "ensure-flight-type-item") {
      const flightTypeId = clean(body.flightTypeId);
      const code = clean(body.code);
      const name = clean(body.name);
      const description = clean(body.description);
      if (!flightTypeId || !code || !name) {
        return json({ error: "Missing flightTypeId, code or name" }, 400);
      }
      return json(await ensureFlightTypeSalesItem(adminClient, ctx, { flightTypeId, code, name, description }));
    }

    if (action === "link-contact") {
      const userId = clean(body.userId);
      const contactId = clean(body.contactId);
      if (!userId || !contactId) return json({ error: "Missing userId or contactId" }, 400);
      return json(await linkContactManually(adminClient, ctx, userId, contactId));
    }

    if (action === "queue-flight-invoice") {
      const flightLogId = clean(body.flightLogId);
      if (!flightLogId) return json({ error: "Missing flightLogId" }, 400);
      const row = await queueItem(adminClient, "flight_invoice", flightLogId, "create_invoice", auth.userId, { reason: "manual_queue" });
      await adminClient.from("flight_logs").update({ xero_sync_status: "queued", xero_sync_error: null }).eq("id", flightLogId);
      return json({ queued: true, queueItem: row });
    }

    if (action === "sync-flight-invoice") {
      const flightLogId = clean(body.flightLogId);
      if (!flightLogId) return json({ error: "Missing flightLogId" }, 400);
      return json(await createOrUpdateFlightInvoice(adminClient, ctx, flightLogId));
    }

    if (action === "apply-flight-payments") {
      const flightLogId = clean(body.flightLogId);
      if (!flightLogId) return json({ error: "Missing flightLogId" }, 400);
      return json(await applyFlightPayments(adminClient, ctx, flightLogId));
    }

    if (action === "repair-prepaid-flight-credit-allocation") {
      const flightLogId = clean(body.flightLogId);
      if (!flightLogId) return json({ error: "Missing flightLogId" }, 400);
      return json(await repairPrepaidFlightCreditAllocation(adminClient, ctx, flightLogId));
    }

    if (action === "sync-ground-session-invoice") {
      const groundSessionLogId = clean(body.groundSessionLogId);
      if (!groundSessionLogId) return json({ error: "Missing groundSessionLogId" }, 400);
      return json(await createOrUpdateGroundSessionInvoice(adminClient, ctx, groundSessionLogId));
    }

    if (action === "apply-ground-session-payments") {
      const groundSessionLogId = clean(body.groundSessionLogId);
      if (!groundSessionLogId) return json({ error: "Missing groundSessionLogId" }, 400);
      return json(await applyGroundSessionPayments(adminClient, ctx, groundSessionLogId));
    }

    if (action === "refresh-paid-flight-invoices") {
      const flightLogIds = Array.isArray(body.flightLogIds) ? body.flightLogIds.map(clean).filter(Boolean) : [];
      return json(await refreshPaidFlightInvoices(adminClient, ctx, flightLogIds));
    }

    if (action === "sync-transaction") {
      const transactionId = clean(body.transactionId);
      if (!transactionId) return json({ error: "Missing transactionId" }, 400);
      return json(await syncTopupTransaction(adminClient, ctx, transactionId));
    }

    if (action === "list-transaction-credit-matches") {
      const transactionId = clean(body.transactionId);
      if (!transactionId) return json({ error: "Missing transactionId" }, 400);
      const tx = await getAccountTransaction(adminClient, transactionId);
      const member = await getMember(adminClient, tx.user_id);
      const contactResult = await syncMemberContact(adminClient, ctx, tx.user_id);
      const contactId = clean(contactResult?.contactId || member.xero_contact_id);
      const { candidates } = await getTopupCreditCandidates(ctx, { ...member, xero_contact_id: contactId }, tx);
      return json({
        transactionId,
        contactId: contactId || null,
        memberName: clean(member.name) || clean(member.email) || "Member",
        candidates: candidates.map((candidate: any) => ({
          id: clean(candidate.id),
          kind: candidate.kind,
          amount: money(candidate.amount),
          status: clean(candidate.status),
          date: candidate.date || null,
          reference: candidate.reference || null,
          exactAmount: Boolean(candidate.exactAmount),
        })),
      });
    }

    if (action === "match-transaction-credit") {
      const transactionId = clean(body.transactionId);
      const creditId = clean(body.creditId);
      const creditKind = clean(body.creditKind).toLowerCase();
      if (!transactionId || !creditId || !creditKind) {
        return json({ error: "Missing transactionId, creditId or creditKind" }, 400);
      }
      if (creditKind !== "overpayment" && creditKind !== "prepayment") {
        return json({ error: "creditKind must be overpayment or prepayment" }, 400);
      }
      const tx = await getAccountTransaction(adminClient, transactionId);
      const member = await getMember(adminClient, tx.user_id);
      const contactResult = await syncMemberContact(adminClient, ctx, tx.user_id);
      const contactId = clean(contactResult?.contactId || member.xero_contact_id);
      if (!contactId) return json({ error: "Member is not linked to a Xero contact yet." }, 400);
      const { candidates } = await getTopupCreditCandidates(ctx, { ...member, xero_contact_id: contactId }, tx);
      const match = candidates.find((candidate: any) => clean(candidate.id) === creditId && candidate.kind === creditKind);
      if (!match) return json({ error: "Selected Xero credit could not be found for this member." }, 404);
      const now = await linkTopupTransactionToCredit({ adminClient, transactionId, contactId, creditId });
      return json({
        matched: true,
        transactionId,
        creditId,
        creditKind,
        syncedAt: now,
      });
    }

    if (action === "unlink-transaction-credit-match") {
      const transactionId = clean(body.transactionId);
      if (!transactionId) return json({ error: "Missing transactionId" }, 400);
      const { error } = await adminClient.from("account_transactions").update({
        xero_bank_transaction_id: null,
        xero_synced_at: null,
        xero_sync_status: "needs_review",
        xero_sync_error: "Xero link was removed manually. Choose the correct credit to match again.",
      }).eq("id", transactionId);
      if (error) throw error;
      return json({ unlinked: true, transactionId });
    }

    if (action === "remove-flight-log") {
      const flightLogId = clean(body.flightLogId);
      const mode = clean(body.mode || "auto").toLowerCase();
      if (!flightLogId) return json({ error: "Missing flightLogId" }, 400);
      const resolvedMode = mode === "credit-note" ? "credit-note" : mode === "void-delete" ? "void-delete" : "";
      if (!resolvedMode) return json({ error: "Mode must be void-delete or credit-note" }, 400);
      const result = await reverseFlightLogInXero({ adminClient, ctx, flightLogId, mode: resolvedMode });
      await clearQueueItemsForFlightLog(adminClient, flightLogId);
      return json(result);
    }

    if (action === "sync-voucher") {
      const voucherId = clean(body.voucherId);
      if (!voucherId) return json({ error: "Missing voucherId" }, 400);
      return json(await syncVoucherLifecycle(adminClient, ctx, voucherId));
    }

    if (action === "process-next") {
      const { data: item, error } = await adminClient
        .from("xero_sync_queue")
        .select("*")
        .eq("status", "pending")
        .lte("next_attempt_at", new Date().toISOString())
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!item) return json({ processed: false, message: "No pending Xero sync work." });

      return json({ processed: true, itemId: item.id, result: await processQueueRecord(adminClient, ctx, item, auth.userId) });
    }

    if (action === "process-item") {
      const queueId = clean(body.queueId);
      if (!queueId) return json({ error: "Missing queueId" }, 400);
      const { data: item, error } = await adminClient
        .from("xero_sync_queue")
        .select("*")
        .eq("id", queueId)
        .maybeSingle();
      if (error) throw error;
      if (!item) return json({ error: "Queue item not found" }, 404);
      return json({ processed: true, itemId: item.id, result: await processQueueRecord(adminClient, ctx, item, auth.userId) });
    }

    if (action === "retry-item") {
      const queueId = clean(body.queueId);
      if (!queueId) return json({ error: "Missing queueId" }, 400);
      const { data: item, error } = await adminClient
        .from("xero_sync_queue")
        .update({
          status: "pending",
          last_error: null,
          next_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", queueId)
        .select("*")
        .single();
      if (error) throw error;
      return json({ queued: true, item });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("xero-sync error:", error);
    return json({ error: getErrorMessage(error) }, 500);
  }
});
