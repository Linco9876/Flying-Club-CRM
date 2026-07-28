/**
 * Every customer-facing price stored by the portal already includes GST/tax.
 * Xero must therefore extract tax from the supplied amount, never add it on top.
 */
export const XERO_SALES_LINE_AMOUNT_TYPE = "Inclusive" as const;
