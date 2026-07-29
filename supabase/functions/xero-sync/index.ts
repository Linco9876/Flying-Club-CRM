import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getConnectedStripeAccountId,
  stripeHeaders,
  stripeIdempotencyKey,
} from "../_shared/stripeConnectAccount.ts";
import {
  getStripeSecretKeyForMode,
  type StripeMode,
} from "../_shared/stripeMode.ts";
import {
  collectionWasSubmitted,
  configuredPaymentRetryDays,
  configuredTechnicalRetryMinutes,
  membershipBillingRetryDelayMs,
  membershipCollectionIdempotencyParts,
  membershipPaymentRetryDelayMs,
  resolveMembershipRevenueMapping,
} from "../_shared/membershipBilling.ts";
import { findExistingActiveXeroBankAccountCode } from "../_shared/xeroAccountRules.ts";
import { XERO_SALES_LINE_AMOUNT_TYPE } from "../_shared/pricingPolicy.ts";
import {
  authenticateAal2AdminOrWorker,
  corsHeadersForRequest,
  isAllowedBrowserOrigin,
} from "../_shared/edgeSecurity.ts";
import { getFreshXeroConnection } from "../_shared/xeroConnection.ts";
import {
  assertTenantBoundQueueItem,
  gstInclusiveImpact,
  isConnectionIndependentXeroAction,
} from "../_shared/xeroSafety.ts";

type SupabaseAdminClient = any;

let corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "https://portal.bendigoflyingclub.com.au",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const clean = (value: unknown) => String(value || "").trim();
const money = (value: unknown) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const quantityValue = (value: unknown) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;
const unitRateValue = (value: unknown) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;
const getErrorMessage = (error: unknown, fallback = "Xero sync failed") => {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "string") return error || fallback;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const direct = clean(value.message) || clean(value.error) ||
      clean(value.details) || clean(value.hint);
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
  return text.length <= maxLength
    ? text
    : text.slice(0, maxLength - 1).trimEnd() + "…";
};
const isoDate = (value: unknown) => {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const parseRetryAfterMs = (value: string | null) => {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
};

let xeroRateLimitAdminClient: SupabaseAdminClient | null = null;
const xeroMaxCallsPerMinute = Math.max(
  1,
  Number(Deno.env.get("XERO_RATE_LIMIT_PER_MINUTE") || 40),
);
const xeroMaxCallsPerDay = Math.max(
  1,
  Number(Deno.env.get("XERO_RATE_LIMIT_PER_DAY") || 4500),
);
const xeroSpacingMs = Math.max(
  0,
  Number(Deno.env.get("XERO_RATE_LIMIT_SPACING_MS") || 1300),
);
const xeroMaxWaitMs = Math.max(
  1000,
  Number(Deno.env.get("XERO_RATE_LIMIT_MAX_WAIT_MS") || 30_000),
);

const waitForXeroApiSlot = async (
  options: { bypassLocalPause?: boolean } = {},
) => {
  if (options.bypassLocalPause) return;
  if (!xeroRateLimitAdminClient) return;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const { data, error } = await xeroRateLimitAdminClient.rpc(
      "claim_xero_api_slot",
      {
        max_calls_per_minute: xeroMaxCallsPerMinute,
        max_calls_per_day: xeroMaxCallsPerDay,
        spacing_ms: xeroSpacingMs,
      },
    );

    if (error) {
      console.warn("Xero rate-limit guard unavailable:", error.message);
      return;
    }

    if (data?.granted) return;

    const waitMs = Math.max(250, Number(data?.waitMs || xeroSpacingMs || 1000));
    if (waitMs > xeroMaxWaitMs) {
      const retryAfterSeconds = Math.ceil(waitMs / 1000);
      throw Object.assign(
        new Error(
          `Xero sync is paused to stay under rate limits. It will retry in about ${retryAfterSeconds} seconds.`,
        ),
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
  if (error) {
    console.warn("Failed to record Xero rate-limit pause:", error.message);
  }
};

const xeroRequest = async ({
  method = "GET",
  path,
  tenantId,
  accessToken,
  body,
  idempotencyKey,
  bypassLocalPause = false,
  requestHeaders = {},
}: {
  method?: string;
  path: string;
  tenantId: string;
  accessToken: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  bypassLocalPause?: boolean;
  requestHeaders?: Record<string, string>;
}) => {
  const persistentOperationId = clean(idempotencyKey);
  if (
    xeroRateLimitAdminClient && persistentOperationId &&
    method.toUpperCase() !== "GET"
  ) {
    const { data: previousOperation, error: lookupError } =
      await xeroRateLimitAdminClient.from("xero_operation_log")
        .select("status,response_summary")
        .eq("tenant_id", tenantId)
        .eq("operation_id", persistentOperationId)
        .maybeSingle();
    if (lookupError) throw lookupError;
    if (
      previousOperation?.status === "confirmed" &&
      previousOperation.response_summary?.apiPayload
    ) {
      return previousOperation.response_summary.apiPayload;
    }
  }
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
        ...(clean(idempotencyKey)
          ? { "Idempotency-Key": clean(idempotencyKey) }
          : {}),
        ...requestHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let payload: any = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { rawResponse: text.slice(0, 1000) };
      }
    }
    const correlationId = clean(
      response.headers.get("Xero-Correlation-Id") ||
        response.headers.get("X-Correlation-Id"),
    );
    const minuteLimitRemaining = Number(
      response.headers.get("X-MinLimit-Remaining"),
    );
    const dayLimitRemaining = Number(
      response.headers.get("X-DayLimit-Remaining"),
    );
    const operationId = persistentOperationId;
    if (xeroRateLimitAdminClient && operationId) {
      const { error: telemetryError } = await xeroRateLimitAdminClient
        .from("xero_operation_log").upsert({
          tenant_id: tenantId,
          operation_id: operationId,
          action: `${method.toUpperCase()} ${path.split("?")[0]}`,
          request_method: method.toUpperCase(),
          request_path: path,
          status: response.ok ? "confirmed" : "failed",
          correlation_id: correlationId || null,
          minute_limit_remaining: Number.isFinite(minuteLimitRemaining)
            ? minuteLimitRemaining
            : null,
          day_limit_remaining: Number.isFinite(dayLimitRemaining)
            ? dayLimitRemaining
            : null,
          retry_after_seconds: Math.ceil(
            parseRetryAfterMs(response.headers.get("Retry-After")) / 1000,
          ) || null,
          response_summary: response.ok
            ? { httpStatus: response.status, apiPayload: payload }
            : { httpStatus: response.status, error: payload },
          updated_at: new Date().toISOString(),
        }, { onConflict: "tenant_id,operation_id" });
      if (telemetryError) {
        console.warn("Unable to record Xero response telemetry:", telemetryError.message);
      }
    }

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("Retry-After"),
      );
      const fallbackDelayMs = Math.min(
        30_000,
        Math.round((1_500 * (2 ** (attempt - 1))) + Math.random() * 750),
      );
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
      const error = new Error(message) as Error & {
        status?: number;
        payload?: unknown;
        retryAfterSeconds?: number | null;
      };
      error.status = response.status;
      error.payload = payload;
      error.retryAfterSeconds = seconds;
      await noteXeroRateLimit(seconds);
      throw error;
    }

    if (!response.ok) {
      const validationMessages = Array.isArray(payload?.Elements)
        ? payload.Elements
          .flatMap((element: any) =>
            Array.isArray(element?.ValidationErrors)
              ? element.ValidationErrors
              : []
          )
          .map((item: any) => clean(item?.Message))
          .filter(Boolean)
        : [];
      const message = validationMessages[0] ||
        payload?.Message ||
        payload?.Title ||
        payload?.Detail ||
        `Xero request failed with HTTP ${response.status}`;
      if (response.status === 401 && path.startsWith("BankTransactions")) {
        throw makeXeroNeedsReviewError(
          "Xero refused the prepaid credit sync. Reconnect Xero in Settings > Integrations so the CRM has bank transaction permission, then retry this sync item.",
        );
      }
      if (
        (response.status === 401 || response.status === 403) &&
        path.startsWith("ManualJournals")
      ) {
        throw makeXeroNeedsReviewError(
          "Xero refused the gift voucher journal. Reconnect Xero in Settings > Integrations to grant Manual Journals permission, and make sure the authorising Xero user has Reports access, then retry this sync item.",
        );
      }
      const error = new Error(message) as Error & {
        status?: number;
        payload?: unknown;
      };
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    if (Number.isFinite(minuteLimitRemaining) && minuteLimitRemaining <= 3) {
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
  const status = typeof (error as any)?.status === "number"
    ? Number((error as any).status)
    : null;
  if (status === 429) return true;
  if (status !== null && status >= 500) return true;
  const message = clean((error as any)?.message).toLowerCase();
  return message.includes("timeout") ||
    message.includes("temporarily unavailable") || message.includes("network");
};

const getConnectionAndSettings = async (
  adminClient: SupabaseAdminClient,
  options: { allowInventory?: boolean } = {},
) => {
  const [
    connection,
    { data: settings, error: settingsError },
  ] = await Promise.all([
    getFreshXeroConnection(adminClient, options),
    adminClient.from("xero_sync_settings").select("*").eq("id", true)
      .maybeSingle(),
  ]);
  if (settingsError) throw settingsError;
  return {
    connection,
    settings: settings || {},
  };
};

const xeroStringLiteral = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const searchXeroContactsByEmail = async (ctx: any, email: string) => {
  const address = clean(email);
  if (!address) return [];
  const where = encodeURIComponent(
    `EmailAddress=="${xeroStringLiteral(address)}"`,
  );
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

const listXeroTaxRates = async (ctx: any) => {
  const result = await xeroRequest({
    path: "TaxRates",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
  });
  return (Array.isArray(result?.TaxRates) ? result.TaxRates : []).map(
    (rate: any) => ({
      taxType: clean(rate.TaxType),
      name: clean(rate.Name),
      status: clean(rate.Status),
      displayTaxRate: money(rate.DisplayTaxRate),
      effectiveRate: money(rate.EffectiveRate),
      canApplyToRevenue: Boolean(rate.CanApplyToRevenue),
      canApplyToExpenses: Boolean(rate.CanApplyToExpenses),
    }),
  );
};

const inventoryCurrentTenant = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
) => {
  const tenantId = clean(ctx.connection.tenant_id);
  const modifiedSince = ctx.connection.last_inventory_at
    ? new Date(ctx.connection.last_inventory_at).toUTCString()
    : "Thu, 01 Jan 1970 00:00:00 GMT";
  const resources = [
    { path: "Contacts", collection: "Contacts", type: "contact", id: "ContactID", number: "ContactNumber" },
    { path: "Invoices", collection: "Invoices", type: "invoice", id: "InvoiceID", number: "InvoiceNumber" },
    { path: "Payments", collection: "Payments", type: "payment", id: "PaymentID", number: "Reference" },
    { path: "BankTransactions", collection: "BankTransactions", type: "bank_transaction", id: "BankTransactionID", number: "Reference" },
    { path: "ManualJournals", collection: "ManualJournals", type: "manual_journal", id: "ManualJournalID", number: "Narration" },
  ];
  const summary: Record<string, number> = {};
  for (const resource of resources) {
    let seen = 0;
    for (let page = 1; page <= 100; page += 1) {
      const result = await xeroRequest({
        path: `${resource.path}?page=${page}`,
        tenantId,
        accessToken: ctx.connection.access_token,
        requestHeaders: { "If-Modified-Since": modifiedSince },
      });
      const rows = Array.isArray(result?.[resource.collection])
        ? result[resource.collection]
        : [];
      if (!rows.length) break;
      const inventoryRows = rows.map((row: any) => ({
        tenant_id: tenantId,
        object_type: resource.type,
        xero_object_id: clean(row[resource.id]),
        object_number: clean(row[resource.number]) || null,
        remote_status: clean(row.Status) || null,
        origin_confidence: "xero_api_verified",
        quarantined: true,
        remote_snapshot: row,
        last_seen_at: new Date().toISOString(),
      })).filter((row: any) => row.xero_object_id);
      if (inventoryRows.length) {
        const { error } = await adminClient.from("xero_external_object_inventory")
          .upsert(inventoryRows, {
            onConflict: "tenant_id,object_type,xero_object_id",
          });
        if (error) throw error;
      }
      seen += inventoryRows.length;
      if (rows.length < 100) break;
    }
    summary[resource.type] = seen;
  }
  const [{ data: localInvoices }, { data: tenantPayments }] = await Promise.all([
    adminClient.from("xero_external_object_inventory")
      .select("id,xero_object_id")
      .eq("tenant_id", tenantId)
      .eq("object_type", "invoice")
      .not("local_table", "is", null),
    adminClient.from("xero_external_object_inventory")
      .select("id,remote_snapshot")
      .eq("tenant_id", tenantId)
      .eq("object_type", "payment")
      .is("local_table", null)
      .eq("origin_confidence", "xero_api_verified"),
  ]);
  const invoiceInventoryByXeroId = new Map(
    (localInvoices || []).map((invoice: any) => [
      clean(invoice.xero_object_id),
      clean(invoice.id),
    ]),
  );
  for (const payment of tenantPayments || []) {
    const invoiceId = clean(payment.remote_snapshot?.Invoice?.InvoiceID);
    const parentInventoryId = invoiceInventoryByXeroId.get(invoiceId);
    if (!parentInventoryId) continue;
    const { error: linkError } = await adminClient
      .from("xero_external_object_inventory").update({
        local_table: "xero_external_object_inventory",
        local_record_id: parentInventoryId,
        source_field: "dependent_invoice_payment",
        reconciliation_note:
          "Payment is linked to a locally linked test invoice and must be removed before that invoice can be voided.",
      }).eq("id", payment.id);
    if (linkError) throw linkError;
  }
  const now = new Date().toISOString();
  await adminClient.from("xero_external_object_inventory").update({
    reconciliation_status: "matched",
    reconciliation_note:
      "The local Xero ID was found in the tenant captured during containment. It remains quarantined until its accounting disposition is reviewed.",
    last_seen_at: now,
  }).eq("tenant_id", tenantId)
    .not("local_table", "is", null)
    .eq("origin_confidence", "xero_api_verified")
    .eq("reconciliation_status", "unreviewed");
  await adminClient.from("xero_external_object_inventory").update({
    reconciliation_status: "difference",
    reconciliation_note:
      "The local Xero ID was not found during the full tenant inventory and requires manual reconciliation.",
    last_seen_at: now,
  }).eq("tenant_id", tenantId)
    .not("local_table", "is", null)
    .eq("origin_confidence", "connection_snapshot_unverified")
    .eq("reconciliation_status", "unreviewed");
  const { count: differenceCount } = await adminClient
    .from("xero_external_object_inventory")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("reconciliation_status", "difference");
  if (Number(differenceCount || 0) > 0) {
    const [{ data: primaryAdmins }, { data: roleAdmins }] = await Promise.all([
      adminClient.from("users").select("id").eq("role", "admin").eq("is_active", true),
      adminClient.from("user_roles").select("user_id").eq("role", "admin"),
    ]);
    const adminIds = Array.from(new Set([
      ...(primaryAdmins || []).map((row: any) => clean(row.id)),
      ...(roleAdmins || []).map((row: any) => clean(row.user_id)),
    ].filter(Boolean)));
    const { data: existingAlert } = await adminClient.from("notifications")
      .select("id").eq("is_read", false)
      .contains("metadata", { xeroInventoryTenantId: tenantId })
      .limit(1).maybeSingle();
    if (!existingAlert && adminIds.length) {
      await adminClient.from("notifications").insert(adminIds.map(userId => ({
        user_id: userId,
        type: "accounting",
        title: "Xero reconciliation differences found",
        message: `${differenceCount} quarantined Xero identifier(s) were not found in the connected tenant inventory.`,
        metadata: {
          xeroInventoryTenantId: tenantId,
          differenceCount,
          path: "/settings?tab=integrations",
        },
        is_read: false,
      })));
    }
  }
  const completedAt = new Date().toISOString();
  const { error } = await adminClient.from("xero_connection_settings").update({
    last_inventory_at: completedAt,
    last_inventory_summary: summary,
    updated_at: completedAt,
  }).eq("id", true);
  if (error) throw error;
  return {
    tenantId,
    modifiedSince,
    completedAt,
    summary,
    differenceCount: Number(differenceCount || 0),
    quarantined: true,
  };
};

const cleanupLegacyTestArtifacts = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  body: any,
) => {
  const connection = ctx.connection;
  const tenantId = clean(connection.tenant_id);
  const required = `CLEAN TEST ARTEFACTS ${clean(connection.tenant_name).toUpperCase()}`;
  if (
    connection.connection_mode !== "inventory_only" ||
    connection.expected_tenant_id ||
    connection.posting_enabled === true
  ) {
    throw Object.assign(
      new Error("Test artefact cleanup is only allowed for the contained, unpinned legacy tenant."),
      { status: 409 },
    );
  }
  if (clean(body.tenantId) !== tenantId || clean(body.confirmation).toUpperCase() !== required) {
    throw Object.assign(
      new Error(`Confirm tenant ${tenantId} and type "${required}".`),
      { status: 400 },
    );
  }
  const { data: artefacts, error } = await adminClient
    .from("xero_external_object_inventory").select("*")
    .eq("tenant_id", tenantId).not("local_table", "is", null)
    .eq("origin_confidence", "xero_api_verified")
    .eq("quarantined", true)
    .order("object_type").order("first_seen_at");
  if (error) throw error;
  const mutationOrder = [
    "payment",
    "bank_transaction",
    "invoice",
    "manual_journal",
  ];
  const ordered = [...(artefacts || [])].sort(
    (left, right) =>
      mutationOrder.indexOf(left.object_type) -
      mutationOrder.indexOf(right.object_type),
  );
  const results: any[] = [];
  for (const artefact of ordered) {
    const objectId = clean(artefact.xero_object_id);
    const type = clean(artefact.object_type);
    if (!mutationOrder.includes(type)) {
      const note = type === "contact"
        ? "Retained until all linked test transactions have been removed; contact archival requires a separate relationship review."
        : "Retained because this object type is configuration, not a financial posting.";
      await adminClient.from("xero_external_object_inventory").update({
        reconciliation_status: "retained",
        reconciliation_note: note,
        reviewed_at: new Date().toISOString(),
      }).eq("id", artefact.id);
      results.push({ id: artefact.id, type, objectId, action: "retained", note });
      continue;
    }
    try {
      const status = clean(artefact.remote_status).toUpperCase();
      if (type === "invoice" && ["PAID", "PARTPAID"].includes(status)) {
        throw makeXeroNeedsReviewError(
          "Paid or part-paid invoices must be reconciled with their payments before voiding.",
        );
      }
      const bankTransactionType = clean(
        artefact.remote_snapshot?.Type,
      ).toUpperCase();
      if (
        type === "bank_transaction" &&
        !["RECEIVE", "SPEND"].includes(bankTransactionType)
      ) {
        throw makeXeroNeedsReviewError(
          `${bankTransactionType || "This bank transaction subtype"} cannot be deleted through the standard Xero bank-transaction update. Review the linked overpayment/prepayment manually in the contained Xero organisation.`,
        );
      }
      const spec = type === "payment"
        ? { path: `Payments/${objectId}`, collection: "Payments", id: "PaymentID", target: "DELETED" }
        : type === "bank_transaction"
        ? { path: `BankTransactions/${objectId}`, collection: "BankTransactions", id: "BankTransactionID", target: "DELETED" }
        : type === "invoice"
        ? { path: `Invoices/${objectId}`, collection: "Invoices", id: "InvoiceID", target: status === "DRAFT" ? "DELETED" : "VOIDED" }
        : { path: `ManualJournals/${objectId}`, collection: "ManualJournals", id: "ManualJournalID", target: "VOIDED" };
      await xeroRequest({
        method: "POST",
        path: spec.path,
        tenantId,
        accessToken: connection.access_token,
        idempotencyKey: `legacy-cleanup:${tenantId}:${type}:${objectId}:${spec.target}`,
        body: {
          [spec.collection]: [{
            [spec.id]: objectId,
            Status: spec.target,
            ...(type === "bank_transaction"
              ? { Type: bankTransactionType }
              : {}),
          }],
        },
      });
      const reconciliationStatus = spec.target === "DELETED" ? "deleted" : "voided";
      await adminClient.from("xero_external_object_inventory").update({
        reconciliation_status: reconciliationStatus,
        reconciliation_note:
          `Test artefact ${spec.target.toLowerCase()} in the contained legacy tenant.`,
        remote_status: spec.target,
        reviewed_at: new Date().toISOString(),
      }).eq("id", artefact.id);
      results.push({ id: artefact.id, type, objectId, action: reconciliationStatus });
    } catch (cleanupError) {
      const message = getErrorMessage(cleanupError);
      await adminClient.from("xero_external_object_inventory").update({
        reconciliation_status: "difference",
        reconciliation_note: message,
        reviewed_at: new Date().toISOString(),
      }).eq("id", artefact.id);
      results.push({ id: artefact.id, type, objectId, action: "needs_review", error: message });
    }
  }
  return {
    tenantId,
    attempted: results.length,
    cleaned: results.filter(item => ["deleted", "voided"].includes(item.action)).length,
    needsReview: results.filter(item => item.action === "needs_review").length,
    retained: results.filter(item => item.action === "retained").length,
    results,
  };
};

const previewMappingImpact = ({
  purpose,
  amount,
  account,
  taxType,
}: {
  purpose: string;
  amount: number;
  account: any;
  taxType: string;
}) => {
  const impact = gstInclusiveImpact(amount, taxType);
  const inclusiveAmount = impact.grossAmount;
  const gst = impact.gstAmount;
  const net = impact.netAmount;
  const isReceipt = [
    "account_topup_receipt",
    "stripe_payment",
    "prepaid_payment",
  ].includes(clean(purpose));
  return {
    lineAmountType: impact.lineAmountType,
    grossAmount: inclusiveAmount,
    netAmount: net,
    gstAmount: gst,
    debit: isReceipt
      ? [{ accountId: clean(account?.accountId), code: clean(account?.code), amount: inclusiveAmount }]
      : [{ account: "Accounts Receivable", amount: inclusiveAmount }],
    credit: isReceipt
      ? [{ account: "Member liability or clearing account", amount: inclusiveAmount }]
      : [
        { accountId: clean(account?.accountId), code: clean(account?.code), amount: net },
        ...(gst ? [{ account: "GST Payable", amount: gst }] : []),
      ],
    warning: inclusiveAmount <= 0
      ? "Enter a positive sample amount before approval."
      : null,
  };
};

const saveMappingDraft = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  body: any,
  actorId: string,
) => {
  const tenantId = clean(ctx.connection.tenant_id);
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (!entries.length) throw Object.assign(new Error("Add at least one mapping entry."), { status: 400 });
  const { data: latest, error: latestError } = await adminClient
    .from("xero_mapping_versions").select("version")
    .eq("tenant_id", tenantId).order("version", { ascending: false })
    .limit(1).maybeSingle();
  if (latestError) throw latestError;
  const version = Number(latest?.version || 0) + 1;
  const { data: mapping, error: mappingError } = await adminClient
    .from("xero_mapping_versions").insert({
      tenant_id: tenantId,
      version,
      status: "draft",
      created_by: actorId,
    }).select("*").single();
  if (mappingError) throw mappingError;
  const rows = entries.map((entry: any) => ({
    mapping_version_id: mapping.id,
    resource_type: clean(entry.resourceType || "account"),
    purpose: clean(entry.purpose),
    local_entity_type: clean(entry.localEntityType) || null,
    local_entity_id: clean(entry.localEntityId) || null,
    xero_object_id: clean(entry.xeroObjectId),
    xero_code: clean(entry.xeroCode) || null,
    xero_name: clean(entry.xeroName) || null,
    account_type: clean(entry.accountType) || null,
    tax_type: clean(entry.taxType) || null,
    effective_from: body.effectiveFrom || null,
    impact_preview: previewMappingImpact({
      purpose: clean(entry.purpose),
      amount: Number(entry.sampleAmount || 110),
      account: {
        accountId: clean(entry.xeroObjectId),
        code: clean(entry.xeroCode),
      },
      taxType: clean(entry.taxType),
    }),
  }));
  if (rows.some((row: any) => !row.purpose || !row.xero_object_id)) {
    throw Object.assign(new Error("Every mapping needs a purpose and Xero object ID."), { status: 400 });
  }
  const { error: entryError } = await adminClient.from("xero_mapping_entries").insert(rows);
  if (entryError) throw entryError;
  return { mapping, entries: rows };
};

const approveMappingVersion = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  body: any,
  actorId: string,
) => {
  const mappingId = clean(body.mappingVersionId);
  const { data: mapping, error } = await adminClient
    .from("xero_mapping_versions").select("*,xero_mapping_entries(*)")
    .eq("id", mappingId).eq("tenant_id", ctx.connection.tenant_id)
    .eq("status", "draft").maybeSingle();
  if (error) throw error;
  if (!mapping) throw Object.assign(new Error("Draft mapping version not found."), { status: 404 });
  const required = `APPROVE XERO MAPPING ${mapping.version}`;
  if (clean(body.confirmation).toUpperCase() !== required) {
    throw Object.assign(new Error(`Type "${required}" to approve this immutable mapping.`), { status: 400 });
  }
  if (clean(body.approvalNote).length < 10) {
    throw Object.assign(new Error("Record the accountant or treasurer approval details."), { status: 400 });
  }
  if (!Array.isArray(mapping.xero_mapping_entries) || !mapping.xero_mapping_entries.length) {
    throw Object.assign(new Error("The mapping has no entries."), { status: 400 });
  }
  const approvedAt = new Date().toISOString();
  const { data: approved, error: updateError } = await adminClient
    .from("xero_mapping_versions").update({
      status: "approved",
      effective_from: body.effectiveFrom || approvedAt,
      approved_by: actorId,
      approval_note: clean(body.approvalNote),
      approved_at: approvedAt,
    }).eq("id", mappingId).eq("status", "draft").select("*").single();
  if (updateError) throw updateError;
  return { approved, postingEnabled: false };
};

const ensureMembershipSalesItem = async (
  ctx: any,
  {
    code,
    name,
    description,
    accountCode,
  }: {
    code: string;
    name: string;
    description: string;
    accountCode?: string;
  },
) => {
  const itemCode = clean(code).toUpperCase();
  const revenueAccountCode = clean(accountCode) ||
    clean(ctx.settings?.revenue_account_code);
  if (!revenueAccountCode) {
    throw makeXeroNeedsReviewError(
      "Set an Accounting Code for this membership product or a default Xero revenue account, then retry membership billing.",
    );
  }

  const existingItems = await listXeroItems(ctx);
  const existing = existingItems.find((item: any) =>
    item.code.toUpperCase() === itemCode
  );
  if (existing && clean(existing.status).toUpperCase() === "DELETED") {
    const recreated = await xeroRequest({
      method: "PUT",
      path: "Items",
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
      idempotencyKey: `membership-item-recreate-${itemCode.toLowerCase()}-${
        clean(existing.itemId)
      }`,
      body: {
        Items: [{
          Code: itemCode,
          Name: name,
          Description: description,
          IsTrackedAsInventory: false,
          SalesDetails: {
            AccountCode: revenueAccountCode,
            TaxType: clean(ctx.settings?.tax_type) || undefined,
          },
        }],
      },
    });
    const recreatedItem = recreated?.Items?.[0];
    if (!recreatedItem?.ItemID) {
      throw makeXeroNeedsReviewError(
        `The deleted Xero item ${itemCode} could not be recreated automatically. Choose another membership item code and retry.`,
      );
    }
    return {
      itemId: clean(recreatedItem.ItemID),
      code: clean(recreatedItem.Code) || itemCode,
      name: clean(recreatedItem.Name) || name,
      description: clean(recreatedItem.Description) || description,
      status: clean(recreatedItem.Status) || "ACTIVE",
      isTrackedAsInventory: false,
    };
  }
  if (existing) return existing;

  const result = await xeroRequest({
    method: "PUT",
    path: "Items",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    idempotencyKey: `membership-item-${itemCode.toLowerCase()}`,
    body: {
      Items: [{
        Code: itemCode,
        Name: name,
        Description: description,
        IsTrackedAsInventory: false,
        SalesDetails: {
          AccountCode: revenueAccountCode,
          TaxType: clean(ctx.settings?.tax_type) || undefined,
        },
      }],
    },
  });
  const created = result?.Items?.[0];
  if (!created?.ItemID) {
    throw new Error(`Xero did not return the newly created ${itemCode} item.`);
  }
  return {
    itemId: clean(created.ItemID),
    code: clean(created.Code) || itemCode,
    name: clean(created.Name) || name,
    description: clean(created.Description) || description,
    status: clean(created.Status) || "ACTIVE",
    isTrackedAsInventory: false,
  };
};

const ensureFlightTypeSalesItem = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  {
    flightTypeId,
    code,
    name,
    description,
    accountCode,
  }: {
    flightTypeId: string;
    code: string;
    name: string;
    description?: string;
    accountCode?: string;
  },
) => {
  const itemCode = clean(code).toUpperCase();
  if (!itemCode) throw new Error("Missing sales item code.");
  const itemName = clean(name) || itemCode;
  const revenueAccountCode = clean(accountCode) ||
    clean(ctx.settings?.revenue_account_code);
  if (!revenueAccountCode) {
    throw new Error(
      "Set an Accounting Code for this Payment Type or a default Xero revenue account before creating its sales item.",
    );
  }

  const existingItems = await listXeroItems(ctx);
  const existing = existingItems.find((item: any) =>
    item.code.toUpperCase() === itemCode
  );

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
      Items: [
        existing?.itemId ? { ItemID: existing.itemId, ...payload } : payload,
      ],
    },
  });

  const item = result?.Items?.[0];
  const resolvedCode = clean(item?.Code) || itemCode;
  const { error } = await adminClient
    .from("flight_types")
    .update({
      xero_item_code: resolvedCode,
      xero_account_code: clean(accountCode) || null,
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
  const categories = Array.isArray(result?.TrackingCategories)
    ? result.TrackingCategories
    : [];
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

  if (!normalizedCategoryName) {
    throw new Error("Tracking category name is required.");
  }
  if (!normalizedOptionName) {
    throw new Error("Tracking option name is required.");
  }

  const categories = await listXeroTrackingCategories(ctx);
  let matchingCategory = categories.find((item: any) =>
    requestedCategoryId && item.trackingCategoryId === requestedCategoryId
  );
  if (!matchingCategory) {
    matchingCategory = categories.find((item: any) =>
      item.name.toLowerCase() === normalizedCategoryName.toLowerCase()
    );
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
      options:
        (Array.isArray(createdCategory.Options) ? createdCategory.Options : [])
          .map((option: any) => ({
            trackingOptionId: clean(option.TrackingOptionID),
            name: clean(option.Name),
            status: clean(option.Status),
          })),
    };
    categoryCreated = true;
    optionCreated = true;
  }

  if (
    clean(matchingCategory.status).toUpperCase() &&
    clean(matchingCategory.status).toUpperCase() !== "ACTIVE"
  ) {
    throw new Error(
      `Xero tracking category "${matchingCategory.name}" is not active.`,
    );
  }

  let matchingOption = (matchingCategory.options || []).find((item: any) =>
    item.name.toLowerCase() === normalizedOptionName.toLowerCase()
  );
  if (
    matchingOption && clean(matchingOption.status).toUpperCase() &&
    clean(matchingOption.status).toUpperCase() !== "ACTIVE"
  ) {
    throw new Error(
      `Xero tracking option "${matchingOption.name}" exists but is not active.`,
    );
  }

  if (!matchingOption) {
    const createOptionResult = await xeroRequest({
      method: "PUT",
      path: `TrackingCategories/${
        encodeURIComponent(matchingCategory.trackingCategoryId)
      }/Options`,
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
        Description:
          "Stripe clearing bank account for CRM card payments and member top-ups.",
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
        Description:
          "Stripe merchant and processing fees from CRM card payments.",
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
        Description:
          "Gift voucher liability for CRM voucher sales until redeemed.",
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
    throw new Error(
      "Xero did not return the member prepaid liability account.",
    );
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

const fetchStripeFeeDetails = async (
  adminClient: SupabaseAdminClient,
  flightLogId: string,
  tx: any,
) => {
  const txMode = tx?.stripe_mode === "test" || tx?.is_test_mode === true
    ? "test"
    : "live";
  let stripeSecretKey = "";
  try {
    stripeSecretKey = getStripeSecretKeyForMode(txMode as StripeMode);
  } catch {
    return null;
  }

  const connectedAccountId = await getConnectedStripeAccountId(adminClient);
  if (!connectedAccountId) return null;

  const description = clean(tx.description);
  const paymentIntentFromDescription =
    (description.match(/pi_[A-Za-z0-9]+/) || [])[0] || "";
  const checkoutSessionFromDescription =
    (description.match(/cs_[A-Za-z0-9]+/) || [])[0] || "";

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
    const sessionResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${
        encodeURIComponent(checkoutSessionFromDescription)
      }`,
      {
        headers: stripeHeaders(stripeSecretKey, connectedAccountId),
      },
    );
    const sessionBody = await sessionResponse.json().catch(() => ({}));
    if (!sessionResponse.ok) {
      throw new Error(
        sessionBody?.error?.message ||
          `Stripe checkout lookup failed with ${sessionResponse.status}`,
      );
    }
    paymentIntentId = clean(sessionBody?.payment_intent);
  }

  if (!paymentIntentId) return null;

  const intentResponse = await fetch(
    `https://api.stripe.com/v1/payment_intents/${
      encodeURIComponent(paymentIntentId)
    }?expand[]=latest_charge.balance_transaction`,
    { headers: stripeHeaders(stripeSecretKey, connectedAccountId) },
  );
  const intentBody = await intentResponse.json().catch(() => ({}));
  if (!intentResponse.ok) {
    throw new Error(
      intentBody?.error?.message ||
        `Stripe payment intent lookup failed with ${intentResponse.status}`,
    );
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
  const expenseAccountCode = clean(
    ctx.settings?.stripe_fee_expense_account_code,
  );
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
          Description: `Stripe processing fee for CRM payment ${
            feeDetails.paymentIntentId || tx.id
          }`,
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
    .select(
      "id,name,email,phone,mobile_phone,address,xero_contact_id,xero_contact_name,xero_contact_email,xero_contact_linked_at",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("CRM member not found.");
  return data;
};

const getRemainingCreditAmount = (item: any) => {
  const remainingCredit = item?.RemainingCredit ??
    item?.RemainingCreditAmount ?? item?.RemainingAmount;
  if (
    remainingCredit === undefined || remainingCredit === null ||
    remainingCredit === ""
  ) return 0;
  return Math.max(0, money(remainingCredit));
};

const getCreditId = (item: any, kind: "overpayment" | "prepayment") =>
  clean(kind === "overpayment" ? item?.OverpaymentID : item?.PrepaymentID);

const normaliseCreditItems = (
  items: any[],
  contactId: string,
  kind: "overpayment" | "prepayment",
) =>
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
    ...normaliseCreditItems(
      overpaymentResult?.Overpayments || [],
      contactId,
      "overpayment",
    ),
    ...normaliseCreditItems(
      prepaymentResult?.Prepayments || [],
      contactId,
      "prepayment",
    ),
  ];
};

const allocateCreditToInvoice = async (
  ctx: any,
  invoiceId: string,
  credit: any,
  amount: number,
) => {
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

const applyAvailableCreditToInvoice = async (
  ctx: any,
  invoiceId: string,
  contactId: string,
  amountDue: number,
) => {
  let remaining = money(amountDue);
  let applied = 0;
  const allocations: Array<Record<string, unknown>> = [];
  if (remaining <= 0.005) return { applied, allocations, remaining: 0 };

  const credits = await fetchContactCreditItems(ctx, contactId);
  for (const credit of credits) {
    if (remaining <= 0.005) break;
    const amount = Math.min(remaining, money(credit.amount));
    if (amount <= 0.005) continue;

    const allocation = await allocateCreditToInvoice(
      ctx,
      invoiceId,
      credit,
      amount,
    );
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
        ? Math.abs(
          new Date(candidateDate).getTime() - new Date(txDate).getTime(),
        )
        : Number.MAX_SAFE_INTEGER;
      return {
        ...candidate,
        exactAmount: Math.abs(money(candidate.amount) - txAmount) < 0.01,
        sameDate: candidateDate === txDate,
        dateDistance,
      };
    })
    .sort((left: any, right: any) => {
      if (left.exactAmount !== right.exactAmount) {
        return left.exactAmount ? -1 : 1;
      }
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

const getFlightBooking = (flight: any) =>
  Array.isArray(flight?.booking) ? flight.booking[0] : flight?.booking;

const getFlightContactLabel = (flight: any) => {
  const booking = getFlightBooking(flight);
  if (booking?.is_guest_booking) {
    return clean(booking?.guest_name) || clean(booking?.guest_email) || "Guest";
  }
  const student = Array.isArray(flight?.student)
    ? flight.student[0]
    : flight?.student;
  return clean(student?.name) || clean(student?.email) || "Member";
};

const syncGuestContact = async (ctx: any, flight: any) => {
  const booking = getFlightBooking(flight);
  if (!booking?.is_guest_booking) {
    throw new Error("This booking is not marked as a guest booking.");
  }

  const guestName = clean(booking?.guest_name);
  const guestEmail = clean(booking?.guest_email);
  const guestPhone = clean(booking?.guest_phone);
  if (!guestName) throw new Error("Guest booking is missing a guest name.");
  if (!guestEmail) throw new Error("Guest booking is missing a guest email.");

  const matches = await searchXeroContactsByEmail(ctx, guestEmail);
  if (matches.length > 1) {
    throw makeXeroNeedsReviewError(
      "More than one Xero contact uses this guest email. Please link or merge the guest contact in Xero first.",
    );
  }

  let contactId = matches.length === 1 ? clean(matches[0]?.ContactID) : "";
  const payloadContact: Record<string, unknown> = {
    Name: guestName,
    EmailAddress: guestEmail,
  };
  if (guestPhone) {
    payloadContact.Phones = [{ PhoneType: "MOBILE", PhoneNumber: guestPhone }];
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

const getAccountTransaction = async (
  adminClient: SupabaseAdminClient,
  transactionId: string,
) => {
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
  const isStripePaymentMethod = paymentSystemKey === "stripe_card" ||
    paymentSystemKey === "stripe_card_payment" ||
    paymentSystemKey === "stripe" ||
    paymentMethodName.includes("stripe");

  if (isStripePaymentMethod) {
    return clean(ctx.settings?.stripe_payment_account_code);
  }

  return clean(ctx.settings?.topup_receipt_account_code);
};

const getXeroBankAccountCode = async (
  ctx: any,
  preferredCode: string,
) => {
  const existingAccounts = await listXeroAccounts(ctx);
  return findExistingActiveXeroBankAccountCode(existingAccounts, preferredCode);
};

const getXeroReceivablesAccountCode = async (ctx: any) => {
  const result = await xeroRequest({
    path: "Accounts",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    bypassLocalPause: Boolean(ctx.priorityTopupSync),
  });
  const accounts = Array.isArray(result?.Accounts) ? result.Accounts : [];
  const receivablesAccount =
    accounts.find((account: any) =>
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
    throw makeXeroNeedsReviewError(
      "Only top-up transactions can be synced as member credit.",
    );
  }
  if (clean(tx.verified_status) !== "verified") {
    throw makeXeroNeedsReviewError(
      "Only verified top-up transactions can be synced to Xero.",
    );
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
  const isStripeTopup = paymentSystemKey === "stripe_card" ||
    paymentSystemKey === "stripe_card_payment" ||
    paymentSystemKey === "stripe" ||
    paymentMethodName.includes("stripe");

  if (isStripeTopup && !clean(tx.stripe_checkout_session_id)) {
    const message =
      "This Stripe top-up has no Stripe checkout confirmation. Re-run it through Stripe checkout or manually confirm the Stripe payment before syncing to Xero.";
    await adminClient.from("account_transactions").update({
      xero_sync_status: "needs_review",
      xero_sync_error: message,
    }).eq("id", tx.id);
    throw makeXeroNeedsReviewError(message);
  }

  const member = await getMember(adminClient, tx.user_id);
  const contactResult = await syncMemberContact(
    adminClient,
    ctx,
    tx.user_id,
    queueId,
  );
  const contactId = clean(contactResult?.contactId || member.xero_contact_id);
  if (!contactId) {
    throw makeXeroNeedsReviewError(
      "This member is not linked to a Xero contact yet.",
    );
  }

  if (!isStripeTopup) {
    const { candidates } = await getTopupCreditCandidates(ctx, {
      ...member,
      xero_contact_id: contactId,
    }, tx);
    const exactMatches = candidates.filter((candidate: any) =>
      candidate.exactAmount
    );

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
    throw makeXeroNeedsReviewError(
      "Xero did not return an active Accounts Receivable account for the prepaid overpayment.",
    );
  }

  const configuredFundingAccountCode = getTopupFundingAccountCode(
    ctx,
    tx.payment_method,
  );
  if (!configuredFundingAccountCode) {
    throw makeXeroNeedsReviewError(
      "Set the member top-up receipt account in Xero settings before syncing Stripe top-ups.",
    );
  }
  const fundingAccountCode = await getXeroBankAccountCode(
    ctx,
    configuredFundingAccountCode,
  );
  if (!fundingAccountCode) {
    throw makeXeroNeedsReviewError(
      "The selected member top-up receipt account is not an active Xero bank account. Choose an existing bank account in Xero settings.",
    );
  }

  const reference = truncateText(
    [
      clean(member.name) || clean(member.email) || "Member",
      "prepaid top-up",
      humanDate(tx.created_at),
    ]
      .filter(Boolean)
      .join(" - "),
    255,
  );
  const description = truncateText(
    clean(tx.description) || "CRM prepaid top-up",
    4000,
  );

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
    throw new Error(
      "Xero did not return a bank transaction ID for the prepaid top-up.",
    );
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
          Description: truncateText(
            `${productName} - voucher ${voucherCode}`,
            4000,
          ),
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
    throw new Error(
      "Xero did not return a bank transaction ID for the voucher sale.",
    );
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
    throw makeXeroNeedsReviewError(
      "The voucher purchaser name is missing. Add it before syncing the voucher to Xero.",
    );
  }
  if (!purchaserEmail) {
    throw makeXeroNeedsReviewError(
      "The voucher purchaser email is missing. Add it before syncing the voucher to Xero.",
    );
  }

  const matches = await searchXeroContactsByEmail(ctx, purchaserEmail);
  if (matches.length > 1) {
    throw makeXeroNeedsReviewError(
      "More than one Xero contact uses this voucher purchaser email. Link or merge the duplicate contacts in Xero before retrying.",
    );
  }

  let contactId = clean(voucher?.xero_purchaser_contact_id) ||
    (matches.length === 1 ? clean(matches[0]?.ContactID) : "");
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
  if (!contactId) {
    throw new Error("Xero did not return a voucher purchaser contact ID.");
  }

  return {
    contactId,
    contactName: clean(contact?.Name) || purchaserName,
    contactEmail: clean(contact?.EmailAddress) || purchaserEmail,
  };
};

const markQueue = async (
  adminClient: SupabaseAdminClient,
  queueId: string | null,
  update: Record<string, unknown>,
) => {
  if (!queueId) return;
  await adminClient.from("xero_sync_queue").update({
    ...update,
    updated_at: new Date().toISOString(),
  }).eq("id", queueId);
};

const clearQueueItemsForFlightLog = async (
  adminClient: SupabaseAdminClient,
  flightLogId: string,
) => {
  const { error } = await adminClient
    .from("xero_sync_queue")
    .delete()
    .or(
      `and(entity_type.eq.flight_invoice,entity_id.eq.${flightLogId}),and(entity_type.eq.flight_payment,entity_id.eq.${flightLogId})`,
    );

  if (error) throw error;
};

const syncMemberContact = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  userId: string,
  queueId: string | null = null,
) => {
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
      const message =
        "More than one Xero contact uses this email. Link the contact manually.";
      await adminClient.from("users").update({
        xero_contact_sync_status: "needs_review",
        xero_contact_sync_error: message,
      }).eq("id", userId);
      await markQueue(adminClient, queueId, {
        status: "needs_review",
        last_error: message,
      });
      return { linked: false, needsReview: true, reason: message, matches };
    }
  }

  const payloadContact: Record<string, unknown> = {
    Name: clean(member.name) || clean(member.email),
    EmailAddress: clean(member.email),
  };
  const phone = clean(member.mobile_phone) || clean(member.phone);
  if (phone) {
    payloadContact.Phones = [{ PhoneType: "MOBILE", PhoneNumber: phone }];
  }
  if (clean(member.address)) {
    payloadContact.Addresses = [{
      AddressType: "STREET",
      AddressLine1: clean(member.address),
    }];
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
    xero_contact_linked_at: member.xero_contact_id
      ? member.xero_contact_linked_at
      : new Date().toISOString(),
    xero_contact_sync_status: "synced",
    xero_contact_sync_error: null,
    xero_contact_last_synced_at: new Date().toISOString(),
  };
  const { error } = await adminClient.from("users").update(update).eq(
    "id",
    userId,
  );
  if (error) throw error;

  await markQueue(adminClient, queueId, {
    status: "synced",
    processed_at: new Date().toISOString(),
    xero_contact_id: contactId,
    result: {
      contactId,
      name: update.xero_contact_name,
      email: update.xero_contact_email,
    },
  });

  return {
    linked: true,
    contactId,
    contactName: update.xero_contact_name,
    contactEmail: update.xero_contact_email,
  };
};

const linkContactManually = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  userId: string,
  contactId: string,
) => {
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
  return {
    linked: true,
    contactId: clean(contact.ContactID),
    contactName: clean(contact.Name),
    contactEmail: clean(contact.EmailAddress),
  };
};

const getFlightLog = async (
  adminClient: SupabaseAdminClient,
  flightLogId: string,
) => {
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
      flight_types(name, xero_item_code, xero_account_code)
    `)
    .eq("id", flightLogId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Flight log not found.");
  return data;
};

const getGroundSessionLog = async (
  adminClient: SupabaseAdminClient,
  groundSessionLogId: string,
) => {
  const { data, error } = await adminClient
    .from("ground_session_logs")
    .select(`
      id, booking_id, student_id, instructor_id, start_time, end_time, duration_hours,
      calculated_cost, payment_status, payment_type, flight_type_id, description_text,
      xero_invoice_id, xero_invoice_number, xero_invoice_status, xero_payment_id,
      student:student_id(id, name, email, xero_contact_id),
      instructor:instructor_id(name),
      ground_session_description_options(name, pricing_mode),
      flight_types(name, xero_item_code, xero_account_code)
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
    ...(categoryId
      ? { TrackingCategoryID: categoryId }
      : { Name: categoryName }),
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

const updateXeroInvoiceStatus = async (
  ctx: any,
  invoiceId: string,
  status: "DELETED" | "VOIDED",
) => {
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
  const aircraft = Array.isArray(flight?.aircraft)
    ? flight.aircraft[0]
    : flight?.aircraft;
  return truncateText(
    [
      "Flight",
      getFlightContactLabel(flight),
      clean(aircraft?.registration),
      humanDate(flight?.start_time),
    ].filter(Boolean).join(" - "),
  );
};

const buildGroundSessionReference = (session: any) => {
  const student = Array.isArray(session?.student)
    ? session.student[0]
    : session?.student;
  return truncateText(
    [
      "Ground",
      clean(student?.name),
      humanDate(session?.start_time),
    ].filter(Boolean).join(" - "),
  );
};

const buildPaymentReference = (flight: any, tx: any, paymentLabel: string) => {
  const aircraft = Array.isArray(flight?.aircraft)
    ? flight.aircraft[0]
    : flight?.aircraft;
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
  if (cost <= 0) {
    throw new Error("This flight has no billable amount to reverse.");
  }
  const flightType = Array.isArray(flight.flight_types)
    ? flight.flight_types[0]
    : flight.flight_types;
  const revenueAccountCode = clean(flightType?.xero_account_code) ||
    clean(ctx.settings?.revenue_account_code);
  if (!revenueAccountCode) {
    throw new Error(
      "Set an Accounting Code for this Payment Type or a default Xero revenue account before reversing this flight.",
    );
  }

  const contactResult = getFlightBooking(flight)?.is_guest_booking
    ? await syncGuestContact(ctx, flight)
    : await syncMemberContact(adminClient, ctx, flight.student_id);
  if (!contactResult?.contactId) {
    throw new Error("Could not link this member to a Xero contact.");
  }

  const aircraft = Array.isArray(flight.aircraft)
    ? flight.aircraft[0]
    : flight.aircraft;
  const instructor = Array.isArray(flight.instructor)
    ? flight.instructor[0]
    : flight.instructor;
  const description = [
    "Reversal",
    flightType?.name || "Flight",
    aircraft?.registration ? `Aircraft ${aircraft.registration}` : null,
    flight.flight_duration
      ? `${Number(flight.flight_duration).toFixed(1)} hr`
      : null,
    instructor?.name ? `Instructor ${instructor.name}` : null,
  ].filter(Boolean).join(" - ");
  const durationHours = quantityValue(flight.flight_duration);
  const hasDurationQuantity = durationHours > 0;
  const creditQuantity = hasDurationQuantity ? durationHours : 1;
  const unitAmount = hasDurationQuantity
    ? unitRateValue(cost / durationHours)
    : cost;
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
        Reference: truncateText(
          [
            "Reversal",
            clean(flight.xero_invoice_number) ||
            clean(flight.xero_invoice_id) || buildFlightReference(flight),
          ].filter(Boolean).join(" - "),
        ),
        LineAmountTypes: XERO_SALES_LINE_AMOUNT_TYPE,
        LineItems: [{
          Description: description,
          Quantity: creditQuantity,
          UnitAmount: unitAmount,
          AccountCode: revenueAccountCode,
          ...(clean(ctx.settings.tax_type)
            ? { TaxType: clean(ctx.settings.tax_type) }
            : {}),
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
    return {
      ok: true,
      action: "crm-only",
      message: "No Xero invoice linked to this flight log.",
    };
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

  const hasPayments = Boolean(clean(flight.xero_payment_id)) ||
    (paymentRows || []).some((row: any) => clean(row.xero_payment_id));

  if (mode === "void-delete") {
    if (
      hasPayments || invoiceStatus === "PAID" || invoiceStatus === "PARTPAID"
    ) {
      throw new Error(
        "This Xero invoice already has payments. Use the credit note reversal flow instead.",
      );
    }

    const targetStatus =
      invoiceStatus === "DRAFT" || invoiceStatus === "SUBMITTED"
        ? "DELETED"
        : "VOIDED";
    const updatedInvoice = await updateXeroInvoiceStatus(
      ctx,
      invoiceId,
      targetStatus,
    );

    return {
      ok: true,
      action: targetStatus.toLowerCase(),
      invoiceId,
      invoiceNumber: clean(updatedInvoice?.InvoiceNumber) ||
        clean(invoice.InvoiceNumber) || null,
      invoiceStatus: clean(updatedInvoice?.Status) || targetStatus,
    };
  }

  const creditNote = await createFlightReversalCreditNote({
    adminClient,
    ctx,
    flight,
  });
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
    invoiceNumber: clean(invoice.InvoiceNumber) ||
      clean(flight.xero_invoice_number) || null,
    invoiceStatus,
    creditNoteId: creditNote.creditNoteId,
    creditNoteNumber: creditNote.creditNoteNumber,
    creditNoteStatus: creditNote.status,
    allocationAmount: allocation ? money((allocation as any)?.Amount || 0) : 0,
    settlementStatus: allocation
      ? "allocated_to_invoice"
      : "open_credit_on_contact",
  };
};

const getLinkedVoucherForFlight = async (
  adminClient: SupabaseAdminClient,
  bookingId: string | null | undefined,
) => {
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
  const voucher = Array.isArray(data?.voucher)
    ? data?.voucher[0]
    : data?.voucher;
  return voucher?.id ? voucher : null;
};

const getVoucher = async (
  adminClient: SupabaseAdminClient,
  voucherId: string,
) => {
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

const getVoucherRedemptionFlight = async (
  adminClient: SupabaseAdminClient,
  bookingId: string | null | undefined,
) => {
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
    aircraft: Array.isArray(flight.aircraft)
      ? flight.aircraft[0]
      : flight.aircraft,
    flight_types: Array.isArray(flight.flight_types)
      ? flight.flight_types[0]
      : flight.flight_types,
  };
};

const createOrUpdateFlightInvoice = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  flightLogId: string,
  queueId: string | null = null,
) => {
  await markQueue(adminClient, queueId, { status: "processing" });
  const flight = await getFlightLog(adminClient, flightLogId);
  const linkedVoucher = await getLinkedVoucherForFlight(
    adminClient,
    flight.booking_id,
  );
  if (linkedVoucher) {
    const voucherCode = clean(linkedVoucher.code);
    if (clean(linkedVoucher.payment_status) === "paid") {
      throw new Error(
        `This flight is covered by gift voucher ${
          voucherCode || linkedVoucher.id
        }. Sync the voucher liability release instead of creating a Xero invoice.`,
      );
    }
    throw new Error(
      `This flight is linked to gift voucher ${
        voucherCode || linkedVoucher.id
      }, but that voucher is not fully paid. Review the voucher before creating a Xero invoice.`,
    );
  }
  const cost = money(flight.calculated_cost ?? flight.total_cost);
  if (cost <= 0) throw new Error("This flight has no billable amount.");
  const flightType = Array.isArray(flight.flight_types)
    ? flight.flight_types[0]
    : flight.flight_types;
  const revenueAccountCode = clean(flightType?.xero_account_code) ||
    clean(ctx.settings?.revenue_account_code);
  if (!revenueAccountCode) {
    throw new Error(
      "Set an Accounting Code for this Payment Type or a default Xero revenue account before syncing invoices.",
    );
  }

  const contactResult = getFlightBooking(flight)?.is_guest_booking
    ? await syncGuestContact(ctx, flight)
    : await syncMemberContact(adminClient, ctx, flight.student_id);
  if (!contactResult?.contactId) {
    throw new Error("Could not link this member to a Xero contact.");
  }

  const aircraft = Array.isArray(flight.aircraft)
    ? flight.aircraft[0]
    : flight.aircraft;
  const instructor = Array.isArray(flight.instructor)
    ? flight.instructor[0]
    : flight.instructor;
  const description = [
    flightType?.name || "Flight",
    aircraft?.registration ? `Aircraft ${aircraft.registration}` : null,
    flight.flight_duration
      ? `${Number(flight.flight_duration).toFixed(1)} hr`
      : null,
    instructor?.name ? `Instructor ${instructor.name}` : null,
  ].filter(Boolean).join(" - ");
  const durationHours = quantityValue(flight.flight_duration);
  const hasDurationQuantity = durationHours > 0;
  const invoiceQuantity = hasDurationQuantity ? durationHours : 1;
  const unitAmount = hasDurationQuantity
    ? unitRateValue(cost / durationHours)
    : cost;
  const aircraftTracking = buildAircraftTrackingPayload(aircraft);

  let existingInvoice: any = null;
  if (clean(flight.xero_invoice_id)) {
    existingInvoice = await getXeroInvoice(ctx, clean(flight.xero_invoice_id));
    const existingStatus = clean(existingInvoice?.Status).toUpperCase();
    const updatableStatuses = new Set(["DRAFT", "SUBMITTED"]);
    if (!updatableStatuses.has(existingStatus)) {
      await adminClient.from("flight_logs").update({
        xero_sync_status: "needs_review",
        xero_sync_error: `Xero invoice ${
          clean(existingInvoice?.InvoiceNumber) ||
          clean(flight.xero_invoice_number) || clean(flight.xero_invoice_id)
        } is ${
          existingStatus || "not editable"
        } and was not updated automatically.`,
      }).eq("id", flightLogId);
      throw makeXeroNeedsReviewError(
        `Xero invoice ${
          clean(existingInvoice?.InvoiceNumber) ||
          clean(flight.xero_invoice_number) || clean(flight.xero_invoice_id)
        } is ${
          existingStatus || "not editable"
        } and should not be overwritten automatically. Review it in the Xero sync queue.`,
      );
    }
  }

  const invoicePayload: Record<string, unknown> = {
    Type: "ACCREC",
    Contact: { ContactID: contactResult.contactId },
    Date: isoDate(flight.start_time),
    DueDate: isoDate(flight.start_time),
    LineAmountTypes: XERO_SALES_LINE_AMOUNT_TYPE,
    Status: ctx.settings?.default_invoice_status || "DRAFT",
    Reference: buildFlightReference(flight),
    LineItems: [{
      Description: description,
      Quantity: invoiceQuantity,
      UnitAmount: unitAmount,
      ...(clean(flightType?.xero_item_code)
        ? { ItemCode: clean(flightType.xero_item_code).toUpperCase() }
        : {}),
      AccountCode: revenueAccountCode,
      ...(clean(ctx.settings.tax_type)
        ? { TaxType: clean(ctx.settings.tax_type) }
        : {}),
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
  const { error } = await adminClient.from("flight_logs").update(invoiceUpdate)
    .eq("id", flightLogId);
  if (error) throw error;

  await markQueue(adminClient, queueId, {
    status: "synced",
    processed_at: new Date().toISOString(),
    xero_contact_id: contactResult.contactId,
    xero_invoice_id: invoiceId,
    result: {
      invoiceId,
      invoiceNumber: invoiceUpdate.xero_invoice_number,
      status: invoiceUpdate.xero_invoice_status,
    },
  });

  return {
    invoiceId,
    invoiceNumber: invoiceUpdate.xero_invoice_number,
    status: invoiceUpdate.xero_invoice_status,
  };
};

const applyFlightPayments = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  flightLogId: string,
  queueId: string | null = null,
) => {
  await markQueue(adminClient, queueId, { status: "processing" });
  const flight = await getFlightLog(adminClient, flightLogId);
  const invoiceId = clean(flight.xero_invoice_id);
  if (!invoiceId) {
    throw new Error("Sync the Xero invoice before applying payments.");
  }
  const flightContactId = clean(flight?.student?.xero_contact_id);
  const latestInvoice = await getXeroInvoice(ctx, invoiceId);
  let invoiceRemaining = money(
    latestInvoice?.AmountDue ?? flight.calculated_cost ?? 0,
  );

  const { data: txRows, error: txError } = await adminClient
    .from("account_transactions")
    .select(
      "id, amount, description, payment_method_id, created_at, xero_payment_id, xero_fee_bank_transaction_id, payment_methods(name, system_key)",
    )
    .eq("flight_log_id", flightLogId)
    .eq("type", "flight_charge")
    .eq("verified_status", "verified");
  if (txError) throw txError;

  const payments: any[] = [];
  const feeTransactions: any[] = [];
  const skippedPayments: string[] = [];
  for (const tx of txRows || []) {
    const methodName = String(tx.payment_methods?.name || "").toLowerCase();
    const systemKey = String(tx.payment_methods?.system_key || "")
      .toLowerCase();
    const isStripe = systemKey === "stripe" || methodName.includes("stripe") ||
      methodName.includes("card");
    const isPrepaid = systemKey === "pilot_account" ||
      methodName.includes("pilot account") || methodName.includes("prepaid") ||
      methodName.includes("pre-paid");
    const paymentLabel = isStripe
      ? "Stripe payment"
      : isPrepaid
      ? "Prepaid payment"
      : "Flight payment";
    let paymentIdForRow = clean(tx.xero_payment_id);
    if (!tx.xero_payment_id) {
      if (isPrepaid) {
        if (!flightContactId) {
          const reason =
            "This member is not linked to a Xero contact, so prepaid credit cannot be allocated.";
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

        const creditResult = await applyAvailableCreditToInvoice(
          ctx,
          invoiceId,
          flightContactId,
          amountToApply,
        );
        if (creditResult.applied + 0.005 < amountToApply) {
          const reason = `Only $${
            creditResult.applied.toFixed(2)
          } of Xero prepaid credit could be allocated to this invoice. $${
            amountToApply.toFixed(2)
          } was required.`;
          skippedPayments.push(reason);
          await adminClient.from("account_transactions").update({
            xero_sync_status: "needs_review",
            xero_sync_error: reason,
          }).eq("id", tx.id);
          continue;
        }

        const allocationReference = clean(
          creditResult.allocations.map((allocation: any) =>
            allocation.allocationId || allocation.creditId
          ).filter(Boolean).join(","),
        );
        paymentIdForRow = allocationReference
          ? `credit-allocation:${allocationReference}`
          : `credit-allocation:${invoiceId}:${tx.id}`;
        invoiceRemaining = money(invoiceRemaining - creditResult.applied);
        await adminClient.from("account_transactions").update({
          xero_payment_id: paymentIdForRow,
          xero_invoice_id: invoiceId,
          xero_contact_id: flightContactId,
          xero_synced_at: new Date().toISOString(),
          xero_sync_status: "synced",
          xero_sync_error: null,
        }).eq("id", tx.id);
        payments.push({
          transactionId: tx.id,
          paymentId: paymentIdForRow,
          amount: creditResult.applied,
          kind: "xero_credit_allocation",
        });
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
          : `Payment method ${
            clean(tx.payment_methods?.name) || tx.payment_method_id
          } is not mapped to a Xero clearing account.`;
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
        payments.push({
          transactionId: tx.id,
          paymentId,
          amount: money(tx.amount),
        });
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
        const message = error instanceof Error
          ? error.message
          : "Stripe fee sync failed";
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

  return {
    invoiceId,
    payments,
    feeTransactions,
    skipped: (txRows || []).length - payments.length,
  };
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
  if (!invoiceId) {
    throw new Error("This flight log is not linked to a Xero invoice.");
  }

  const flightContactId = clean(flight?.student?.xero_contact_id);
  if (!flightContactId) {
    throw new Error(
      "This member is not linked to a Xero contact, so prepaid credit cannot be allocated.",
    );
  }

  const { data: txRows, error: txError } = await adminClient
    .from("account_transactions")
    .select(
      "id, amount, payment_method_id, xero_payment_id, payment_methods(name, system_key)",
    )
    .eq("flight_log_id", flightLogId)
    .eq("type", "flight_charge")
    .eq("verified_status", "verified");
  if (txError) throw txError;

  const prepaidRows = (txRows || []).filter((tx: any) => {
    const methodName = String(tx.payment_methods?.name || "").toLowerCase();
    const systemKey = String(tx.payment_methods?.system_key || "")
      .toLowerCase();
    return systemKey === "pilot_account" ||
      methodName.includes("pilot account") || methodName.includes("prepaid") ||
      methodName.includes("pre-paid");
  });

  if (prepaidRows.length === 0) {
    throw new Error(
      "No verified prepaid flight-charge transaction was found for this flight log.",
    );
  }

  const paymentIds = new Set<string>();
  const flightPaymentId = clean(flight.xero_payment_id);
  if (flightPaymentId && !flightPaymentId.startsWith("credit-allocation:")) {
    paymentIds.add(flightPaymentId);
  }
  for (const tx of prepaidRows) {
    const paymentId = clean(tx.xero_payment_id);
    if (paymentId && !paymentId.startsWith("credit-allocation:")) {
      paymentIds.add(paymentId);
    }
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
  const sessionType = Array.isArray(session.flight_types)
    ? session.flight_types[0]
    : session.flight_types;
  const revenueAccountCode = clean(sessionType?.xero_account_code) ||
    clean(ctx.settings?.revenue_account_code);
  if (!revenueAccountCode) {
    throw new Error(
      "Set an Accounting Code for this Payment Type or a default Xero revenue account before syncing invoices.",
    );
  }

  const contactResult = await syncMemberContact(
    adminClient,
    ctx,
    session.student_id,
  );
  if (!contactResult?.contactId) {
    throw new Error("Could not link this member to a Xero contact.");
  }

  const sessionDescription =
    Array.isArray(session.ground_session_description_options)
      ? session.ground_session_description_options[0]
      : session.ground_session_description_options;
  const instructor = Array.isArray(session.instructor)
    ? session.instructor[0]
    : session.instructor;
  const durationHours = quantityValue(session.duration_hours);
  const fixedPrice = clean(sessionDescription?.pricing_mode) === "fixed";
  const invoiceQuantity = fixedPrice
    ? 1
    : durationHours > 0
    ? durationHours
    : 1;
  const unitAmount = fixedPrice
    ? cost
    : durationHours > 0
    ? unitRateValue(cost / durationHours)
    : cost;
  const description = [
    clean(session.description_text) || sessionDescription?.name ||
    sessionType?.name || "Ground session",
    !fixedPrice && durationHours > 0
      ? `${Number(session.duration_hours).toFixed(2)} hr`
      : null,
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
        xero_sync_error: `Xero invoice ${
          clean(existingInvoice?.InvoiceNumber) ||
          clean(session.xero_invoice_number) || clean(session.xero_invoice_id)
        } is ${
          existingStatus || "not editable"
        } and was not updated automatically.`,
      }).eq("id", groundSessionLogId);
      throw makeXeroNeedsReviewError(
        `Xero invoice ${
          clean(existingInvoice?.InvoiceNumber) ||
          clean(session.xero_invoice_number) || clean(session.xero_invoice_id)
        } is ${
          existingStatus || "not editable"
        } and should not be overwritten automatically. Review it in the Xero sync queue.`,
      );
    }
  }

  const invoicePayload: Record<string, unknown> = {
    Type: "ACCREC",
    Contact: { ContactID: contactResult.contactId },
    Date: isoDate(session.start_time),
    DueDate: isoDate(session.start_time),
    LineAmountTypes: XERO_SALES_LINE_AMOUNT_TYPE,
    Status: ctx.settings?.default_invoice_status || "DRAFT",
    Reference: buildGroundSessionReference(session),
    LineItems: [{
      Description: description,
      Quantity: invoiceQuantity,
      UnitAmount: unitAmount,
      ...(clean(sessionType?.xero_item_code)
        ? { ItemCode: clean(sessionType.xero_item_code).toUpperCase() }
        : {}),
      AccountCode: revenueAccountCode,
      ...(clean(ctx.settings.tax_type)
        ? { TaxType: clean(ctx.settings.tax_type) }
        : {}),
    }],
  };
  if (session.xero_invoice_id) {
    invoicePayload.InvoiceID = session.xero_invoice_id;
  }

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
  const { error } = await adminClient.from("ground_session_logs").update(
    invoiceUpdate,
  ).eq("id", groundSessionLogId);
  if (error) throw error;

  await markQueue(adminClient, queueId, {
    status: "synced",
    processed_at: new Date().toISOString(),
    xero_contact_id: contactResult.contactId,
    xero_invoice_id: invoiceId,
    result: {
      invoiceId,
      invoiceNumber: invoiceUpdate.xero_invoice_number,
      status: invoiceUpdate.xero_invoice_status,
    },
  });

  return {
    invoiceId,
    invoiceNumber: invoiceUpdate.xero_invoice_number,
    status: invoiceUpdate.xero_invoice_status,
  };
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
  if (!invoiceId) {
    throw new Error("Sync the Xero invoice before applying payments.");
  }
  const sessionContactId = clean(session?.student?.xero_contact_id);
  const latestInvoice = await getXeroInvoice(ctx, invoiceId);
  let invoiceRemaining = money(
    latestInvoice?.AmountDue ?? session.calculated_cost ?? 0,
  );

  const { data: txRows, error: txError } = await adminClient
    .from("account_transactions")
    .select(
      "id, amount, description, payment_method_id, created_at, xero_payment_id, payment_methods(name, system_key)",
    )
    .eq("ground_session_log_id", groundSessionLogId)
    .eq("type", "flight_charge")
    .eq("verified_status", "verified");
  if (txError) throw txError;

  const payments: any[] = [];
  const skippedPayments: string[] = [];
  for (const tx of txRows || []) {
    const methodName = String(tx.payment_methods?.name || "").toLowerCase();
    const systemKey = String(tx.payment_methods?.system_key || "")
      .toLowerCase();
    const isPrepaid = systemKey === "pilot_account" ||
      methodName.includes("pilot account") || methodName.includes("prepaid") ||
      methodName.includes("pre-paid");
    if (!isPrepaid) {
      skippedPayments.push(
        `Payment method ${
          clean(tx.payment_methods?.name) || tx.payment_method_id
        } is not mapped to an automatic ground-session Xero payment flow.`,
      );
      continue;
    }

    if (tx.xero_payment_id) {
      payments.push({
        transactionId: tx.id,
        paymentId: clean(tx.xero_payment_id),
        amount: money(tx.amount),
      });
      continue;
    }

    if (!sessionContactId) {
      skippedPayments.push(
        "This member is not linked to a Xero contact, so prepaid credit cannot be allocated.",
      );
      await adminClient.from("account_transactions").update({
        xero_sync_status: "needs_review",
        xero_sync_error:
          "This member is not linked to a Xero contact, so prepaid credit cannot be allocated.",
      }).eq("id", tx.id);
      continue;
    }

    const amountToApply = Math.min(money(tx.amount), invoiceRemaining);
    if (amountToApply <= 0.005) continue;

    const creditResult = await applyAvailableCreditToInvoice(
      ctx,
      invoiceId,
      sessionContactId,
      amountToApply,
    );
    if (creditResult.applied + 0.005 < amountToApply) {
      const reason = `Only $${
        creditResult.applied.toFixed(2)
      } of Xero prepaid credit could be allocated to this ground session invoice. $${
        amountToApply.toFixed(2)
      } was required.`;
      skippedPayments.push(reason);
      await adminClient.from("account_transactions").update({
        xero_sync_status: "needs_review",
        xero_sync_error: reason,
      }).eq("id", tx.id);
      continue;
    }

    const allocationReference = clean(
      creditResult.allocations.map((allocation: any) =>
        allocation.allocationId || allocation.creditId
      ).filter(Boolean).join(","),
    );
    const paymentId = allocationReference
      ? `credit-allocation:${allocationReference}`
      : `credit-allocation:${invoiceId}:${tx.id}`;
    invoiceRemaining = money(invoiceRemaining - creditResult.applied);

    await adminClient.from("account_transactions").update({
      xero_payment_id: paymentId,
      xero_invoice_id: invoiceId,
      xero_contact_id: sessionContactId,
      xero_synced_at: new Date().toISOString(),
      xero_sync_status: "synced",
      xero_sync_error: null,
    }).eq("id", tx.id);
    payments.push({
      transactionId: tx.id,
      paymentId,
      amount: creditResult.applied,
      kind: "xero_credit_allocation",
    });
  }

  const paidAmount = payments.reduce(
    (total, item) => total + money(item.amount),
    0,
  );
  const now = new Date().toISOString();
  const { error: updateError } = await adminClient
    .from("ground_session_logs")
    .update({
      xero_payment_id: payments[0]?.paymentId || null,
      xero_payment_synced_at: payments.length > 0 ? now : null,
      payment_status: paidAmount >= money(session.calculated_cost)
        ? "paid"
        : "pending",
      xero_sync_status: skippedPayments.length > 0 ? "needs_review" : "synced",
      xero_sync_error: skippedPayments.length > 0
        ? skippedPayments.join(" ")
        : null,
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
    .or(
      "payment_status.is.null,payment_status.eq.unpaid,payment_status.eq.pending",
    )
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
      xero_invoice_number: clean(invoice?.InvoiceNumber) ||
        clean(flight.xero_invoice_number) || null,
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
    paidCount: updated.filter((row) => row.markedPaid).length,
  };
};

const syncVoucherLifecycle = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  voucherId: string,
  queueId: string | null = null,
) => {
  await markQueue(adminClient, queueId, { status: "processing" });
  const voucher = await getVoucher(adminClient, voucherId);
  const now = new Date().toISOString();
  const voucherCode = clean(voucher.code) || voucher.id;
  const productName = clean(voucher.product?.name) || "Trial flight voucher";
  const voucherAmount = money(voucher.payment_amount);
  const voucherLiabilityAccountCode = clean(ctx.settings?.voucher_account_code);
  const revenueAccountCode = clean(ctx.settings?.revenue_account_code);

  const setNeedsReview = async (
    message: string,
    extraResult: Record<string, unknown> = {},
  ) => {
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
      result: {
        voucherId: voucher.id,
        voucherCode,
        skipped: "voucher_not_paid",
      },
    });
    return { skipped: true, reason: "voucher_not_paid" };
  }

  if (voucherAmount <= 0) {
    return await setNeedsReview(
      "Voucher payment amount is zero. Review this voucher before sending it to Xero.",
    );
  }

  let saleJournalId = clean(voucher.xero_sale_journal_id);
  let saleBankTransactionId = clean(voucher.xero_sale_bank_transaction_id);
  let purchaserContactId = clean(voucher.xero_purchaser_contact_id);
  let redemptionJournalId = clean(voucher.xero_redemption_journal_id);
  const result: Record<string, unknown> = {
    voucherId: voucher.id,
    voucherCode,
  };

  if (!saleJournalId && !saleBankTransactionId) {
    if (!voucherLiabilityAccountCode) {
      return await setNeedsReview(
        "Set a Gift voucher liability account in Xero settings before syncing vouchers.",
      );
    }

    let fundingAccountCode = "";
    let saleNarration = `Gift voucher sale ${voucherCode} - ${productName}`;

    if (clean(voucher.payment_source) === "stripe") {
      fundingAccountCode = clean(ctx.settings?.stripe_payment_account_code);
      if (!fundingAccountCode) {
        return await setNeedsReview(
          "Set the Stripe payment clearing account before syncing Stripe-paid vouchers.",
        );
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
        return await setNeedsReview(
          "Set the Member prepaid liability account before syncing prepaid-funded vouchers.",
        );
      }
      saleNarration =
        `Gift voucher funded from member prepaid balance ${voucherCode} - ${productName}`;
    } else if (clean(voucher.payment_source) === "manual") {
      return await setNeedsReview(
        "Manual-paid vouchers are left for review so the club can choose the correct bank or cash account in Xero.",
      );
    } else if (clean(voucher.payment_source) === "waived") {
      return await setNeedsReview(
        "Complimentary or waived vouchers are not auto-posted. Review this voucher manually in Xero.",
      );
    } else {
      return await setNeedsReview(
        "Voucher payment source is not set. Save the voucher again or review it manually.",
      );
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

  const redemptionFlight = await getVoucherRedemptionFlight(
    adminClient,
    voucher.booked_booking_id,
  );
  if (redemptionFlight && !redemptionJournalId) {
    if (!voucherLiabilityAccountCode) {
      return await setNeedsReview(
        "Set a Gift voucher liability account before releasing redeemed vouchers into revenue.",
        result,
      );
    }
    if (!revenueAccountCode) {
      return await setNeedsReview(
        "Set a Flight revenue account before releasing redeemed vouchers into revenue.",
        result,
      );
    }
    if (clean(redemptionFlight.xero_invoice_id)) {
      return await setNeedsReview(
        `Flight log ${redemptionFlight.id} already has Xero invoice ${
          clean(redemptionFlight.xero_invoice_number) ||
          clean(redemptionFlight.xero_invoice_id)
        }. Remove or review that invoice before syncing the voucher redemption.`,
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
  const { data: existing, error: existingError } = await adminClient
    .from("xero_sync_queue")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("action", action)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data, error } = await adminClient
    .from("xero_sync_queue")
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      action,
      status: "pending",
      requested_by: requestedBy,
      payload,
      next_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) {
    if ((error as any)?.code === "23505") {
      const { data: raced, error: racedError } = await adminClient
        .from("xero_sync_queue")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .eq("action", action)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (racedError) throw racedError;
      return raced;
    }
    throw error;
  }
  return data;
};

const updateMembershipBillingState = async (
  adminClient: SupabaseAdminClient,
  periodId: string,
  update: {
    status: "queued" | "processing" | "succeeded" | "failed" | "needs_review";
    attempts?: number;
    nextAttemptAt?: string | null;
    error?: string | null;
  },
) => {
  const now = new Date().toISOString();
  const values: Record<string, unknown> = {
    billing_sync_status: update.status,
    billing_sync_updated_at: now,
    updated_at: now,
  };
  if (update.attempts !== undefined) {
    values.billing_sync_attempts = update.attempts;
  }
  if (update.nextAttemptAt !== undefined) {
    values.billing_sync_next_attempt_at = update.nextAttemptAt;
  }
  if (update.error !== undefined) {
    values.billing_sync_error = update.error;
    values.xero_sync_error = update.error;
  }
  const { error } = await adminClient.from("membership_financial_periods")
    .update(values)
    .eq("id", periodId);
  if (error) throw error;
};

const queueMembershipBilling = async (
  adminClient: SupabaseAdminClient,
  periodId: string,
  requestedBy: string | null,
  payload: Record<string, unknown> = {},
) => {
  const { data: existing, error: existingError } = await adminClient
    .from("xero_sync_queue")
    .select("*")
    .eq("entity_type", "membership_period")
    .eq("entity_id", periodId)
    .eq("action", "sync_membership")
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    const mergedPayload = {
      ...(existing.payload || {}),
      ...payload,
      sendEmail: existing.payload?.sendEmail === true ||
        payload.sendEmail === true,
    };
    if (existing.status === "pending") {
      const { error: mergeError } = await adminClient
        .from("xero_sync_queue")
        .update({
          payload: mergedPayload,
          requested_by: existing.requested_by || requestedBy,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (mergeError) throw mergeError;
      existing.payload = mergedPayload;
    }
    await updateMembershipBillingState(adminClient, periodId, {
      status: existing.status === "processing" ? "processing" : "queued",
      attempts: Number(existing.attempts || 0),
      nextAttemptAt: existing.next_attempt_at,
      error: existing.last_error || null,
    });
    return existing;
  }

  const now = new Date().toISOString();
  const { data, error } = await adminClient.from("xero_sync_queue").insert({
    entity_type: "membership_period",
    entity_id: periodId,
    action: "sync_membership",
    status: "pending",
    priority: 40,
    requested_by: requestedBy,
    payload,
    next_attempt_at: now,
    updated_at: now,
  }).select("*").single();
  if (error) {
    if ((error as any)?.code === "23505") {
      const { data: raced, error: racedError } = await adminClient
        .from("xero_sync_queue")
        .select("*")
        .eq("entity_type", "membership_period")
        .eq("entity_id", periodId)
        .eq("action", "sync_membership")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (racedError) throw racedError;
      return raced;
    }
    throw error;
  }
  await updateMembershipBillingState(adminClient, periodId, {
    status: "queued",
    attempts: 0,
    nextAttemptAt: now,
    error: null,
  });
  return data;
};

const notifyMembershipBillingFailure = async (
  adminClient: SupabaseAdminClient,
  periodId: string,
  message: string,
) => {
  const { data: period } = await adminClient
    .from("membership_financial_periods")
    .select("membership_id,amount_due")
    .eq("id", periodId)
    .maybeSingle();
  if (!period) return;
  const { data: membership } = await adminClient
    .from("club_memberships")
    .select("user_id")
    .eq("id", period.membership_id)
    .maybeSingle();
  if (!membership?.user_id) return;

  const [{ data: primaryAdmins }, { data: roleAdmins }, { data: member }] =
    await Promise.all([
      adminClient.from("users").select("id").eq("role", "admin").eq(
        "is_active",
        true,
      ),
      adminClient.from("user_roles").select("user_id").eq("role", "admin"),
      adminClient.from("users").select("name").eq("id", membership.user_id)
        .maybeSingle(),
    ]);
  const adminIds = Array.from(
    new Set([
      ...(primaryAdmins || []).map((row: any) => clean(row.id)),
      ...(roleAdmins || []).map((row: any) => clean(row.user_id)),
    ].filter(Boolean)),
  );
  const memberName = clean(member?.name) || "A member";
  const amount = money(period.amount_due).toFixed(2);
  const metadata = {
    membershipPeriodId: periodId,
    path: "/membership",
  };
  await adminClient.from("notifications").insert([
    {
      user_id: membership.user_id,
      type: "membership",
      title: "Membership billing needs attention",
      message:
        "Your membership remains current, but the club could not complete the invoice or payment after its automatic attempts. Staff have been notified; review Club membership or contact the club.",
      metadata,
      is_read: false,
    },
    ...adminIds.filter((id) => id !== membership.user_id).map((userId) => ({
      user_id: userId,
      type: "membership",
      title: "Membership billing failed",
      message:
        `${memberName}'s $${amount} membership billing needs attention: ${message}`,
      metadata,
      is_read: false,
    })),
  ]);
};

const notifyXeroQueueReview = async (
  adminClient: SupabaseAdminClient,
  item: any,
  message: string,
  terminal: boolean,
) => {
  const { data: existing } = await adminClient.from("notifications")
    .select("id").eq("is_read", false)
    .contains("metadata", { xeroQueueId: item.id })
    .limit(1).maybeSingle();
  if (existing) return;
  const [{ data: primaryAdmins }, { data: roleAdmins }] = await Promise.all([
    adminClient.from("users").select("id").eq("role", "admin").eq("is_active", true),
    adminClient.from("user_roles").select("user_id").eq("role", "admin"),
  ]);
  const adminIds = Array.from(new Set([
    ...(primaryAdmins || []).map((row: any) => clean(row.id)),
    ...(roleAdmins || []).map((row: any) => clean(row.user_id)),
  ].filter(Boolean)));
  if (!adminIds.length) return;
  await adminClient.from("notifications").insert(adminIds.map(userId => ({
    user_id: userId,
    type: "accounting",
    title: terminal ? "Xero operation failed" : "Xero operation needs review",
    message: `${clean(item.entity_type)} ${clean(item.action)}: ${truncateText(message, 400)}`,
    metadata: {
      xeroQueueId: item.id,
      operationId: item.operation_id || null,
      tenantId: item.tenant_id_snapshot || null,
      path: "/settings?tab=integrations",
    },
    is_read: false,
  })));
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

  if (
    item.entity_type === "flight_invoice" ||
    item.entity_type === "flight_payment"
  ) {
    const { data } = await adminClient
      .from("flight_logs")
      .select(`
        id,start_time,xero_sync_status,xero_invoice_number,
        student:student_id(name,email),
        aircraft:aircraft_id(registration)
      `)
      .eq("id", item.entity_id)
      .maybeSingle();
    const student = Array.isArray(data?.student)
      ? data?.student[0]
      : data?.student;
    const aircraft = Array.isArray(data?.aircraft)
      ? data?.aircraft[0]
      : data?.aircraft;
    const date = data?.start_time
      ? new Date(data.start_time).toLocaleDateString("en-AU")
      : "";
    return {
      entityLabel: clean(student?.name) || "Flight log",
      entityDetail:
        [date, clean(aircraft?.registration), clean(data?.xero_invoice_number)]
          .filter(Boolean).join(" · ") || null,
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
      entityLabel: clean(data?.purchaser_name) || clean(data?.code) ||
        "Voucher",
      entityDetail:
        [clean(data?.code), clean(data?.purchaser_email)].filter(Boolean).join(
          " · ",
        ) || null,
      recordStatus: clean(data?.xero_sync_status) || clean(data?.status) ||
        null,
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
      entityLabel: clean(user?.name) || clean(user?.email) ||
        "Account transaction",
      entityDetail: [
        clean(data?.type),
        clean(data?.description),
        money(data?.amount).toFixed(2),
      ].filter(Boolean).join(" · ") || null,
      recordStatus: clean(data?.xero_sync_status) ||
        clean(data?.verified_status) || null,
    };
  }

  if (item.entity_type === "membership_period") {
    const { data } = await adminClient
      .from("membership_financial_periods")
      .select(`
        id,
        amount_due,
        financial_year_start,
        billing_sync_status,
        xero_invoice_number,
        membership:membership_id(
          member:user_id(name,email),
          membership_class:membership_class_id(name)
        )
      `)
      .eq("id", item.entity_id)
      .maybeSingle();
    const membership = Array.isArray(data?.membership)
      ? data?.membership[0]
      : data?.membership;
    const member = Array.isArray(membership?.member)
      ? membership?.member[0]
      : membership?.member;
    const membershipClass = Array.isArray(membership?.membership_class)
      ? membership?.membership_class[0]
      : membership?.membership_class;
    return {
      entityLabel: clean(member?.name) || clean(member?.email) ||
        "Membership billing",
      entityDetail: [
        clean(membershipClass?.name),
        data?.financial_year_start
          ? `FY ${String(data.financial_year_start).slice(0, 4)}`
          : null,
        `$${money(data?.amount_due).toFixed(2)}`,
        clean(data?.xero_invoice_number),
      ].filter(Boolean).join(" Â· ") || null,
      recordStatus: clean(data?.billing_sync_status) || null,
    };
  }

  return {
    entityLabel: item.entity_type,
    entityDetail: null,
    recordStatus: null,
  };
};

const listQueue = async (
  adminClient: SupabaseAdminClient,
  statusFilter = "all",
  limit = 50,
) => {
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
    {
      all: 0,
      pending: 0,
      processing: 0,
      synced: 0,
      needs_review: 0,
      failed: 0,
      cancelled: 0,
    },
  );

  return { items, counts };
};

const isTestModeQueueItem = async (
  adminClient: SupabaseAdminClient,
  item: any,
) => {
  if (
    item.entity_type === "flight_invoice" ||
    item.entity_type === "flight_payment"
  ) {
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

  if (item.entity_type === "membership_period") {
    const { data: period, error: periodError } = await adminClient
      .from("membership_financial_periods")
      .select("membership_id")
      .eq("id", item.entity_id)
      .maybeSingle();
    if (periodError) throw periodError;
    if (!period) return false;
    const { data: membership, error: membershipError } = await adminClient
      .from("club_memberships")
      .select("user_id")
      .eq("id", period.membership_id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return false;
    const { data: preference, error: preferenceError } = await adminClient
      .from("membership_payment_preferences")
      .select("is_test_mode,stripe_mode")
      .eq("user_id", membership.user_id)
      .maybeSingle();
    if (preferenceError) throw preferenceError;
    return preference?.is_test_mode === true ||
      preference?.stripe_mode === "test";
  }

  return false;
};

const processQueueRecord = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  item: any,
  processedBy: string | null,
) => {
  const activeTenant = clean(ctx?.connection?.tenant_id);
  try {
    assertTenantBoundQueueItem(ctx?.connection, item);
  } catch {
    throw makeXeroNeedsReviewError(
      "This queue item is quarantined because its tenant snapshot does not match the active, immutable Bendigo Flying Club tenant.",
    );
  }
  if (!item.mapping_version_id) {
    throw makeXeroNeedsReviewError(
      "An accountant-approved mapping version is required before this Xero operation can run.",
    );
  }
  const { data: mappingVersion, error: mappingError } = await adminClient
    .from("xero_mapping_versions")
    .select("id,status,effective_from,tenant_id")
    .eq("id", item.mapping_version_id)
    .eq("tenant_id", activeTenant)
    .maybeSingle();
  if (mappingError) throw mappingError;
  if (
    mappingVersion?.status !== "approved" ||
    !mappingVersion.effective_from ||
    new Date(mappingVersion.effective_from).getTime() > Date.now()
  ) {
    throw makeXeroNeedsReviewError(
      "The mapping version is not approved and effective for this Xero tenant.",
    );
  }
  const operationId = clean(item.operation_id);
  const { data: existingOperation, error: operationLookupError } =
    await adminClient.from("xero_operation_log")
      .select("status,response_summary,xero_object_id")
      .eq("tenant_id", activeTenant).eq("operation_id", operationId)
      .maybeSingle();
  if (operationLookupError) throw operationLookupError;
  if (existingOperation?.status === "confirmed") {
    return {
      reconciled: true,
      operationId,
      xeroObjectId: existingOperation.xero_object_id,
      ...(existingOperation.response_summary || {}),
    };
  }
  const { error: operationReserveError } = await adminClient
    .from("xero_operation_log").upsert({
      tenant_id: activeTenant,
      operation_id: operationId,
      queue_id: item.id,
      action: clean(item.action),
      status: "reserved",
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,operation_id" });
  if (operationReserveError) throw operationReserveError;

  const attempt = Number(item.attempts || 0) + 1;
  await adminClient.from("xero_sync_queue").update({
    status: "processing",
    attempts: attempt,
    processed_by: processedBy,
    updated_at: new Date().toISOString(),
  }).eq("id", item.id);
  if (item.entity_type === "membership_period") {
    await updateMembershipBillingState(adminClient, item.entity_id, {
      status: "processing",
      attempts: attempt,
      nextAttemptAt: null,
      error: null,
    });
  }

  try {
    if (await isTestModeQueueItem(adminClient, item)) {
      throw makeXeroNeedsReviewError(
        "Test-payment records are permanently blocked from Xero syncing.",
      );
    }

    let result: Record<string, unknown>;
    if (item.action === "upsert_contact") {
      result = await syncMemberContact(
        adminClient,
        ctx,
        item.entity_id,
        item.id,
      );
    } else if (item.action === "create_invoice") {
      result = await createOrUpdateFlightInvoice(
        adminClient,
        ctx,
        item.entity_id,
        item.id,
      );
    } else if (item.action === "apply_payment") {
      result = await applyFlightPayments(
        adminClient,
        ctx,
        item.entity_id,
        item.id,
      );
    } else if (item.action === "sync_transaction") {
      result = await syncTopupTransaction(
        adminClient,
        ctx,
        item.entity_id,
        item.id,
      );
    } else if (item.action === "sync_voucher") {
      result = await syncVoucherLifecycle(
        adminClient,
        ctx,
        item.entity_id,
        item.id,
      );
    } else if (item.action === "sync_membership") {
      result = await createOrRefreshMembershipInvoice(
        adminClient,
        ctx,
        item.entity_id,
        item.payload?.sendEmail === true &&
          item.payload?.invoiceEmailSent !== true,
      );
      const collection = (result as any)?.collection;
      if ((result as any)?.emailSent === true) {
        const nextPayload = {
          ...(item.payload || {}),
          invoiceEmailSent: true,
        };
        const { error: emailStateError } = await adminClient.from(
          "xero_sync_queue",
        ).update({
          payload: nextPayload,
          updated_at: new Date().toISOString(),
        }).eq("id", item.id);
        if (emailStateError) throw emailStateError;
        item.payload = nextPayload;
      }
      if (clean(collection?.status).toLowerCase() === "failed") {
        throw Object.assign(
          new Error(
            clean(collection?.error) ||
              "Automatic membership collection failed.",
          ),
          { membershipPaymentDeclined: true },
        );
      }
      const { error: completedQueueError } = await adminClient.from(
        "xero_sync_queue",
      ).update({
        status: "synced",
        last_error: null,
        processed_by: processedBy,
        processed_at: new Date().toISOString(),
        result,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      if (completedQueueError) throw completedQueueError;
      await updateMembershipBillingState(adminClient, item.entity_id, {
        status: ["pending", "processing"].includes(
            clean(collection?.status).toLowerCase(),
          )
          ? "processing"
          : "succeeded",
        attempts: attempt,
        nextAttemptAt: null,
        error: null,
      });
    } else {
      throw new Error(`Unsupported Xero queue action: ${item.action}`);
    }
    await adminClient.from("xero_operation_log").update({
      status: "confirmed",
      response_summary: result,
      updated_at: new Date().toISOString(),
    }).eq("tenant_id", activeTenant).eq("operation_id", operationId);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Xero sync failed";
    const queueStatus = (error as any)?.queueStatus;
    if (queueStatus === "needs_review") {
      await adminClient.from("xero_operation_log").update({
        status: "needs_review",
        response_summary: { error: message },
        updated_at: new Date().toISOString(),
      }).eq("tenant_id", activeTenant).eq("operation_id", operationId);
      await adminClient.from("xero_sync_queue").update({
        status: "needs_review",
        last_error: message,
        processed_by: processedBy,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      if (item.entity_type === "membership_period") {
        await updateMembershipBillingState(adminClient, item.entity_id, {
          status: "needs_review",
          attempts: attempt,
          nextAttemptAt: null,
          error: message,
        });
        await notifyMembershipBillingFailure(
          adminClient,
          item.entity_id,
          message,
        );
      }
      await notifyXeroQueueReview(adminClient, item, message, false);
      return {
        needsReview: true,
        message,
      };
    }

    let technicalRetryMinutes: number[] = [];
    let paymentRetryDays: number[] = [];
    if (item.entity_type === "membership_period") {
      const { data: retrySettings } = await adminClient
        .from("membership_settings")
        .select("technical_retry_minutes,payment_retry_days")
        .eq("id", true)
        .maybeSingle();
      technicalRetryMinutes = configuredTechnicalRetryMinutes(
        retrySettings?.technical_retry_minutes,
      );
      paymentRetryDays = configuredPaymentRetryDays(
        retrySettings?.payment_retry_days,
      );
    }
    const paymentDeclined = (error as any)?.membershipPaymentDeclined === true;
    const retryLimit = paymentDeclined
      ? paymentRetryDays.length
      : item.entity_type === "membership_period"
      ? technicalRetryMinutes.length
      : 4;
    const shouldRetry = item.entity_type === "membership_period" ||
      isRetriableXeroError(error);
    if (shouldRetry && attempt <= retryLimit) {
      const retryAfterSeconds = Number((error as any)?.retryAfterSeconds || 0);
      const baseRetryDelay = paymentDeclined
        ? membershipPaymentRetryDelayMs(attempt, paymentRetryDays)
        : item.entity_type === "membership_period"
        ? membershipBillingRetryDelayMs(attempt, technicalRetryMinutes)
        : getRetryDelayMs(attempt);
      const retryDelayMs = retryAfterSeconds > 0
        ? Math.max(baseRetryDelay, retryAfterSeconds * 1000)
        : baseRetryDelay;
      const nextAttemptAt = new Date(Date.now() + retryDelayMs).toISOString();
      await adminClient.from("xero_sync_queue").update({
        status: "pending",
        last_error: message,
        processed_by: processedBy,
        next_attempt_at: nextAttemptAt,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      if (item.entity_type === "membership_period") {
        await updateMembershipBillingState(adminClient, item.entity_id, {
          status: "queued",
          attempts: attempt,
          nextAttemptAt,
          error: message,
        });
      }
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
    await adminClient.from("xero_operation_log").update({
      status: "failed",
      response_summary: { error: message },
      updated_at: new Date().toISOString(),
    }).eq("tenant_id", activeTenant).eq("operation_id", operationId);
    if (item.entity_type === "membership_period") {
      await updateMembershipBillingState(adminClient, item.entity_id, {
        status: "failed",
        attempts: attempt,
        nextAttemptAt: null,
        error: message,
      });
      await notifyMembershipBillingFailure(
        adminClient,
        item.entity_id,
        message,
      );
    }
    await notifyXeroQueueReview(adminClient, item, message, true);
    throw error;
  }
};

const updateMembershipPeriodFromInvoice = async (
  adminClient: SupabaseAdminClient,
  periodId: string,
  invoice: any,
) => {
  const invoiceId = clean(invoice?.InvoiceID);
  const status = clean(invoice?.Status).toUpperCase();
  const amountDue = money(invoice?.AmountDue);
  const isVoided = ["VOIDED", "DELETED", "CANCELLED"].includes(status);
  const isPaid = !isVoided && (status === "PAID" || amountDue <= 0.005);
  const now = new Date().toISOString();
  const { error } = await adminClient.from("membership_financial_periods")
    .update({
      xero_invoice_id: invoiceId || null,
      xero_invoice_number: clean(invoice?.InvoiceNumber) || null,
      xero_invoice_status: status || null,
      xero_amount_due: amountDue,
      xero_last_synced_at: now,
      xero_sync_error: null,
      fee_disposition: isVoided ? "ceased" : isPaid ? "paid" : "invoiced",
      financially_cleared_at: isPaid ? now : null,
      updated_at: now,
    }).eq("id", periodId);
  if (error) throw error;
  return {
    periodId,
    invoiceId: invoiceId || null,
    invoiceNumber: clean(invoice?.InvoiceNumber) || null,
    status: status || null,
    amountDue,
    paid: isPaid,
    voided: isVoided,
    syncedAt: now,
  };
};

const getMembershipPeriod = async (
  adminClient: SupabaseAdminClient,
  periodId: string,
) => {
  const { data: period, error } = await adminClient
    .from("membership_financial_periods")
    .select("*")
    .eq("id", periodId)
    .maybeSingle();
  if (error) throw error;
  if (!period) throw new Error("Membership financial period not found.");

  const { data: membership, error: membershipError } = await adminClient
    .from("club_memberships")
    .select("id,user_id,membership_class_id,legal_status,commenced_at")
    .eq("id", period.membership_id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error("BFC membership record not found.");

  const { data: membershipClass, error: classError } = await adminClient
    .from("membership_classes")
    .select(
      "id,code,name,annual_fee,is_fee_exempt,xero_item_code,xero_account_code",
    )
    .eq("id", membership.membership_class_id)
    .maybeSingle();
  if (classError) throw classError;
  if (!membershipClass) throw new Error("Membership class not found.");

  return { period, membership, membershipClass };
};

const createMembershipXeroPayment = async (
  ctx: any,
  invoiceId: string,
  amount: number,
  reference: string,
  stripePaymentIntentId: string,
) => {
  const accountCode = clean(ctx.settings?.stripe_payment_account_code);
  if (!accountCode) {
    throw new Error(
      "Set the Xero Stripe clearing account before collecting automatic membership payments.",
    );
  }
  const result = await xeroRequest({
    method: "POST",
    path: "Payments",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    idempotencyKey: `membership-payment-${stripePaymentIntentId}`,
    body: {
      Payments: [{
        Invoice: { InvoiceID: invoiceId },
        Account: { Code: accountCode },
        Date: new Date().toISOString().slice(0, 10),
        Amount: money(amount),
        Reference: truncateText(reference),
      }],
    },
  });
  const paymentId = clean(result?.Payments?.[0]?.PaymentID);
  if (!paymentId) {
    throw new Error(
      "Xero did not return a payment ID for the membership collection.",
    );
  }
  return paymentId;
};

const collectMembershipInvoice = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  period: any,
  membership: any,
  invoice: any,
) => {
  const invoiceId = clean(invoice?.InvoiceID);
  const amountDue = money(invoice?.AmountDue);
  if (!invoiceId || amountDue <= 0.005) {
    return { attempted: false, reason: "nothing_due" };
  }
  const dueDate = String(period.due_date || "").slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate && dueDate > today) {
    return {
      attempted: false,
      reason: "payment_not_due",
      dueDate,
    };
  }

  const { data: preference, error: preferenceError } = await adminClient
    .from("membership_payment_preferences")
    .select("*")
    .eq("user_id", membership.user_id)
    .maybeSingle();
  if (preferenceError) throw preferenceError;
  if (
    !preference || !["card", "becs"].includes(clean(preference.payment_method))
  ) {
    const manualMember = await getMember(adminClient, membership.user_id);
    const contactId = clean(
      invoice?.Contact?.ContactID || manualMember?.xero_contact_id,
    );
    if (!contactId) {
      return { attempted: false, reason: "manual_invoice_no_xero_contact" };
    }
    const credit = await applyAvailableCreditToInvoice(
      ctx,
      invoiceId,
      contactId,
      amountDue,
    );
    if (credit.applied <= 0.005) {
      return { attempted: false, reason: "manual_invoice_no_prepaid_credit" };
    }
    const refreshedInvoice = await getXeroInvoice(ctx, invoiceId);
    if (refreshedInvoice) {
      await updateMembershipPeriodFromInvoice(
        adminClient,
        period.id,
        refreshedInvoice,
      );
    }
    return {
      attempted: true,
      status: credit.remaining <= 0.005
        ? "paid_from_prepaid_credit"
        : "partially_paid_from_prepaid_credit",
      prepaidCreditApplied: credit.applied,
      remaining: credit.remaining,
      allocations: credit.allocations,
    };
  }
  if (
    preference.authority_status !== "ready" ||
    !clean(preference.stripe_payment_method_id) ||
    !clean(preference.stripe_customer_id)
  ) {
    return { attempted: false, reason: "payment_authority_not_ready" };
  }

  const commencedDate = String(membership.commenced_at || "").slice(0, 10);
  const isInitialPeriod = Boolean(
    commencedDate &&
      commencedDate >= String(period.financial_year_start).slice(0, 10) &&
      commencedDate <= String(period.financial_year_end).slice(0, 10),
  );
  if (!isInitialPeriod && !preference.auto_renew) {
    return { attempted: false, reason: "automatic_renewal_not_authorised" };
  }

  const { data: existingPaymentData, error: existingError } = await adminClient
    .from("xero_invoice_portal_payments")
    .select("id,status,stripe_payment_intent_id,xero_payment_id")
    .eq("xero_invoice_id", invoiceId)
    .in("status", ["pending", "paid", "needs_review"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  let existingPayment = existingPaymentData;
  if (
    existingPayment &&
    ["paid", "needs_review"].includes(clean(existingPayment.status))
  ) {
    return {
      attempted: false,
      reason: "collection_already_recorded",
      paymentRecordId: existingPayment.id,
      status: existingPayment.status,
    };
  }

  const stripeMode = clean(preference.stripe_mode) === "test" ? "test" : "live";
  const stripeSecretKey = getStripeSecretKeyForMode(stripeMode);
  const connectedAccountId = await getConnectedStripeAccountId(adminClient);
  if (!connectedAccountId) {
    throw new Error("Stripe is not connected for this club.");
  }
  if (
    existingPayment &&
    collectionWasSubmitted(existingPayment) &&
    clean(existingPayment.stripe_payment_intent_id)
  ) {
    const intentResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${
        encodeURIComponent(clean(existingPayment.stripe_payment_intent_id))
      }`,
      {
        headers: stripeHeaders(stripeSecretKey, connectedAccountId),
      },
    );
    const intent = await intentResponse.json().catch(() => ({}));
    if (!intentResponse.ok) {
      throw new Error(
        clean(intent?.error?.message) ||
          "The existing Stripe membership payment could not be checked.",
      );
    }
    if (clean(intent.status) === "succeeded") {
      let xeroPaymentId = clean(existingPayment.xero_payment_id);
      if (!xeroPaymentId) {
        xeroPaymentId = await createMembershipXeroPayment(
          ctx,
          invoiceId,
          amountDue,
          `Stripe membership payment ${clean(intent.id)}`,
          clean(intent.id),
        );
      }
      await adminClient.from("xero_invoice_portal_payments").update({
        status: "paid",
        xero_payment_id: xeroPaymentId,
        error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", existingPayment.id);
      const paidInvoice = await getXeroInvoice(ctx, invoiceId);
      if (paidInvoice) {
        await updateMembershipPeriodFromInvoice(
          adminClient,
          period.id,
          paidInvoice,
        );
      }
      await adminClient.from("membership_payment_preferences").update({
        last_collection_status: "succeeded",
        last_collection_error: null,
        updated_at: new Date().toISOString(),
      }).eq("user_id", membership.user_id);
      return {
        attempted: true,
        status: "succeeded",
        paymentRecordId: existingPayment.id,
        xeroPaymentId,
        reconciled: true,
      };
    }
    if (clean(intent.status) === "processing") {
      return {
        attempted: false,
        reason: "collection_already_recorded",
        paymentRecordId: existingPayment.id,
        status: "processing",
      };
    }
    const failedIntentMessage = clean(intent?.last_payment_error?.message) ||
      `Stripe returned ${clean(intent.status) || "an incomplete status"}.`;
    await adminClient.from("xero_invoice_portal_payments").update({
      status: "failed",
      error: failedIntentMessage,
      updated_at: new Date().toISOString(),
    }).eq("id", existingPayment.id);
    existingPayment = null;
  }
  const { data: member, error: memberError } = await adminClient
    .from("users")
    .select("id,email,xero_contact_id")
    .eq("id", membership.user_id)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member?.xero_contact_id) {
    throw new Error("The member is not linked to the Xero invoice contact.");
  }

  let paymentRecord = existingPayment;
  if (!paymentRecord) {
    const { data: insertedRecord, error: recordError } = await adminClient
      .from("xero_invoice_portal_payments")
      .insert({
        user_id: membership.user_id,
        xero_contact_id: clean(member.xero_contact_id),
        xero_invoice_id: invoiceId,
        xero_invoice_number: clean(invoice?.InvoiceNumber) || null,
        amount: amountDue,
        currency: clean(invoice?.CurrencyCode) || "AUD",
        status: "pending",
        stripe_mode: stripeMode,
        is_test_mode: stripeMode === "test",
      })
      .select("id,status,stripe_payment_intent_id,xero_payment_id")
      .single();
    if (recordError) {
      if ((recordError as any)?.code !== "23505") throw recordError;
      const { data: racedRecord, error: racedError } = await adminClient
        .from("xero_invoice_portal_payments")
        .select("id,status,stripe_payment_intent_id,xero_payment_id")
        .eq("xero_invoice_id", invoiceId)
        .in("status", ["pending", "paid", "needs_review"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (racedError) throw racedError;
      if (clean(racedRecord?.stripe_payment_intent_id)) {
        return {
          attempted: false,
          reason: "collection_already_recorded",
          paymentRecordId: racedRecord.id,
          status: racedRecord.status,
        };
      }
      paymentRecord = racedRecord;
    } else {
      paymentRecord = insertedRecord;
    }
  }
  if (!paymentRecord?.id) {
    throw new Error("The membership payment attempt could not be reserved.");
  }

  const form = new URLSearchParams();
  form.set("amount", String(Math.round(amountDue * 100)));
  form.set("currency", (clean(invoice?.CurrencyCode) || "AUD").toLowerCase());
  form.set("customer", clean(preference.stripe_customer_id));
  form.set("payment_method", clean(preference.stripe_payment_method_id));
  form.append(
    "payment_method_types[]",
    preference.payment_method === "becs" ? "au_becs_debit" : "card",
  );
  form.set("off_session", "true");
  form.set("confirm", "true");
  form.set(
    "description",
    clean(invoice?.InvoiceNumber)
      ? `Bendigo Flying Club membership invoice ${clean(invoice.InvoiceNumber)}`
      : "Bendigo Flying Club membership payment",
  );
  form.set("metadata[crm_payment_type]", "membership_invoice_auto_payment");
  form.set("metadata[payment_record_id]", paymentRecord.id);
  form.set("metadata[membership_period_id]", period.id);
  form.set("metadata[user_id]", membership.user_id);
  form.set("metadata[xero_contact_id]", clean(member.xero_contact_id));
  form.set("metadata[xero_invoice_id]", invoiceId);
  form.set("metadata[xero_invoice_number]", clean(invoice?.InvoiceNumber));
  form.set("metadata[stripe_mode]", stripeMode);
  form.set("metadata[test_mode]", stripeMode === "test" ? "true" : "false");

  const paymentResponse = await fetch(
    "https://api.stripe.com/v1/payment_intents",
    {
      method: "POST",
      headers: stripeHeaders(stripeSecretKey, connectedAccountId, {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": stripeIdempotencyKey(
          ...membershipCollectionIdempotencyParts({
            stripeMode,
            periodId: period.id,
            invoiceId,
            paymentRecordId: paymentRecord.id,
          }),
        ),
      }),
      body: form,
    },
  );
  const paymentIntent = await paymentResponse.json().catch(() => ({}));
  const now = new Date().toISOString();
  const failureMessage = clean(paymentIntent?.error?.message) ||
    (!paymentResponse.ok ? "Stripe membership collection failed." : null);

  if (!paymentResponse.ok) {
    await adminClient.from("xero_invoice_portal_payments").update({
      status: "failed",
      stripe_payment_intent_id:
        clean(paymentIntent?.error?.payment_intent?.id) || null,
      error: failureMessage,
      updated_at: now,
    }).eq("id", paymentRecord.id);
    await adminClient.from("membership_payment_preferences").update({
      last_collection_attempt_at: now,
      last_collection_status: "failed",
      last_collection_error: failureMessage,
      updated_at: now,
    }).eq("user_id", membership.user_id);
    return {
      attempted: true,
      status: "failed",
      error: failureMessage,
      paymentRecordId: paymentRecord.id,
    };
  }

  await adminClient.from("xero_invoice_portal_payments").update({
    stripe_payment_intent_id: clean(paymentIntent.id),
    status: paymentIntent.status === "succeeded"
      ? "pending"
      : paymentIntent.status === "processing"
      ? "pending"
      : "failed",
    error: ["succeeded", "processing"].includes(clean(paymentIntent.status))
      ? null
      : `Stripe returned ${
        clean(paymentIntent.status) || "an incomplete status"
      }.`,
    updated_at: now,
  }).eq("id", paymentRecord.id);
  await adminClient.from("membership_payment_preferences").update({
    last_collection_attempt_at: now,
    last_collection_status: clean(paymentIntent.status) || "pending",
    last_collection_error: ["succeeded", "processing"].includes(
        clean(paymentIntent.status),
      )
      ? null
      : `Stripe returned ${
        clean(paymentIntent.status) || "an incomplete status"
      }.`,
    updated_at: now,
  }).eq("user_id", membership.user_id);

  if (paymentIntent.status !== "succeeded") {
    const processing = paymentIntent.status === "processing";
    return {
      attempted: true,
      status: processing ? "processing" : "failed",
      stripeStatus: clean(paymentIntent.status) || "unknown",
      error: processing
        ? null
        : `Stripe returned ${
          clean(paymentIntent.status) || "an incomplete status"
        }.`,
      paymentRecordId: paymentRecord.id,
    };
  }

  const { data: latestRecord } = await adminClient
    .from("xero_invoice_portal_payments")
    .select("xero_payment_id,status")
    .eq("id", paymentRecord.id)
    .maybeSingle();
  let xeroPaymentId = clean(latestRecord?.xero_payment_id);
  if (!xeroPaymentId) {
    xeroPaymentId = await createMembershipXeroPayment(
      ctx,
      invoiceId,
      amountDue,
      `Stripe membership payment ${clean(paymentIntent.id)}`,
      clean(paymentIntent.id),
    );
    await adminClient.from("xero_invoice_portal_payments").update({
      status: "paid",
      xero_payment_id: xeroPaymentId,
      error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", paymentRecord.id);
  }
  const paidInvoice = await getXeroInvoice(ctx, invoiceId);
  if (paidInvoice) {
    await updateMembershipPeriodFromInvoice(
      adminClient,
      period.id,
      paidInvoice,
    );
  }
  await adminClient.from("membership_payment_preferences").update({
    last_collection_status: "succeeded",
    last_collection_error: null,
    updated_at: new Date().toISOString(),
  }).eq("user_id", membership.user_id);
  return {
    attempted: true,
    status: "succeeded",
    paymentRecordId: paymentRecord.id,
    xeroPaymentId,
  };
};

const createOrRefreshMembershipInvoice = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  periodId: string,
  sendEmail = false,
) => {
  const { period, membership, membershipClass } = await getMembershipPeriod(
    adminClient,
    periodId,
  );
  if (
    ["waived", "fee_exempt"].includes(
      clean(period.fee_disposition).toLowerCase(),
    )
  ) {
    throw new Error(
      "Waived and fee-exempt memberships do not require a Xero invoice.",
    );
  }

  const { data: membershipSettings, error: settingsError } = await adminClient
    .from("membership_settings")
    .select(
      "xero_membership_item_code,xero_scholarship_item_code,xero_scholarship_account_code",
    )
    .eq("id", true)
    .maybeSingle();
  if (settingsError) throw settingsError;
  const revenueMapping = resolveMembershipRevenueMapping({
    membershipClass,
    settings: membershipSettings,
    defaultRevenueAccountCode: ctx.settings?.revenue_account_code,
  });
  const itemCode = revenueMapping.membershipItemCode;
  const membershipAccountCode = revenueMapping.membershipAccountCode;
  if (!membershipAccountCode) {
    throw makeXeroNeedsReviewError(
      `Set an Accounting Code for ${membershipClass.name} membership or a default Xero revenue account, then retry membership billing.`,
    );
  }
  const scholarshipAmount = money(period.scholarship_contribution_amount);
  const scholarshipItemCode = revenueMapping.scholarshipItemCode;
  const scholarshipAccountCode = revenueMapping.scholarshipAccountCode;
  await ensureMembershipSalesItem(ctx, {
    code: itemCode,
    name: `${membershipClass.name} BFC Membership`,
    description: `${membershipClass.name} Bendigo Flying Club annual membership`,
    accountCode: membershipAccountCode,
  });
  if (scholarshipAmount > 0) {
    if (!scholarshipAccountCode) {
      throw makeXeroNeedsReviewError(
        "Set the Scholarship Accounting Code or a default Xero revenue account, then retry membership billing.",
      );
    }
    await ensureMembershipSalesItem(ctx, {
      code: scholarshipItemCode,
      name: "BFC Scholarship Contribution",
      description: "Optional Bendigo Flying Club scholarship contribution",
      accountCode: scholarshipAccountCode,
    });
  }

  const startYear = String(period.financial_year_start).slice(0, 4);
  const endYear = String(period.financial_year_end).slice(2, 4);
  const financialYearLabel = `${startYear}/${endYear}`;
  const membershipFeeAmount = money(
    period.membership_fee_amount ??
      (money(period.amount_due) - scholarshipAmount),
  );
  const lineItems = [{
    ItemCode: itemCode,
    Description: truncateText(
      `${membershipClass.name} Bendigo Flying Club membership ${financialYearLabel}`,
      4000,
    ),
    Quantity: 1,
    UnitAmount: membershipFeeAmount,
    AccountCode: membershipAccountCode,
  }];
  if (scholarshipAmount > 0) {
    lineItems.push({
      ItemCode: scholarshipItemCode,
      Description: truncateText(
        `Optional Bendigo Flying Club scholarship contribution ${financialYearLabel}`,
        4000,
      ),
      Quantity: 1,
      UnitAmount: scholarshipAmount,
      AccountCode: scholarshipAccountCode,
    });
  }

  if (clean(period.xero_invoice_id)) {
    let invoice = await getXeroInvoice(ctx, clean(period.xero_invoice_id));
    if (!invoice) {
      throw new Error("The linked Xero membership invoice could not be found.");
    }
    const expectedTotal = money(period.amount_due);
    const invoiceTotal = money(invoice.Total);
    const totalDiffers = Math.abs(expectedTotal - invoiceTotal) > 0.005;
    const invoiceStatus = clean(invoice.Status).toUpperCase();
    const invoiceCanRefreshLines = money(invoice.AmountPaid) <= 0.005 &&
      !["PAID", "VOIDED", "DELETED", "CANCELLED"].includes(invoiceStatus);
    if (invoiceCanRefreshLines) {
      const correction = await xeroRequest({
        method: "POST",
        path: "Invoices",
        tenantId: ctx.connection.tenant_id,
        accessToken: ctx.connection.access_token,
        body: {
          Invoices: [{
            InvoiceID: clean(invoice.InvoiceID),
            LineAmountTypes: XERO_SALES_LINE_AMOUNT_TYPE,
            LineItems: lineItems,
          }],
        },
      });
      invoice = correction?.Invoices?.[0] ||
        await getXeroInvoice(ctx, clean(period.xero_invoice_id));
      if (!invoice || Math.abs(money(invoice.Total) - expectedTotal) > 0.005) {
        throw new Error(
          `Xero invoice refresh did not produce the expected $${
            expectedTotal.toFixed(2)
          } total.`,
        );
      }
    } else if (totalDiffers) {
      if (money(invoice.AmountPaid) > 0.005 || invoiceStatus === "PAID") {
        throw makeXeroNeedsReviewError(
          `Xero invoice ${
            clean(invoice.InvoiceNumber) || clean(invoice.InvoiceID)
          } totals $${invoiceTotal.toFixed(2)}, but the CRM fee is $${
            expectedTotal.toFixed(2)
          } and a payment is already recorded.`,
        );
      }
      throw makeXeroNeedsReviewError(
        `Xero invoice ${
          clean(invoice.InvoiceNumber) || clean(invoice.InvoiceID)
        } cannot be updated automatically while it is ${invoiceStatus || "locked"}.`,
      );
    }
    const synced = await updateMembershipPeriodFromInvoice(
      adminClient,
      period.id,
      invoice,
    );
    if (sendEmail) {
      await xeroRequest({
        method: "POST",
        path: `Invoices/${
          encodeURIComponent(clean(period.xero_invoice_id))
        }/Email`,
        tenantId: ctx.connection.tenant_id,
        accessToken: ctx.connection.access_token,
      });
    }
    const collection = await collectMembershipInvoice(
      adminClient,
      ctx,
      period,
      membership,
      invoice,
    )
      .catch((error) => ({
        attempted: true,
        status: "failed",
        error: getErrorMessage(error),
      }));
    return { ...synced, emailSent: sendEmail, collection };
  }

  const member = await getMember(adminClient, membership.user_id);
  const contact = await syncMemberContact(adminClient, ctx, membership.user_id);
  const contactId = clean(contact?.contactId || member.xero_contact_id);
  if (!contactId) {
    throw new Error("The member could not be linked to a Xero contact.");
  }

  const result = await xeroRequest({
    method: "POST",
    path: "Invoices",
    tenantId: ctx.connection.tenant_id,
    accessToken: ctx.connection.access_token,
    idempotencyKey: `membership-period-${period.id}`,
    body: {
      Invoices: [{
        Type: "ACCREC",
        Contact: { ContactID: contactId },
        Date: isoDate(period.due_date),
        DueDate: isoDate(period.due_date),
        Status: "AUTHORISED",
        Reference: truncateText(`BFC membership ${financialYearLabel}`),
        LineAmountTypes: XERO_SALES_LINE_AMOUNT_TYPE,
        LineItems: lineItems,
      }],
    },
  });
  const invoice = result?.Invoices?.[0];
  if (!invoice?.InvoiceID) {
    throw new Error("Xero did not return a membership invoice ID.");
  }
  const synced = await updateMembershipPeriodFromInvoice(
    adminClient,
    period.id,
    invoice,
  );
  if (sendEmail) {
    await xeroRequest({
      method: "POST",
      path: `Invoices/${encodeURIComponent(clean(invoice.InvoiceID))}/Email`,
      tenantId: ctx.connection.tenant_id,
      accessToken: ctx.connection.access_token,
    });
  }
  const collection = await collectMembershipInvoice(
    adminClient,
    ctx,
    period,
    membership,
    invoice,
  )
    .catch((error) => ({
      attempted: true,
      status: "failed",
      error: getErrorMessage(error),
    }));
  return { ...synced, emailSent: sendEmail, collection };
};

const issueMembershipRenewals = async (
  adminClient: SupabaseAdminClient,
  _ctx: any,
  requestedPeriodIds: string[] = [],
  sendEmail = true,
  requestedBy: string | null = null,
) => {
  const { error: prepareError } = await adminClient.rpc(
    "prepare_membership_renewals",
    { p_as_of: new Date().toISOString().slice(0, 10) },
  );
  if (prepareError) throw prepareError;

  const { data: settings, error: settingsError } = await adminClient
    .from("membership_settings")
    .select("renewal_invoice_lead_days")
    .eq("id", true)
    .maybeSingle();
  if (settingsError) throw settingsError;
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const issueThrough = new Date(today);
  issueThrough.setUTCDate(
    issueThrough.getUTCDate() +
      Math.max(0, Number(settings?.renewal_invoice_lead_days || 30)),
  );

  let query = adminClient
    .from("membership_financial_periods")
    .select(
      "id,membership_id,due_date,xero_invoice_id,billing_sync_status",
    )
    .in("fee_disposition", ["invoice_required", "invoiced", "overdue"])
    .gt("amount_due", 0)
    .lte("due_date", issueThrough.toISOString().slice(0, 10))
    .order("due_date", { ascending: true })
    .limit(100);
  if (requestedPeriodIds.length > 0) query = query.in("id", requestedPeriodIds);
  const { data: periods, error } = await query;
  if (error) throw error;

  const membershipIds = Array.from(
    new Set((periods || []).map((period: any) => period.membership_id)),
  );
  const { data: memberships, error: membershipsError } = membershipIds.length
    ? await adminClient
      .from("club_memberships")
      .select("id,user_id")
      .in("id", membershipIds)
    : { data: [], error: null };
  if (membershipsError) throw membershipsError;
  const membershipUserById = new Map<string, string>(
    (memberships || []).map((membership: any) => [
      membership.id,
      membership.user_id,
    ]),
  );
  const userIds = Array.from(
    new Set((memberships || []).map((membership: any) => membership.user_id)),
  );
  const { data: preferences, error: preferencesError } = userIds.length
    ? await adminClient
      .from("membership_payment_preferences")
      .select("user_id,payment_method,auto_renew,authority_status")
      .in("user_id", userIds)
    : { data: [], error: null };
  if (preferencesError) throw preferencesError;
  const preferenceByUserId = new Map<string, any>(
    (preferences || []).map((preference: any) => [
      preference.user_id,
      preference,
    ]),
  );

  const results: any[] = [];
  for (const period of periods || []) {
    if (["failed", "needs_review"].includes(period.billing_sync_status)) {
      continue;
    }
    const alreadyIssued = Boolean(clean(period.xero_invoice_id));
    if (alreadyIssued) {
      if (String(period.due_date).slice(0, 10) > todayIso) continue;
      const memberUserId = membershipUserById.get(period.membership_id);
      const preference = memberUserId
        ? preferenceByUserId.get(memberUserId)
        : undefined;
      if (
        !preference?.auto_renew ||
        !["card", "becs"].includes(clean(preference.payment_method)) ||
        preference.authority_status !== "ready"
      ) {
        continue;
      }
    }
    try {
      const queue = await queueMembershipBilling(
        adminClient,
        period.id,
        requestedBy,
        {
          sendEmail: alreadyIssued ? false : sendEmail,
          source: alreadyIssued
            ? "membership_automatic_collection"
            : "membership_renewal_batch",
        },
      );
      results.push({ periodId: period.id, queued: true, queueId: queue.id });
    } catch (error) {
      results.push({
        periodId: period.id,
        error: getErrorMessage(error),
        emailSent: false,
      });
    }
  }
  return {
    attempted: results.length,
    queued: results.filter((item) => item.queued).length,
    issued: 0,
    emailed: 0,
    failed: results.filter((item) => item.error).length,
    results,
  };
};

const refreshMembershipInvoices = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  requestedPeriodIds: string[] = [],
) => {
  let query = adminClient
    .from("membership_financial_periods")
    .select("id,xero_invoice_id")
    .not("xero_invoice_id", "is", null)
    .order("updated_at", { ascending: true })
    .limit(100);
  if (requestedPeriodIds.length > 0) query = query.in("id", requestedPeriodIds);
  const { data: periods, error } = await query;
  if (error) throw error;

  const results: any[] = [];
  for (const period of periods || []) {
    try {
      const invoice = await getXeroInvoice(ctx, clean(period.xero_invoice_id));
      if (!invoice) throw new Error("Linked invoice not found in Xero.");
      results.push(
        await updateMembershipPeriodFromInvoice(
          adminClient,
          period.id,
          invoice,
        ),
      );
    } catch (error) {
      const message = getErrorMessage(error);
      const syncedAt = new Date().toISOString();
      await adminClient.from("membership_financial_periods").update({
        xero_sync_error: message,
        xero_last_synced_at: syncedAt,
        updated_at: syncedAt,
      }).eq("id", period.id);
      results.push({ periodId: period.id, error: message });
    }
  }
  return { refreshed: results.length, results };
};

const issueMemberMembershipInvoice = async (
  adminClient: SupabaseAdminClient,
  ctx: any,
  userId: string,
  sendEmail = true,
  requestedBy: string | null = null,
) => {
  const { data: membership, error: membershipError } = await adminClient
    .from("club_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("legal_status", "current")
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return { issued: false, reason: "membership_not_current" };
  const { data: period, error: periodError } = await adminClient
    .from("membership_financial_periods")
    .select("id")
    .eq("membership_id", membership.id)
    .order("financial_year_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (periodError) throw periodError;
  if (!period) return { issued: false, reason: "financial_period_not_ready" };
  const queue = await queueMembershipBilling(
    adminClient,
    period.id,
    requestedBy,
    { sendEmail, source: "member_approval_or_payment_setup" },
  );
  if (queue.status === "processing") {
    return { issued: true, queued: true, queueId: queue.id };
  }
  return {
    issued: true,
    queued: true,
    queueId: queue.id,
    result: await processQueueRecord(
      adminClient,
      ctx,
      queue,
      requestedBy,
    ),
  };
};

const cancelPendingMembershipCollections = async (
  adminClient: SupabaseAdminClient,
  invoiceId: string,
) => {
  const { data: records, error } = await adminClient
    .from("xero_invoice_portal_payments")
    .select("id,stripe_payment_intent_id,stripe_mode,status")
    .eq("xero_invoice_id", invoiceId)
    .eq("status", "pending");
  if (error) throw error;
  if (!records?.length) return [];

  const connectedAccountId = await getConnectedStripeAccountId(adminClient);
  if (!connectedAccountId) {
    throw Object.assign(
      new Error(
        "A membership payment is still pending and Stripe is not connected. Reconnect Stripe before cancelling this membership.",
      ),
      { status: 409 },
    );
  }

  const results: any[] = [];
  for (const record of records) {
    const paymentIntentId = clean(record.stripe_payment_intent_id);
    if (!paymentIntentId) {
      throw Object.assign(
        new Error(
          "A membership payment has just started. Wait a moment and try the cancellation again.",
        ),
        { status: 409 },
      );
    }
    const stripeMode = clean(record.stripe_mode) === "test" ? "test" : "live";
    const stripeSecretKey = getStripeSecretKeyForMode(stripeMode as StripeMode);
    const retrieveResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${
        encodeURIComponent(paymentIntentId)
      }`,
      { headers: stripeHeaders(stripeSecretKey, connectedAccountId) },
    );
    const paymentIntent = await retrieveResponse.json().catch(() => ({}));
    if (!retrieveResponse.ok) {
      throw new Error(
        clean(paymentIntent?.error?.message) ||
          "The pending Stripe membership payment could not be checked.",
      );
    }
    if (paymentIntent.status === "succeeded") {
      throw Object.assign(
        new Error(
          "The membership payment has completed and is being reconciled. Wait for the payment confirmation, then cancel again.",
        ),
        { status: 409 },
      );
    }
    if (paymentIntent.status !== "canceled") {
      const cancelResponse = await fetch(
        `https://api.stripe.com/v1/payment_intents/${
          encodeURIComponent(paymentIntentId)
        }/cancel`,
        {
          method: "POST",
          headers: stripeHeaders(stripeSecretKey, connectedAccountId),
        },
      );
      const cancelledIntent = await cancelResponse.json().catch(() => ({}));
      if (!cancelResponse.ok || cancelledIntent.status !== "canceled") {
        throw Object.assign(
          new Error(
            clean(cancelledIntent?.error?.message) ||
              "The pending Stripe membership payment could not be stopped. Try again after its status updates.",
          ),
          { status: 409 },
        );
      }
    }
    const now = new Date().toISOString();
    await adminClient.from("xero_invoice_portal_payments").update({
      status: "cancelled",
      error:
        "Cancelled because the membership was cancelled before collection completed.",
      updated_at: now,
    }).eq("id", record.id).eq("status", "pending");
    results.push({
      paymentRecordId: record.id,
      paymentIntentId,
      status: "cancelled",
    });
  }
  return results;
};

const cancelDirectMembershipCollections = async (
  adminClient: SupabaseAdminClient,
  userId: string,
) => {
  const { data: records, error } = await adminClient
    .from("membership_provider_payments")
    .select("id,external_payment_id,stripe_mode,status")
    .eq("user_id", userId)
    .in("status", ["pending", "processing"]);
  if (error) throw error;
  if (!records?.length) return [];

  const results: any[] = [];
  for (const record of records) {
    const paymentIntentId = clean(record.external_payment_id);
    if (!paymentIntentId) {
      const now = new Date().toISOString();
      await adminClient.from("membership_provider_payments").update({
        status: "cancelled",
        error:
          "Cancelled because the membership was cancelled before Stripe collection began.",
        updated_at: now,
      }).eq("id", record.id).in("status", ["pending", "processing"]);
      results.push({
        paymentRecordId: record.id,
        paymentIntentId: null,
        status: "cancelled",
      });
      continue;
    }

    const connectedAccountId = await getConnectedStripeAccountId(adminClient);
    if (!connectedAccountId) {
      throw Object.assign(
        new Error(
          "A Stripe membership payment is still processing. Reconnect Stripe before cancelling so the debit can be stopped safely.",
        ),
        { status: 409 },
      );
    }
    const stripeMode = clean(record.stripe_mode) === "live" ? "live" : "test";
    const stripeSecretKey = getStripeSecretKeyForMode(stripeMode as StripeMode);
    const retrieveResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${
        encodeURIComponent(paymentIntentId)
      }`,
      { headers: stripeHeaders(stripeSecretKey, connectedAccountId) },
    );
    const paymentIntent = await retrieveResponse.json().catch(() => ({}));
    if (!retrieveResponse.ok) {
      throw Object.assign(
        new Error(
          clean(paymentIntent?.error?.message) ||
            "The processing Stripe membership payment could not be checked.",
        ),
        { status: 409 },
      );
    }
    if (paymentIntent.status === "succeeded") {
      throw Object.assign(
        new Error(
          "The Stripe membership payment has completed and is being reconciled. Wait for confirmation, then cancel again.",
        ),
        { status: 409 },
      );
    }
    if (paymentIntent.status !== "canceled") {
      const cancelResponse = await fetch(
        `https://api.stripe.com/v1/payment_intents/${
          encodeURIComponent(paymentIntentId)
        }/cancel`,
        {
          method: "POST",
          headers: stripeHeaders(stripeSecretKey, connectedAccountId),
        },
      );
      const cancelledIntent = await cancelResponse.json().catch(() => ({}));
      if (!cancelResponse.ok || cancelledIntent.status !== "canceled") {
        throw Object.assign(
          new Error(
            clean(cancelledIntent?.error?.message) ||
              "The processing Stripe membership payment could not be stopped.",
          ),
          { status: 409 },
        );
      }
    }
    const now = new Date().toISOString();
    await adminClient.from("membership_provider_payments").update({
      status: "cancelled",
      error:
        "Cancelled because the membership was cancelled before collection completed.",
      updated_at: now,
    }).eq("id", record.id).in("status", ["pending", "processing"]);
    results.push({
      paymentRecordId: record.id,
      paymentIntentId,
      status: "cancelled",
    });
  }
  return results;
};

const xeroIsUnavailable = (error: unknown) => {
  const message = getErrorMessage(error, "").toLowerCase();
  return message.includes("xero is not connected") ||
    message.includes("xero refresh credentials are not configured") ||
    message.includes("xero token encryption key") ||
    message.includes("xero posting is contained") ||
    message.includes("expected xero tenant") ||
    message.includes("xero tenant");
};

const cancelMembership = async (
  adminClient: SupabaseAdminClient,
  getXeroContext: () => Promise<any>,
  userId: string,
  reason: string,
  actorId: string | null,
) => {
  const cancellationReason = clean(reason);
  if (cancellationReason.length < 10) {
    throw Object.assign(
      new Error("A cancellation reason of at least 10 characters is required."),
      { status: 400 },
    );
  }
  const { data: application, error: applicationError } = await adminClient
    .from("membership_applications")
    .select("id,status")
    .eq("user_id", userId)
    .in("status", ["pending", "approved", "auto_commenced"])
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (applicationError) throw applicationError;
  const { data: membership, error: membershipError } = await adminClient
    .from("club_memberships")
    .select("id,legal_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!application && !membership) {
    throw Object.assign(
      new Error("No membership application or membership was found."),
      { status: 404 },
    );
  }
  if (
    application?.status !== "pending" && membership?.legal_status !== "current"
  ) {
    throw Object.assign(
      new Error(
        "This membership application or membership is already inactive.",
      ),
      { status: 409 },
    );
  }

  const invoiceResults: any[] = [];
  const paidPeriodIds = new Set<string>();
  const preservedPeriodIds = new Set<string>();
  const stripeCollectionCancellations =
    await cancelDirectMembershipCollections(adminClient, userId);
  let xeroContext: any = null;
  if (membership) {
    const { data: periods, error: periodsError } = await adminClient
      .from("membership_financial_periods")
      .select("*")
      .eq("membership_id", membership.id);
    if (periodsError) throw periodsError;

    for (const period of periods || []) {
      if (
        !clean(period.xero_invoice_id) &&
        ["paid", "waived", "fee_exempt"].includes(
          clean(period.fee_disposition).toLowerCase(),
        )
      ) {
        preservedPeriodIds.add(period.id);
        invoiceResults.push({
          periodId: period.id,
          invoiceId: clean(period.xero_invoice_id) || null,
          invoiceNumber: clean(period.xero_invoice_number) || null,
          action: "preserved",
          reason: "financial_period_already_settled",
          status: clean(period.xero_invoice_status) || null,
        });
        continue;
      }
      const invoiceId = clean(period.xero_invoice_id);
      if (!invoiceId) {
        invoiceResults.push({
          periodId: period.id,
          action: "crm_only",
          reason: "no_xero_invoice",
        });
        continue;
      }
      try {
        xeroContext ||= await getXeroContext();
      } catch (error) {
        if (!xeroIsUnavailable(error)) throw error;
        invoiceResults.push({
          periodId: period.id,
          invoiceId,
          invoiceNumber: clean(period.xero_invoice_number) || null,
          action: "void_deferred",
          status: clean(period.xero_invoice_status) || null,
          reason:
            "Xero is disconnected. The membership was cancelled locally and this invoice must be voided after reconnection.",
        });
        continue;
      }
      const invoice = await getXeroInvoice(xeroContext, invoiceId);
      if (!invoice) {
        throw new Error(
          `The linked Xero membership invoice ${
            clean(period.xero_invoice_number) || invoiceId
          } could not be found.`,
        );
      }
      const status = clean(invoice.Status).toUpperCase();
      const amountPaid = money(invoice.AmountPaid);
      if (["PAID", "PARTPAID"].includes(status) || amountPaid > 0.005) {
        paidPeriodIds.add(period.id);
        preservedPeriodIds.add(period.id);
        invoiceResults.push({
          periodId: period.id,
          invoiceId,
          invoiceNumber: clean(invoice.InvoiceNumber) || null,
          action: "preserved",
          reason: "invoice_has_payment",
          status,
        });
        continue;
      }
      if (["VOIDED", "DELETED", "CANCELLED"].includes(status)) {
        invoiceResults.push({
          periodId: period.id,
          invoiceId,
          action: "already_void",
          status,
        });
        continue;
      }
      const collectionCancellations = await cancelPendingMembershipCollections(
        adminClient,
        invoiceId,
      );
      const targetStatus = ["DRAFT", "SUBMITTED"].includes(status)
        ? "DELETED"
        : "VOIDED";
      const updatedInvoice = await updateXeroInvoiceStatus(
        xeroContext,
        invoiceId,
        targetStatus,
      );
      invoiceResults.push({
        periodId: period.id,
        invoiceId,
        invoiceNumber:
          clean(updatedInvoice?.InvoiceNumber || invoice.InvoiceNumber) || null,
        action: targetStatus.toLowerCase(),
        status: clean(updatedInvoice?.Status) || targetStatus,
        collectionCancellations,
      });
    }

    for (const period of periods || []) {
      if (preservedPeriodIds.has(period.id)) continue;
      const invoiceResult = invoiceResults.find((item) =>
        item.periodId === period.id
      );
      const voidDeferred = invoiceResult?.action === "void_deferred";
      const { error } = await adminClient.from("membership_financial_periods")
        .update({
          fee_disposition: "ceased",
          xero_invoice_status: invoiceResult?.status ||
            period.xero_invoice_status,
          xero_amount_due: invoiceResult?.action === "voided" ||
              invoiceResult?.action === "deleted" ||
              invoiceResult?.action === "already_void"
            ? 0
            : period.xero_amount_due,
          xero_last_synced_at: invoiceResult?.invoiceId
            ? new Date().toISOString()
            : period.xero_last_synced_at,
          xero_sync_error: voidDeferred
            ? invoiceResult.reason
            : null,
          billing_sync_status: voidDeferred
            ? "needs_review"
            : period.billing_sync_status,
          billing_sync_error: voidDeferred
            ? invoiceResult.reason
            : period.billing_sync_error,
          financially_cleared_at: null,
          updated_at: new Date().toISOString(),
        }).eq("id", period.id);
      if (error) throw error;
    }
  }

  const now = new Date().toISOString();
  if (application?.status === "pending") {
    const { error } = await adminClient.from("membership_applications").update({
      status: "withdrawn",
      decided_at: now,
      decided_by: actorId,
      decision_reason: cancellationReason,
      updated_at: now,
    }).eq("id", application.id).eq("status", "pending");
    if (error) throw error;
  }
  if (membership?.legal_status === "current") {
    const { error } = await adminClient.from("club_memberships").update({
      legal_status: "resigned",
      ended_at: now,
      end_reason: cancellationReason,
      updated_at: now,
    }).eq("id", membership.id).eq("legal_status", "current");
    if (error) throw error;
  }
  await adminClient.from("membership_payment_preferences").update({
    auto_renew: false,
    authority_status: "cancelled",
    cancelled_at: now,
    updated_at: now,
  }).eq("user_id", userId).neq("payment_method", "invoice");
  await adminClient.from("membership_payment_setup_sessions").update({
    status: "cancelled",
    updated_at: now,
  }).eq("user_id", userId).eq("status", "pending");

  const { error: eventError } = await adminClient.from(
    "membership_status_events",
  ).insert({
    membership_id: membership?.id || null,
    application_id: application?.id || null,
    user_id: userId,
    event_type: membership?.legal_status === "current"
      ? "membership_cancelled"
      : "application_withdrawn",
    actor_id: actorId,
    details: {
      reason: cancellationReason,
      xeroInvoices: invoiceResults,
      stripeCollections: stripeCollectionCancellations,
      paidInvoicesPreserved: paidPeriodIds.size,
      settledPeriodsPreserved: preservedPeriodIds.size,
    },
  });
  if (eventError) throw eventError;
  await adminClient.from("notifications").insert({
    user_id: userId,
    type: "membership",
    title: membership?.legal_status === "current"
      ? "BFC membership cancelled"
      : "Membership application withdrawn",
    message: invoiceResults.some((item) => item.action === "void_deferred")
      ? "Your membership has been cancelled. An unpaid Xero invoice is awaiting voiding when Xero is reconnected."
      : paidPeriodIds.size > 0
      ? "Your membership has been cancelled. Paid Xero invoices were retained as accounting records."
      : preservedPeriodIds.size > 0
      ? "Your membership has been cancelled. Settled membership records were retained for the club's history."
      : "Your membership has been cancelled and any unpaid Xero membership invoice has been voided.",
    metadata: {
      membershipId: membership?.id || null,
      applicationId: application?.id || null,
    },
    is_read: false,
  });

  return {
    cancelled: true,
    applicationWithdrawn: application?.status === "pending",
    membershipResigned: membership?.legal_status === "current",
    invoiceResults,
    stripeCollectionCancellations,
    paidInvoicesPreserved: paidPeriodIds.size,
    settledPeriodsPreserved: preservedPeriodIds.size,
  };
};

Deno.serve(async (req: Request) => {
  corsHeaders = corsHeadersForRequest(req, "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (!isAllowedBrowserOrigin(req)) {
    return json({ error: "Origin is not allowed." }, 403);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    xeroRateLimitAdminClient = adminClient;

    const auth = await authenticateAal2AdminOrWorker({
      req,
      supabaseUrl,
      anonKey,
      adminClient,
      allowWorker: true,
    });
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const workerActions = new Set([
      "process-next",
      "issue-membership-renewals",
      "refresh-membership-invoices",
      "inventory-current-tenant",
      "cleanup-legacy-test-artefacts",
    ]);
    if (auth.actorType === "worker" && !workerActions.has(action)) {
      return json({ error: "The integration worker is not authorised for this action." }, 403);
    }

    if (action === "cancel-membership") {
      const userId = clean(body.userId);
      const reason = clean(body.reason);
      if (!userId) return json({ error: "Missing userId" }, 400);
      const actorId = clean(body.requestedByUserId) === userId
        ? userId
        : auth.userId;
      return json(
        await cancelMembership(
          adminClient,
          () => getConnectionAndSettings(adminClient),
          userId,
          reason,
          actorId,
        ),
      );
    }

    // Queue inspection is a local, read-only operation. It must remain
    // available when Xero is disconnected, contained or awaiting reconnection.
    if (isConnectionIndependentXeroAction(action) && action === "list-queue") {
      const status = clean(body.status || "all").toLowerCase();
      const limit = Number(body.limit || 50);
      return json(await listQueue(adminClient, status, limit));
    }

    const inventoryActions = new Set([
      "search-contacts",
      "list-accounts",
      "list-items",
      "list-tracking-categories",
      "list-tax-rates",
      "inventory-current-tenant",
      "list-mapping-versions",
      "save-mapping-draft",
      "approve-mapping-version",
      "cleanup-legacy-test-artefacts",
    ]);
    const ctx: any = await getConnectionAndSettings(adminClient, {
      allowInventory: inventoryActions.has(action),
    });
    ctx.priorityTopupSync = action === "sync-transaction" &&
      body.priorityTopupSync === true;

    if (action === "queue-member-contact") {
      const userId = clean(body.userId);
      if (!userId) return json({ error: "Missing userId" }, 400);
      const row = await queueItem(
        adminClient,
        "contact",
        userId,
        "upsert_contact",
        auth.userId,
        { reason: "manual_queue" },
      );
      await adminClient.from("users").update({
        xero_contact_sync_status: "queued",
        xero_contact_sync_error: null,
      }).eq("id", userId);
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
      return json({
        contacts: contacts.map((contact: any) => ({
          contactId: clean(contact.ContactID),
          name: clean(contact.Name),
          email: clean(contact.EmailAddress),
        })),
      });
    }

    if (action === "list-accounts") {
      return json({ accounts: await listXeroAccounts(ctx) });
    }

    if (action === "list-items") {
      return json({ items: await listXeroItems(ctx) });
    }

    if (action === "list-tax-rates") {
      return json({ taxRates: await listXeroTaxRates(ctx) });
    }

    if (action === "list-tracking-categories") {
      return json({ categories: await listXeroTrackingCategories(ctx) });
    }

    if (action === "inventory-current-tenant") {
      return json(await inventoryCurrentTenant(adminClient, ctx));
    }

    if (action === "cleanup-legacy-test-artefacts") {
      return json(await cleanupLegacyTestArtifacts(adminClient, ctx, body));
    }

    if (action === "list-mapping-versions") {
      const { data, error } = await adminClient.from("xero_mapping_versions")
        .select("*,xero_mapping_entries(*)")
        .eq("tenant_id", ctx.connection.tenant_id)
        .order("version", { ascending: false });
      if (error) throw error;
      return json({ versions: data || [] });
    }

    if (action === "save-mapping-draft") {
      if (auth.actorType !== "user") return json({ error: "Administrator access is required." }, 403);
      return json(await saveMappingDraft(adminClient, ctx, body, auth.userId));
    }

    if (action === "approve-mapping-version") {
      if (auth.actorType !== "user") return json({ error: "Administrator access is required." }, 403);
      return json(await approveMappingVersion(adminClient, ctx, body, auth.userId));
    }

    if (action === "ensure-stripe-clearing-account") {
      return json(await ensureStripeClearingAccount(ctx));
    }

    if (action === "ensure-prepaid-clearing-account") {
      return json(await ensurePrepaidClearingAccount(ctx));
    }

    if (action === "ensure-topup-receipt-account") {
      return json({
        error:
          "Member top-up receipts must use an existing active Xero bank account. Select one in Xero settings.",
      }, 400);
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
      return json(
        await ensureAircraftTrackingOption(ctx, {
          categoryName,
          optionName,
          categoryId,
        }),
      );
    }

    if (action === "ensure-flight-type-item") {
      const flightTypeId = clean(body.flightTypeId);
      const code = clean(body.code);
      const name = clean(body.name);
      const description = clean(body.description);
      const accountCode = clean(body.accountCode);
      if (!flightTypeId || !code || !name) {
        return json({ error: "Missing flightTypeId, code or name" }, 400);
      }
      return json(
        await ensureFlightTypeSalesItem(adminClient, ctx, {
          flightTypeId,
          code,
          name,
          description,
          accountCode,
        }),
      );
    }

    if (action === "link-contact") {
      const userId = clean(body.userId);
      const contactId = clean(body.contactId);
      if (!userId || !contactId) {
        return json({ error: "Missing userId or contactId" }, 400);
      }
      return json(
        await linkContactManually(adminClient, ctx, userId, contactId),
      );
    }

    if (action === "queue-flight-invoice") {
      const flightLogId = clean(body.flightLogId);
      if (!flightLogId) return json({ error: "Missing flightLogId" }, 400);
      const row = await queueItem(
        adminClient,
        "flight_invoice",
        flightLogId,
        "create_invoice",
        auth.userId,
        { reason: "manual_queue" },
      );
      await adminClient.from("flight_logs").update({
        xero_sync_status: "queued",
        xero_sync_error: null,
      }).eq("id", flightLogId);
      return json({ queued: true, queueItem: row });
    }

    if (action === "sync-flight-invoice") {
      const flightLogId = clean(body.flightLogId);
      if (!flightLogId) return json({ error: "Missing flightLogId" }, 400);
      return json(
        await createOrUpdateFlightInvoice(adminClient, ctx, flightLogId),
      );
    }

    if (action === "apply-flight-payments") {
      const flightLogId = clean(body.flightLogId);
      if (!flightLogId) return json({ error: "Missing flightLogId" }, 400);
      return json(await applyFlightPayments(adminClient, ctx, flightLogId));
    }

    if (action === "repair-prepaid-flight-credit-allocation") {
      const flightLogId = clean(body.flightLogId);
      if (!flightLogId) return json({ error: "Missing flightLogId" }, 400);
      return json(
        await repairPrepaidFlightCreditAllocation(
          adminClient,
          ctx,
          flightLogId,
        ),
      );
    }

    if (action === "sync-ground-session-invoice") {
      const groundSessionLogId = clean(body.groundSessionLogId);
      if (!groundSessionLogId) {
        return json({ error: "Missing groundSessionLogId" }, 400);
      }
      return json(
        await createOrUpdateGroundSessionInvoice(
          adminClient,
          ctx,
          groundSessionLogId,
        ),
      );
    }

    if (action === "apply-ground-session-payments") {
      const groundSessionLogId = clean(body.groundSessionLogId);
      if (!groundSessionLogId) {
        return json({ error: "Missing groundSessionLogId" }, 400);
      }
      return json(
        await applyGroundSessionPayments(adminClient, ctx, groundSessionLogId),
      );
    }

    if (action === "refresh-paid-flight-invoices") {
      const flightLogIds = Array.isArray(body.flightLogIds)
        ? body.flightLogIds.map(clean).filter(Boolean)
        : [];
      return json(
        await refreshPaidFlightInvoices(adminClient, ctx, flightLogIds),
      );
    }

    if (action === "create-membership-invoice") {
      const periodId = clean(body.periodId);
      if (!periodId) return json({ error: "Missing periodId" }, 400);
      const queue = await queueMembershipBilling(
        adminClient,
        periodId,
        auth.userId,
        {
          sendEmail: body.sendEmail === true,
          source: "admin_membership_billing",
        },
      );
      return json({
        queued: true,
        queueId: queue.id,
        result: queue.status === "processing"
          ? { processing: true }
          : await processQueueRecord(adminClient, ctx, queue, auth.userId),
      });
    }

    if (action === "issue-member-membership-invoice") {
      const userId = clean(body.userId);
      if (!userId) return json({ error: "Missing userId" }, 400);
      return json(
        await issueMemberMembershipInvoice(
          adminClient,
          ctx,
          userId,
          body.sendEmail !== false,
          auth.userId,
        ),
      );
    }

    if (action === "issue-membership-renewals") {
      const periodIds = Array.isArray(body.periodIds)
        ? body.periodIds.map(clean).filter(Boolean)
        : [];
      return json(
        await issueMembershipRenewals(
          adminClient,
          ctx,
          periodIds,
          body.sendEmail !== false,
          auth.userId,
        ),
      );
    }

    if (action === "refresh-membership-invoices") {
      const periodIds = Array.isArray(body.periodIds)
        ? body.periodIds.map(clean).filter(Boolean)
        : [];
      return json(await refreshMembershipInvoices(adminClient, ctx, periodIds));
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
      const contactResult = await syncMemberContact(
        adminClient,
        ctx,
        tx.user_id,
      );
      const contactId = clean(
        contactResult?.contactId || member.xero_contact_id,
      );
      const { candidates } = await getTopupCreditCandidates(ctx, {
        ...member,
        xero_contact_id: contactId,
      }, tx);
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
        return json(
          { error: "Missing transactionId, creditId or creditKind" },
          400,
        );
      }
      if (creditKind !== "overpayment" && creditKind !== "prepayment") {
        return json(
          { error: "creditKind must be overpayment or prepayment" },
          400,
        );
      }
      const tx = await getAccountTransaction(adminClient, transactionId);
      const member = await getMember(adminClient, tx.user_id);
      const contactResult = await syncMemberContact(
        adminClient,
        ctx,
        tx.user_id,
      );
      const contactId = clean(
        contactResult?.contactId || member.xero_contact_id,
      );
      if (!contactId) {
        return json(
          { error: "Member is not linked to a Xero contact yet." },
          400,
        );
      }
      const { candidates } = await getTopupCreditCandidates(ctx, {
        ...member,
        xero_contact_id: contactId,
      }, tx);
      const match = candidates.find((candidate: any) =>
        clean(candidate.id) === creditId && candidate.kind === creditKind
      );
      if (!match) {
        return json({
          error: "Selected Xero credit could not be found for this member.",
        }, 404);
      }
      const now = await linkTopupTransactionToCredit({
        adminClient,
        transactionId,
        contactId,
        creditId,
      });
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
        xero_sync_error:
          "Xero link was removed manually. Choose the correct credit to match again.",
      }).eq("id", transactionId);
      if (error) throw error;
      return json({ unlinked: true, transactionId });
    }

    if (action === "remove-flight-log") {
      const flightLogId = clean(body.flightLogId);
      const mode = clean(body.mode || "auto").toLowerCase();
      if (!flightLogId) return json({ error: "Missing flightLogId" }, 400);
      const resolvedMode = mode === "credit-note"
        ? "credit-note"
        : mode === "void-delete"
        ? "void-delete"
        : "";
      if (!resolvedMode) {
        return json({ error: "Mode must be void-delete or credit-note" }, 400);
      }
      const result = await reverseFlightLogInXero({
        adminClient,
        ctx,
        flightLogId,
        mode: resolvedMode,
      });
      await clearQueueItemsForFlightLog(adminClient, flightLogId);
      return json(result);
    }

    if (action === "sync-voucher") {
      const voucherId = clean(body.voucherId);
      if (!voucherId) return json({ error: "Missing voucherId" }, 400);
      return json(await syncVoucherLifecycle(adminClient, ctx, voucherId));
    }

    if (action === "process-next") {
      const { data: leasedItems, error } = await adminClient.rpc(
        "lease_next_xero_sync_job",
        {
          p_worker_id: auth.actorType === "worker"
            ? "github-actions"
            : `admin:${auth.userId}`,
          p_lease_seconds: 120,
        },
      );
      if (error) throw error;
      const item = Array.isArray(leasedItems) ? leasedItems[0] : leasedItems;
      if (!item) {
        return json({
          processed: false,
          message: "No pending Xero sync work.",
        });
      }

      return json({
        processed: true,
        itemId: item.id,
        result: await processQueueRecord(adminClient, ctx, item, auth.userId),
      });
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
      return json({
        processed: true,
        itemId: item.id,
        result: await processQueueRecord(adminClient, ctx, item, auth.userId),
      });
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
      if (item.entity_type === "membership_period") {
        await updateMembershipBillingState(adminClient, item.entity_id, {
          status: "queued",
          attempts: Number(item.attempts || 0),
          nextAttemptAt: item.next_attempt_at,
          error: null,
        });
      }
      return json({ queued: true, item });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("xero-sync error:", error);
    return json(
      { error: getErrorMessage(error, "The accounting request could not be completed") },
      Number((error as any)?.status || 500),
    );
  }
});
