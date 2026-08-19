export interface TemporaryDowntimeDraft {
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
}

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
