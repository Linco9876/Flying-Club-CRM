import { assertEquals, assertMatch } from "jsr:@std/assert";
import { assessOrphanAuthReconciliation } from "./accountEmailReconciliation.ts";

Deno.test("permits an unlinked authentication account with the same member name", () => {
  assertEquals(
    assessOrphanAuthReconciliation({
      targetProfileName: "Harper Molluso",
      orphanAuthName: "  Harper  Molluso ",
      orphanHasProfile: false,
    }),
    { allowed: true, code: "READY" },
  );
});

Deno.test("normalises punctuation and accents when comparing the account owner", () => {
  assertEquals(
    assessOrphanAuthReconciliation({
      targetProfileName: "Jos\u00e9 O'Neil",
      orphanAuthName: "Jose O Neil",
      orphanHasProfile: false,
    }).allowed,
    true,
  );
});

Deno.test("refuses to replace a login that already owns a CRM profile", () => {
  const result = assessOrphanAuthReconciliation({
    targetProfileName: "Harper Molluso",
    orphanAuthName: "Harper Molluso",
    orphanHasProfile: true,
  });
  assertEquals(result.code, "AUTH_ACCOUNT_HAS_PROFILE");
  assertMatch(result.error || "", /another CRM member/i);
});

Deno.test("refuses automatic reconciliation when the names differ or are missing", () => {
  assertEquals(
    assessOrphanAuthReconciliation({
      targetProfileName: "Harper Molluso",
      orphanAuthName: "Another Person",
      orphanHasProfile: false,
    }).code,
    "ACCOUNT_OWNER_MISMATCH",
  );
  assertEquals(
    assessOrphanAuthReconciliation({
      targetProfileName: "Harper Molluso",
      orphanAuthName: "",
      orphanHasProfile: false,
    }).code,
    "ACCOUNT_OWNER_UNKNOWN",
  );
});
