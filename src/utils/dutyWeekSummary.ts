import { addDays, format, startOfWeek } from 'date-fns';
import type { DutyPeriod } from '../types';

export interface DutyHistoryWeek {
  key: string;
  weekStart: string;
  weekEnd: string;
  periods: DutyPeriod[];
  dutyMinutes: number;
  breakMinutes: number;
  dutyMinutesExcludingBreaks: number;
  flightMinutes: number;
  openPeriods: number;
}

const localDutyDate = (date: string) => new Date(`${date}T12:00:00`);

const effectiveDutyMinutes = (period: DutyPeriod) => {
  const start = period.actualStart || period.plannedStart;
  const end = period.actualEnd || period.plannedEnd;
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
};

const effectiveBreakMinutes = (period: DutyPeriod) => {
  const dutyStart = period.actualStart || period.plannedStart;
  const dutyEnd = period.actualEnd || period.plannedEnd;
  if (!dutyStart || !dutyEnd || dutyEnd <= dutyStart) return 0;

  const intervals = period.breaks
    .map(item => ({
      start: Math.max(dutyStart.getTime(), item.breakStart.getTime()),
      end: Math.min(dutyEnd.getTime(), item.breakEnd.getTime()),
    }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((left, right) => left.start - right.start);

  let totalMilliseconds = 0;
  let currentStart = 0;
  let currentEnd = 0;

  for (const interval of intervals) {
    if (currentEnd === 0) {
      currentStart = interval.start;
      currentEnd = interval.end;
    } else if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
    } else {
      totalMilliseconds += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }

  if (currentEnd > currentStart) totalMilliseconds += currentEnd - currentStart;
  return Math.max(0, Math.round(totalMilliseconds / 60_000));
};

const effectiveStartTime = (period: DutyPeriod) =>
  (period.actualStart || period.plannedStart)?.getTime() || 0;

export const groupDutyHistoryByWeek = (periods: DutyPeriod[]): DutyHistoryWeek[] => {
  const weeks = new Map<string, DutyHistoryWeek>();

  for (const period of periods) {
    const monday = startOfWeek(localDutyDate(period.dutyDate), { weekStartsOn: 1 });
    const sunday = addDays(monday, 6);
    const key = format(monday, 'yyyy-MM-dd');
    const week = weeks.get(key) || {
      key,
      weekStart: key,
      weekEnd: format(sunday, 'yyyy-MM-dd'),
      periods: [],
      dutyMinutes: 0,
      breakMinutes: 0,
      dutyMinutesExcludingBreaks: 0,
      flightMinutes: 0,
      openPeriods: 0,
    };
    const start = period.actualStart || period.plannedStart;
    const end = period.actualEnd || period.plannedEnd;

    week.periods.push(period);
    const dutyMinutes = effectiveDutyMinutes(period);
    const breakMinutes = Math.min(dutyMinutes, effectiveBreakMinutes(period));
    week.dutyMinutes += dutyMinutes;
    week.breakMinutes += breakMinutes;
    week.dutyMinutesExcludingBreaks += Math.max(0, dutyMinutes - breakMinutes);
    const flightMinutes = Number(period.flightMinutes);
    week.flightMinutes += Number.isFinite(flightMinutes) ? Math.max(0, Math.round(flightMinutes)) : 0;
    if (start && !end) week.openPeriods += 1;
    weeks.set(key, week);
  }

  return [...weeks.values()]
    .map(week => ({
      ...week,
      periods: [...week.periods].sort((left, right) =>
        right.dutyDate.localeCompare(left.dutyDate)
        || effectiveStartTime(right) - effectiveStartTime(left)),
    }))
    .sort((left, right) => right.weekStart.localeCompare(left.weekStart));
};
