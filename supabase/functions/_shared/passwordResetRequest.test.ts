import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  nextPasswordResetRequestWindow,
  PASSWORD_RESET_COOLDOWN_MS,
  PASSWORD_RESET_MAX_REQUESTS_PER_WINDOW,
  PASSWORD_RESET_WINDOW_MS,
  passwordResetRequestIsAvailable,
  passwordResetRequestIsWithinWindowLimit,
  publicPasswordResetResponse,
} from "./passwordResetRequest.ts";

Deno.test("public password reset responses do not reveal account existence", () => {
  assertEquals(publicPasswordResetResponse(), {
    accepted: true,
    message:
      "If that email matches a portal account, a password reset link will arrive shortly.",
  });
});

Deno.test("password reset requests enforce cooldown and daily limits", () => {
  const now = Date.parse("2026-08-14T03:00:00.000Z");
  assertFalse(
    passwordResetRequestIsAvailable(
      new Date(now - PASSWORD_RESET_COOLDOWN_MS + 1).toISOString(),
      now,
    ),
  );
  assertEquals(
    passwordResetRequestIsAvailable(
      new Date(now - PASSWORD_RESET_COOLDOWN_MS).toISOString(),
      now,
    ),
    true,
  );
  assertFalse(passwordResetRequestIsWithinWindowLimit(
    PASSWORD_RESET_MAX_REQUESTS_PER_WINDOW,
    new Date(now - 1_000).toISOString(),
    now,
  ));
  assertEquals(
    passwordResetRequestIsWithinWindowLimit(
      PASSWORD_RESET_MAX_REQUESTS_PER_WINDOW,
      new Date(now - PASSWORD_RESET_WINDOW_MS).toISOString(),
      now,
    ),
    true,
  );
});

Deno.test("password reset request windows increment and restart safely", () => {
  const now = Date.parse("2026-08-14T03:00:00.000Z");
  assertEquals(
    nextPasswordResetRequestWindow(2, new Date(now - 1_000).toISOString(), now)
      .requestCount,
    3,
  );
  assertEquals(
    nextPasswordResetRequestWindow(
      5,
      new Date(now - PASSWORD_RESET_WINDOW_MS).toISOString(),
      now,
    ),
    {
      requestCount: 1,
      windowStartedAt: new Date(now).toISOString(),
    },
  );
});
