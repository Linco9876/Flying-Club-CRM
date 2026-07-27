export const DEFAULT_MEMBERSHIP_ITEM_CODE = "BFC-MEMBERSHIP";
export const DEFAULT_SCHOLARSHIP_ITEM_CODE = "BFC-SCHOLARSHIP";

export const membershipBillingRetryDelayMs = (attempt: number) => {
  if (attempt <= 1) return 5 * 60 * 1000;
  if (attempt === 2) return 30 * 60 * 1000;
  if (attempt === 3) return 2 * 60 * 60 * 1000;
  if (attempt === 4) return 12 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
};

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
