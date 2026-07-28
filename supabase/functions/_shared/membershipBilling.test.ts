import {
  collectionWasSubmitted,
  configuredPaymentRetryDays,
  DEFAULT_MEMBERSHIP_ITEM_CODE,
  membershipBillingRetryDelayMs,
  membershipCollectionIdempotencyParts,
  membershipPaymentRetryDelayMs,
  resolveMembershipRevenueMapping,
} from "./membershipBilling.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("membership billing uses bounded increasing retry delays", () => {
  const delays = [1, 2, 3, 4, 5, 8].map(membershipBillingRetryDelayMs);
  assert(delays[0] === 5 * 60 * 1000, "first retry should wait five minutes");
  assert(delays[4] === 12 * 60 * 60 * 1000, "later retries should remain bounded");
  assert(
    delays.every((delay, index) => index === 0 || delay >= delays[index - 1]),
    "retry delays must never decrease",
  );
});

Deno.test("payment declines use a slower independently configurable schedule", () => {
  assert(
    membershipPaymentRetryDelayMs(1) === 3 * 24 * 60 * 60 * 1000,
    "first payment retry should wait three days",
  );
  assert(
    membershipPaymentRetryDelayMs(2, [2, 6]) === 6 * 24 * 60 * 60 * 1000,
    "configured payment retry days should be honoured",
  );
  assert(
    configuredPaymentRetryDays(["bad", 4, -1]).join(",") === "4",
    "invalid configured delays should be ignored",
  );
});

Deno.test("an interrupted reservation can resume but a submitted collection cannot", () => {
  assert(
    !collectionWasSubmitted({
      status: "pending",
      stripe_payment_intent_id: null,
    }),
    "a reservation without a Stripe intent must be resumable",
  );
  assert(
    collectionWasSubmitted({
      status: "pending",
      stripe_payment_intent_id: "pi_123",
    }),
    "a submitted Stripe intent must not be charged again",
  );
  assert(
    collectionWasSubmitted({ status: "paid", stripe_payment_intent_id: null }),
    "a paid record must never be retried",
  );
});

Deno.test("collection idempotency is stable per reserved attempt", () => {
  const base = {
    stripeMode: "test",
    periodId: "period-1",
    invoiceId: "invoice-1",
    paymentRecordId: "attempt-1",
  };
  const first = membershipCollectionIdempotencyParts(base).join(":");
  const repeated = membershipCollectionIdempotencyParts(base).join(":");
  const nextAttempt = membershipCollectionIdempotencyParts({
    ...base,
    paymentRecordId: "attempt-2",
  }).join(":");
  assert(first === repeated, "the same reserved attempt must reuse its key");
  assert(first !== nextAttempt, "a definite failed attempt must get a new key");
  assert(
    DEFAULT_MEMBERSHIP_ITEM_CODE === "BFC-MEMBERSHIP",
    "the fallback item code must remain explicit",
  );
});

Deno.test("membership products may share or override Xero revenue mappings", () => {
  const shared = resolveMembershipRevenueMapping({
    membershipClass: {
      xero_item_code: "bfc-membership",
      xero_account_code: "200",
    },
    settings: {
      xero_scholarship_item_code: "bfc-scholarship",
      xero_scholarship_account_code: "210",
    },
    defaultRevenueAccountCode: "999",
  });
  assert(shared.membershipItemCode === "BFC-MEMBERSHIP", "membership item code should be normalised");
  assert(shared.membershipAccountCode === "200", "class accounting code should override the default");
  assert(shared.scholarshipAccountCode === "210", "scholarship accounting should remain separate");

  const fallback = resolveMembershipRevenueMapping({
    membershipClass: {},
    settings: {},
    defaultRevenueAccountCode: "200",
  });
  assert(fallback.membershipItemCode === DEFAULT_MEMBERSHIP_ITEM_CODE, "legacy item fallback should remain");
  assert(fallback.membershipAccountCode === "200", "legacy memberships should use the integration default");
  assert(fallback.scholarshipAccountCode === "200", "scholarship should fall back safely");
});
