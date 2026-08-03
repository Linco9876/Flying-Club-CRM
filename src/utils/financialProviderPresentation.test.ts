import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  disabledFinancialProviderCapabilities,
  type FinancialProviderCapabilities,
} from '../types/financialProviders.ts';
import {
  financialProviderModeDescription,
  financialProviderModeLabel,
  shouldCaptureFinancialDetails,
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

test('financial capture is disabled only when neither provider is connected', () => {
  assert.equal(shouldCaptureFinancialDetails(withMode('disabled')), false);
  assert.equal(shouldCaptureFinancialDetails(withMode('stripe_only')), true);
  assert.equal(shouldCaptureFinancialDetails(withMode('xero_only')), true);
  assert.equal(shouldCaptureFinancialDetails(withMode('combined')), true);
});

test('a stale financeEnabled flag cannot expose payment fields without a connected provider', () => {
  const inconsistent = {
    ...withMode('disabled'),
    financeEnabled: true,
  };
  assert.equal(shouldCaptureFinancialDetails(inconsistent), false);
});

test('offline records store null financial fields and bypass the ground-session rate trigger', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260804023000_disable_financial_capture_without_providers.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /financial_capture_suppressed boolean not null default false/g);
  assert.match(migration, /alter column total_cost drop not null/);
  assert.match(migration, /alter column payment_type drop not null/);
  assert.match(migration, /if coalesce\(new\.financial_capture_suppressed, false\) then/);
  assert.match(migration, /new\.payment_type := null/);
  assert.match(migration, /new\.calculated_cost := null/);
  assert.match(migration, /new\.payment_status := null/);
  assert.match(migration, /flight_logs_suppressed_financial_fields_check/);
  assert.match(migration, /ground_session_logs_suppressed_financial_fields_check/);
  assert.match(migration, /select private\.assert_function_permission_manifest\(\)/);
});

test('booking and logging forms hide payment controls when financial capture is unavailable', () => {
  const bookingForm = readFileSync(new URL('../components/Bookings/BookingForm.tsx', import.meta.url), 'utf8');
  const flightLogModal = readFileSync(new URL('../components/Bookings/FlightLogModal.tsx', import.meta.url), 'utf8');
  const groundLogModal = readFileSync(new URL('../components/Bookings/GroundSessionLogModal.tsx', import.meta.url), 'utf8');

  assert.match(bookingForm, /financialCaptureEnabled && isFieldVisible\('paymentType'/);
  assert.match(flightLogModal, /financialCaptureEnabled && \(\s*<div className=\{`\$\{isVoucherBooking/);
  assert.match(groundLogModal, /financialCaptureEnabled && \(\s*<div className="grid grid-cols-1 gap-4 md:grid-cols-2">\s*<label[\s\S]+Payment Type/);
  assert.match(flightLogModal, /This flight will be saved without financial information/);
  assert.match(groundLogModal, /This ground session will be saved without financial information/);
});
