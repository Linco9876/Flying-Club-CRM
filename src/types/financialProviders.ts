export type FinancialProviderMode = 'disabled' | 'stripe_only' | 'xero_only' | 'combined';

export interface ProviderAvailability {
  linked: boolean;
  configured: boolean;
  connected: boolean;
  status: 'connected' | 'disconnected' | 'configuration_required';
  reason: string | null;
}

export interface FinancialProviderCapabilities {
  mode: FinancialProviderMode;
  financeEnabled: boolean;
  stripe: ProviderAvailability & {
    paymentsAvailable: boolean;
    mode: 'test' | 'live';
  };
  xero: ProviderAvailability & {
    accountingAvailable: boolean;
    postingAvailable: boolean;
    connectionMode: 'disconnected' | 'inventory_only' | 'draft_only' | 'posting';
  };
  combined: {
    paymentReconciliationAvailable: boolean;
  };
}

export const disabledFinancialProviderCapabilities: FinancialProviderCapabilities = {
  mode: 'disabled',
  financeEnabled: false,
  stripe: {
    linked: false,
    configured: false,
    connected: false,
    status: 'disconnected',
    reason: 'Stripe is not connected.',
    paymentsAvailable: false,
    mode: 'test',
  },
  xero: {
    linked: false,
    configured: false,
    connected: false,
    status: 'disconnected',
    reason: 'Xero is not connected.',
    accountingAvailable: false,
    postingAvailable: false,
    connectionMode: 'disconnected',
  },
  combined: {
    paymentReconciliationAvailable: false,
  },
};
