export type PortalThemePreference = 'light' | 'semi-dark' | 'dark' | 'day-night' | 'auto';

export const PORTAL_THEME_STORAGE_KEY = 'bfc.portal.theme';
export const PORTAL_THEME_USER_STORAGE_PREFIX = `${PORTAL_THEME_STORAGE_KEY}.user.`;

const isPortalThemePreference = (value: unknown): value is PortalThemePreference =>
  value === 'light' || value === 'semi-dark' || value === 'dark' || value === 'day-night' || value === 'auto';

export const normalizePortalTheme = (theme: unknown): PortalThemePreference =>
  isPortalThemePreference(theme) ? theme : 'auto';

const getThemeStorageKey = (userId?: string) =>
  userId ? `${PORTAL_THEME_USER_STORAGE_PREFIX}${userId}` : PORTAL_THEME_STORAGE_KEY;

export const getStoredPortalTheme = (userId?: string): PortalThemePreference | null => {
  if (typeof window === 'undefined') return null;
  try {
    const storedTheme = window.localStorage.getItem(getThemeStorageKey(userId));
    return isPortalThemePreference(storedTheme) ? storedTheme : null;
  } catch {
    return null;
  }
};

export const storePortalTheme = (theme: unknown, userId?: string) => {
  if (typeof window === 'undefined') return;
  try {
    const normalizedTheme = normalizePortalTheme(theme);
    window.localStorage.setItem(getThemeStorageKey(userId), normalizedTheme);
    if (userId) {
      window.localStorage.removeItem(PORTAL_THEME_STORAGE_KEY);
    }
  } catch {
    // Best-effort only. The database preference remains the source of truth.
  }
};

const BENDIGO_LATITUDE = -36.757;
const BENDIGO_LONGITUDE = 144.2794;
const DAY_NIGHT_FALLBACK_SUNRISE_HOUR = 6;
const DAY_NIGHT_FALLBACK_SUNSET_HOUR = 18;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;
const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;

const getDayOfYear = (date: Date) => {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime() + ((start.getTimezoneOffset() - date.getTimezoneOffset()) * 60_000);
  return Math.floor(diff / 86_400_000);
};

const calculateSunTime = (date: Date, isSunrise: boolean) => {
  const dayOfYear = getDayOfYear(date);
  const longitudeHour = BENDIGO_LONGITUDE / 15;
  const approximateTime = dayOfYear + ((isSunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = (0.9856 * approximateTime) - 3.289;
  let trueLongitude = meanAnomaly
    + (1.916 * Math.sin(degreesToRadians(meanAnomaly)))
    + (0.020 * Math.sin(degreesToRadians(2 * meanAnomaly)))
    + 282.634;
  trueLongitude = (trueLongitude + 360) % 360;

  let rightAscension = radiansToDegrees(Math.atan(0.91764 * Math.tan(degreesToRadians(trueLongitude))));
  rightAscension = (rightAscension + 360) % 360;
  rightAscension += (Math.floor(trueLongitude / 90) * 90) - (Math.floor(rightAscension / 90) * 90);
  rightAscension /= 15;

  const sinDeclination = 0.39782 * Math.sin(degreesToRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle = (
    Math.cos(degreesToRadians(90.833)) -
    (sinDeclination * Math.sin(degreesToRadians(BENDIGO_LATITUDE)))
  ) / (cosDeclination * Math.cos(degreesToRadians(BENDIGO_LATITUDE)));

  if (cosHourAngle > 1 || cosHourAngle < -1) return null;

  const hourAngle = isSunrise
    ? 360 - radiansToDegrees(Math.acos(cosHourAngle))
    : radiansToDegrees(Math.acos(cosHourAngle));
  const localMeanTime = (hourAngle / 15) + rightAscension - (0.06571 * approximateTime) - 6.622;
  const utcHour = (localMeanTime - longitudeHour + 24) % 24;
  const localMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const result = new Date(localMidnight);
  result.setUTCHours(Math.floor(utcHour), Math.round((utcHour % 1) * 60), 0, 0);
  if (result < localMidnight) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
};

export const isDaylightThemeTime = (date = new Date()) => {
  const sunrise = calculateSunTime(date, true);
  const sunset = calculateSunTime(date, false);
  if (!sunrise || !sunset) {
    const hour = date.getHours();
    return hour >= DAY_NIGHT_FALLBACK_SUNRISE_HOUR && hour < DAY_NIGHT_FALLBACK_SUNSET_HOUR;
  }
  return date >= sunrise && date < sunset;
};

export const applyPortalTheme = (theme: unknown, media?: MediaQueryList) => {
  if (typeof document === 'undefined') return;

  const normalizedTheme = normalizePortalTheme(theme);
  const darkMedia = media ?? (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
  );
  const useDarkTheme =
    normalizedTheme === 'dark' ||
    normalizedTheme === 'semi-dark' ||
    (normalizedTheme === 'day-night' && !isDaylightThemeTime()) ||
    (normalizedTheme === 'auto' && Boolean(darkMedia?.matches));

  document.documentElement.dataset.portalTheme = useDarkTheme ? 'dark' : 'light';
  if (normalizedTheme === 'semi-dark') {
    document.documentElement.dataset.portalVariant = 'semi-dark';
  } else {
    delete document.documentElement.dataset.portalVariant;
  }
};
