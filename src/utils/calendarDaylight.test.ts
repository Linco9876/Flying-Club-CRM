import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  formatCalendarMinute,
  getCalendarDaylightTimes,
  isCalendarSlotOutsideDaylight,
} from './calendarDaylight.ts';

const BENDIGO_AIRPORT = {
  latitude: -36.7391667,
  longitude: 144.3297222,
};

test('calculates plausible winter sunrise and sunset for the configured Bendigo Airport coordinates', () => {
  const daylight = getCalendarDaylightTimes(
    new Date(2026, 7, 18, 12),
    BENDIGO_AIRPORT.latitude,
    BENDIGO_AIRPORT.longitude,
    'Australia/Melbourne',
  );

  assert.ok(daylight);
  assert.ok(daylight.sunriseMinutes >= 6 * 60 + 30 && daylight.sunriseMinutes <= 7 * 60 + 30);
  assert.ok(daylight.sunsetMinutes >= 17 * 60 && daylight.sunsetMinutes <= 18 * 60 + 15);
});

test('summer daylight is longer than winter daylight and observes daylight-saving time', () => {
  const winter = getCalendarDaylightTimes(
    new Date(2026, 5, 21, 12),
    BENDIGO_AIRPORT.latitude,
    BENDIGO_AIRPORT.longitude,
    'Australia/Melbourne',
  );
  const summer = getCalendarDaylightTimes(
    new Date(2026, 11, 21, 12),
    BENDIGO_AIRPORT.latitude,
    BENDIGO_AIRPORT.longitude,
    'Australia/Melbourne',
  );

  assert.ok(winter);
  assert.ok(summer);
  assert.ok(summer.sunsetMinutes > 20 * 60);
  assert.ok((summer.sunsetMinutes - summer.sunriseMinutes) > (winter.sunsetMinutes - winter.sunriseMinutes));
});

test('only fully non-daylight calendar slots are shaded', () => {
  const daylight = { sunriseMinutes: 7 * 60 + 4, sunsetMinutes: 17 * 60 + 49 };

  assert.equal(isCalendarSlotOutsideDaylight(6 * 60 + 45, 15, daylight), true);
  assert.equal(isCalendarSlotOutsideDaylight(7 * 60, 15, daylight), false);
  assert.equal(isCalendarSlotOutsideDaylight(17 * 60 + 45, 15, daylight), false);
  assert.equal(isCalendarSlotOutsideDaylight(18 * 60, 15, daylight), true);
  assert.equal(isCalendarSlotOutsideDaylight(6 * 60, 15, null), false);
});

test('formats minute offsets as unambiguous 24-hour local times and rejects invalid coordinates', () => {
  assert.equal(formatCalendarMinute(7 * 60 + 4), '07:04');
  assert.equal(formatCalendarMinute(24 * 60 + 5), '00:05');
  assert.equal(getCalendarDaylightTimes(new Date(), 91, 144), null);
});

test('calendar day and week grids, mobile summary, controls and the persistent legend stay wired to daylight presentation', () => {
  const calendarSource = readFileSync(
    new URL('../components/Calendar/Calendar.tsx', import.meta.url),
    'utf8',
  );

  assert.match(calendarSource, /Shade non-daylight/);
  assert.match(calendarSource, /Daylight at \{daylightLocation\.name\}/);
  assert.equal((calendarSource.match(/calendar-slot-non-daylight/g) || []).length, 3);
  assert.match(calendarSource, /Temporary off/);
  assert.match(calendarSource, /Rostered unavailable/);
  assert.match(calendarSource, /Non-daylight \(when enabled\)/);
  assert.match(calendarSource, /activeLocations\.length > 1/);
});
