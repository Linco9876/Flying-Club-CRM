export interface LogbookBaseline {
  user_id: string;
  as_of_date: string;
  last_flight_date: string | null;
  total_hours: number;
  pic_hours: number;
  dual_hours: number;
  takeoffs: number;
  landings: number;
  created_at?: string;
  updated_at?: string;
}

export interface ExternalLogbookEntry {
  id: string;
  user_id: string;
  flight_date: string;
  aircraft_registration: string;
  aircraft_type: string;
  pilot_in_command_name: string | null;
  other_crew_name: string | null;
  dual_hours: number;
  pic_hours: number;
  takeoffs: number;
  landings: number;
  comments: string;
  description: string;
  notes: string;
  created_at?: string;
  updated_at?: string;
}

export interface ExternalLogbookEntryInput {
  flightDate: string;
  aircraftRegistration: string;
  aircraftType: string;
  pilotInCommandName?: string;
  otherCrewName?: string;
  dualHours: number;
  picHours: number;
  takeoffs?: number;
  landings?: number;
  comments?: string;
  description?: string;
  notes?: string;
}

export interface LogbookBaselineInput {
  asOfDate: string;
  lastFlightDate?: string;
  totalHours: number;
  picHours: number;
  dualHours: number;
  takeoffs?: number;
  landings?: number;
}

export interface DatedLogbookHours {
  date: string;
  totalHours: number;
  picHours: number;
  dualHours: number;
  takeoffs?: number;
  landings?: number;
}

export interface LogbookTotals {
  totalHours: number;
  picHours: number;
  dualHours: number;
  takeoffs: number;
  landings: number;
}

const roundOne = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;

const finiteNonNegative = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

export const DEFAULT_LOGBOOK_TIME_ZONE = 'Australia/Melbourne';

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

const zonedDateOnly = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const toLogbookDateOnly = (
  value: string,
  timeZone = DEFAULT_LOGBOOK_TIME_ZONE,
) => {
  const trimmed = String(value || '').trim();
  if (dateOnlyPattern.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  try {
    return zonedDateOnly(parsed, timeZone);
  } catch {
    return zonedDateOnly(parsed, DEFAULT_LOGBOOK_TIME_ZONE);
  }
};

export const todayDateOnly = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isIncludedInLogbookBaseline = (
  date: string,
  baseline?: Pick<LogbookBaseline, 'as_of_date'> | null,
  timeZone = DEFAULT_LOGBOOK_TIME_ZONE,
) => Boolean(baseline?.as_of_date && toLogbookDateOnly(date, timeZone) <= baseline.as_of_date);

export const calculateLifetimeLogbookTotals = (
  baseline: LogbookBaseline | null | undefined,
  entries: DatedLogbookHours[],
  timeZone = DEFAULT_LOGBOOK_TIME_ZONE,
): LogbookTotals => {
  const totals: LogbookTotals = {
    totalHours: finiteNonNegative(baseline?.total_hours),
    picHours: finiteNonNegative(baseline?.pic_hours),
    dualHours: finiteNonNegative(baseline?.dual_hours),
    takeoffs: Math.trunc(finiteNonNegative(baseline?.takeoffs)),
    landings: Math.trunc(finiteNonNegative(baseline?.landings)),
  };

  for (const entry of entries) {
    if (isIncludedInLogbookBaseline(entry.date, baseline, timeZone)) continue;
    totals.totalHours += finiteNonNegative(entry.totalHours);
    totals.picHours += finiteNonNegative(entry.picHours);
    totals.dualHours += finiteNonNegative(entry.dualHours);
    totals.takeoffs += Math.trunc(finiteNonNegative(entry.takeoffs));
    totals.landings += Math.trunc(finiteNonNegative(entry.landings));
  }

  return {
    totalHours: roundOne(totals.totalHours),
    picHours: roundOne(totals.picHours),
    dualHours: roundOne(totals.dualHours),
    takeoffs: totals.takeoffs,
    landings: totals.landings,
  };
};

const validDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());

const validHour = (value: number, maximum: number) =>
  Number.isFinite(value) && value >= 0 && value <= maximum;

const validMovementCount = (value: number | undefined, maximum: number) =>
  value === undefined || (Number.isInteger(value) && value >= 0 && value <= maximum);

export const getLogbookBaselineValidationError = (input: LogbookBaselineInput) => {
  if (!validDateOnly(input.asOfDate)) return 'Enter the date these cumulative hours are accurate through.';
  if (input.asOfDate > todayDateOnly()) return 'The baseline date cannot be in the future.';
  if (input.lastFlightDate) {
    if (!validDateOnly(input.lastFlightDate)) return 'Enter a valid last flight date or leave it blank.';
    if (input.lastFlightDate > input.asOfDate) return 'The last flight included cannot be after the baseline date.';
  }
  if (!validHour(input.totalHours, 100000)) return 'Total hours must be between 0 and 100,000.';
  if (!validHour(input.picHours, input.totalHours)) return 'PIC hours cannot exceed total hours.';
  if (!validHour(input.dualHours, input.totalHours)) return 'Dual hours cannot exceed total hours.';
  if (roundOne(input.picHours + input.dualHours) > roundOne(input.totalHours)) {
    return 'PIC plus dual hours cannot exceed total hours.';
  }
  if (!validMovementCount(input.takeoffs, 1000000) || !validMovementCount(input.landings, 1000000)) {
    return 'Take-off and landing totals must be whole numbers between 0 and 1,000,000.';
  }
  return null;
};

export const getExternalLogbookEntryValidationError = (input: ExternalLogbookEntryInput) => {
  if (!validDateOnly(input.flightDate)) return 'Enter the flight date.';
  if (input.flightDate > todayDateOnly()) return 'An external flight cannot be dated in the future.';
  if (!input.aircraftRegistration.trim()) return 'Enter the aircraft registration.';
  if (input.aircraftRegistration.trim().length > 20) return 'Aircraft registration must be 20 characters or fewer.';
  if (!input.aircraftType.trim()) return 'Enter the aircraft type.';
  if (input.aircraftType.trim().length > 120) return 'Aircraft type must be 120 characters or fewer.';
  if (!validHour(input.picHours, 24) || !validHour(input.dualHours, 24)) {
    return 'PIC and dual hours must each be between 0 and 24.';
  }
  const total = roundOne(input.picHours + input.dualHours);
  if (total <= 0 || total > 24) return 'Enter flight time greater than zero and no more than 24 hours.';
  if (input.dualHours > 0 && !input.pilotInCommandName?.trim()) {
    return 'Enter the instructor or pilot in command for dual time.';
  }
  if (!validMovementCount(input.takeoffs, 1000) || !validMovementCount(input.landings, 1000)) {
    return 'Take-offs and landings must be whole numbers between 0 and 1,000.';
  }
  for (const [label, value] of [
    ['Pilot in command', input.pilotInCommandName],
    ['Other pilot or crew', input.otherCrewName],
  ] as const) {
    if (String(value || '').trim().length > 200) return `${label} must be 200 characters or fewer.`;
  }
  for (const [label, value] of [
    ['Comments', input.comments],
    ['Description', input.description],
    ['Notes', input.notes],
  ] as const) {
    if (String(value || '').trim().length > 2000) return `${label} must be 2,000 characters or fewer.`;
  }
  return null;
};
