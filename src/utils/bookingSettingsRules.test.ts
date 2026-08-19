import assert from 'node:assert/strict';
import test from 'node:test';
import { getBookingRulesValidationError } from './bookingSettingsRules.ts';

const valid = {
  minBookingNoticeHours: 2,
  maxBookingAdvanceDays: 30,
  maxActiveBookingsPerMember: 0,
  cancellationNoticeHours: 24,
  enforceMaxDuration: true,
  maxBookingDurationHours: 8,
  fatigueRulesEnabled: true,
  fatigueLateFinishTime: '22:00',
  fatigueEarlyStartTime: '07:00',
  fatigueMinRestHours: 12,
  fatigueMaxDutyHoursPerDay: 11,
  fatigueMaxFlightHoursPerDay: 7,
  fatigueMaxLateFinishes7Days: 3,
  fatigueBreakRequiredAfterHours: 5,
  fatigueMinBreakMinutes: 30,
};

test('accepts a coherent booking and fatigue configuration', () => {
  assert.equal(getBookingRulesValidationError(valid), null);
});

test('rejects empty numeric fields represented as NaN', () => {
  assert.match(getBookingRulesValidationError({ ...valid, minBookingNoticeHours: Number.NaN }) || '', /Minimum booking notice/);
});

test('rejects flight limits greater than the duty span', () => {
  assert.match(getBookingRulesValidationError({ ...valid, fatigueMaxDutyHoursPerDay: 6, fatigueMaxFlightHoursPerDay: 7 }) || '', /cannot exceed/);
});
