import type { Student, UserRole } from '../types';
import type { SafetyComplianceSettings } from '../hooks/useSafetySettings';
import type { FlightLog } from '../hooks/useFlightLogs';
import { getFlightReviewDueDate } from './pilotReviewCurrency.ts';
import { bfrLapseSeverity, credentialLapseSeverity } from './safetyComplianceRules.ts';
import { calculateLogbookRoleHours } from './logbookEntries.ts';
import {
  isIncludedInLogbookBaseline,
  type ExternalLogbookEntry,
  type LogbookBaseline,
} from './externalLogbook.ts';
import {
  evaluateMedicalCurrency,
  type MedicalCurrencyStatus,
  type MedicalTypeDefinition,
} from './medicalRequirements.ts';

export type SafetyConcernType = 'recency' | 'medical' | 'licence' | 'bfr';
export type SafetyConcernSeverity = 'warning' | 'lapsed' | 'blocked';

export interface SafetyConcern {
  type: SafetyConcernType;
  severity: SafetyConcernSeverity;
  label: string;
  message: string;
  days?: number;
}

export interface SafetyComplianceSummary {
  concerns: SafetyConcern[];
  warningConcerns: SafetyConcern[];
  blockingConcerns: SafetyConcern[];
  isStudentOnly: boolean;
  lastFlightDate: Date | null;
  daysSinceLastFlight: number | null;
  picHours: number;
  medicalStatus: MedicalCurrencyStatus;
}

type SafetyMessagePerspective = 'named' | 'firstPerson';

type MinimalFlightLog = Pick<FlightLog, 'student_id' | 'start_time' | 'solo_time' | 'dual_time' | 'flight_duration'> & {
  instructor_id?: string | null;
};
type MinimalBaseline = Pick<LogbookBaseline, 'user_id' | 'as_of_date' | 'last_flight_date' | 'pic_hours'>;
type MinimalExternalEntry = Pick<ExternalLogbookEntry, 'user_id' | 'flight_date' | 'pic_hours'>;

export interface SafetyLogbookSupplement {
  baselines?: MinimalBaseline[];
  externalEntries?: MinimalExternalEntry[];
  timeZone?: string;
}

export interface SafetyComplianceOptions extends SafetyLogbookSupplement {
  hasInstructor?: boolean;
  perspective?: SafetyMessagePerspective;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const startOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const daysUntil = (date?: Date | null) => {
  if (!date) return null;
  return Math.ceil((date.getTime() - startOfToday().getTime()) / MS_PER_DAY);
};

const formatDate = (date?: Date | null) => date ? date.toLocaleDateString() : 'Not recorded';

const subjectFor = (person: Pick<Student, 'name'>, perspective: SafetyMessagePerspective) =>
  perspective === 'firstPerson' ? 'Your' : `${person.name}'s`;

const replaceSafetyTokens = (
  template: string,
  tokens: Record<string, string | number>,
  fallback: string
) => {
  const source = template.trim() || fallback;
  return Object.entries(tokens).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    source
  );
};

const noRecentFlightMessageFor = (
  person: Pick<Student, 'name'>,
  perspective: SafetyMessagePerspective,
  template: string
) =>
  replaceSafetyTokens(
    template,
    {
      name: person.name,
      subject: perspective === 'firstPerson' ? 'you' : person.name,
      possessive: perspective === 'firstPerson' ? 'Your' : `${person.name}'s`
    },
    perspective === 'firstPerson'
      ? 'No recent logged flight was found for you.'
      : `No recent logged flight was found for ${person.name}.`
  );

const lastFlightMessageFor = (
  person: Pick<Student, 'name'>,
  perspective: SafetyMessagePerspective,
  daysSinceLastFlight: number,
  template: string
) => replaceSafetyTokens(
  template,
  {
    name: person.name,
    subject: perspective === 'firstPerson' ? 'you' : person.name,
    possessive: perspective === 'firstPerson' ? 'Your' : `${person.name}'s`,
    days: daysSinceLastFlight
  },
  perspective === 'firstPerson'
    ? `Your last logged flight was ${daysSinceLastFlight} days ago.`
    : `${person.name}'s last logged flight was ${daysSinceLastFlight} days ago.`
);

const baselineFor = (personId: string, baselines: MinimalBaseline[] = []) =>
  baselines.find(baseline => baseline.user_id === personId) || null;

export const getPilotInCommandHours = (
  personId: string,
  flightLogs: MinimalFlightLog[],
  supplement: SafetyLogbookSupplement = {},
) => {
  const baseline = baselineFor(personId, supplement.baselines);
  const portalPic = flightLogs.reduce((total, log) => {
    if (isIncludedInLogbookBaseline(log.start_time, baseline, supplement.timeZone)) return total;
    return total + calculateLogbookRoleHours(log, personId).picHours;
  }, 0);
  const externalPic = (supplement.externalEntries || []).reduce((total, entry) => {
    if (
      entry.user_id !== personId
      || isIncludedInLogbookBaseline(entry.flight_date, baseline, supplement.timeZone)
    ) return total;
    return total + Number(entry.pic_hours || 0);
  }, 0);
  return Number(baseline?.pic_hours || 0) + portalPic + externalPic;
};

export const getLastCurrencyFlightDate = (
  personId: string,
  flightLogs: MinimalFlightLog[],
  supplement: SafetyLogbookSupplement = {},
) => {
  const dates = flightLogs
    .filter((log) => log.student_id === personId || log.instructor_id === personId)
    .map(log => new Date(log.start_time).getTime())
    .filter(Number.isFinite);
  const baseline = baselineFor(personId, supplement.baselines);
  if (baseline?.last_flight_date) {
    dates.push(new Date(`${baseline.last_flight_date}T12:00:00`).getTime());
  }
  for (const entry of supplement.externalEntries || []) {
    if (entry.user_id === personId) {
      dates.push(new Date(`${entry.flight_date}T12:00:00`).getTime());
    }
  }

  const validDates = dates.filter(Number.isFinite);
  if (validDates.length === 0) return null;

  return new Date(Math.max(...validDates));
};

export const isStudentOnly = (person: Pick<Student, 'role' | 'roles'>) => {
  const roles = person.roles && person.roles.length > 0 ? person.roles : [person.role as UserRole];
  return roles.includes('student') && !roles.some((role) => ['pilot', 'instructor', 'senior_instructor', 'admin'].includes(role));
};

export const getBfrDueDate = (person: Pick<Student, 'lastFlightReview'>) => {
  return getFlightReviewDueDate(person.lastFlightReview);
};

export const buildSafetyComplianceSummary = (
  person: Student,
  settings: SafetyComplianceSettings,
  flightLogs: MinimalFlightLog[],
  options: SafetyComplianceOptions = {}
): SafetyComplianceSummary => {
  const perspective = options.perspective ?? 'named';
  const hasInstructor = Boolean(options.hasInstructor);
  const studentOnly = isStudentOnly(person);
  const supplement = {
    baselines: options.baselines,
    externalEntries: options.externalEntries,
    timeZone: options.timeZone,
  };
  const lastFlightDate = getLastCurrencyFlightDate(person.id, flightLogs, supplement);
  const daysSinceLastFlight = lastFlightDate
    ? Math.floor((startOfToday().getTime() - lastFlightDate.getTime()) / MS_PER_DAY)
    : null;
  const picHours = getPilotInCommandHours(person.id, flightLogs, supplement);
  const concerns: SafetyConcern[] = [];

  if (!studentOnly && !hasInstructor && (daysSinceLastFlight === null || daysSinceLastFlight > settings.recencyDays)) {
    concerns.push({
      type: 'recency',
      severity: 'warning',
      label: 'Pilot recency',
      days: daysSinceLastFlight ?? undefined,
      message: daysSinceLastFlight === null
        ? noRecentFlightMessageFor(person, perspective, settings.recencyNoFlightMessage)
        : lastFlightMessageFor(person, perspective, daysSinceLastFlight, settings.recencyLastFlightMessage)
    });
  }

  const personRoles = person.roles && person.roles.length > 0 ? person.roles : [person.role as UserRole];
  const medicalRequired = person.medicalRequired ?? personRoles.some(role =>
    ['pilot', 'instructor', 'senior_instructor', 'cfi'].includes(role)
  );
  const configuredMedicalDefinition: MedicalTypeDefinition[] = person.medicalType ? [{
    id: `member-${person.id}`,
    name: person.medicalType,
    validityMode: person.medicalValidityMode ?? 'expiry_date',
    validUntilAge: person.medicalValidUntilAge,
    isActive: true,
  }] : [];
  const medicalStatus = evaluateMedicalCurrency({
    required: medicalRequired,
    medicalType: person.medicalType || (person.medicalExpiry ? 'Recorded medical' : null),
    medicalExpiry: person.medicalExpiry,
    dateOfBirth: person.dateOfBirth,
    definitions: configuredMedicalDefinition,
    warningDays: settings.medicalWarningDays,
  });
  const medicalSubject = subjectFor(person, perspective);
  const medicalReason = person.medicalRequirementReason === 'course' && person.medicalRequirementCourseTitle
    ? ` for ${person.medicalRequirementCourseTitle}`
    : '';

  if (medicalStatus.state === 'missing_type') {
    concerns.push({
      type: 'medical',
      severity: credentialLapseSeverity(settings.autoBlockExpiredMedical),
      label: 'Operating medical required',
      message: `${medicalSubject} applicable operating medical has not been selected${medicalReason}.`,
    });
  } else if (medicalStatus.state === 'missing_expiry') {
    concerns.push({
      type: 'medical',
      severity: credentialLapseSeverity(settings.autoBlockExpiredMedical),
      label: 'Medical expiry required',
      message: `${medicalSubject} ${medicalStatus.definition?.name || 'medical'} needs an expiry date.`,
    });
  } else if (medicalStatus.state === 'missing_date_of_birth') {
    concerns.push({
      type: 'medical',
      severity: 'warning',
      label: 'Date of birth required for medical',
      message: `${medicalSubject} date of birth is needed to confirm the age-based ${medicalStatus.definition?.name || 'medical'}.`,
    });
  } else if (medicalStatus.state === 'expired') {
    concerns.push({
      type: 'medical',
      severity: credentialLapseSeverity(settings.autoBlockExpiredMedical),
      label: 'Medical expired',
      days: medicalStatus.daysRemaining ?? undefined,
      message: medicalStatus.definition?.validityMode === 'until_age'
        ? `${medicalSubject} ${medicalStatus.definition.name} ceased to satisfy the requirement at age ${medicalStatus.definition.validUntilAge} on ${formatDate(medicalStatus.effectiveExpiry)}.`
        : `${medicalSubject} medical expired on ${formatDate(medicalStatus.effectiveExpiry)}.`
    });
  } else if (medicalStatus.state === 'expiring') {
    concerns.push({
      type: 'medical',
      severity: 'warning',
      label: 'Medical approaching expiry',
      days: medicalStatus.daysRemaining ?? undefined,
      message: medicalStatus.definition?.validityMode === 'until_age'
        ? `${medicalSubject} ${medicalStatus.definition.name} remains current until age ${medicalStatus.definition.validUntilAge} on ${formatDate(medicalStatus.effectiveExpiry)}.`
        : `${medicalSubject} medical expires on ${formatDate(medicalStatus.effectiveExpiry)}.`
    });
  }

  const licenceDays = daysUntil(person.licenceExpiry);
  if (licenceDays !== null && licenceDays < 0) {
    concerns.push({
      type: 'licence',
      severity: credentialLapseSeverity(settings.autoBlockExpiredLicence),
      label: 'RAAus membership expired',
      days: licenceDays,
      message: `${subjectFor(person, perspective)} RAAus membership expired on ${formatDate(person.licenceExpiry)}.`
    });
  } else if (licenceDays !== null && licenceDays <= settings.licenceWarningDays) {
    concerns.push({
      type: 'licence',
      severity: 'warning',
      label: 'RAAus membership approaching expiry',
      days: licenceDays,
      message: `${subjectFor(person, perspective)} RAAus membership expires on ${formatDate(person.licenceExpiry)}.`
    });
  }

  const bfrDue = getBfrDueDate(person);
  const bfrDays = daysUntil(bfrDue);
  if (!studentOnly && bfrDays !== null && bfrDays < 0) {
    concerns.push({
      type: 'bfr',
      severity: bfrLapseSeverity(settings.requireBfrForSolo, hasInstructor),
      label: 'BFR lapsed',
      days: bfrDays,
      message: `${subjectFor(person, perspective)} BFR was due on ${formatDate(bfrDue)}. Aircraft bookings without an instructor are not permitted.`
    });
  } else if (!studentOnly && bfrDays !== null && bfrDays <= settings.bfrWarningDays) {
    concerns.push({
      type: 'bfr',
      severity: 'warning',
      label: 'BFR approaching due',
      days: bfrDays,
      message: `${subjectFor(person, perspective)} BFR is due on ${formatDate(bfrDue)}.`
    });
  }

  const blockingConcerns = concerns.filter((concern) => concern.severity === 'blocked');
  const warningConcerns = concerns.filter((concern) => concern.severity !== 'blocked');

  return {
    concerns,
    warningConcerns,
    blockingConcerns,
    isStudentOnly: studentOnly,
    lastFlightDate,
    daysSinceLastFlight,
    picHours,
    medicalStatus,
  };
};
