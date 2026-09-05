import assert from 'node:assert/strict';
import test from 'node:test';
import { isSameLocalDate, validateBreakFinishTime } from './breakFinishTime.ts';

const now = new Date('2026-09-05T15:00:00+10:00');
const started = new Date('2026-09-05T12:00:00+10:00');

test('allows an active break to be finished at an earlier actual time', () => {
  assert.equal(validateBreakFinishTime({
    breakStartedAt: started,
    breakFinishedAt: new Date('2026-09-05T12:45:00+10:00'),
    now,
  }), null);
});

test('rejects a finish before the break began or in the future', () => {
  assert.match(validateBreakFinishTime({
    breakStartedAt: started,
    breakFinishedAt: new Date('2026-09-05T11:59:00+10:00'),
    now,
  }) || '', /after the break started/i);
  assert.match(validateBreakFinishTime({
    breakStartedAt: started,
    breakFinishedAt: new Date('2026-09-05T15:06:00+10:00'),
    now,
  }) || '', /future/i);
});

test('recognises same-day picker bounds without confusing overnight breaks', () => {
  assert.equal(isSameLocalDate(started, now), true);
  assert.equal(isSameLocalDate('2026-09-04T23:55:00+10:00', now), false);
});
