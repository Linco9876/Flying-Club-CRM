export type FinancialProviderMode =
  | "disabled"
  | "stripe_only"
  | "xero_only"
  | "combined";

export type ProviderAvailability = {
  linked: boolean;
  configured: boolean;
  connected: boolean;
  status: "connected" | "disconnected" | "configuration_required";
  reason: string | null;
};

export type FinancialProviderCapabilities = {
  mode: FinancialProviderMode;
  financeEnabled: boolean;
  stripe: ProviderAvailability & {
    paymentsAvailable: boolean;
    mode: "test" | "live";
  };
  xero: ProviderAvailability & {
    accountingAvailable: boolean;
    postingAvailable: boolean;
    connectionMode: "disconnected" | "inventory_only" | "draft_only" | "posting";
  };
  combined: {
    paymentReconciliationAvailable: boolean;
  };
};

type CapabilityEvidence = {
  stripeAccountId?: unknown;
  stripeConfigured?: boolean;
  stripeMode?: "test" | "live";
  xeroTenantId?: unknown;
  xeroExpectedTenantId?: unknown;
  xeroHasRefreshToken?: boolean;
  xeroDisconnected?: boolean;
  xeroConfigured?: boolean;
  xeroPostingEnabled?: boolean;
  xeroConnectionMode?: "disconnected" | "inventory_only" | "draft_only" | "posting";
};

const clean = (value: unknown) => String(value || "").trim();

export const deriveFinancialProviderCapabilities = (
  evidence: CapabilityEvidence,
): FinancialProviderCapabilities => {
  const stripeLinked = /^acct_[A-Za-z0-9_]+$/.test(
    clean(evidence.stripeAccountId),
  );
  const stripeConfigured = evidence.stripeConfigured === true;
  const stripeConnected = stripeLinked && stripeConfigured;
  const stripeStatus = stripeConnected
    ? "connected"
    : stripeLinked
    ? "configuration_required"
    : "disconnected";

  const xeroTenantId = clean(evidence.xeroTenantId);
  const xeroExpectedTenantId = clean(evidence.xeroExpectedTenantId);
  const xeroTenantMatches = Boolean(
    xeroTenantId &&
      xeroExpectedTenantId &&
      xeroTenantId === xeroExpectedTenantId,
  );
  const xeroLinked = Boolean(
    xeroTenantMatches &&
      evidence.xeroHasRefreshToken &&
      !evidence.xeroDisconnected,
  );
  const xeroConfigured = evidence.xeroConfigured === true;
  const xeroConnected = xeroLinked && xeroConfigured;
  const xeroStatus = xeroConnected
    ? "connected"
    : xeroLinked
    ? "configuration_required"
    : "disconnected";
  const xeroConnectionMode = evidence.xeroConnectionMode || "disconnected";
  const xeroPostingAvailable = Boolean(
    xeroConnected &&
      evidence.xeroPostingEnabled &&
      (xeroConnectionMode === "draft_only" ||
        xeroConnectionMode === "posting"),
  );

  const financeEnabled = stripeConnected || xeroConnected;
  const mode: FinancialProviderMode = stripeConnected && xeroConnected
    ? "combined"
    : stripeConnected
    ? "stripe_only"
    : xeroConnected
    ? "xero_only"
    : "disabled";

  return {
    mode,
    financeEnabled,
    stripe: {
      linked: stripeLinked,
      configured: stripeConfigured,
      connected: stripeConnected,
      status: stripeStatus,
      reason: stripeConnected
        ? null
        : stripeLinked
        ? "Stripe is linked, but the active Stripe credentials are not configured."
        : "Stripe is not connected.",
      paymentsAvailable: stripeConnected,
      mode: evidence.stripeMode === "live" ? "live" : "test",
    },
    xero: {
      linked: xeroLinked,
      configured: xeroConfigured,
      connected: xeroConnected,
      status: xeroStatus,
      reason: xeroConnected
        ? null
        : xeroTenantId && xeroExpectedTenantId &&
            xeroTenantId !== xeroExpectedTenantId
        ? "Xero is linked to a different organisation than the pinned organisation."
        : xeroLinked
        ? "Xero is linked, but its credentials or encryption key are not configured."
        : "Xero is not connected.",
      accountingAvailable: xeroConnected,
      postingAvailable: xeroPostingAvailable,
      connectionMode: xeroConnectionMode,
    },
    combined: {
      paymentReconciliationAvailable: Boolean(
        stripeConnected && xeroPostingAvailable,
      ),
    },
  };
};
