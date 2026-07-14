import { assertEquals } from "jsr:@std/assert@1";
import { stripePriceIdForMode } from "./stripeMode.ts";

Deno.test("voucher Stripe prices never fall back across modes", () => {
  const product = {
    stripe_test_price_id: "price_test_123",
    stripe_live_price_id: "price_live_456",
    stripe_price_id: "price_legacy_live",
  };

  assertEquals(stripePriceIdForMode(product, "test"), "price_test_123");
  assertEquals(stripePriceIdForMode(product, "live"), "price_live_456");
  assertEquals(stripePriceIdForMode({ stripe_live_price_id: "price_live_456" }, "test"), "");
  assertEquals(stripePriceIdForMode({ stripe_test_price_id: "price_test_123" }, "live"), "");
});
