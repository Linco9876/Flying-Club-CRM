import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDutyTrendSeries,
  calculateDutyTimeSummary,
  dutyReportFilename,
  type DutyTimeDay,
  type DutyTimePeriod,
} from './dutyTimeReport.ts';

const period = (id: string, hours: number, flightHours: number, isExternal = false): DutyTimePeriod => ({
  id,
  status: 'completed',
  start: new Date('2026-08-01T08:00:00+10:00'),
  end: new Date(`2026-08-01T${String(8 + hours).padStart(2, '0')}:00:00+10:00`),
  durationHours: hours,
  flightHours,
  location: 'Bendigo',
  isExternal,
  breakCount: 0,
});

const day = (index: number, dutyHours: number, flightHours: number, status: 'ok' | 'attention' = 'ok'): DutyTimeDay => ({
  date: `${String(index + 1).padStart(2, '0')}/08/2026`,
  dateKey: `2026-08-${String(index + 1).padStart(2, '0')}`,
  duties: dutyHours ? [period(String(index), dutyHours, flightHours)] : [],
  dutySpanHours: dutyHours,
  bookedHours: flightHours,
  fdpLimitHours: dutyHours ? 11 : 0,
  rolling7DutyHours: dutyHours * 2,
  rolling14DutyHours: dutyHours * 3,
  rolling28FlightHours: flightHours * 4,
  rolling365FlightHours: flightHours * 10,
  status,
  issues: status === 'attention' ? ['Review this day'] : [],
});

test('calculates management summary without mixing flight and duty hours', () => {
  const duties = [period('one', 8, 2), period('two', 4, 1.5, true)];
  const summary = calculateDutyTimeSummary(duties, [day(0, 8, 2), day(1, 4, 1.5, 'attention'), day(2, 0, 0)]);

  assert.deepEqual(summary, {
    periodCount: 2,
    activeDays: 2,
    attentionDays: 1,
    totalDutyHours: 12,
    totalFlightHours: 3.5,
    averageDutyHours: 6,
    longestDutyHours: 8,
    externalDutyHours: 4,
    compliancePercent: 50,
  });
});

test('uses daily trend points for short ranges and weekly summaries for long ranges', () => {
  assert.equal(buildDutyTrendSeries([day(0, 4, 1), day(1, 6, 2)]).length, 2);
  const longRange = Array.from({ length: 43 }, (_, index) => day(index % 28, 2, 1));
  const weekly = buildDutyTrendSeries(longRange);
  assert.equal(weekly.length, 7);
  assert.equal(weekly[0].dutyHours, 14);
  assert.equal(weekly[0].flightHours, 7);
});

test('creates a safe descriptive filename', () => {
  assert.equal(
    dutyReportFilename('David Goode (CFI)', '2026-07-01', '2026-07-31', 'pdf'),
    'duty-time-report-david-goode-cfi-2026-07-01-to-2026-07-31.pdf',
  );
});
