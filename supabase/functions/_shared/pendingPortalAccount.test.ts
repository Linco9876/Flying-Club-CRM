import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  createPendingAccountPassword,
  isValidPendingAccountEmail,
  nextPendingAccountClaimWindow,
  normalisePendingAccountEmail,
  PENDING_ACCOUNT_CLAIM_COOLDOWN_MS,
  PENDING_ACCOUNT_CLAIM_WINDOW_MS,
  pendingAccountClaimIsAvailable,
  pendingAccountClaimIsWithinWindowLimit,
  pendingAccountClaimResponse,
  resolvePendingAccountRedirect,
} from "./pendingPortalAccount.ts";

Deno.test("pending account emails are normalised and validated before lookup", () => {
  assertEquals(
    normalisePendingAccountEmail("  Pilot@Example.COM "),
    "pilot@example.com",
  );
  assertEquals(isValidPendingAccountEmail("pilot@example.com"), true);
  assertEquals(isValidPendingAccountEmail("not-an-email"), false);
  assertEquals(
    isValidPendingAccountEmail(`${"a".repeat(250)}@example.com`),
    false,
  );
});

Deno.test("claim email reservations enforce a fifteen minute cooldown", () => {
  const now = Date.parse("2026-08-04T03:30:00.000Z");
  assertEquals(pendingAccountClaimIsAvailable(null, now), true);
  assertEquals(
    pendingAccountClaimIsAvailable(
      new Date(now - PENDING_ACCOUNT_CLAIM_COOLDOWN_MS + 1).toISOString(),
      now,
    ),
    false,
  );
  assertEquals(
    pendingAccountClaimIsAvailable(
      new Date(now - PENDING_ACCOUNT_CLAIM_COOLDOWN_MS).toISOString(),
      now,
    ),
    true,
  );
  assertEquals(pendingAccountClaimIsAvailable("invalid", now), false);
});

Deno.test("claim emails are capped within a rolling daily window", () => {
  const now = Date.parse("2026-08-04T03:30:00.000Z");
  const activeWindow = new Date(now - PENDING_ACCOUNT_CLAIM_WINDOW_MS + 1)
    .toISOString();
  const expiredWindow = new Date(now - PENDING_ACCOUNT_CLAIM_WINDOW_MS)
    .toISOString();
  assertEquals(
    pendingAccountClaimIsWithinWindowLimit(4, activeWindow, now),
    true,
  );
  assertEquals(
    pendingAccountClaimIsWithinWindowLimit(5, activeWindow, now),
    false,
  );
  assertEquals(
    pendingAccountClaimIsWithinWindowLimit(99, expiredWindow, now),
    true,
  );
  assertEquals(
    pendingAccountClaimIsWithinWindowLimit(0, "invalid", now),
    false,
  );
  assertEquals(nextPendingAccountClaimWindow(4, activeWindow, now), {
    claimCount: 5,
    windowStartedAt: activeWindow,
  });
  assertEquals(nextPendingAccountClaimWindow(99, expiredWindow, now), {
    claimCount: 1,
    windowStartedAt: new Date(now).toISOString(),
  });
});

Deno.test("public claim responses do not disclose whether an email exists", () => {
  assertEquals(pendingAccountClaimResponse(), {
    accepted: true,
    message:
      "If this email matches an account awaiting setup, a verification email will arrive shortly.",
  });
});

Deno.test("claim links can only return to the configured portal origin", () => {
  const portal = "https://portal.example.com";
  assertEquals(
    resolvePendingAccountRedirect(
      "https://portal.example.com/anything?secret=value#hash",
      portal,
    ),
    "https://portal.example.com/reset-password",
  );
  assertEquals(
    resolvePendingAccountRedirect("https://attacker.example/accept", portal),
    "https://portal.example.com/reset-password",
  );
  assertEquals(
    resolvePendingAccountRedirect("http://localhost:5173/join", portal),
    "https://portal.example.com/reset-password",
  );
  assertEquals(
    resolvePendingAccountRedirect(
      "http://localhost:5173/join",
      "http://localhost:5173",
    ),
    "http://localhost:5173/reset-password",
  );
  assertEquals(
    resolvePendingAccountRedirect("not a url", portal),
    "https://portal.example.com/reset-password",
  );
});

Deno.test("silent accounts receive unique high-entropy passwords that are never shown", () => {
  const first = createPendingAccountPassword();
  const second = createPendingAccountPassword();
  assert(first.length >= 50);
  assert(first.length <= 72);
  assert(/[a-z]/.test(first));
  assert(/[A-Z]/.test(first));
  assert(/[0-9]/.test(first));
  assert(/[^a-zA-Z0-9]/.test(first));
  assertNotEquals(first, second);
});
