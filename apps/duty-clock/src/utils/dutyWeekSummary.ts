import type { HistoricalDutyPeriod } from '../types';
import { summariseHistoricalDutyPeriod } from './dutyPeriodDetails.ts';

export type HistoricalDutyWeek = {
  key: string;
  weekStart: string;
  weekEnd: string;
  periods: HistoricalDutyPeriod[];
  flightMinutes: number;
  dutyMinutes: number;
  dutyMinutesExcludingBreaks: number;
};

const localDate = (value: string) => new Date(`${value}T12:00:00`);

const toDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (value: Date, days: number) => {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
};

export const groupHistoricalDutyByWeek = (periods: HistoricalDutyPeriod[]): HistoricalDutyWeek[] => {
  const weeks = new Map<string, HistoricalDutyWeek>();

  for (const period of periods) {
    const date = localDate(period.dutyDate);
    const sunday = addDays(date, -date.getDay());
    const key = toDateKey(sunday);
    const week = weeks.get(key) || {
      key,
      weekStart: key,
      weekEnd: toDateKey(addDays(sunday, 6)),
      periods: [],
      flightMinutes: 0,
      dutyMinutes: 0,
      dutyMinutesExcludingBreaks: 0,
    };
    const summary = summariseHistoricalDutyPeriod(period);
    week.periods.push(period);
    week.flightMinutes += summary.flightMinutes;
    week.dutyMinutes += summary.dutyMinutes;
    week.dutyMinutesExcludingBreaks += summary.dutyMinutesExcludingBreaks;
    weeks.set(key, week);
  }

  return [...weeks.values()]
    .map(week => ({
      ...week,
      periods: [...week.periods].sort((left, right) =>
        right.dutyDate.localeCompare(left.dutyDate)
        || new Date(right.actualStart).getTime() - new Date(left.actualStart).getTime()),
    }))
    .sort((left, right) => right.weekStart.localeCompare(left.weekStart));
};
