import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGroundSessionBillingDefaults,
  getAllowedGroundSessionPaymentTypes,
  resolveGroundSessionPaymentMethod,
} from './groundSessionBilling.ts';

const paymentTypes = [
  {
    id: 'prepaid',
    name: 'Prepaid',
    active: true,
    groundSessionEnabled: true,
    groundSessionHourlyRate: 80,
  },
  {
    id: 'payg',
    name: 'Pay As You Go',
    active: true,
    groundSessionEnabled: false,
    groundSessionHourlyRate: 0,
  },
  {
    id: 'inactive',
    name: 'Inactive',
    active: false,
    groundSessionEnabled: true,
    groundSessionHourlyRate: 100,
  },
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

test('hourly ground sessions offer only enabled payment types', () => {
  assert.deepEqual(
    getAllowedGroundSessionPaymentTypes(paymentTypes, 'flight_type_hourly')
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
