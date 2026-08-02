import type { TrainingModule } from '../types/index.ts';
import {
  csvCell,
  type CsvParseResult,
  type ImportValidationResult,
  type NormalizedImportRow,
} from './studentRecordImport.ts';
import {
  courseVersionsMatch,
  createAutomaticRecordReference,
  type CourseTransferIdentity,
} from './studentCourseRecordTransfer.ts';
import {
  FORMAL_REVIEW_FINDINGS_LABEL,
  requiresFormalReviewFindings,
} from './flightReviewFindings.ts';

export interface ReviewChecklistTransferDefinition {
  key: string;
  code: string;
  section: string;
  title: string;
  required: boolean;
  resultColumn: string;
  notesColumn: string;
}

type ReviewChecklistResult = 'not_assessed' | 'satisfactory' | 'further_training' | 'not_applicable';

const REVIEW_BASE_HEADERS = [
  'include',
  'student_portal_id',
  'student_name',
  'course',
  'course_version',
  'record_reference',
  'review_date',
  'status',
  'reviewer_name',
  'reviewer_identifier',
  'reviewer_organisation',
  'aircraft_registration',
  'aircraft_type',
  'aircraft_group',
  'ground_time',
  'flight_time',
  'candidate_objectives',
  'reviewer_summary',
  'further_training_plan',
  'minimums_override_reason',
  'emergency_plan_confirmed',
  'logbook_entry_confirmed',
  'authority_submission_confirmed',
  'candidate_acknowledged',
  'evidence_reference',
  'next_review_due',
];

const normalisePart = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'item';

const normaliseLookup = (value: string) => value.trim().toLocaleLowerCase();
const includedValues = new Set(['yes', 'y', 'true', '1', 'x', 'include', 'included', 'complete', 'completed', 'done', 'checked']);
const excludedValues = new Set(['no', 'n', 'false', '0', '', 'skip', 'exclude', 'excluded']);
const statuses = new Set(['draft', 'in_progress', 'further_training_required', 'completed', 'cancelled']);
const results = new Set<ReviewChecklistResult>(['not_assessed', 'satisfactory', 'further_training', 'not_applicable']);

const normaliseDate = (value: string) => {
  const cleaned = value.trim();
  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const australian = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : australian
      ? { year: Number(australian[3]), month: Number(australian[2]), day: Number(australian[1]) }
      : null;
  if (!parts) return null;
  const parsed = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    parsed.getUTCFullYear() !== parts.year
    || parsed.getUTCMonth() !== parts.month - 1
    || parsed.getUTCDate() !== parts.day
  ) return null;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

const parseMinutes = (value: string) => {
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) return 0;
  const clock = cleaned.match(/^(\d{1,3}):([0-5]\d)$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const minutes = cleaned.match(/^(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?$/);
  if (minutes) return Math.round(Number(minutes[1]));
  const hours = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)?$/);
  if (!hours) return null;
  return Math.round(Number(hours[1]) * 60);
};

const parseBoolean = (value: string, defaultValue = false) => {
  if (!value.trim()) return defaultValue;
  const normalised = normaliseLookup(value);
  if (['yes', 'y', 'true', '1'].includes(normalised)) return true;
  if (['no', 'n', 'false', '0'].includes(normalised)) return false;
  return null;
};

const mergeError = (
  errors: ImportValidationResult['errors'],
  sourceRow: number,
  message: string,
) => {
  const current = errors.find(error => error.sourceRow === sourceRow);
  if (current) current.messages.push(message);
  else errors.push({ sourceRow, messages: [message] });
};

export const buildReviewChecklistTransferDefinitions = (
  course: TrainingModule,
): ReviewChecklistTransferDefinition[] => {
  const used = new Set<string>();
  return (course.reviewConfiguration?.checklist || []).map(item => {
    const base = `check_${normalisePart(item.code || item.key)}`;
    let resultColumn = `${base}_result`;
    let suffix = 2;
    while (used.has(resultColumn)) {
      resultColumn = `${base}_${suffix}_result`;
      suffix += 1;
    }
    used.add(resultColumn);
    return {
      key: item.key,
      code: item.code,
      section: item.section,
      title: item.title,
      required: item.required,
      resultColumn,
      notesColumn: resultColumn.replace(/_result$/, '_notes'),
    };
  });
};

export const getReviewTransferHeaders = (definitions: ReviewChecklistTransferDefinition[]) => [
  ...REVIEW_BASE_HEADERS,
  ...definitions.flatMap(item => [item.resultColumn, item.notesColumn]),
];

export const createReviewTransferCsv = (
  definitions: ReviewChecklistTransferDefinition[],
  rows: Array<Record<string, string>>,
) => {
  const headers = getReviewTransferHeaders(definitions);
  return `${[
    headers.map(csvCell).join(','),
    ...rows.map(row => headers.map(header => csvCell(row[header] || '')).join(',')),
  ].join('\r\n')}\r\n`;
};

export const getReviewRecordTemplate = (
  identity: CourseTransferIdentity,
  definitions: ReviewChecklistTransferDefinition[],
) => createReviewTransferCsv(definitions, [{
  include: '',
  student_portal_id: identity.studentId,
  student_name: identity.studentName,
  course: identity.course.title,
  course_version: identity.course.version,
  record_reference: '',
  status: '',
  emergency_plan_confirmed: '',
  logbook_entry_confirmed: '',
  authority_submission_confirmed: '',
  candidate_acknowledged: '',
}]);

export const getReviewChecklistGuideCsv = (
  identity: CourseTransferIdentity,
  definitions: ReviewChecklistTransferDefinition[],
) => {
  const headers = ['course', 'course_version', 'code', 'section', 'title', 'required', 'result_column', 'notes_column', 'allowed_results'];
  const rows = definitions.map(item => [
    identity.course.title,
    identity.course.version,
    item.code,
    item.section,
    item.title,
    item.required ? 'Yes' : 'No',
    item.resultColumn,
    item.notesColumn,
    'satisfactory / further_training / not_applicable / not_assessed',
  ]);
  return `${[
    headers.map(csvCell).join(','),
    ...rows.map(row => row.map(csvCell).join(',')),
  ].join('\r\n')}\r\n`;
};

export const validateReviewRecordCsv = (
  parsed: CsvParseResult,
  identity: CourseTransferIdentity,
  definitions: ReviewChecklistTransferDefinition[],
): ImportValidationResult => {
  const errors: ImportValidationResult['errors'] = [];
  const rows: NormalizedImportRow[] = [];
  const requiredHeaders = [
    'student_portal_id',
    'student_name',
    'course',
    'course_version',
    'record_reference',
    'review_date',
    'status',
    'reviewer_name',
    'ground_time',
    'flight_time',
  ];
  const missing = requiredHeaders.filter(header => !parsed.headers.includes(header));
  if (missing.length > 0) {
    return {
      rows,
      errors: [{ sourceRow: 1, messages: [`This review template is missing: ${missing.join(', ')}. Download a fresh template.`] }],
      unmatchedCourses: [],
      unmatchedLessons: [],
      unmatchedExams: [],
    };
  }

  const completionFields = REVIEW_BASE_HEADERS
    .filter(header => !['include', 'student_portal_id', 'student_name', 'course', 'course_version'].includes(header))
    .concat(definitions.flatMap(item => [item.resultColumn, item.notesColumn]));
  const includedRows = parsed.rows.filter(row => {
    const include = normaliseLookup(row.values.include || '');
    const populated = completionFields.some(field => Boolean((row.values[field] || '').trim()));
    if (include === 'skip' || include === 'exclude' || include === 'excluded') return false;
    if (includedValues.has(include)) return true;
    if (excludedValues.has(include) && populated) return true;
    if (!excludedValues.has(include)) mergeError(errors, row.sourceRow, 'Include must be Yes, No, or Skip.');
    return false;
  });
  if (includedRows.length === 0 && errors.length === 0) {
    errors.push({ sourceRow: 1, messages: ['Fill in at least one completed review row or mark Include as Yes.'] });
  }

  const references = new Map<string, number>();
  includedRows.forEach(rawRow => {
    const values = rawRow.values;
    if (values.student_portal_id !== identity.studentId) {
      mergeError(errors, rawRow.sourceRow, 'Student portal ID does not match the open Pilot File.');
    }
    if (normaliseLookup(values.course) !== normaliseLookup(identity.course.title)) {
      mergeError(errors, rawRow.sourceRow, `Course must be "${identity.course.title}".`);
    }
    if (!courseVersionsMatch(values.course_version || '', identity.course.version)) {
      mergeError(errors, rawRow.sourceRow, `Course version must be "${identity.course.version}". Download a fresh template if the template changed.`);
    }
    const reviewDate = normaliseDate(values.review_date || '');
    if (!reviewDate) mergeError(errors, rawRow.sourceRow, 'Enter a valid review_date (DD/MM/YYYY or YYYY-MM-DD).');
    const nextReviewDue = values.next_review_due ? normaliseDate(values.next_review_due) : '';
    if (values.next_review_due && !nextReviewDue) {
      mergeError(errors, rawRow.sourceRow, 'Enter a valid next_review_due date or leave it blank.');
    }
    const status = normaliseLookup(values.status || '').replaceAll(' ', '_');
    if (!statuses.has(status)) {
      mergeError(errors, rawRow.sourceRow, 'Status must be draft, in_progress, further_training_required, completed, or cancelled.');
    }
    if (!(values.reviewer_name || '').trim()) mergeError(errors, rawRow.sourceRow, 'Reviewer name is required.');
    const groundMinutes = parseMinutes(values.ground_time || '');
    const flightMinutes = parseMinutes(values.flight_time || '');
    if (groundMinutes === null) mergeError(errors, rawRow.sourceRow, 'Ground time must be hours (1.25), hours:minutes (1:15), or minutes (75m).');
    if (flightMinutes === null) mergeError(errors, rawRow.sourceRow, 'Flight time must be hours (1.25), hours:minutes (1:15), or minutes (75m).');
    if ((groundMinutes ?? 0) > 1440 || (flightMinutes ?? 0) > 1440) {
      mergeError(errors, rawRow.sourceRow, 'Ground and flight time must each be no more than 24 hours.');
    }

    const booleans = [
      ['emergency_plan_confirmed', values.emergency_plan_confirmed],
      ['logbook_entry_confirmed', values.logbook_entry_confirmed],
      ['authority_submission_confirmed', values.authority_submission_confirmed],
      ['candidate_acknowledged', values.candidate_acknowledged],
    ] as const;
    const parsedBooleans: Record<string, boolean> = {};
    booleans.forEach(([field, value]) => {
      const parsedValue = parseBoolean(value || '');
      if (parsedValue === null) mergeError(errors, rawRow.sourceRow, `${field} must be Yes or No.`);
      else parsedBooleans[field] = parsedValue;
    });

    const checklistResults = definitions.map(definition => {
      const result = normaliseLookup(values[definition.resultColumn] || '').replaceAll(' ', '_') as ReviewChecklistResult;
      if (!results.has(result)) {
        mergeError(
          errors,
          rawRow.sourceRow,
          `${definition.code} result must be satisfactory, further_training, not_applicable, or not_assessed.`,
        );
      }
      return {
        key: definition.key,
        code: definition.code,
        result,
        notes: values[definition.notesColumn] || '',
      };
    });
    if (requiresFormalReviewFindings({
      reviewStatus: status,
      checklistResults: checklistResults.map(item => item.result),
    }) && !(values.reviewer_summary || '').trim()) {
      mergeError(errors, rawRow.sourceRow, `${FORMAL_REVIEW_FINDINGS_LABEL} are required for this outcome.`);
    }
    if (status === 'completed') {
      definitions.forEach((definition, index) => {
        const result = checklistResults[index].result;
        if (definition.required && !['satisfactory', 'not_applicable'].includes(result)) {
          mergeError(errors, rawRow.sourceRow, `${definition.code} must be satisfactory or not_applicable for a completed review.`);
        }
      });
      const config = identity.course.reviewConfiguration;
      if ((config?.required_evidence.length || 0) > 0 && !(values.evidence_reference || '').trim()) {
        mergeError(errors, rawRow.sourceRow, 'Evidence reference is required for a completed review. Enter the source file, logbook entry or authority record reference.');
      }
      if (config?.requires_logbook_confirmation && !parsedBooleans.logbook_entry_confirmed) {
        mergeError(errors, rawRow.sourceRow, 'Logbook entry confirmed must be Yes for a completed review.');
      }
      if (config?.requires_authority_submission_confirmation && !parsedBooleans.authority_submission_confirmed) {
        mergeError(errors, rawRow.sourceRow, 'Authority submission confirmed must be Yes for a completed review.');
      }
      if (config?.candidate_ack_required && !parsedBooleans.candidate_acknowledged) {
        mergeError(errors, rawRow.sourceRow, 'Candidate acknowledged must be Yes for a completed review.');
      }
      const meetsMinimums = (groundMinutes ?? 0) >= (config?.minimum_ground_minutes || 0)
        && (flightMinutes ?? 0) >= (config?.minimum_flight_minutes || 0);
      if (!meetsMinimums && !(values.minimums_override_reason || '').trim()) {
        mergeError(errors, rawRow.sourceRow, 'Enter a minimums override reason when a completed review is below the configured ground or flight time.');
      }
    }

    const reference = (values.record_reference || '').trim()
      || createAutomaticRecordReference('review', identity.studentId, values);
    const referenceKey = normaliseLookup(reference);
    const earlier = references.get(referenceKey);
    if (earlier) mergeError(errors, rawRow.sourceRow, `Record reference duplicates row ${earlier}.`);
    else references.set(referenceKey, rawRow.sourceRow);

    if (!errors.some(error => error.sourceRow === rawRow.sourceRow) && reviewDate && groundMinutes !== null && flightMinutes !== null) {
      rows.push({
        source_row: rawRow.sourceRow,
        student_portal_id: identity.studentId,
        date: reviewDate,
        course_id: identity.course.id,
        course_name: identity.course.title,
        course_version: identity.course.version,
        source_reference: reference,
        status,
        instructor_name: values.reviewer_name.trim(),
        reviewer_identifier: values.reviewer_identifier || '',
        source_organisation: values.reviewer_organisation || '',
        aircraft_registration: (values.aircraft_registration || '').toUpperCase(),
        aircraft_type: values.aircraft_type || '',
        aircraft_group: values.aircraft_group || '',
        ground_time_min: groundMinutes,
        flight_time_min: flightMinutes,
        candidate_objectives: values.candidate_objectives || '',
        reviewer_summary: values.reviewer_summary || '',
        remedial_plan: values.further_training_plan || '',
        minimums_override_reason: values.minimums_override_reason || '',
        emergency_plan_confirmed: parsedBooleans.emergency_plan_confirmed,
        logbook_entry_confirmed: parsedBooleans.logbook_entry_confirmed,
        authority_submission_confirmed: parsedBooleans.authority_submission_confirmed,
        student_acknowledged: parsedBooleans.candidate_acknowledged,
        evidence_reference: values.evidence_reference || '',
        next_review_due: nextReviewDue || '',
        checklist_results: checklistResults,
        notes: values.reviewer_summary || '',
      });
    }
  });

  return {
    rows,
    errors,
    unmatchedCourses: [],
    unmatchedLessons: [],
    unmatchedExams: [],
  };
};
