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
  recordedBreaks: Array<{ start: string; end: string }>;
  fatiguePolicy: {
    enabled: boolean;
    breakRequiredAfterMinutes: number;
    minimumBreakMinutes: number;
  };
  locations: DutyLocation[];
  maximumBackdateMinutes: number;
  serverTime: string;
};

export type EndDutyBreakResponse = {
  taken: boolean;
  start?: Date;
  end?: Date;
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

export type HistoricalDutyBreak = {
  id: string;
  breakStart: string;
  breakEnd: string;
  breakType: 'break' | 'rest' | 'split_duty_rest';
  freeOfDuty: boolean;
  affectsCalculation: boolean;
  facility?: string;
  notes?: string;
};

export type HistoricalDutyPeriod = {
  id: string;
  dutyDate: string;
  plannedStart?: string;
  plannedEnd?: string;
  actualStart: string;
  actualEnd: string;
  location: string;
  isExternal: boolean;
  externalOrganisation?: string;
  flightMinutes: number;
  notes?: string;
  amendmentReason?: string;
  entrySource: 'manual' | 'mobile' | 'automatic_booking';
  autoClosedAtLimit: boolean;
  breakConfirmation?: 'taken' | 'not_taken';
  breaks: HistoricalDutyBreak[];
};
