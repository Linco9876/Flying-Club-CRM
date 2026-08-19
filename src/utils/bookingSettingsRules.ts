export interface BookingRulesDraft {
  minBookingNoticeHours: number;
  maxBookingAdvanceDays: number;
  maxActiveBookingsPerMember: number;
  cancellationNoticeHours: number;
  enforceMaxDuration: boolean;
  maxBookingDurationHours: number;
  fatigueRulesEnabled: boolean;
  fatigueLateFinishTime: string;
  fatigueEarlyStartTime: string;
  fatigueMinRestHours: number;
  fatigueMaxDutyHoursPerDay: number;
  fatigueMaxFlightHoursPerDay: number;
  fatigueMaxLateFinishes7Days: number;
  fatigueBreakRequiredAfterHours: number;
  fatigueMinBreakMinutes: number;
}

const inRange = (value: number, minimum: number, maximum: number) =>
  Number.isFinite(value) && value >= minimum && value <= maximum;

export const getBookingRulesValidationError = (rules: BookingRulesDraft) => {
  if (!inRange(rules.maxBookingAdvanceDays, 1, 365)) return 'Maximum advance booking must be between 1 and 365 days.';
  if (!inRange(rules.minBookingNoticeHours, 0, 48)) return 'Minimum booking notice must be between 0 and 48 hours.';
  if (!Number.isInteger(rules.maxActiveBookingsPerMember) || !inRange(rules.maxActiveBookingsPerMember, 0, 100)) {
    return 'Maximum active bookings must be a whole number between 0 and 100.';
  }
  if (!inRange(rules.cancellationNoticeHours, 0, 72)) return 'Cancellation notice must be between 0 and 72 hours.';
  if (rules.enforceMaxDuration && !inRange(rules.maxBookingDurationHours, 1, 24)) {
    return 'Maximum booking duration must be between 1 and 24 hours.';
  }
  if (!rules.fatigueRulesEnabled) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rules.fatigueLateFinishTime)) return 'Choose a valid late-finish time.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rules.fatigueEarlyStartTime)) return 'Choose a valid early-start time.';
  if (!inRange(rules.fatigueMinRestHours, 0, 24)) return 'Minimum rest must be between 0 and 24 hours.';
  if (!inRange(rules.fatigueMaxDutyHoursPerDay, 1, 16)) return 'Maximum duty span must be between 1 and 16 hours.';
  if (!inRange(rules.fatigueMaxFlightHoursPerDay, 1, 12)) return 'Maximum flight time must be between 1 and 12 hours.';
  if (rules.fatigueMaxFlightHoursPerDay > rules.fatigueMaxDutyHoursPerDay) return 'Maximum flight time cannot exceed maximum duty span.';
  if (!Number.isInteger(rules.fatigueMaxLateFinishes7Days) || !inRange(rules.fatigueMaxLateFinishes7Days, 0, 7)) {
    return 'Maximum late finishes must be a whole number between 0 and 7.';
  }
  if (!inRange(rules.fatigueBreakRequiredAfterHours, 1, 16)) return 'Break prompting must start between 1 and 16 duty hours.';
  if (!Number.isInteger(rules.fatigueMinBreakMinutes) || !inRange(rules.fatigueMinBreakMinutes, 1, 240)) {
    return 'Minimum break must be a whole number between 1 and 240 minutes.';
  }
  return null;
};
