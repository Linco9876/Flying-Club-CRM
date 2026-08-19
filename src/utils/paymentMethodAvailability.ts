import type { FinancialProviderCapabilities } from '../types/financialProviders';

export interface ProviderScopedPaymentMethod {
  id?: string;
  name?: string | null;
  active?: boolean;
  allowAccountTopup?: boolean;
  systemKey?: string | null;
}

export interface ProviderScopedPaymentType {
  name?: string | null;
  forcedPaymentMethodId?: string | null;
}

export type PaymentMethodProvider = 'stripe' | 'xero' | null;

const normalise = (value?: string | null) =>
  String(value || '').toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();

export const paymentMethodProvider = (
  method: ProviderScopedPaymentMethod,
): PaymentMethodProvider => {
  const systemKey = normalise(method.systemKey);
  if (systemKey === 'stripe card' || systemKey === 'stripe card payment') return 'stripe';
  if (systemKey === 'pilot account') return 'xero';

  // Older databases pre-date system_key. Keep the two reserved method names safe
  // without hiding genuinely custom methods such as "Credit card at counter".
  const name = normalise(method.name);
  if (name === 'stripe' || name === 'stripe card') return 'stripe';
  if (name === 'pilot account' || name === 'prepaid' || name === 'pre paid') return 'xero';
  return null;
};

export const isPaymentMethodAvailable = (
  method: ProviderScopedPaymentMethod,
  capabilities: FinancialProviderCapabilities,
) => {
  if (method.active === false) return false;
  const provider = paymentMethodProvider(method);
  if (provider === 'stripe') return capabilities.stripe.paymentsAvailable;
  if (provider === 'xero') return capabilities.xero.accountingAvailable;
  return true;
};

export const isTopUpPaymentMethodAvailable = (
  method: ProviderScopedPaymentMethod,
  capabilities: FinancialProviderCapabilities,
) => method.allowAccountTopup !== false && isPaymentMethodAvailable(method, capabilities);

export const isPrepaidPaymentType = (name?: string | null) => {
  const value = normalise(name);
  return value.includes('pilot account') || value.includes('prepaid') || value.includes('pre paid');
};

export const isPaymentTypeAvailable = (
  paymentType: ProviderScopedPaymentType,
  paymentMethods: ProviderScopedPaymentMethod[],
  capabilities: FinancialProviderCapabilities,
) => {
  if (isPrepaidPaymentType(paymentType.name)) {
    return capabilities.xero.accountingAvailable;
  }

  if (!paymentType.forcedPaymentMethodId) return true;
  const forcedMethod = paymentMethods.find(method => method.id === paymentType.forcedPaymentMethodId);
  return Boolean(forcedMethod && isPaymentMethodAvailable(forcedMethod, capabilities));
};

export const paymentMethodUnavailableReason = (
  method: ProviderScopedPaymentMethod,
  capabilities: FinancialProviderCapabilities,
) => {
  if (method.active === false) return 'This method is turned off.';
  const provider = paymentMethodProvider(method);
  if (provider === 'stripe' && !capabilities.stripe.paymentsAvailable) return 'Connect Stripe to use this method.';
  if (provider === 'xero' && !capabilities.xero.accountingAvailable) return 'Connect Xero to use this method.';
  return null;
};
