import type { Booking } from '../types/index.ts';

export type RecurringBookingEditScope = 'single' | 'future';

export interface RecurringBookingUpdatePlanItem {
  booking: Booking;
  startTime: Date;
  endTime: Date;
}

const isActiveOccurrence = (booking: Booking) =>
  !booking.deletedAt
  && booking.status !== 'cancelled'
  && booking.status !== 'no-show'
  && booking.status !== 'completed';

export const getExpectedFutureOccurrenceCount = (booking?: Booking | null) => {
  if (
    !booking?.recurrenceSeriesId
    || !booking.recurrenceOccurrenceIndex
    || !booking.recurrenceOccurrenceCount
  ) return 0;

  return Math.max(
    1,
    booking.recurrenceOccurrenceCount - booking.recurrenceOccurrenceIndex + 1,
  );
};

export const buildRecurringBookingUpdatePlan = (
  bookings: Booking[],
  sourceBooking: Booking,
  newStartTime: Date,
  newEndTime: Date,
): RecurringBookingUpdatePlanItem[] => {
  if (!sourceBooking.recurrenceSeriesId || !sourceBooking.recurrenceOccurrenceIndex) {
    throw new Error('This booking is not linked to a recurring series.');
  }
  if (newEndTime <= newStartTime) {
    throw new Error('End time must be after start time.');
  }

  const startShiftMs = newStartTime.getTime() - new Date(sourceBooking.startTime).getTime();
  const endShiftMs = newEndTime.getTime() - new Date(sourceBooking.endTime).getTime();

  const targets = bookings
    .filter((booking) => (
      booking.recurrenceSeriesId === sourceBooking.recurrenceSeriesId
      && Boolean(booking.recurrenceOccurrenceIndex)
      && booking.recurrenceOccurrenceIndex! >= sourceBooking.recurrenceOccurrenceIndex!
      && isActiveOccurrence(booking)
    ))
    .map((booking) => ({
      booking,
      startTime: new Date(new Date(booking.startTime).getTime() + startShiftMs),
      endTime: new Date(new Date(booking.endTime).getTime() + endShiftMs),
    }));

  // Moving forward is processed from the end backwards; moving backwards is
  // processed from the start forwards. The server uses the same ordering so a
  // shifted occurrence never collides with the old position of the next one.
  targets.sort((left, right) => {
    const leftIndex = left.booking.recurrenceOccurrenceIndex || 0;
    const rightIndex = right.booking.recurrenceOccurrenceIndex || 0;
    return startShiftMs >= 0 ? rightIndex - leftIndex : leftIndex - rightIndex;
  });

  if (!targets.some((target) => target.booking.id === sourceBooking.id)) {
    throw new Error('The selected recurring booking is no longer active. Refresh the calendar and try again.');
  }

  return targets;
};
