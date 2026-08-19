import type { User } from '../types';

const EXAM_SHEET_STAFF_ROLES = ['admin', 'cfi', 'instructor', 'senior_instructor'] as const;

export const STUDENT_SAFE_EXAM_RESULT_COLUMNS = [
  'id', 'student_id', 'course_id', 'exam_id', 'exam_name', 'score', 'pass_mark', 'result',
  'exam_date', 'notes', 'instructor_id', 'created_at', 'updated_at', 'kdr_required',
  'kdr_completed', 'kdr_completion_method', 'kdr_notes', 'kdr_signed_off_by',
  'kdr_signed_off_at', 'record_origin', 'import_batch_id', 'imported_by',
  'import_source_row', 'source_instructor_name', 'source_organisation', 'source_reference',
].join(',');

export const STAFF_EXAM_RESULT_COLUMNS = [
  STUDENT_SAFE_EXAM_RESULT_COLUMNS,
  'file_name,file_type,file_size,storage_path,answer_sheet_only',
].join(',');

export const canAccessUploadedExamSheets = (user: User | null | undefined) => {
  if (!user) return false;
  const roles = user.roles?.length ? user.roles : [user.role];
  return roles.some(role =>
    EXAM_SHEET_STAFF_ROLES.includes(role as typeof EXAM_SHEET_STAFF_ROLES[number])
  );
};

export const examResultColumnsForViewer = (user: User | null | undefined) =>
  canAccessUploadedExamSheets(user)
    ? STAFF_EXAM_RESULT_COLUMNS
    : STUDENT_SAFE_EXAM_RESULT_COLUMNS;
