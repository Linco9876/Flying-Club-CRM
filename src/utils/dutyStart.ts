export type DutyStartLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMetres: number;
  isPrimary?: boolean;
};

export type DutyStartGeo = {
  latitude?: number;
  longitude?: number;
  accuracyMetres?: number;
  nearestLocation?: DutyStartLocation;
  distanceMetres?: number;
  insideGeofence: boolean;
  label: string;
  error?: string;
};

export type DutyStartValidationInput = {
  actualStart: Date;
  now: Date;
  maximumBackdateMinutes: number;
  locationLabel: string;
  geo: DutyStartGeo;
  geofenceNotes: string;
  fitForDuty: boolean;
  externalDutyDeclared: boolean;
  sleepOpportunityConfirmed: boolean;
  kssScore?: number;
  privateNote: string;
};

const EARTH_RADIUS_METRES = 6_371_000;
const radians = (degrees: number) => degrees * Math.PI / 180;

export const dutyDistanceMetres = (
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) => {
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA))
    * Math.cos(radians(latitudeB))
    * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METRES * 2 * Math.asin(Math.sqrt(a));
};

export const nearestDutyStartLocation = (
  latitude: number,
  longitude: number,
  locations: DutyStartLocation[],
) => locations
  .map(location => ({
    location,
    distance: dutyDistanceMetres(latitude, longitude, location.latitude, location.longitude),
  }))
  .sort((left, right) => left.distance - right.distance)[0];

export const readableDutyDistance = (metres?: number) => {
  if (metres === undefined) return '';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
};

export const validateDutyStart = (input: DutyStartValidationInput): string | null => {
  if (Number.isNaN(input.actualStart.getTime())) return 'Choose a valid duty start time.';

  const earliest = input.now.getTime() - input.maximumBackdateMinutes * 60_000;
  const latest = input.now.getTime() + 5 * 60_000;
  if (input.actualStart.getTime() < earliest || input.actualStart.getTime() > latest) {
    return `Duty start must be within the last ${input.maximumBackdateMinutes / 60} hours.`;
  }
  if (!input.fitForDuty) {
    return 'You cannot start duty while marked not fit. Contact operations or a senior instructor.';
  }
  if (!input.externalDutyDeclared) {
    return 'Confirm that relevant external duty has been entered, or that there is none.';
  }
  if (!input.locationLabel.trim()) return 'Confirm the location where you are starting duty.';
  if (!input.geo.insideGeofence && input.geofenceNotes.trim().length < 10) {
    return 'Add at least 10 characters explaining where you are working off-site.';
  }
  if (
    (!input.sleepOpportunityConfirmed || (input.kssScore || 0) >= 7)
    && input.privateNote.trim().length < 10
  ) {
    return 'Add at least 10 characters about the fatigue risk and your mitigation.';
  }
  return null;
};
