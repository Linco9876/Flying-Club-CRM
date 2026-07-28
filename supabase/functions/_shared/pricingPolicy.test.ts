import {
  assertEquals,
} from "jsr:@std/assert@1";

import { XERO_SALES_LINE_AMOUNT_TYPE } from "./pricingPolicy.ts";

Deno.test("Xero customer sales use tax-inclusive line amounts", () => {
  assertEquals(XERO_SALES_LINE_AMOUNT_TYPE, "Inclusive");
});
