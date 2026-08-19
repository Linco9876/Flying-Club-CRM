import assert from 'node:assert/strict';
import test from 'node:test';
import type { FlightType, PaymentMethod } from '../hooks/useBillingSettings.ts';
import { getBillingSettingsValidationError } from './billingSettingsRules.ts';

const method: PaymentMethod = { id: 'cash', name: 'EFTPOS', description: '', active: true, displayOrder: 1, allowAccountTopup: true };
const type: FlightType = { id: 'dual', name: 'Dual', description: '', active: true, allowedRoles: ['student'], displayOrder: 1, forcedPaymentMethodId: null, groundSessionEnabled: false, groundSessionHourlyRate: 0 };

test('accepts coherent billing settings', () => {
  assert.equal(getBillingSettingsValidationError([type], [method]), null);
});

test('rejects duplicate names and missing active methods', () => {
  assert.match(getBillingSettingsValidationError([type, { ...type, id: 'other' }], [method]) || '', /unique/);
  assert.match(getBillingSettingsValidationError([{ ...type, forcedPaymentMethodId: method.id }], [{ ...method, active: false }]) || '', /active Payment Method/);
});
