import React from 'react';

interface KioskCalendarShellProps {
  onExit: () => void | Promise<void>;
  children: React.ReactNode;
}

const BENDIGO_LATITUDE = -36.757;
const BENDIGO_LONGITUDE = 144.2794;
const OFFICIAL_ZENITH = 90.833;

const degreesToRadians = (degrees: number) => degrees * (Math.PI / 180);
const radiansToDegrees = (radians: number) => radians * (180 / Math.PI);
const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;
const normalizeHours = (hours: number) => ((hours % 24) + 24) % 24;

const getDayOfYear = (date: Date) => {
  const start = new Date(date.getFullYear(), 0, 0);
  const difference = date.getTime() - start.getTime();
  return Math.floor(difference / 86_400_000);
};

const getLocalDateKey = (date: Date) => (
  (date.getFullYear() * 10_000) + ((date.getMonth() + 1) * 100) + date.getDate()
);

const calculateSunTime = (date: Date, isSunrise: boolean) => {
  const dayOfYear = getDayOfYear(date);
  const longitudeHour = BENDIGO_LONGITUDE / 15;
  const approximateTime = dayOfYear + (((isSunrise ? 6 : 18) - longitudeHour) / 24);
  const meanAnomaly = (0.9856 * approximateTime) - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly
      + (1.916 * Math.sin(degreesToRadians(meanAnomaly)))
      + (0.020 * Math.sin(degreesToRadians(2 * meanAnomaly)))
      + 282.634
  );

  let rightAscension = radiansToDegrees(Math.atan(0.91764 * Math.tan(degreesToRadians(trueLongitude))));
  rightAscension = normalizeDegrees(rightAscension);
  rightAscension += Math.floor(trueLongitude / 90) * 90 - Math.floor(rightAscension / 90) * 90;
  rightAscension /= 15;

  const sinDeclination = 0.39782 * Math.sin(degreesToRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle = (
    Math.cos(degreesToRadians(OFFICIAL_ZENITH))
    - (sinDeclination * Math.sin(degreesToRadians(BENDIGO_LATITUDE)))
  ) / (cosDeclination * Math.cos(degreesToRadians(BENDIGO_LATITUDE)));

  if (cosHourAngle > 1 || cosHourAngle < -1) {
    return null;
  }

  const hourAngle = isSunrise
    ? 360 - radiansToDegrees(Math.acos(cosHourAngle))
    : radiansToDegrees(Math.acos(cosHourAngle));
  const localMeanTime = (hourAngle / 15) + rightAscension - (0.06571 * approximateTime) - 6.622;
  const universalTime = normalizeHours(localMeanTime - longitudeHour);

  const localDateKey = getLocalDateKey(date);
  let sunTime = new Date(Date.UTC(date.getFullYear(), 0, dayOfYear, 0, 0, 0, 0) + (universalTime * 3_600_000));

  if (isSunrise && getLocalDateKey(sunTime) > localDateKey) {
    sunTime = new Date(sunTime.getTime() - 86_400_000);
  }

  if (!isSunrise && getLocalDateKey(sunTime) < localDateKey) {
    sunTime = new Date(sunTime.getTime() + 86_400_000);
  }

  return sunTime;
};

const getKioskDaylightTheme = () => {
  const now = new Date();
  const sunrise = calculateSunTime(now, true);
  const sunset = calculateSunTime(now, false);

  if (!sunrise || !sunset) {
    return 'light';
  }

  return now >= sunrise && now < sunset ? 'light' : 'dark';
};

export const KioskCalendarShell: React.FC<KioskCalendarShellProps> = ({
  onExit,
  children,
}) => {
  const [kioskTheme, setKioskTheme] = React.useState<'light' | 'dark'>(() => getKioskDaylightTheme());

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void onExit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExit]);

  React.useEffect(() => {
    const refreshTheme = () => setKioskTheme(getKioskDaylightTheme());
    refreshTheme();
    const intervalId = window.setInterval(refreshTheme, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div
      className="kiosk-app-surface h-screen overflow-hidden bg-slate-100 text-gray-950"
      data-kiosk-theme={kioskTheme}
    >
      <main className="h-full">
        {children}
      </main>
    </div>
  );
};
