import { Student, UserRole } from '../types';
import { SafetyComplianceSettings } from '../hooks/useSafetySettings';
import { FlightLog } from '../hooks/useFlightLogs';

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
}

type SafetyMessagePerspective = 'named' | 'firstPerson';

type MinimalFlightLog = Pick<FlightLog, 'student_id' | 'instructor_id' | 'start_time' | 'solo_time' | 'flight_duration'>;

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

export const getPilotInCommandHours = (personId: string, flightLogs: MinimalFlightLog[]) =>
  flightLogs
    .reduce((total, log) => {
      if (log.instructor_id === personId) {
        return total + Number(log.flight_duration || 0);
      }
      if (log.student_id === personId && !log.instructor_id) {
        return total + Number(log.solo_time || log.flight_duration || 0);
      }
      return total;
    }, 0);

export const getLastCurrencyFlightDate = (personId: string, flightLogs: MinimalFlightLog[]) => {
  const relevantLogs = flightLogs.filter((log) =>
    log.student_id === personId || log.instructor_id === personId
  );

  if (relevantLogs.length === 0) return null;

  return new Date(Math.max(...relevantLogs.map((log) => new Date(log.start_time).getTime())));
};

export const isStudentOnly = (person: Pick<Student, 'role' | 'roles'>) => {
  const roles = person.roles && person.roles.length > 0 ? person.roles : [person.role as UserRole];
  return roles.includes('student') && !roles.some((role) => ['pilot', 'instructor', 'senior_instructor', 'admin'].includes(role));
};

export const getBfrDueDate = (person: Pick<Student, 'lastFlightReview'>) => {
  if (!person.lastFlightReview) return null;
  const due = new Date(person.lastFlightReview);
  due.setFullYear(due.getFullYear() + 2);
  return due;
};

export const buildSafetyComplianceSummary = (
  person: Student,
  settings: SafetyComplianceSettings,
  flightLogs: MinimalFlightLog[],
  options: { hasInstructor?: boolean; perspective?: SafetyMessagePerspective } = {}
): SafetyComplianceSummary => {
  const perspective = options.perspective ?? 'named';
  const studentOnly = isStudentOnly(person);
  const lastFlightDate = getLastCurrencyFlightDate(person.id, flightLogs);
  const daysSinceLastFlight = lastFlightDate
    ? Math.floor((startOfToday().getTime() - lastFlightDate.getTime()) / MS_PER_DAY)
    : null;
  const picHours = getPilotInCommandHours(person.id, flightLogs);
  const concerns: SafetyConcern[] = [];

  if (!studentOnly && (daysSinceLastFlight === null || daysSinceLastFlight > settings.recencyDays)) {
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

  const medicalDays = daysUntil(person.medicalExpiry);
  if (medicalDays !== null && medicalDays < 0) {
    concerns.push({
      type: 'medical',
      severity: 'lapsed',
      label: 'Medical expired',
      days: medicalDays,
      message: `${subjectFor(person, perspective)} medical expired on ${formatDate(person.medicalExpiry)}.`
    });
  } else if (medicalDays !== null && medicalDays <= settings.medicalWarningDays) {
    concerns.push({
      type: 'medical',
      severity: 'warning',
      label: 'Medical approaching expiry',
      days: medicalDays,
      message: `${subjectFor(person, perspective)} medical expires on ${formatDate(person.medicalExpiry)}.`
    });
  }

  const licenceDays = daysUntil(person.licenceExpiry);
  if (licenceDays !== null && licenceDays < 0) {
    concerns.push({
      type: 'licence',
      severity: 'lapsed',
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
      severity: options.hasInstructor ? 'lapsed' : 'blocked',
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
    picHours
  };
};
