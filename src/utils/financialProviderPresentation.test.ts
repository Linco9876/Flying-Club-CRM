import assert from 'node:assert/strict';
import test from 'node:test';
import {
  disabledFinancialProviderCapabilities,
  type FinancialProviderCapabilities,
} from '../types/financialProviders.ts';
import {
  financialProviderModeDescription,
  financialProviderModeLabel,
} from './financialProviderPresentation.ts';

const withMode = (
  mode: FinancialProviderCapabilities['mode'],
): FinancialProviderCapabilities => ({
  ...disabledFinancialProviderCapabilities,
  mode,
  financeEnabled: mode !== 'disabled',
  stripe: {
    ...disabledFinancialProviderCapabilities.stripe,
    connected: mode === 'stripe_only' || mode === 'combined',
    paymentsAvailable: mode === 'stripe_only' || mode === 'combined',
  },
  xero: {
    ...disabledFinancialProviderCapabilities.xero,
    connected: mode === 'xero_only' || mode === 'combined',
    accountingAvailable: mode === 'xero_only' || mode === 'combined',
  },
});

test('labels all four provider modes clearly', () => {
  assert.equal(financialProviderModeLabel(withMode('disabled')), 'Financial services disconnected');
  assert.equal(financialProviderModeLabel(withMode('stripe_only')), 'Stripe connected');
  assert.equal(financialProviderModeLabel(withMode('xero_only')), 'Xero connected');
  assert.equal(financialProviderModeLabel(withMode('combined')), 'Stripe and Xero connected');
});

test('independent modes explain what remains available', () => {
  assert.match(financialProviderModeDescription(withMode('stripe_only')), /Online payments remain available/);
  assert.match(financialProviderModeDescription(withMode('stripe_only')), /Xero balances/);
  assert.match(financialProviderModeDescription(withMode('xero_only')), /Xero balances/);
  assert.match(financialProviderModeDescription(withMode('xero_only')), /Card, BECS/);
  assert.match(financialProviderModeDescription(withMode('disabled')), /Connect Stripe or Xero/);
});
