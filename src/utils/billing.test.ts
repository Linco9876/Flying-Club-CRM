import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFlightCost } from './billing.ts';

const tachRate = {
  chargeType: 'tach' as const,
  soloRate: 200,
  dualRate: 300,
  flatSurcharge: 0,
  weekendSurcharge: 0,
};

test('mixed tach flights charge their dual and solo portions at the correct rates', () => {
  assert.equal(calculateFlightCost({
    rate: tachRate,
    durationHours: 1.2,
    isDual: true,
    dualHours: 0.8,
    soloHours: 0.4,
  }), 320);
});

test('billing keeps the legacy whole-flight rate when no complete allocation is supplied', () => {
  assert.equal(calculateFlightCost({
    rate: tachRate,
    durationHours: 1.2,
    isDual: true,
  }), 360);
});
