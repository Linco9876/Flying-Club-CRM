import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildGroundSessionBillingDefaults,
  getAllowedGroundSessionPaymentTypes,
  getGroundSessionHourlyRate,
  resolveBookingBillingSelection,
  resolveGroundSessionPaymentMethod,
} from './groundSessionBilling.ts';

const paymentTypes = [
  {
    id: 'prepaid',
    name: 'Prepaid',
    active: true,
  },
  {
    id: 'payg',
    name: 'Pay As You Go',
    active: true,
  },
  {
    id: 'inactive',
    name: 'Inactive',
    active: false,
  },
];

const sessionRates = [
  { flightTypeId: 'prepaid', enabled: true, hourlyRate: 80 },
  { flightTypeId: 'payg', enabled: false, hourlyRate: 95 },
  { flightTypeId: 'inactive', enabled: true, hourlyRate: 100 },
];

test('ground-session billing pre-fills the Payment Type and Payment Method from its booking', () => {
  assert.deepEqual(buildGroundSessionBillingDefaults({
    flightTypeId: 'prepaid',
    paymentType: 'Pilot Account',
  }), {
    paymentTypeId: 'prepaid',
    paymentMethodName: 'Pilot Account',
  });
});

test('ground-session bookings preserve the selected Payment Type when saved', () => {
  assert.deepEqual(resolveBookingBillingSelection({
    paymentTypeId: 'payg',
    paymentTypeName: 'Pay As You Go',
    derivedPaymentTypeName: 'Pay As You Go',
  }), {
    flightTypeId: 'payg',
    paymentType: 'Pay As You Go',
  });
});

test('voucher bookings keep their dedicated billing selection', () => {
  assert.deepEqual(resolveBookingBillingSelection({
    paymentTypeId: 'payg',
    paymentTypeName: 'Pay As You Go',
    derivedPaymentTypeName: 'Pay As You Go',
    isVoucherBooking: true,
  }), {
    flightTypeId: '',
    paymentType: 'Gift Voucher',
  });
});

test('hourly ground sessions offer only enabled payment types', () => {
  assert.deepEqual(
    getAllowedGroundSessionPaymentTypes(paymentTypes, 'flight_type_hourly', sessionRates)
      .map(type => type.id),
    ['prepaid'],
  );
});

test('fixed ground sessions retain all active payment types', () => {
  assert.deepEqual(
    getAllowedGroundSessionPaymentTypes(paymentTypes, 'fixed').map(type => type.id),
    ['prepaid', 'payg'],
  );
});

test('each ground-session type resolves its own rate for the selected Payment Type', () => {
  const briefingRates = [
    { flightTypeId: 'prepaid', enabled: true, hourlyRate: 80 },
    { flightTypeId: 'payg', enabled: true, hourlyRate: 95 },
  ];
  const simulatorRates = [
    { flightTypeId: 'prepaid', enabled: true, hourlyRate: 120 },
    { flightTypeId: 'payg', enabled: true, hourlyRate: 145 },
  ];

  assert.equal(getGroundSessionHourlyRate(briefingRates, 'payg'), 95);
  assert.equal(getGroundSessionHourlyRate(simulatorRates, 'payg'), 145);
  assert.equal(getGroundSessionHourlyRate(simulatorRates, 'missing'), 0);
});

test('ground-session charges are persisted and enforced through the rate matrix', () => {
  const hookSource = readFileSync(
    new URL('../hooks/useGroundSessionLogs.ts', import.meta.url),
    'utf8',
  );
  const migrationSource = readFileSync(
    new URL('../../supabase/migrations/20260729180000_add_ground_session_rate_matrix.sql', import.meta.url),
    'utf8',
  );

  assert.match(hookSource, /\.from\('ground_session_rates'\)/);
  assert.match(hookSource, /\.eq\('description_option_id', descriptionOptionId\)/);
  assert.match(hookSource, /\.eq\('flight_type_id', effectiveFlightTypeId\)/);
  assert.match(migrationSource, /unique \(description_option_id, flight_type_id\)/i);
  assert.match(migrationSource, /create trigger ground_session_logs_apply_rate_matrix/i);
  assert.match(migrationSource, /new\.calculated_cost := round\(selected_hourly_rate \* billable_hours, 2\)/i);
});

test('a prepaid payment type always selects Pilot Account as the payment method', () => {
  assert.equal(resolveGroundSessionPaymentMethod({
    paymentTypeName: 'Pre-paid flying',
    forcedPaymentMethodName: 'Invoice',
    currentPaymentMethodName: 'Card',
    pilotAccountPaymentMethodName: 'Pilot Account',
  }), 'Pilot Account');
});

test('non-prepaid payment types keep their forced or current payment method', () => {
  assert.equal(resolveGroundSessionPaymentMethod({
    paymentTypeName: 'Pay As You Go',
    forcedPaymentMethodName: 'Stripe Card Payment',
    currentPaymentMethodName: 'Invoice',
  }), 'Stripe Card Payment');
});
