import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCalendarMonths,
  calculateDaysRemaining,
  calculateHoursRemaining,
  getMaintenanceAlertLevel,
  validateMaintenanceThresholds
} from './maintenanceRules.ts';

test('calendar intervals use real calendar months and preserve month end safely', () => {
  assert.equal(addCalendarMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addCalendarMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addCalendarMonths('2026-07-29', 12), '2027-07-29');
});

test('hours remaining stays signed so overdue hours are not hidden', () => {
  assert.equal(calculateHoursRemaining(100, 97.5), 2.5);
  assert.ok(Math.abs((calculateHoursRemaining(100, 104.2) ?? 0) + 4.2) < 1e-9);
  assert.equal(calculateHoursRemaining(undefined, 10), null);
});

test('calendar-day remaining is stable around time-of-day boundaries', () => {
  const now = new Date(2026, 6, 29, 23, 55);
  assert.equal(calculateDaysRemaining(new Date(2026, 6, 29), now), 0);
  assert.equal(calculateDaysRemaining(new Date(2026, 6, 30), now), 1);
  assert.equal(calculateDaysRemaining(new Date(2026, 6, 28), now), -1);
});

test('the most serious maintenance alert wins when a milestone has two limits', () => {
  assert.equal(getMaintenanceAlertLevel({
    hoursRemaining: 12,
    daysRemaining: -1,
    urgentHours: 10,
    upcomingHours: 25,
    urgentDays: 7,
    upcomingDays: 30
  }), 'overdue');
  assert.equal(getMaintenanceAlertLevel({
    hoursRemaining: 10,
    daysRemaining: 60,
    urgentHours: 10,
    upcomingHours: 25,
    urgentDays: 7,
    upcomingDays: 30
  }), 'urgent');
});

test('maintenance warning thresholds cannot overlap backwards', () => {
  assert.equal(validateMaintenanceThresholds({
    urgentHours: 10,
    upcomingHours: 25,
    urgentDays: 7,
    upcomingDays: 30
  }), null);
  assert.match(validateMaintenanceThresholds({
    urgentHours: 30,
    upcomingHours: 25,
    urgentDays: 7,
    upcomingDays: 30
  }) || '', /Upcoming/);
});
