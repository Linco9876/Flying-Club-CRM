import type { FinancialProviderCapabilities } from '../types/financialProviders';

export const financialProviderModeLabel = (
  capabilities: FinancialProviderCapabilities,
) => {
  switch (capabilities.mode) {
    case 'combined':
      return 'Stripe and Xero connected';
    case 'stripe_only':
      return 'Stripe connected';
    case 'xero_only':
      return 'Xero connected';
    default:
      return 'Financial services disconnected';
  }
};

export const financialProviderModeDescription = (
  capabilities: FinancialProviderCapabilities,
) => {
  switch (capabilities.mode) {
    case 'combined':
      return capabilities.combined.paymentReconciliationAvailable
        ? 'Online payments, Xero accounting, and payment reconciliation are available.'
        : 'Online payments and Xero accounting are available. Xero posting remains in its controlled review mode.';
    case 'stripe_only':
      return 'Online payments remain available. Xero balances, invoices, prepaid credit, and accounting sync are hidden.';
    case 'xero_only':
      return 'Xero balances, invoices, and accounting remain available. Card, BECS, and payment-link actions are hidden.';
    default:
      return 'Connect Stripe or Xero in Settings → Integrations to enable financial features.';
  }
};
