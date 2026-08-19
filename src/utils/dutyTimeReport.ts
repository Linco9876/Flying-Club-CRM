export type DutyTimePeriod = {
  id: string;
  status: string;
  start: Date;
  end: Date;
  durationHours: number;
  flightHours: number;
  location: string;
  isExternal: boolean;
  breakCount: number;
};

export type DutyTimeDay = {
  date: string;
  dateKey: string;
  duties: DutyTimePeriod[];
  firstStart?: Date;
  lastEnd?: Date;
  dutySpanHours: number;
  bookedHours: number;
  fdpLimitHours: number;
  latestFinish?: Date;
  restBeforeHours?: number;
  rolling7DutyHours: number;
  rolling14DutyHours: number;
  rolling28FlightHours: number;
  rolling365FlightHours: number;
  status: 'ok' | 'attention';
  issues: string[];
};

export type DutyTimeSummary = {
  periodCount: number;
  activeDays: number;
  attentionDays: number;
  totalDutyHours: number;
  totalFlightHours: number;
  averageDutyHours: number;
  longestDutyHours: number;
  externalDutyHours: number;
  compliancePercent: number | null;
};

export type DutyTrendPoint = {
  label: string;
  rangeLabel: string;
  dutyHours: number;
  flightHours: number;
  rolling7DutyHours: number;
};

const roundOne = (value: number) => Math.round(value * 10) / 10;

export const calculateDutyTimeSummary = (
  duties: DutyTimePeriod[],
  rows: DutyTimeDay[],
): DutyTimeSummary => {
  const activeRows = rows.filter(row => row.duties.length > 0);
  const attentionDays = activeRows.filter(row => row.status === 'attention').length;
  const totalDutyHours = duties.reduce((total, duty) => total + duty.durationHours, 0);
  const totalFlightHours = duties.reduce((total, duty) => total + duty.flightHours, 0);

  return {
    periodCount: duties.length,
    activeDays: activeRows.length,
    attentionDays,
    totalDutyHours: roundOne(totalDutyHours),
    totalFlightHours: roundOne(totalFlightHours),
    averageDutyHours: duties.length ? roundOne(totalDutyHours / duties.length) : 0,
    longestDutyHours: roundOne(duties.reduce((longest, duty) => Math.max(longest, duty.durationHours), 0)),
    externalDutyHours: roundOne(duties.filter(duty => duty.isExternal).reduce((total, duty) => total + duty.durationHours, 0)),
    compliancePercent: activeRows.length ? Math.round(((activeRows.length - attentionDays) / activeRows.length) * 100) : null,
  };
};

const shortDate = (dateKey: string) => {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};

export const buildDutyTrendSeries = (rows: DutyTimeDay[], maxDailyPoints = 42): DutyTrendPoint[] => {
  if (rows.length <= maxDailyPoints) {
    return rows.map(row => ({
      label: shortDate(row.dateKey),
      rangeLabel: row.date,
      dutyHours: roundOne(row.dutySpanHours),
      flightHours: roundOne(row.bookedHours),
      rolling7DutyHours: roundOne(row.rolling7DutyHours),
    }));
  }

  const points: DutyTrendPoint[] = [];
  for (let index = 0; index < rows.length; index += 7) {
    const week = rows.slice(index, index + 7);
    const first = week[0];
    const last = week[week.length - 1];
    points.push({
      label: shortDate(first.dateKey),
      rangeLabel: `${first.date} - ${last.date}`,
      dutyHours: roundOne(week.reduce((total, row) => total + row.dutySpanHours, 0)),
      flightHours: roundOne(week.reduce((total, row) => total + row.bookedHours, 0)),
      rolling7DutyHours: roundOne(Math.max(...week.map(row => row.rolling7DutyHours))),
    });
  }
  return points;
};

export const dutyReportFilename = (name: string, start: string, end: string, extension: 'pdf' | 'csv') =>
  `duty-time-report-${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'instructor'}-${start}-to-${end}.${extension}`;
