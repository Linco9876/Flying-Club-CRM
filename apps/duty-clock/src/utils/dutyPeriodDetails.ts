import type { HistoricalDutyPeriod } from '../types';

const asMilliseconds = (value: string) => new Date(value).getTime();

export const summariseHistoricalDutyPeriod = (period: HistoricalDutyPeriod) => {
  const dutyStart = asMilliseconds(period.actualStart);
  const dutyEnd = asMilliseconds(period.actualEnd);
  const validDuty = Number.isFinite(dutyStart) && Number.isFinite(dutyEnd) && dutyEnd > dutyStart;
  const dutyMinutes = validDuty ? Math.max(0, Math.round((dutyEnd - dutyStart) / 60_000)) : 0;

  const intervals = validDuty
    ? period.breaks
      .map(item => ({
        start: Math.max(dutyStart, asMilliseconds(item.breakStart)),
        end: Math.min(dutyEnd, asMilliseconds(item.breakEnd)),
      }))
      .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
      .sort((left, right) => left.start - right.start)
    : [];

  let breakMilliseconds = 0;
  let currentStart = 0;
  let currentEnd = 0;
  for (const interval of intervals) {
    if (currentEnd === 0) {
      currentStart = interval.start;
      currentEnd = interval.end;
    } else if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
    } else {
      breakMilliseconds += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }
  if (currentEnd > currentStart) breakMilliseconds += currentEnd - currentStart;

  const breakMinutes = Math.min(dutyMinutes, Math.max(0, Math.round(breakMilliseconds / 60_000)));
  const numericFlightMinutes = Number(period.flightMinutes);
  const flightMinutes = Number.isFinite(numericFlightMinutes) ? Math.max(0, Math.round(numericFlightMinutes)) : 0;

  return {
    dutyMinutes,
    breakMinutes,
    dutyMinutesExcludingBreaks: Math.max(0, dutyMinutes - breakMinutes),
    flightMinutes,
  };
};

export const historicalDutySourceLabel = (source: HistoricalDutyPeriod['entrySource']) => {
  if (source === 'automatic_booking') return 'Automatic booking start';
  if (source === 'mobile') return 'Duty Clock app';
  return 'Manual entry';
};

export const historicalBreakTypeLabel = (type: HistoricalDutyPeriod['breaks'][number]['breakType']) => {
  if (type === 'split_duty_rest') return 'Split-duty rest';
  if (type === 'rest') return 'Rest period';
  return 'Break';
};
