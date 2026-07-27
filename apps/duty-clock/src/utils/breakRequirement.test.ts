import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDutyBreakRequirement } from './breakRequirement.ts';

const policy = { enabled: true, requiredAfterMinutes: 300, minimumBreakMinutes: 30 };
const at = (hours: number, minutes = 0) => new Date(2026, 6, 27, hours, minutes);

test('does not request a break confirmation at or below five hours', () => {
  assert.equal(evaluateDutyBreakRequirement({
    dutyStart: at(8),
    dutyEnd: at(13),
    policy,
  }).needsConfirmation, false);
});

test('requests confirmation after five hours when no break is recorded', () => {
  assert.equal(evaluateDutyBreakRequirement({
    dutyStart: at(8),
    dutyEnd: at(13, 1),
    policy,
  }).needsConfirmation, true);
});

test('accepts a recorded break that meets the configured minimum', () => {
  const result = evaluateDutyBreakRequirement({
    dutyStart: at(8),
    dutyEnd: at(15),
    breaks: [{ start: at(12), end: at(12, 30) }],
    policy,
  });
  assert.equal(result.required, true);
  assert.equal(result.satisfied, true);
});

test('does not accept a short or out-of-period break', () => {
  const result = evaluateDutyBreakRequirement({
    dutyStart: at(8),
    dutyEnd: at(15),
    breaks: [
      { start: at(12), end: at(12, 20) },
      { start: at(7), end: at(7, 45) },
    ],
    policy,
  });
  assert.equal(result.needsConfirmation, true);
});

test('counts an active break through the selected duty finish time', () => {
  assert.equal(evaluateDutyBreakRequirement({
    dutyStart: at(8),
    dutyEnd: at(15),
    activeBreakStart: at(14, 30),
    policy,
  }).satisfied, true);
});

test('respects a disabled policy', () => {
  assert.equal(evaluateDutyBreakRequirement({
    dutyStart: at(8),
    dutyEnd: at(16),
    policy: { ...policy, enabled: false },
  }).required, false);
});
