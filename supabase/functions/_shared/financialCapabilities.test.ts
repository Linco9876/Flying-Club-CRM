import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveFinancialProviderCapabilities } from "./financialCapabilities.ts";

Deno.test("neither provider disables finance", () => {
  const result = deriveFinancialProviderCapabilities({});
  assertEquals(result.mode, "disabled");
  assertEquals(result.financeEnabled, false);
  assertEquals(result.stripe.connected, false);
  assertEquals(result.xero.connected, false);
});

Deno.test("Stripe can operate without Xero", () => {
  const result = deriveFinancialProviderCapabilities({
    stripeAccountId: "acct_test123",
    stripeConfigured: true,
    stripeMode: "test",
  });
  assertEquals(result.mode, "stripe_only");
  assertEquals(result.stripe.paymentsAvailable, true);
  assertEquals(result.xero.accountingAvailable, false);
  assertEquals(result.combined.paymentReconciliationAvailable, false);
});

Deno.test("Xero can operate without Stripe", () => {
  const result = deriveFinancialProviderCapabilities({
    xeroTenantId: "tenant-1",
    xeroExpectedTenantId: "tenant-1",
    xeroHasRefreshToken: true,
    xeroConfigured: true,
    xeroPostingEnabled: true,
    xeroConnectionMode: "draft_only",
  });
  assertEquals(result.mode, "xero_only");
  assertEquals(result.stripe.paymentsAvailable, false);
  assertEquals(result.xero.accountingAvailable, true);
  assertEquals(result.xero.postingAvailable, true);
});

Deno.test("both providers enable combined reconciliation", () => {
  const result = deriveFinancialProviderCapabilities({
    stripeAccountId: "acct_test123",
    stripeConfigured: true,
    stripeMode: "test",
    xeroTenantId: "tenant-1",
    xeroExpectedTenantId: "tenant-1",
    xeroHasRefreshToken: true,
    xeroConfigured: true,
    xeroPostingEnabled: true,
    xeroConnectionMode: "posting",
  });
  assertEquals(result.mode, "combined");
  assertEquals(result.combined.paymentReconciliationAvailable, true);
});

Deno.test("stale links are not reported as connected", () => {
  const stripe = deriveFinancialProviderCapabilities({
    stripeAccountId: "acct_test123",
    stripeConfigured: false,
  });
  assertEquals(stripe.stripe.linked, true);
  assertEquals(stripe.stripe.connected, false);
  assertEquals(stripe.stripe.status, "configuration_required");

  const xero = deriveFinancialProviderCapabilities({
    xeroTenantId: "tenant-1",
    xeroExpectedTenantId: "tenant-1",
    xeroHasRefreshToken: true,
    xeroConfigured: false,
    xeroConnectionMode: "posting",
  });
  assertEquals(xero.xero.linked, true);
  assertEquals(xero.xero.connected, false);
  assertEquals(xero.xero.postingAvailable, false);
});

Deno.test("disconnected Xero is unavailable even when a tenant remains stored", () => {
  const result = deriveFinancialProviderCapabilities({
    xeroTenantId: "tenant-1",
    xeroExpectedTenantId: "tenant-1",
    xeroHasRefreshToken: true,
    xeroDisconnected: true,
    xeroConfigured: true,
    xeroPostingEnabled: true,
    xeroConnectionMode: "posting",
  });
  assertEquals(result.mode, "disabled");
  assertEquals(result.xero.linked, false);
  assertEquals(result.xero.connected, false);
});

Deno.test("a mismatched pinned Xero tenant is never available", () => {
  const result = deriveFinancialProviderCapabilities({
    xeroTenantId: "wrong-tenant",
    xeroExpectedTenantId: "bfc-tenant",
    xeroHasRefreshToken: true,
    xeroConfigured: true,
    xeroPostingEnabled: true,
    xeroConnectionMode: "posting",
  });
  assertEquals(result.mode, "disabled");
  assertEquals(result.xero.connected, false);
  assertEquals(
    result.xero.reason,
    "Xero is linked to a different organisation than the pinned organisation.",
  );
});
