export const DEFAULT_SAFETY_REPORT_TIME_ZONE = 'Australia/Melbourne';

interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const getZonedDateTimeParts = (date: Date, timeZone: string): ZonedDateTimeParts => {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
};

const getTimeZoneOffsetMilliseconds = (date: Date, timeZone: string) => {
  const parts = getZonedDateTimeParts(date, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
};

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export const normaliseSafetyOccurrenceTimestamp = (
  value?: string | null,
  timeZone = DEFAULT_SAFETY_REPORT_TIME_ZONE,
) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const localMatch = localDateTimePattern.exec(trimmed);
  if (!localMatch) {
    const explicitDate = new Date(trimmed);
    if (Number.isNaN(explicitDate.getTime())) {
      throw new Error('Enter a valid occurrence date and time.');
    }
    return explicitDate.toISOString();
  }

  const requested: ZonedDateTimeParts = {
    year: Number(localMatch[1]),
    month: Number(localMatch[2]),
    day: Number(localMatch[3]),
    hour: Number(localMatch[4]),
    minute: Number(localMatch[5]),
    second: Number(localMatch[6] || 0),
  };
  const nominalUtc = Date.UTC(
    requested.year,
    requested.month - 1,
    requested.day,
    requested.hour,
    requested.minute,
    requested.second,
  );
  const nominalDate = new Date(nominalUtc);

  if (
    requested.month < 1 || requested.month > 12
    || requested.day < 1 || requested.day > 31
    || requested.hour < 0 || requested.hour > 23
    || requested.minute < 0 || requested.minute > 59
    || requested.second < 0 || requested.second > 59
    || nominalDate.getUTCFullYear() !== requested.year
    || nominalDate.getUTCMonth() + 1 !== requested.month
    || nominalDate.getUTCDate() !== requested.day
  ) {
    throw new Error('Enter a valid occurrence date and time.');
  }

  let instant = nominalUtc;
  try {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const nextInstant = nominalUtc - getTimeZoneOffsetMilliseconds(new Date(instant), timeZone);
      if (nextInstant === instant) break;
      instant = nextInstant;
    }
  } catch {
    throw new Error('The configured club timezone is invalid. Ask an administrator to check Organisation settings.');
  }

  const result = new Date(instant);
  const represented = getZonedDateTimeParts(result, timeZone);
  if (Object.keys(requested).some(key => (
    requested[key as keyof ZonedDateTimeParts] !== represented[key as keyof ZonedDateTimeParts]
  ))) {
    throw new Error('That local time does not exist because of a daylight-saving clock change. Choose a valid occurrence time.');
  }

  return result.toISOString();
};

export const formatSafetyOccurrenceDateTime = (
  value: Date | string,
  timeZone = DEFAULT_SAFETY_REPORT_TIME_ZONE,
) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';

  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(date);
};

export const formatSafetyOccurrenceDate = (
  value: Date | string,
  timeZone = DEFAULT_SAFETY_REPORT_TIME_ZONE,
) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';

  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};
