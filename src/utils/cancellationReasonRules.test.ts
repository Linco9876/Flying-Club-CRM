import assert from 'node:assert/strict';
import test from 'node:test';
import type { BookingCancellationReasonInput } from '../hooks/useBookingCancellationReasons.ts';
import { getCancellationReasonValidationError } from './cancellationReasonRules.ts';

const valid: BookingCancellationReasonInput = {
  name: 'Weather',
  description: '',
  feeType: 'none',
  feeAmount: 0,
  isActive: true,
  displayOrder: 100,
};

test('accepts a valid cancellation reason', () => {
  assert.equal(getCancellationReasonValidationError(valid, []), null);
});

test('rejects duplicate names without case sensitivity', () => {
  assert.match(getCancellationReasonValidationError(valid, [{ id: '1', ...valid, name: 'weather' }]) || '', /already exists/);
});

test('allows an existing reason to keep its own name', () => {
  assert.equal(getCancellationReasonValidationError(valid, [{ id: '1', ...valid }], '1'), null);
});

test('rejects invalid fee values', () => {
  assert.match(getCancellationReasonValidationError({ ...valid, feeType: 'late_cancel', feeAmount: Number.NaN }, []) || '', /valid fee/);
  assert.match(getCancellationReasonValidationError({ ...valid, feeType: 'no_show', feeAmount: -1 }, []) || '', /valid fee/);
});
