import assert from 'node:assert/strict';
import test from 'node:test';
import type { HistoricalDutyPeriod } from '../types';
import { groupHistoricalDutyByWeek } from './dutyWeekSummary.ts';

const period = (
  id: string,
  dutyDate: string,
  start: string,
  end: string,
  flightMinutes: number,
  breakStart?: string,
  breakEnd?: string,
): HistoricalDutyPeriod => ({
  id,
  dutyDate,
  actualStart: start,
  actualEnd: end,
  location: 'Bendigo',
  isExternal: false,
  flightMinutes,
  entrySource: 'mobile',
  autoClosedAtLimit: false,
  breaks: breakStart && breakEnd ? [{
    id: `${id}-break`,
    breakStart,
    breakEnd,
    breakType: 'break',
    freeOfDuty: true,
    affectsCalculation: false,
  }] : [],
});

test('PWA duty history groups Sunday through Saturday', () => {
  const weeks = groupHistoricalDutyByWeek([
    period('saturday', '2026-08-15', '2026-08-15T08:00:00+10:00', '2026-08-15T10:00:00+10:00', 30),
    period('sunday', '2026-08-16', '2026-08-16T08:00:00+10:00', '2026-08-16T11:00:00+10:00', 60),
  ]);

  assert.deepEqual(weeks.map(week => ({
    start: week.weekStart,
    end: week.weekEnd,
    periods: week.periods.map(item => item.id),
  })), [
    { start: '2026-08-16', end: '2026-08-22', periods: ['sunday'] },
    { start: '2026-08-09', end: '2026-08-15', periods: ['saturday'] },
  ]);
});

test('PWA weekly totals include flying, elapsed duty and elapsed duty minus breaks', () => {
  const [week] = groupHistoricalDutyByWeek([
    period(
      'one',
      '2026-08-10',
      '2026-08-10T08:00:00+10:00',
      '2026-08-10T14:00:00+10:00',
      120,
      '2026-08-10T10:00:00+10:00',
      '2026-08-10T10:30:00+10:00',
    ),
    period('two', '2026-08-12', '2026-08-12T09:00:00+10:00', '2026-08-12T12:00:00+10:00', 45),
  ]);

  assert.equal(week.flightMinutes, 165);
  assert.equal(week.dutyMinutes, 540);
  assert.equal(week.dutyMinutesExcludingBreaks, 510);
});
