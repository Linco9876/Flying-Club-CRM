import assert from 'node:assert/strict';
import test from 'node:test';
import type { DutyPeriod } from '../types';
import { groupDutyHistoryByWeek } from './dutyWeekSummary.ts';

const period = ({
  id,
  dutyDate,
  start,
  end,
  flightMinutes,
}: {
  id: string;
  dutyDate: string;
  start?: string;
  end?: string;
  flightMinutes: number;
}) => ({
  id,
  instructorId: 'instructor',
  dutyDate,
  actualStart: start ? new Date(start) : undefined,
  actualEnd: end ? new Date(end) : undefined,
  location: 'Bendigo',
  status: end ? 'completed' : 'active',
  isExternal: false,
  flightMinutes,
  entrySource: 'manual',
  autoClosedAtLimit: false,
  breaks: [],
  createdAt: new Date('2026-07-01T00:00:00+10:00'),
  updatedAt: new Date('2026-07-01T00:00:00+10:00'),
}) as DutyPeriod;

test('duty history groups Monday through Sunday and separates Sunday from Monday', () => {
  const weeks = groupDutyHistoryByWeek([
    period({
      id: 'monday',
      dutyDate: '2026-07-27',
      start: '2026-07-27T08:00:00+10:00',
      end: '2026-07-27T16:00:00+10:00',
      flightMinutes: 90,
    }),
    period({
      id: 'sunday',
      dutyDate: '2026-07-26',
      start: '2026-07-26T09:00:00+10:00',
      end: '2026-07-26T12:00:00+10:00',
      flightMinutes: 45,
    }),
  ]);

  assert.deepEqual(weeks.map(week => ({
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    periods: week.periods.map(item => item.id),
  })), [
    { weekStart: '2026-07-27', weekEnd: '2026-08-02', periods: ['monday'] },
    { weekStart: '2026-07-20', weekEnd: '2026-07-26', periods: ['sunday'] },
  ]);
});

test('weekly summaries total duty and flying time without counting an open duty period', () => {
  const completed = period({
      id: 'completed',
      dutyDate: '2026-07-28',
      start: '2026-07-28T08:15:00+10:00',
      end: '2026-07-28T14:45:00+10:00',
      flightMinutes: 125,
    });
  completed.breaks = [
    {
      id: 'break-1',
      dutyPeriodId: completed.id,
      breakStart: new Date('2026-07-28T10:00:00+10:00'),
      breakEnd: new Date('2026-07-28T10:30:00+10:00'),
      breakType: 'break',
      freeOfDuty: true,
      affectsCalculation: false,
    },
    {
      id: 'break-2',
      dutyPeriodId: completed.id,
      breakStart: new Date('2026-07-28T10:20:00+10:00'),
      breakEnd: new Date('2026-07-28T10:45:00+10:00'),
      breakType: 'break',
      freeOfDuty: false,
      affectsCalculation: false,
    },
    {
      id: 'outside-duty',
      dutyPeriodId: completed.id,
      breakStart: new Date('2026-07-28T07:00:00+10:00'),
      breakEnd: new Date('2026-07-28T08:00:00+10:00'),
      breakType: 'break',
      freeOfDuty: true,
      affectsCalculation: false,
    },
  ];

  const [week] = groupDutyHistoryByWeek([
    completed,
    period({
      id: 'open',
      dutyDate: '2026-07-29',
      start: '2026-07-29T09:00:00+10:00',
      flightMinutes: 30,
    }),
  ]);

  assert.equal(week.dutyMinutes, 390);
  assert.equal(week.breakMinutes, 45);
  assert.equal(week.dutyMinutesExcludingBreaks, 345);
  assert.equal(week.flightMinutes, 155);
  assert.equal(week.openPeriods, 1);
  assert.deepEqual(week.periods.map(item => item.id), ['open', 'completed']);
});

test('planned times are used when actual times have not been recorded', () => {
  const planned = period({
    id: 'planned',
    dutyDate: '2026-07-30',
    flightMinutes: 0,
  });
  planned.status = 'draft';
  planned.plannedStart = new Date('2026-07-30T10:00:00+10:00');
  planned.plannedEnd = new Date('2026-07-30T12:30:00+10:00');

  const [week] = groupDutyHistoryByWeek([planned]);
  assert.equal(week.dutyMinutes, 150);
  assert.equal(week.breakMinutes, 0);
  assert.equal(week.dutyMinutesExcludingBreaks, 150);
  assert.equal(week.openPeriods, 0);
});
