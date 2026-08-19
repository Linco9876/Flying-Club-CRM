export const PASSWORD_RESET_COOLDOWN_MS = 15 * 60 * 1000;
export const PASSWORD_RESET_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_MAX_REQUESTS_PER_WINDOW = 5;

export const passwordResetRequestIsAvailable = (
  reservedAt: string | null | undefined,
  now = Date.now(),
) => {
  if (!reservedAt) return true;
  const timestamp = Date.parse(reservedAt);
  return Number.isFinite(timestamp) &&
    now - timestamp >= PASSWORD_RESET_COOLDOWN_MS;
};

export const passwordResetRequestIsWithinWindowLimit = (
  requestCount: unknown,
  windowStartedAt: string | null | undefined,
  now = Date.now(),
) => {
  if (!windowStartedAt) return true;
  const windowStart = Date.parse(windowStartedAt);
  if (!Number.isFinite(windowStart)) return false;
  if (now - windowStart >= PASSWORD_RESET_WINDOW_MS) return true;

  const count = Number(requestCount);
  return Number.isInteger(count) && count >= 0 &&
    count < PASSWORD_RESET_MAX_REQUESTS_PER_WINDOW;
};

export const nextPasswordResetRequestWindow = (
  requestCount: unknown,
  windowStartedAt: string | null | undefined,
  now = Date.now(),
) => {
  const windowStart = windowStartedAt
    ? Date.parse(windowStartedAt)
    : Number.NaN;
  const windowExpired = !Number.isFinite(windowStart) ||
    now - windowStart >= PASSWORD_RESET_WINDOW_MS;
  return {
    requestCount: windowExpired
      ? 1
      : Math.max(0, Number(requestCount) || 0) + 1,
    windowStartedAt: windowExpired
      ? new Date(now).toISOString()
      : windowStartedAt!,
  };
};

export const publicPasswordResetResponse = () => ({
  accepted: true,
  message:
    "If that email matches a portal account, a password reset link will arrive shortly.",
});
