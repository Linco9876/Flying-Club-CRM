export interface CalendarDaylightTimes {
  sunriseMinutes: number;
  sunsetMinutes: number;
}

const OFFICIAL_SUNRISE_ZENITH_DEGREES = 90.833;
const MINUTES_PER_DAY = 24 * 60;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;
const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;
const normaliseDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;
const normaliseMinutes = (minutes: number) => ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

const getDayOfYear = (date: Date) => {
  const year = date.getFullYear();
  const current = Date.UTC(year, date.getMonth(), date.getDate());
  const start = Date.UTC(year, 0, 0);
  return Math.floor((current - start) / 86_400_000);
};

const getTimeZoneOffsetMinutes = (date: Date, timeZone: string) => {
  try {
    const reference = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(reference);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const representedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    return Math.round((representedAsUtc - reference.getTime()) / 60_000);
  } catch {
    return -date.getTimezoneOffset();
  }
};

const calculateSolarEventUtcMinutes = (
  date: Date,
  latitude: number,
  longitude: number,
  isSunrise: boolean,
) => {
  const dayOfYear = getDayOfYear(date);
  const longitudeHour = longitude / 15;
  const approximateTime = dayOfYear + ((isSunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = (0.9856 * approximateTime) - 3.289;
  const trueLongitude = normaliseDegrees(
    meanAnomaly
      + (1.916 * Math.sin(degreesToRadians(meanAnomaly)))
      + (0.020 * Math.sin(degreesToRadians(2 * meanAnomaly)))
      + 282.634,
  );

  let rightAscension = normaliseDegrees(
    radiansToDegrees(Math.atan(0.91764 * Math.tan(degreesToRadians(trueLongitude)))),
  );
  rightAscension +=
    (Math.floor(trueLongitude / 90) * 90)
    - (Math.floor(rightAscension / 90) * 90);
  rightAscension /= 15;

  const sinDeclination = 0.39782 * Math.sin(degreesToRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle = (
    Math.cos(degreesToRadians(OFFICIAL_SUNRISE_ZENITH_DEGREES))
      - (sinDeclination * Math.sin(degreesToRadians(latitude)))
  ) / (cosDeclination * Math.cos(degreesToRadians(latitude)));

  if (cosHourAngle > 1 || cosHourAngle < -1) return null;

  const hourAngle = isSunrise
    ? 360 - radiansToDegrees(Math.acos(cosHourAngle))
    : radiansToDegrees(Math.acos(cosHourAngle));
  const localMeanTime = (hourAngle / 15) + rightAscension - (0.06571 * approximateTime) - 6.622;
  const utcHours = (localMeanTime - longitudeHour + 24) % 24;
  return Math.round(utcHours * 60);
};

export const getCalendarDaylightTimes = (
  date: Date,
  latitude: number,
  longitude: number,
  timeZone = 'Australia/Melbourne',
): CalendarDaylightTimes | null => {
  if (
    Number.isNaN(date.getTime())
    || !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }

  const sunriseUtcMinutes = calculateSolarEventUtcMinutes(date, latitude, longitude, true);
  const sunsetUtcMinutes = calculateSolarEventUtcMinutes(date, latitude, longitude, false);
  if (sunriseUtcMinutes === null || sunsetUtcMinutes === null) return null;

  const offsetMinutes = getTimeZoneOffsetMinutes(date, timeZone);
  return {
    sunriseMinutes: normaliseMinutes(sunriseUtcMinutes + offsetMinutes),
    sunsetMinutes: normaliseMinutes(sunsetUtcMinutes + offsetMinutes),
  };
};

export const formatCalendarMinute = (minutes: number) => {
  const normalised = normaliseMinutes(Math.round(minutes));
  const hour = Math.floor(normalised / 60);
  const minute = normalised % 60;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
};

export const isCalendarSlotOutsideDaylight = (
  slotStartMinutes: number,
  slotDurationMinutes: number,
  daylight: CalendarDaylightTimes | null,
) => {
  if (!daylight) return false;
  const slotEndMinutes = slotStartMinutes + Math.max(1, slotDurationMinutes);
  return slotEndMinutes <= daylight.sunriseMinutes || slotStartMinutes >= daylight.sunsetMinutes;
};
