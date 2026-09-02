import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfWeek,
} from 'date-fns';

export interface TemporaryDowntimeDraft {
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
}

export type DowntimeRecurrenceFrequency = 'daily' | 'weekly' | 'monthly';
export type DowntimeRecurrenceEndMode = 'never' | 'on' | 'after';

export interface DowntimeRecurrenceRule {
  enabled: boolean;
  frequency: DowntimeRecurrenceFrequency;
  interval: number;
  weekdays: number[];
  endMode: DowntimeRecurrenceEndMode;
  untilDate: string;
  count: number;
}

export interface RecurringDowntimeOccurrence {
  startDate: string;
  endDate: string;
}

export const MAX_DOWNTIME_RECURRENCE_OCCURRENCES = 52;

export const buildDefaultDowntimeRecurrence = (): DowntimeRecurrenceRule => ({
  enabled: false,
  frequency: 'weekly',
  interval: 1,
  weekdays: [],
  endMode: 'after',
  untilDate: '',
  count: 2,
});

export const REGULAR_UNAVAILABLE_BACKGROUND = 'rgba(156, 163, 175, 0.35)';
export const TEMPORARY_DOWNTIME_BACKGROUND = `repeating-linear-gradient(
  45deg,
  rgba(249, 115, 22, 0.62),
  rgba(249, 115, 22, 0.62) 4px,
  rgba(249, 115, 22, 0.10) 4px,
  rgba(249, 115, 22, 0.10) 9px
)`;

export const getCalendarUnavailabilityBackground = (source?: 'absence' | 'schedule') =>
  source === 'absence' ? TEMPORARY_DOWNTIME_BACKGROUND : REGULAR_UNAVAILABLE_BACKGROUND;

export const canManageCalendarDowntime = (
  downtimeOwnerId: string | null | undefined,
  currentUserId: string | null | undefined,
  isAdmin: boolean,
) => Boolean(downtimeOwnerId && currentUserId && (isAdmin || downtimeOwnerId === currentUserId));

export const getTemporaryDowntimeValidationError = (draft: TemporaryDowntimeDraft) => {
  if (!draft.startDate || !draft.endDate) return 'Choose a start and end date';
  if (draft.endDate < draft.startDate) return 'The end date cannot be before the start date';

  const hasStartTime = Boolean(draft.startTime);
  const hasEndTime = Boolean(draft.endTime);
  if (hasStartTime !== hasEndTime) return 'Choose both a start and end time, or make the downtime all day';
  if (hasStartTime && hasEndTime && draft.startTime! >= draft.endTime!) {
    return 'The end time must be after the start time';
  }
  if (!draft.reason?.trim()) return 'Enter a short reason for the downtime';
  return null;
};

export const getDowntimeRecurrenceValidationError = (
  rule: DowntimeRecurrenceRule,
  firstStartDate: string,
) => {
  if (!rule.enabled) return null;
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 12) {
    return 'Choose a repeat interval from 1 to 12';
  }
  if (rule.frequency === 'weekly' && rule.weekdays.length === 0) {
    return 'Choose at least one weekday';
  }
  if (rule.endMode === 'after' && (
    !Number.isInteger(rule.count)
    || rule.count < 2
    || rule.count > MAX_DOWNTIME_RECURRENCE_OCCURRENCES
  )) {
    return `Choose between 2 and ${MAX_DOWNTIME_RECURRENCE_OCCURRENCES} occurrences`;
  }
  if (rule.endMode === 'on' && (!rule.untilDate || rule.untilDate <= firstStartDate)) {
    return 'Choose an end date after the first downtime period';
  }
  return null;
};

const formatDateOnly = (date: Date) => format(date, 'yyyy-MM-dd');

export const buildRecurringDowntimeOccurrences = (
  template: Pick<TemporaryDowntimeDraft, 'startDate' | 'endDate'>,
  rule: DowntimeRecurrenceRule,
): RecurringDowntimeOccurrence[] => {
  const firstStart = parseISO(template.startDate);
  const firstEnd = parseISO(template.endDate);
  const durationDays = Math.max(0, differenceInCalendarDays(firstEnd, firstStart));
  const occurrences: RecurringDowntimeOccurrence[] = [{
    startDate: template.startDate,
    endDate: template.endDate,
  }];

  if (!rule.enabled) return occurrences;

  const maximumOccurrences = rule.endMode === 'after'
    ? Math.min(rule.count, MAX_DOWNTIME_RECURRENCE_OCCURRENCES)
    : MAX_DOWNTIME_RECURRENCE_OCCURRENCES;
  const untilDate = rule.endMode === 'on' ? parseISO(rule.untilDate) : null;

  const appendCandidate = (candidateStart: Date) => {
    if (candidateStart <= firstStart) return false;
    if (untilDate && candidateStart > untilDate) return true;
    occurrences.push({
      startDate: formatDateOnly(candidateStart),
      endDate: formatDateOnly(addDays(candidateStart, durationDays)),
    });
    return occurrences.length >= maximumOccurrences;
  };

  if (rule.frequency === 'daily') {
    for (let index = 1; occurrences.length < maximumOccurrences; index += 1) {
      if (appendCandidate(addDays(firstStart, index * rule.interval))) break;
    }
    return occurrences;
  }

  if (rule.frequency === 'monthly') {
    for (let index = 1; occurrences.length < maximumOccurrences; index += 1) {
      if (appendCandidate(addMonths(firstStart, index * rule.interval))) break;
    }
    return occurrences;
  }

  const weekdays = [...new Set(rule.weekdays)]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  if (weekdays.length === 0) return occurrences;
  const firstWeekStart = startOfWeek(firstStart, { weekStartsOn: 0 });

  for (let weekIndex = 0; occurrences.length < maximumOccurrences; weekIndex += 1) {
    const weekStart = addWeeks(firstWeekStart, weekIndex * rule.interval);
    for (const weekday of weekdays) {
      if (appendCandidate(addDays(weekStart, weekday))) return occurrences;
    }
  }

  return occurrences;
};
