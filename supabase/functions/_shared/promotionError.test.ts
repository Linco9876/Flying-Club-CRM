import { promotionErrorMessage } from "./promotionError.ts";

Deno.test("promotion preserves structured database errors and ordinary errors", () => {
  for (const error of [new Error("Transfer failed"), { code: "42501", message: "Transfer failed" }]) {
    if (promotionErrorMessage(error) !== "Transfer failed") throw new Error("Failure details were lost");
  }
});

Deno.test("promotion uses a stable fallback for missing error messages", () => {
  for (const error of [null, undefined, {}, { message: "  " }, { message: 42 }]) {
    if (promotionErrorMessage(error) !== "The casual contact could not be promoted") {
      throw new Error("Unexpected fallback");
    }
  }
});
