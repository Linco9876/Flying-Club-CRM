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

export interface ManualSupervisorOption {
  id: string;
  name: string;
}

export interface InstructorSupervisionRequirement {
  instructor_id: string;
  supervision_required: boolean;
  activity_types: string[] | null;
  locations: string[] | null;
  preflight_minutes: number | null;
  postflight_minutes: number | null;
  effective_from: string;
  effective_to: string | null;
}

export interface SupervisionCoverageWindow {
  startTime: Date;
  endTime: Date;
  preflightMinutes: number;
  postflightMinutes: number;
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

export const canOfferCfiSupervisorAllocation = (
  booking: Booking,
  isCfi: boolean,
  now = new Date(),
) => Boolean(
  isCfi
  && booking.instructorId
  && booking.supervisionRequired
  && booking.supervisionStatus !== 'not_required'
  && !booking.deletedAt
  && !['cancelled', 'completed', 'no-show'].includes(booking.status)
  && !booking.flight_logged
  && !booking.flightLog
  && !booking.ground_session_logged
  && !booking.groundSessionLog
  && new Date(booking.endTime).getTime() > now.getTime()
);

export const getAuthorisedSupervisorsForBooking = (
  booking: Booking,
  authorisations: SeniorInstructorAuthorisation[],
  people: ManualSupervisorOption[],
) => {
  const peopleById = new Map(people.map(person => [person.id, person]));
  const eligible = new Map<string, ManualSupervisorOption>();

  authorisations.forEach(authorisation => {
    if (
      authorisation.instructor_id === booking.instructorId
      || authorisation.instructor_id === booking.supervisingInstructorId
      || !authorisationCoversBooking(authorisation, booking)
    ) return;

    const person = peopleById.get(authorisation.instructor_id);
    if (person) eligible.set(person.id, person);
  });

  return Array.from(eligible.values()).sort((left, right) =>
    left.name.localeCompare(right.name));
};

export const canAcknowledgeBookingSupervision = (
  booking: Booking,
  currentUserId: string | undefined,
) => Boolean(
  currentUserId
  && booking.supervisingInstructorId === currentUserId
  && booking.supervisionRequired
  && booking.supervisionStatus === 'assigned'
  && !booking.deletedAt
  && !['cancelled', 'completed', 'no-show'].includes(booking.status)
);

export const getSupervisionCoverageWindow = (
  booking: Booking,
  requirements: InstructorSupervisionRequirement[],
): SupervisionCoverageWindow => {
  const bookingStart = new Date(booking.startTime);
  const bookingEnd = new Date(booking.endTime);
  const startDate = sydneyDate(bookingStart);
  const endDate = sydneyDate(bookingEnd);
  const activityType = booking.bookingKind === 'ground' ? 'ground' : 'flight';
  const location = booking.location || 'Bendigo';
  const requirement = requirements.find(row => (
    row.instructor_id === booking.instructorId
    && row.supervision_required
    && row.effective_from <= startDate
    && (!row.effective_to || row.effective_to >= endDate)
    && containsIgnoreCase(row.activity_types, activityType)
    && containsIgnoreCase(row.locations, location)
  ));
  const preflightMinutes = Math.max(0, Number(requirement?.preflight_minutes ?? 30));
  const postflightMinutes = Math.max(0, Number(requirement?.postflight_minutes ?? 30));

  return {
    startTime: new Date(bookingStart.getTime() - preflightMinutes * 60_000),
    endTime: new Date(bookingEnd.getTime() + postflightMinutes * 60_000),
    preflightMinutes,
    postflightMinutes,
  };
};
