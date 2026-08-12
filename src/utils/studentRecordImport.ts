import type { TrainingModule } from '../types';

export type StudentRecordImportType = 'lesson' | 'exam';
export type StudentRecordTransferType = StudentRecordImportType | 'review';

export const getRecordImportCourses = (
  courses: TrainingModule[],
  recordType: StudentRecordTransferType,
): TrainingModule[] => courses.filter(course => {
  const purpose = course.coursePurpose || 'training';
  if (recordType === 'review') {
    return ['flight_review', 'flight_test', 'proficiency_check'].includes(purpose);
  }
  if (purpose !== 'training') return false;
  return recordType === 'lesson'
    ? course.lessons.length > 0
    : Boolean(course.exams?.length);
});

export interface CsvRow {
  sourceRow: number;
  values: Record<string, string>;
}

export interface CsvParseResult {
  headers: string[];
  rows: CsvRow[];
  errors: string[];
}

export interface ImportMappingState {
  courses: Record<string, string>;
  lessons: Record<string, string>;
  exams: Record<string, string>;
}

export interface ImportWorkflowPresentation {
  action: 'preview' | 'import' | 'none';
  actionLabel: string;
  title: string;
  detail: string;
}

export const getImportWorkflowPresentation = ({
  localReadyRows,
  previewComplete,
  serverCanImport = false,
  serverReadyRows = 0,
  duplicateRows = 0,
  errorRows = 0,
}: {
  localReadyRows: number;
  previewComplete: boolean;
  serverCanImport?: boolean;
  serverReadyRows?: number;
  duplicateRows?: number;
  errorRows?: number;
}): ImportWorkflowPresentation => {
  const localRecordLabel = `${localReadyRows} record${localReadyRows === 1 ? '' : 's'}`;
  if (!previewComplete) {
    return {
      action: localReadyRows > 0 ? 'preview' : 'none',
      actionLabel: localReadyRows > 0 ? `Preview ${localRecordLabel}` : 'No records ready',
      title: localReadyRows > 0 ? `${localRecordLabel} matched` : 'No records ready',
      detail: localReadyRows > 0
        ? 'Run the safe server preview before anything is imported.'
        : 'Complete or include at least one valid row before previewing.',
    };
  }

  if (serverCanImport && serverReadyRows > 0) {
    const readyLabel = `${serverReadyRows} record${serverReadyRows === 1 ? '' : 's'}`;
    return {
      action: 'import',
      actionLabel: `Import ${readyLabel}`,
      title: `${readyLabel} ready to import`,
      detail: duplicateRows > 0
        ? `${duplicateRows} existing duplicate${duplicateRows === 1 ? '' : 's'} will be skipped.`
        : 'The server validation passed without changing any records.',
    };
  }

  if (serverCanImport && serverReadyRows === 0 && duplicateRows > 0) {
    return {
      action: 'none',
      actionLabel: 'Nothing new to import',
      title: 'All records already exist',
      detail: `${duplicateRows} duplicate record${duplicateRows === 1 ? '' : 's'} found; no changes are needed.`,
    };
  }

  return {
    action: 'none',
    actionLabel: errorRows > 0 ? 'Correct errors before importing' : 'No records ready',
    title: errorRows > 0 ? 'Server validation found a problem' : 'No records ready',
    detail: errorRows > 0
      ? `${errorRows} row${errorRows === 1 ? '' : 's'} must be corrected before importing.`
      : 'The server did not find any new records to import.',
  };
};

export interface NormalizedImportRow {
  source_row: number;
  date: string;
  course_id: string;
  course_name: string;
  instructor_name: string;
  source_organisation: string;
  source_reference: string;
  notes: string;
  course_version?: string;
  student_portal_id?: string;
  competencies?: NormalizedImportedCompetency[];
  criteria_grades?: Record<string, string>;
  [key: string]: string | number | boolean | NormalizedImportedCompetency[] | Array<Record<string, string>> | Record<string, string> | undefined;
}

export interface NormalizedImportedCompetency {
  matrix_row_id: string;
  code: string;
  achieved_standard: 1 | 2 | 3;
  comments: string;
}

export interface ImportValidationResult {
  rows: NormalizedImportRow[];
  errors: Array<{ sourceRow: number; messages: string[] }>;
  unmatchedCourses: string[];
  unmatchedLessons: Array<{ key: string; courseLabel: string; lessonLabel: string; courseId?: string }>;
  unmatchedExams: Array<{ key: string; courseLabel: string; examLabel: string; courseId?: string }>;
}

const LESSON_HEADERS = [
  'date',
  'course',
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
  'source_reference',
  'student_acknowledged',
];

const EXAM_HEADERS = [
  'exam_date',
  'course',
  'exam',
  'score_percent',
  'pass_mark',
  'instructor_name',
  'source_organisation',
  'notes',
  'kdr_completed',
  'source_reference',
];

const normaliseHeader = (value: string) => value
  .replace(/^\uFEFF/, '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

export const safeSpreadsheetCell = (value: string) => /^[=+\-@]/.test(value) ? `'${value}` : value;

export const csvCell = (value: string) => {
  const safe = safeSpreadsheetCell(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const withUtf8CsvBom = (value: string) => value.startsWith('\uFEFF') ? value : `\uFEFF${value}`;

export const getStudentRecordTemplate = (type: StudentRecordImportType) => {
  const headers = type === 'lesson' ? LESSON_HEADERS : EXAM_HEADERS;
  return `${headers.join(',')}\r\n`;
};

export const downloadStudentRecordTemplate = (type: StudentRecordImportType, studentName: string) => {
  const blob = new Blob([getStudentRecordTemplate(type)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = studentName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'student';
  link.href = url;
  link.download = `${safeName}-${type}-records-template.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

export const parseCsv = (input: string): CsvParseResult => {
  const matrix: string[][] = [];
  const errors: string[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      if (cell.length === 0) quoted = true;
      else cell += character;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      matrix.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (quoted) errors.push('The CSV contains an unclosed quoted value.');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    matrix.push(row);
  }

  const nonEmptyRows = matrix.filter(values => values.some(value => value.trim()));
  if (nonEmptyRows.length === 0) return { headers: [], rows: [], errors: ['The CSV is empty.'] };

  const headers = nonEmptyRows[0].map(normaliseHeader);
  if (headers.some(header => !header)) errors.push('Every CSV column must have a heading.');
  if (new Set(headers).size !== headers.length) errors.push('CSV headings must be unique.');

  const rows = nonEmptyRows.slice(1).map((values, index) => ({
    sourceRow: index + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, (values[column] || '').trim()])),
  }));
  if (rows.length === 0) errors.push('Add at least one record beneath the heading row.');
  if (rows.length > 500) errors.push('A single import is limited to 500 records.');

  return { headers, rows, errors };
};

const normaliseDate = (value: string) => {
  const cleaned = value.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const australian = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (iso) [, year, month, day] = iso.map(Number);
  else if (australian) [, day, month, year] = australian.map(Number);
  else return null;

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
  const normalised = value.trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(normalised)) return true;
  if (['no', 'n', 'false', '0'].includes(normalised)) return false;
  return null;
};

const normaliseLookup = (value: string) => value.trim().toLocaleLowerCase();
const normaliseLessonLookup = (value: string) => normaliseLookup(value)
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');
const mappingKey = (course: string, child: string) => `${normaliseLookup(course)}::${normaliseLookup(child)}`;

export const formatLessonLabel = (lesson: {
  sequenceCode?: string;
  sequenceTitle?: string;
  name?: string;
}) => {
  const code = lesson.sequenceCode?.trim() || '';
  const title = lesson.name?.trim() || lesson.sequenceTitle?.trim() || '';
  if (code && title && normaliseLookup(code) !== normaliseLookup(title)) return `${code} · ${title}`;
  return code || title;
};

const findCourse = (label: string, courses: TrainingModule[], mappings: ImportMappingState) => {
  const mapped = mappings.courses[normaliseLookup(label)];
  if (mapped) return courses.find(course => course.id === mapped);
  const target = normaliseLookup(label);
  return courses.find(course => course.id === label || normaliseLookup(course.title) === target);
};

const requiredHeaders = (type: StudentRecordImportType) => type === 'lesson'
  ? ['date', 'course', 'lesson', 'dual_time', 'solo_time', 'instructor_name', 'comments']
  : ['exam_date', 'course', 'exam', 'score_percent', 'pass_mark', 'instructor_name'];

export const validateStudentRecordCsv = (
  parsed: CsvParseResult,
  type: StudentRecordImportType,
  courses: TrainingModule[],
  mappings: ImportMappingState,
): ImportValidationResult => {
  const rows: NormalizedImportRow[] = [];
  const errors: ImportValidationResult['errors'] = [];
  const unmatchedCourses = new Set<string>();
  const unmatchedLessons = new Map<string, ImportValidationResult['unmatchedLessons'][number]>();
  const unmatchedExams = new Map<string, ImportValidationResult['unmatchedExams'][number]>();
  const missingHeaders = requiredHeaders(type).filter(header => !parsed.headers.includes(header));

  if (missingHeaders.length > 0) {
    errors.push({ sourceRow: 1, messages: [`Missing required column${missingHeaders.length === 1 ? '' : 's'}: ${missingHeaders.join(', ')}`] });
    return { rows, errors, unmatchedCourses: [], unmatchedLessons: [], unmatchedExams: [] };
  }

  for (const rawRow of parsed.rows) {
    const values = rawRow.values;
    const rowErrors: string[] = [];
    const courseLabel = values.course || '';
    const course = findCourse(courseLabel, courses, mappings);
    if (!course) {
      rowErrors.push(`Choose a portal course for "${courseLabel || 'blank course'}".`);
      if (courseLabel) unmatchedCourses.add(courseLabel);
    }

    const date = normaliseDate(type === 'lesson' ? values.date : values.exam_date);
    if (!date) rowErrors.push(`Enter a valid ${type === 'lesson' ? 'date' : 'exam_date'} (DD/MM/YYYY or YYYY-MM-DD).`);
    if (!values.instructor_name) rowErrors.push('Instructor name is required.');

    if (type === 'lesson') {
      const lessonLabel = values.lesson || '';
      const lessonKey = mappingKey(courseLabel, lessonLabel);
      const mappedLessonId = mappings.lessons[lessonKey];
      const lesson = course?.lessons.find(candidate =>
        candidate.id === mappedLessonId ||
        candidate.id === lessonLabel ||
        [candidate.sequenceCode, candidate.name, candidate.sequenceTitle, formatLessonLabel(candidate)]
          .some(label => normaliseLessonLookup(label) === normaliseLessonLookup(lessonLabel))
      );
      if (!lesson) {
        rowErrors.push(`Choose a portal lesson for "${lessonLabel || 'blank lesson'}".`);
        if (lessonLabel) unmatchedLessons.set(lessonKey, { key: lessonKey, courseLabel, lessonLabel, courseId: course?.id });
      }
      const dualMinutes = parseMinutes(values.dual_time || '');
      const soloMinutes = parseMinutes(values.solo_time || '');
      if (dualMinutes === null) rowErrors.push('Dual time must be hours (1.25), hours:minutes (1:15), or minutes (75m).');
      if (soloMinutes === null) rowErrors.push('Solo time must be hours (1.25), hours:minutes (1:15), or minutes (75m).');
      if ((dualMinutes ?? 0) + (soloMinutes ?? 0) <= 0) rowErrors.push('Enter some dual or solo time.');
      if ((dualMinutes ?? 0) > 1440 || (soloMinutes ?? 0) > 1440) rowErrors.push('A single lesson cannot contain more than 24 hours.');
      if (!values.comments) rowErrors.push('Comments are required.');
      const formalBriefing = parseBoolean(values.formal_briefing || '');
      const acknowledged = parseBoolean(values.student_acknowledged || '');
      if (formalBriefing === null) rowErrors.push('Formal briefing must be Yes or No.');
      if (acknowledged === null) rowErrors.push('Student acknowledged must be Yes or No.');

      if (rowErrors.length === 0 && course && lesson && date && dualMinutes !== null && soloMinutes !== null) {
        rows.push({
          source_row: rawRow.sourceRow,
          date,
          course_id: course.id,
          course_name: course.title,
          lesson_id: lesson.id,
          lesson_code: lesson.sequenceCode || lesson.name,
          lesson_name: lesson.name,
          aircraft_registration: (values.aircraft_registration || '').toUpperCase(),
          aircraft_type: values.aircraft_type || '',
          dual_time_min: dualMinutes,
          solo_time_min: soloMinutes,
          instructor_name: values.instructor_name,
          source_organisation: values.source_organisation || '',
          source_reference: values.source_reference || '',
          notes: values.comments,
          formal_briefing: Boolean(formalBriefing),
          next_lesson: values.next_lesson || '',
          student_acknowledged: Boolean(acknowledged),
        });
      }
    } else {
      const examLabel = values.exam || '';
      const examKey = mappingKey(courseLabel, examLabel);
      const mappedExamId = mappings.exams[examKey];
      const exam = course?.exams?.find(candidate =>
        candidate.id === mappedExamId ||
        candidate.id === examLabel ||
        normaliseLookup(candidate.name) === normaliseLookup(examLabel)
      );
      if (!exam) {
        rowErrors.push(`Choose a portal exam for "${examLabel || 'blank exam'}".`);
        if (examLabel) unmatchedExams.set(examKey, { key: examKey, courseLabel, examLabel, courseId: course?.id });
      }
      const score = Number(values.score_percent);
      const passMark = Number(values.pass_mark);
      if (!Number.isFinite(score) || score < 0 || score > 100) rowErrors.push('Score must be between 0 and 100.');
      if (!Number.isFinite(passMark) || passMark < 0 || passMark > 100) rowErrors.push('Pass mark must be between 0 and 100.');
      const kdrCompleted = parseBoolean(values.kdr_completed || '');
      if (kdrCompleted === null) rowErrors.push('KDR completed must be Yes or No.');

      if (rowErrors.length === 0 && course && exam && date) {
        rows.push({
          source_row: rawRow.sourceRow,
          date,
          course_id: course.id,
          course_name: course.title,
          exam_id: exam.id,
          exam_name: exam.name,
          score,
          pass_mark: passMark,
          instructor_name: values.instructor_name,
          source_organisation: values.source_organisation || '',
          source_reference: values.source_reference || '',
          notes: values.notes || '',
          kdr_completed: Boolean(kdrCompleted),
        });
      }
    }

    if (rowErrors.length > 0) errors.push({ sourceRow: rawRow.sourceRow, messages: rowErrors });
  }

  return {
    rows,
    errors,
    unmatchedCourses: [...unmatchedCourses],
    unmatchedLessons: [...unmatchedLessons.values()],
    unmatchedExams: [...unmatchedExams.values()],
  };
};

export const createRejectedRowsCsv = (
  parsed: CsvParseResult,
  rowErrors: Array<{ sourceRow: number; messages: string[] }>,
) => {
  const fileMessages = rowErrors
    .filter(error => error.sourceRow <= 1)
    .flatMap(error => error.messages);
  const messages = new Map(
    rowErrors
      .filter(error => error.sourceRow > 1)
      .map(error => [error.sourceRow, error.messages.join(' ')]),
  );
  const lines = [[...parsed.headers, 'problem'].map(csvCell).join(',')];
  for (const [index, row] of parsed.rows.entries()) {
    const rowMessage = messages.get(row.sourceRow);
    if (!rowMessage && fileMessages.length === 0) continue;
    const message = [
      ...(index === 0 ? fileMessages : []),
      ...(rowMessage ? [rowMessage] : []),
    ].join(' ');
    lines.push([...parsed.headers.map(header => row.values[header] || ''), message].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
};
