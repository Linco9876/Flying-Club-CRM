export const DEFAULT_MEMBERSHIP_ITEM_CODE = "BFC-MEMBERSHIP";
export const DEFAULT_SCHOLARSHIP_ITEM_CODE = "BFC-SCHOLARSHIP";

export const DEFAULT_TECHNICAL_RETRY_MINUTES = [5, 30, 120, 720] as const;
export const DEFAULT_PAYMENT_RETRY_DAYS = [3, 7] as const;

const safeRetrySchedule = (
  configured: unknown,
  fallback: readonly number[],
) => {
  if (!Array.isArray(configured)) return [...fallback];
  const values = configured
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 10);
  return values.length ? values : [...fallback];
};

export const configuredTechnicalRetryMinutes = (configured: unknown) =>
  safeRetrySchedule(configured, DEFAULT_TECHNICAL_RETRY_MINUTES);

export const configuredPaymentRetryDays = (configured: unknown) =>
  safeRetrySchedule(configured, DEFAULT_PAYMENT_RETRY_DAYS);

export const retryDelayFromScheduleMs = (
  schedule: readonly number[],
  attempt: number,
  unitMs: number,
) => {
  const safeAttempt = Math.max(1, Math.trunc(attempt));
  const index = Math.min(safeAttempt - 1, schedule.length - 1);
  return schedule[index] * unitMs;
};

export const membershipBillingRetryDelayMs = (
  attempt: number,
  configured?: unknown,
) =>
  retryDelayFromScheduleMs(
    configuredTechnicalRetryMinutes(configured),
    attempt,
    60 * 1000,
  );

export const membershipPaymentRetryDelayMs = (
  attempt: number,
  configured?: unknown,
) =>
  retryDelayFromScheduleMs(
    configuredPaymentRetryDays(configured),
    attempt,
    24 * 60 * 60 * 1000,
  );

export const collectionWasSubmitted = (payment: {
  status?: string | null;
  stripe_payment_intent_id?: string | null;
}) =>
  Boolean(payment.stripe_payment_intent_id?.trim()) ||
  ["paid", "needs_review"].includes(String(payment.status || "").trim());

export const membershipCollectionIdempotencyParts = ({
  stripeMode,
  periodId,
  invoiceId,
  paymentRecordId,
}: {
  stripeMode: string;
  periodId: string;
  invoiceId: string;
  paymentRecordId: string;
}) =>
  [
    "membership-invoice-collection",
    stripeMode,
    periodId,
    invoiceId,
    paymentRecordId,
  ] as const;
