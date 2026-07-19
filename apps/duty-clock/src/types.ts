export type DutyLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMetres: number;
  isPrimary: boolean;
};

export type ActiveDuty = {
  id: string;
  actualStart: string;
  location: string;
  entrySource: 'manual' | 'mobile' | 'automatic_booking';
  dutyDate: string;
  maximumEnd: string;
};

export type ActiveBreak = {
  id: string;
  startedAt: string;
};

export type DutyContext = {
  allowed: boolean;
  profile?: { id: string; name: string };
  activeDuty: ActiveDuty | null;
  activeBreak: ActiveBreak | null;
  loggedFlightMinutes: number;
  loggedFlightCount: number;
  locations: DutyLocation[];
  maximumBackdateMinutes: number;
  serverTime: string;
};

export type GeoResult = {
  latitude?: number;
  longitude?: number;
  accuracyMetres?: number;
  nearestLocation?: DutyLocation;
  distanceMetres?: number;
  insideGeofence: boolean;
  label: string;
  error?: string;
};

export type StartDutyInput = {
  actualStart: Date;
  locationLabel: string;
  geo: GeoResult;
  geofenceNotes: string;
  fitForDuty: boolean;
  externalDutyDeclared: boolean;
  sleepOpportunityConfirmed: boolean;
  kssScore?: number;
  privateNote: string;
};
