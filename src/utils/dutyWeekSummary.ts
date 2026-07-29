import { addDays, format, startOfWeek } from 'date-fns';
import type { DutyPeriod } from '../types';

export interface DutyHistoryWeek {
  key: string;
  weekStart: string;
  weekEnd: string;
  periods: DutyPeriod[];
  dutyMinutes: number;
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
      flightMinutes: 0,
      openPeriods: 0,
    };
    const start = period.actualStart || period.plannedStart;
    const end = period.actualEnd || period.plannedEnd;

    week.periods.push(period);
    week.dutyMinutes += effectiveDutyMinutes(period);
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
