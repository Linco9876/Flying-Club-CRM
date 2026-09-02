export interface TrainingRecordReassignmentFlight {
  id: string;
  bookingId?: string | null;
  instructorId?: string | null;
  startTime: string;
  endTime: string;
  dualTime: number;
  soloTime: number;
  trainingRecordStatus: 'pending' | 'dismissed' | 'recorded';
  registration?: string;
  instructorName?: string;
  bookingNotes?: string;
}

export interface TrainingRecordFlightLink {
  trainingRecordId: string;
  flightLogId?: string | null;
  bookingId?: string | null;
}

export const getTrainingRecordReassignmentCandidates = ({
  flights,
  links,
  sourceFlightLogId,
  sourceTrainingRecordId,
  currentUserId,
  canManageAnyInstructor,
}: {
  flights: TrainingRecordReassignmentFlight[];
  links: TrainingRecordFlightLink[];
  sourceFlightLogId: string;
  sourceTrainingRecordId: string;
  currentUserId: string;
  canManageAnyInstructor: boolean;
}) => {
  const occupiedFlightLogIds = new Set(
    links
      .filter(link => link.trainingRecordId !== sourceTrainingRecordId)
      .map(link => link.flightLogId)
      .filter((value): value is string => Boolean(value)),
  );
  const occupiedBookingIds = new Set(
    links
      .filter(link => link.trainingRecordId !== sourceTrainingRecordId)
      .map(link => link.bookingId)
      .filter((value): value is string => Boolean(value)),
  );

  return flights.filter(flight => (
    flight.id !== sourceFlightLogId
    && flight.trainingRecordStatus !== 'recorded'
    && !occupiedFlightLogIds.has(flight.id)
    && !(flight.bookingId && occupiedBookingIds.has(flight.bookingId))
    && (canManageAnyInstructor || flight.instructorId === currentUserId)
  ));
};

export const matchesTrainingRecordReassignmentSearch = (
  flight: TrainingRecordReassignmentFlight,
  query: string,
) => {
  const normalisedQuery = query.trim().toLocaleLowerCase();
  if (!normalisedQuery) return true;

  const searchableText = [
    flight.registration,
    flight.instructorName,
    flight.bookingNotes,
    new Date(flight.startTime).toLocaleDateString('en-AU'),
  ].filter(Boolean).join(' ').toLocaleLowerCase();

  return searchableText.includes(normalisedQuery);
};

