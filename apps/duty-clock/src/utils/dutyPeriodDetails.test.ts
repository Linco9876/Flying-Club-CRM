import assert from 'node:assert/strict';
import test from 'node:test';
import type { HistoricalDutyPeriod } from '../types';
import { summariseHistoricalDutyPeriod } from './dutyPeriodDetails.ts';

const period = (overrides: Partial<HistoricalDutyPeriod> = {}): HistoricalDutyPeriod => ({
  id: 'period-1',
  dutyDate: '2026-08-05',
  actualStart: '2026-08-05T08:00:00+10:00',
  actualEnd: '2026-08-05T16:00:00+10:00',
  location: 'Bendigo',
  isExternal: false,
  flightMinutes: 95,
  entrySource: 'mobile',
  autoClosedAtLimit: false,
  breaks: [],
  ...overrides,
});

test('summarises elapsed duty, breaks and flying for the detail view', () => {
  assert.deepEqual(summariseHistoricalDutyPeriod(period({
    breaks: [{
      id: 'break-1',
      breakStart: '2026-08-05T11:30:00+10:00',
      breakEnd: '2026-08-05T12:15:00+10:00',
      breakType: 'break',
      freeOfDuty: true,
      affectsCalculation: false,
    }],
  })), {
    dutyMinutes: 480,
    breakMinutes: 45,
    dutyMinutesExcludingBreaks: 435,
    flightMinutes: 95,
  });
});

test('clips breaks to the duty window and does not double-count overlaps', () => {
  const summary = summariseHistoricalDutyPeriod(period({
    breaks: [
      { id: 'one', breakStart: '2026-08-05T07:45:00+10:00', breakEnd: '2026-08-05T08:30:00+10:00', breakType: 'rest', freeOfDuty: true, affectsCalculation: false },
      { id: 'two', breakStart: '2026-08-05T08:15:00+10:00', breakEnd: '2026-08-05T09:00:00+10:00', breakType: 'break', freeOfDuty: true, affectsCalculation: false },
    ],
  }));

  assert.equal(summary.breakMinutes, 60);
  assert.equal(summary.dutyMinutesExcludingBreaks, 420);
});
