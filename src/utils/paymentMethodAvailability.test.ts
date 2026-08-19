import assert from 'node:assert/strict';
import test from 'node:test';
import type { FinancialProviderCapabilities, FinancialProviderMode } from '../types/financialProviders.ts';
import {
  isPaymentMethodAvailable,
  isPaymentTypeAvailable,
  isTopUpPaymentMethodAvailable,
} from './paymentMethodAvailability.ts';

const capabilities = (mode: FinancialProviderMode): FinancialProviderCapabilities => ({
  mode,
  financeEnabled: mode !== 'disabled',
  stripe: {
    linked: mode === 'stripe_only' || mode === 'combined',
    configured: mode === 'stripe_only' || mode === 'combined',
    connected: mode === 'stripe_only' || mode === 'combined',
    status: mode === 'stripe_only' || mode === 'combined' ? 'connected' : 'disconnected',
    reason: null,
    paymentsAvailable: mode === 'stripe_only' || mode === 'combined',
    mode: 'test',
  },
  xero: {
    linked: mode === 'xero_only' || mode === 'combined',
    configured: mode === 'xero_only' || mode === 'combined',
    connected: mode === 'xero_only' || mode === 'combined',
    status: mode === 'xero_only' || mode === 'combined' ? 'connected' : 'disconnected',
    reason: null,
    accountingAvailable: mode === 'xero_only' || mode === 'combined',
    postingAvailable: mode === 'xero_only' || mode === 'combined',
    connectionMode: mode === 'xero_only' || mode === 'combined' ? 'posting' : 'disconnected',
  },
  combined: { paymentReconciliationAvailable: mode === 'combined' },
});

const methods = {
  stripe: { id: 'stripe', name: 'Stripe card', active: true, allowAccountTopup: true, systemKey: 'stripe_card' },
  pilot: { id: 'pilot', name: 'Pilot Account', active: true, allowAccountTopup: false, systemKey: 'pilot_account' },
  cash: { id: 'cash', name: 'EFTPOS at counter', active: true, allowAccountTopup: true, systemKey: null },
};

test('payment methods follow all four provider connection modes', () => {
  assert.equal(isPaymentMethodAvailable(methods.stripe, capabilities('disabled')), false);
  assert.equal(isPaymentMethodAvailable(methods.pilot, capabilities('disabled')), false);
  assert.equal(isPaymentMethodAvailable(methods.cash, capabilities('disabled')), true);
  assert.equal(isPaymentMethodAvailable(methods.stripe, capabilities('stripe_only')), true);
  assert.equal(isPaymentMethodAvailable(methods.pilot, capabilities('stripe_only')), false);
  assert.equal(isPaymentMethodAvailable(methods.stripe, capabilities('xero_only')), false);
  assert.equal(isPaymentMethodAvailable(methods.pilot, capabilities('xero_only')), true);
  assert.equal(isPaymentMethodAvailable(methods.stripe, capabilities('combined')), true);
  assert.equal(isPaymentMethodAvailable(methods.pilot, capabilities('combined')), true);
});

test('prepaid and forced payment types cannot select an unavailable provider', () => {
  assert.equal(isPaymentTypeAvailable({ name: 'Prepaid flying' }, Object.values(methods), capabilities('stripe_only')), false);
  assert.equal(isPaymentTypeAvailable({ name: 'Prepaid flying' }, Object.values(methods), capabilities('xero_only')), true);
  assert.equal(isPaymentTypeAvailable({ name: 'Casual hire', forcedPaymentMethodId: 'stripe' }, Object.values(methods), capabilities('xero_only')), false);
  assert.equal(isPaymentTypeAvailable({ name: 'Casual hire', forcedPaymentMethodId: 'stripe' }, Object.values(methods), capabilities('combined')), true);
});

test('top-up availability also respects the method setting', () => {
  assert.equal(isTopUpPaymentMethodAvailable(methods.stripe, capabilities('stripe_only')), true);
  assert.equal(isTopUpPaymentMethodAvailable(methods.pilot, capabilities('combined')), false);
  assert.equal(isTopUpPaymentMethodAvailable({ ...methods.cash, active: false }, capabilities('combined')), false);
});
