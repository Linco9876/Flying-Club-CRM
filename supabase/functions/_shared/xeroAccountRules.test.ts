import { assertEquals } from "jsr:@std/assert@1";
import { findExistingActiveXeroBankAccountCode } from "./xeroAccountRules.ts";

const accounts = [
  { code: "605", type: "BANK", status: "ACTIVE" },
  { code: "TOPUPRCPT", type: "CURRENT", status: "ACTIVE" },
  { code: "606", type: "BANK", status: "ARCHIVED" },
];

Deno.test("top-up posting accepts only the selected existing active bank account", () => {
  assertEquals(findExistingActiveXeroBankAccountCode(accounts, "605"), "605");
  assertEquals(findExistingActiveXeroBankAccountCode(accounts, "TOPUPRCPT"), "");
  assertEquals(findExistingActiveXeroBankAccountCode(accounts, "606"), "");
  assertEquals(findExistingActiveXeroBankAccountCode(accounts, "STRIPEBNK"), "");
});
