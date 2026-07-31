import type { TrainingModule } from '../types/index.ts';
import {
  csvCell,
  formatLessonLabel,
  type CsvParseResult,
  type ImportMappingState,
  type ImportValidationResult,
  type NormalizedImportedCompetency,
  type StudentRecordImportType,
  validateStudentRecordCsv,
} from './studentRecordImport.ts';

export interface CourseCompetencyDefinition {
  id: string;
  code: string;
  description: string;
  lessonIds: string[];
  column: string;
  commentsColumn: string;
}

export interface CourseTransferIdentity {
  studentId: string;
  studentName: string;
  course: TrainingModule;
}

const LESSON_BASE_HEADERS = [
  'include',
  'student_portal_id',
  'student_name',
  'course',
  'course_version',
  'record_reference',
  'date',
  'lesson',
  'aircraft_registration',
  'aircraft_type',
  'dual_time',
  'solo_time',
  'instructor_name',
  'source_organisation',
  'comments',
  'formal_briefing',
  'next_lesson',
  'student_acknowledged',
];

const EXAM_BASE_HEADERS = [
  'include',
  'student_portal_id',
  'student_name',
  'course',
  'course_version',
  'record_reference',
  'exam_date',
  'exam',
  'score_percent',
  'pass_mark',
  'instructor_name',
  'source_organisation',
  'notes',
  'kdr_completed',
];

const normaliseLookup = (value: string) => value.trim().toLocaleLowerCase();
const normaliseVersionParts = (value: string) => {
  const cleaned = value.trim().replace(/^v(?=\d)/i, '');
  if (!/^\d+(?:\.\d+)*$/.test(cleaned)) return null;
  const parts = cleaned.split('.').map(part => Number(part));
  while (parts.length > 1 && parts.at(-1) === 0) parts.pop();
  return parts;
};

export const courseVersionsMatch = (left: string, right: string) => {
  const leftParts = normaliseVersionParts(left);
  const rightParts = normaliseVersionParts(right);
  if (!leftParts || !rightParts) return left.trim() === right.trim();
  return leftParts.length === rightParts.length
    && leftParts.every((part, index) => part === rightParts[index]);
};

const stableHash = (value: string) => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
};

export const createAutomaticRecordReference = (
  type: StudentRecordImportType,
  studentId: string,
  values: Record<string, string>,
) => {
  const fingerprint = Object.entries(values)
    .filter(([key]) => !['include', 'record_reference', 'problem'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value.trim()}`)
    .join('\u001f');
  return `${type === 'lesson' ? 'LESSON' : 'EXAM'}-AUTO-${stableHash(`${studentId}\u001e${fingerprint}`)}`;
};

const normaliseColumnPart = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'code';

const yesValues = new Set(['yes', 'y', 'true', '1', 'x', 'include', 'included', 'complete', 'completed', 'done', 'checked', '✓']);
const noValues = new Set(['no', 'n', 'false', '0', '']);
const skipValues = new Set(['skip', 'exclude', 'excluded']);

const escapeFilename = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'student';

const mergeRowError = (
  errors: ImportValidationResult['errors'],
  sourceRow: number,
  message: string,
) => {
  const existing = errors.find(error => error.sourceRow === sourceRow);
  if (existing) existing.messages.push(message);
  else errors.push({ sourceRow, messages: [message] });
};

export const buildCourseCompetencyDefinitions = (
  rows: Array<{ id: string; code: string; description?: string }>,
  requirements: Array<{ matrix_row_id: string; lesson_id?: string | null }>,
): CourseCompetencyDefinition[] => {
  const usedColumns = new Set<string>();
  return rows.map(row => {
    const base = `competency_${normaliseColumnPart(row.code)}`;
    let column = base;
    let suffix = 2;
    while (usedColumns.has(column)) {
      column = `${base}_${suffix}`;
      suffix += 1;
    }
    usedColumns.add(column);
    return {
      id: row.id,
      code: row.code,
      description: row.description || '',
      lessonIds: requirements
        .filter(requirement => requirement.matrix_row_id === row.id && requirement.lesson_id)
        .map(requirement => String(requirement.lesson_id)),
      column,
      commentsColumn: `${column}_comments`,
    };
  });
};

export const getCourseTransferHeaders = (
  type: StudentRecordImportType,
  competencies: CourseCompetencyDefinition[],
) => [
  ...(type === 'lesson' ? LESSON_BASE_HEADERS : EXAM_BASE_HEADERS),
  ...(type === 'lesson'
    ? competencies.flatMap(competency => [competency.column, competency.commentsColumn])
    : []),
];

export const createCourseTransferCsv = (
  type: StudentRecordImportType,
  competencies: CourseCompetencyDefinition[],
  rows: Array<Record<string, string>>,
) => {
  const headers = getCourseTransferHeaders(type, competencies);
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach(row => lines.push(headers.map(header => csvCell(row[header] || '')).join(',')));
  return `${lines.join('\r\n')}\r\n`;
};

export const getCourseStudentRecordTemplate = (
  type: StudentRecordImportType,
  identity: CourseTransferIdentity,
  competencies: CourseCompetencyDefinition[],
) => {
  const common = {
    include: '',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: identity.course.title,
    course_version: identity.course.version,
    record_reference: '',
  };
  const rows = type === 'lesson'
    ? identity.course.lessons.map(lesson => ({
        ...common,
        lesson: formatLessonLabel(lesson),
      }))
    : (identity.course.exams || []).map(exam => ({
        ...common,
        exam: exam.name,
        pass_mark: String(exam.passMark),
      }));
  return createCourseTransferCsv(type, competencies, rows);
};

export const getCourseCompetencyGuideCsv = (
  identity: CourseTransferIdentity,
  competencies: CourseCompetencyDefinition[],
) => {
  const headers = ['course', 'course_version', 'competency_code', 'csv_column', 'description', 'applicable_lessons', 'allowed_values'];
  const lessonNames = new Map(identity.course.lessons.map(lesson => [lesson.id, formatLessonLabel(lesson)]));
  const rows = competencies.map(competency => [
    identity.course.title,
    identity.course.version,
    competency.code,
    competency.column,
    competency.description,
    competency.lessonIds.map(lessonId => lessonNames.get(lessonId) || lessonId).join('; '),
    '1 = qualification standard; 2 = supervised solo standard; 3 = training received',
  ]);
  return `${[
    headers.map(csvCell).join(','),
    ...rows.map(row => row.map(csvCell).join(',')),
  ].join('\r\n')}\r\n`;
};

export const getCourseTransferFilename = (
  identity: CourseTransferIdentity,
  type: StudentRecordImportType,
  suffix: 'template' | 'export' | 'competency-guide',
) => {
  const student = escapeFilename(identity.studentName);
  const course = escapeFilename(identity.course.title);
  return `${student}-${course}-${type}-${suffix}.csv`;
};

export const validateCourseStudentRecordCsv = (
  parsed: CsvParseResult,
  type: StudentRecordImportType,
  identity: CourseTransferIdentity,
  competencies: CourseCompetencyDefinition[],
  mappings: ImportMappingState,
): ImportValidationResult => {
  const metadataErrors: ImportValidationResult['errors'] = [];
  const references = new Map<string, number>();
  const missingMetadataHeaders = [
    'student_portal_id',
    'student_name',
    'course',
    'course_version',
    'record_reference',
  ].filter(header => !parsed.headers.includes(header));
  if (missingMetadataHeaders.length > 0) {
    return {
      rows: [],
      errors: [{
        sourceRow: 1,
        messages: [`This course template is missing: ${missingMetadataHeaders.join(', ')}. Download a fresh template.`],
      }],
      unmatchedCourses: [],
      unmatchedLessons: [],
      unmatchedExams: [],
    };
  }

  const completionFields = type === 'lesson'
    ? [
        'record_reference',
        'date',
        'aircraft_registration',
        'aircraft_type',
        'dual_time',
        'solo_time',
        'instructor_name',
        'source_organisation',
        'comments',
        'formal_briefing',
        'next_lesson',
        'student_acknowledged',
        ...competencies.flatMap(competency => [competency.column, competency.commentsColumn]),
      ]
    : [
        'record_reference',
        'exam_date',
        'score_percent',
        'instructor_name',
        'source_organisation',
        'notes',
        'kdr_completed',
      ];
  const includedRows = parsed.rows.filter(row => {
    if (!parsed.headers.includes('include')) return true;
    const value = normaliseLookup(row.values.include || '');
    const hasCompletedDetails = completionFields.some(field => Boolean((row.values[field] || '').trim()));
    if (skipValues.has(value)) return false;
    if (yesValues.has(value)) return true;
    // Older templates filled this cell with "No". If the user has entered
    // record details, those details are a clearer signal than the untouched
    // template default. "Skip" remains available for an intentional exclusion.
    if (noValues.has(value) && hasCompletedDetails) return true;
    if (!noValues.has(value)) {
      mergeRowError(metadataErrors, row.sourceRow, 'Include must be Yes, No, or Skip.');
    }
    return false;
  });

  if (includedRows.length === 0 && metadataErrors.length === 0) {
    metadataErrors.push({
      sourceRow: 1,
      messages: ['Fill in at least one completed row or mark Include as Yes. Use Skip to omit a filled row.'],
    });
  }

  const prepared: CsvParseResult = {
    ...parsed,
    rows: includedRows.map(row => ({
      ...row,
      values: {
        ...row.values,
        source_reference: row.values.record_reference?.trim()
          || createAutomaticRecordReference(type, identity.studentId, row.values),
      },
    })),
  };
  const base = validateStudentRecordCsv(prepared, type, [identity.course], mappings);

  includedRows.forEach(rawRow => {
    const values = rawRow.values;
    if (values.student_portal_id !== identity.studentId) {
      mergeRowError(metadataErrors, rawRow.sourceRow, 'Student portal ID does not match the open Pilot File.');
    }
    if (normaliseLookup(values.course) !== normaliseLookup(identity.course.title)) {
      mergeRowError(metadataErrors, rawRow.sourceRow, `Course must be "${identity.course.title}".`);
    }
    if (!courseVersionsMatch(values.course_version, identity.course.version)) {
      mergeRowError(metadataErrors, rawRow.sourceRow, `Course version must be "${identity.course.version}". Download a fresh template if the course changed.`);
    }
    const reference = normaliseLookup(
      values.record_reference
      || createAutomaticRecordReference(type, identity.studentId, values),
    );
    const previousRow = references.get(reference);
    if (previousRow) {
      mergeRowError(metadataErrors, rawRow.sourceRow, `Record reference duplicates row ${previousRow}.`);
    } else {
      references.set(reference, rawRow.sourceRow);
    }
  });

  if (type === 'lesson') {
    base.rows.forEach(row => {
      const rawRow = includedRows.find(candidate => candidate.sourceRow === row.source_row);
      if (!rawRow) return;
      const importedCompetencies: NormalizedImportedCompetency[] = [];
      competencies.forEach(competency => {
        const rawStandard = (rawRow.values[competency.column] || '').trim();
        const rawComments = (rawRow.values[competency.commentsColumn] || '').trim();
        if (!rawStandard && !rawComments) return;
        const standard = Number(rawStandard);
        if (![1, 2, 3].includes(standard)) {
          mergeRowError(metadataErrors, rawRow.sourceRow, `${competency.code} must be 1, 2, 3, or blank.`);
          return;
        }
        if (competency.lessonIds.length > 0 && !competency.lessonIds.includes(String(row.lesson_id))) {
          mergeRowError(metadataErrors, rawRow.sourceRow, `${competency.code} is not configured for this lesson.`);
          return;
        }
        importedCompetencies.push({
          matrix_row_id: competency.id,
          code: competency.code,
          achieved_standard: standard as 1 | 2 | 3,
          comments: rawComments,
        });
      });
      row.student_portal_id = identity.studentId;
      row.course_version = identity.course.version;
      row.competencies = importedCompetencies;
    });
  } else {
    base.rows.forEach(row => {
      row.student_portal_id = identity.studentId;
      row.course_version = identity.course.version;
    });
  }

  const errors = [...base.errors];
  metadataErrors.forEach(error => error.messages.forEach(message => mergeRowError(errors, error.sourceRow, message)));
  const invalidRows = new Set(errors.filter(error => error.sourceRow > 1).map(error => error.sourceRow));

  return {
    ...base,
    rows: base.rows.filter(row => !invalidRows.has(row.source_row)),
    errors,
  };
};
