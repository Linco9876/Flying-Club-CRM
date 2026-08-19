import type { Booking } from '../types';

export interface SeniorInstructorAuthorisation {
  instructor_id: string;
  is_active: boolean;
  locations: string[] | null;
  activity_types: string[] | null;
  remote_supervision_allowed: boolean;
  effective_from: string;
  effective_to: string | null;
  qualification_expires_on: string | null;
}

const sydneyDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value || '';
  return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
};

const containsIgnoreCase = (values: string[] | null, expected: string) =>
  !values?.length || values.some(value => value.toLowerCase() === expected.toLowerCase());

export const authorisationCoversBooking = (
  authorisation: SeniorInstructorAuthorisation,
  booking: Booking,
) => {
  if (!authorisation.is_active) return false;

  const startDate = sydneyDate(new Date(booking.startTime));
  const endDate = sydneyDate(new Date(booking.endTime));
  if (authorisation.effective_from > startDate) return false;
  if (authorisation.effective_to && authorisation.effective_to < endDate) return false;
  if (
    authorisation.qualification_expires_on
    && authorisation.qualification_expires_on < endDate
  ) return false;

  const activityType = booking.bookingKind === 'ground' ? 'ground' : 'flight';
  const location = booking.location || 'Bendigo';
  const locationCovered = authorisation.remote_supervision_allowed
    || containsIgnoreCase(authorisation.locations, location);

  return locationCovered
    && containsIgnoreCase(authorisation.activity_types, activityType);
};

export const canOfferManualBookingSupervision = (
  booking: Booking,
  currentUserId: string | undefined,
  authorisations: SeniorInstructorAuthorisation[],
  now = new Date(),
) => Boolean(
  currentUserId
  && booking.instructorId
  && booking.instructorId !== currentUserId
  && booking.supervisionRequired
  && booking.supervisionStatus === 'pending'
  && !booking.deletedAt
  && !['cancelled', 'completed', 'no-show'].includes(booking.status)
  && !booking.flight_logged
  && !booking.flightLog
  && !booking.ground_session_logged
  && !booking.groundSessionLog
  && new Date(booking.endTime).getTime() > now.getTime()
  && authorisations.some(authorisation =>
    authorisation.instructor_id === currentUserId
    && authorisationCoversBooking(authorisation, booking)
  )
);
