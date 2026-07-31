import type { TrainingModule } from '../types/index.ts';
import {
  csvCell,
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
const normaliseColumnPart = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'code';

const yesValues = new Set(['yes', 'y', 'true', '1']);
const noValues = new Set(['no', 'n', 'false', '0', '']);

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
    include: 'No',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: identity.course.title,
    course_version: identity.course.version,
    record_reference: '',
  };
  const rows = type === 'lesson'
    ? identity.course.lessons.map(lesson => ({
        ...common,
        lesson: lesson.sequenceCode || lesson.name,
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
  const lessonNames = new Map(identity.course.lessons.map(lesson => [lesson.id, lesson.sequenceCode || lesson.name]));
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

  const includedRows = parsed.rows.filter(row => {
    if (!parsed.headers.includes('include')) return true;
    const value = normaliseLookup(row.values.include || '');
    if (yesValues.has(value)) return true;
    if (!noValues.has(value)) {
      mergeRowError(metadataErrors, row.sourceRow, 'Include must be Yes or No.');
    }
    return false;
  });

  if (includedRows.length === 0 && metadataErrors.length === 0) {
    metadataErrors.push({ sourceRow: 1, messages: ['Mark Include as Yes for at least one completed row.'] });
  }

  const prepared: CsvParseResult = {
    ...parsed,
    rows: includedRows.map(row => ({
      ...row,
      values: {
        ...row.values,
        source_reference: row.values.record_reference || '',
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
    if (values.course_version.trim() !== identity.course.version.trim()) {
      mergeRowError(metadataErrors, rawRow.sourceRow, `Course version must be "${identity.course.version}". Download a fresh template if the course changed.`);
    }
    if (!values.record_reference.trim()) {
      mergeRowError(metadataErrors, rawRow.sourceRow, 'Record reference is required and must identify this lesson or exam uniquely.');
    } else {
      const reference = normaliseLookup(values.record_reference);
      const previousRow = references.get(reference);
      if (previousRow) {
        mergeRowError(metadataErrors, rawRow.sourceRow, `Record reference duplicates row ${previousRow}.`);
      } else {
        references.set(reference, rawRow.sourceRow);
      }
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
