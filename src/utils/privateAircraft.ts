// Stable system option: uses the existing rate/logging foreign keys, never a fleet resource.
export const PRIVATE_AIRCRAFT_ID = '00000000-0000-4000-8000-000000000001';
export const isPrivateAircraft = (id?: string | null) => id === PRIVATE_AIRCRAFT_ID;
export const normaliseAircraftRegistration = (value?: string | null) =>
  (value || '').trim().toUpperCase().replace(/\s+/g, '');
export const aircraftResourcesConflict = (left?: string | null, right?: string | null) =>
  Boolean(left && right && !isPrivateAircraft(left) && left === right);

interface PrivateAircraftReservation {
  id?: string;
  aircraftId?: string;
  privateAircraftRegistration?: string;
  startTime: Date;
  endTime: Date;
  status?: string;
  deletedAt?: Date;
}

export const hasPrivateRegistrationOverlap = (candidate: PrivateAircraftReservation, bookings: PrivateAircraftReservation[]) => {
  const key = (value?: string) => normaliseAircraftRegistration(value).replace(/[^A-Z0-9]/g, '');
  const registration = key(candidate.privateAircraftRegistration);
  return isPrivateAircraft(candidate.aircraftId) && Boolean(registration) && bookings.some(existing =>
    existing.id !== candidate.id && !existing.deletedAt
    && !['cancelled', 'no-show'].includes(existing.status || '')
    && isPrivateAircraft(existing.aircraftId)
    && key(existing.privateAircraftRegistration) === registration
    && existing.startTime < candidate.endTime && existing.endTime > candidate.startTime,
  );
};

export const privateAircraftValidationError = (data: {
  aircraftId?: string | null;
  instructorId?: string | null;
  privateAircraftType?: string | null;
  privateAircraftRegistration?: string | null;
}) => {
  if (!isPrivateAircraft(data.aircraftId)) return null;
  if (!data.instructorId) return 'An instructor is required for private aircraft instruction.';
  if (!data.privateAircraftType?.trim()) return 'Enter the private aircraft type.';
  if (!normaliseAircraftRegistration(data.privateAircraftRegistration)) return 'Enter the private aircraft registration.';
  return null;
};

export const withPrivateAircraftDetails = <T extends {
  private_aircraft_registration?: string | null;
  private_aircraft_type?: string | null;
  aircraft?: { registration: string; make: string; model: string } | null;
}>(log: T): T => log.private_aircraft_registration ? {
  ...log,
  aircraft: { ...log.aircraft, registration: log.private_aircraft_registration, make: '', model: log.private_aircraft_type || '' },
} as T : log;
