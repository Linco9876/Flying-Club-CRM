export const PENDING_ACCOUNT_CLAIM_COOLDOWN_MS = 15 * 60 * 1000;
export const PENDING_ACCOUNT_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PENDING_ACCOUNT_MAX_CLAIMS_PER_WINDOW = 5;

export const normalisePendingAccountEmail = (value: unknown) =>
  String(value || "").trim().toLowerCase();

export const isValidPendingAccountEmail = (value: unknown) => {
  const email = normalisePendingAccountEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const pendingAccountClaimIsAvailable = (
  reservedAt: string | null | undefined,
  now = Date.now(),
) => {
  if (!reservedAt) return true;
  const timestamp = Date.parse(reservedAt);
  return Number.isFinite(timestamp) &&
    now - timestamp >= PENDING_ACCOUNT_CLAIM_COOLDOWN_MS;
};

export const pendingAccountClaimIsWithinWindowLimit = (
  claimCount: unknown,
  windowStartedAt: string | null | undefined,
  now = Date.now(),
) => {
  if (!windowStartedAt) return true;
  const windowStart = Date.parse(windowStartedAt);
  if (!Number.isFinite(windowStart)) return false;
  if (now - windowStart >= PENDING_ACCOUNT_CLAIM_WINDOW_MS) return true;

  const count = Number(claimCount);
  return Number.isInteger(count) && count >= 0 &&
    count < PENDING_ACCOUNT_MAX_CLAIMS_PER_WINDOW;
};

export const nextPendingAccountClaimWindow = (
  claimCount: unknown,
  windowStartedAt: string | null | undefined,
  now = Date.now(),
) => {
  const windowStart = windowStartedAt
    ? Date.parse(windowStartedAt)
    : Number.NaN;
  const windowExpired = !Number.isFinite(windowStart) ||
    now - windowStart >= PENDING_ACCOUNT_CLAIM_WINDOW_MS;
  return {
    claimCount: windowExpired ? 1 : Math.max(0, Number(claimCount) || 0) + 1,
    windowStartedAt: windowExpired
      ? new Date(now).toISOString()
      : windowStartedAt!,
  };
};

export const pendingAccountClaimResponse = () => ({
  accepted: true,
  message:
    "If this email matches an account awaiting setup, a verification email will arrive shortly.",
});

export const resolvePendingAccountRedirect = (
  value: unknown,
  configuredPortalOrigin: string,
) => {
  const portalOrigin = new URL(configuredPortalOrigin).origin;
  const fallback = `${portalOrigin}/reset-password`;
  if (typeof value !== "string" || !value.trim()) return fallback;

  try {
    const candidate = new URL(value.trim());
    const isConfiguredPortal = candidate.origin === portalOrigin;
    if (!isConfiguredPortal) return fallback;

    candidate.pathname = "/reset-password";
    candidate.search = "";
    candidate.hash = "";
    return candidate.toString();
  } catch {
    return fallback;
  }
};

export const createPendingAccountPassword = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `Bfc-${encoded}-aA1!`;
};
