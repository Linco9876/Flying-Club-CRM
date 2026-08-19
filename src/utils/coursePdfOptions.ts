import type { StudentExamResult, TrainingModule, TrainingRecord, User } from '../types';

type InstructorRecord = Pick<TrainingRecord, 'instructorId' | 'sourceInstructorName'>;

export const courseRecordInstructorName = (
  record: InstructorRecord,
  users: Array<Pick<User, 'id' | 'name' | 'email'>>,
) => {
  const historicalInstructor = record.sourceInstructorName?.trim();
  if (historicalInstructor) return historicalInstructor;

  const portalInstructor = users.find((user) => user.id === record.instructorId);
  return portalInstructor?.name?.trim()
    || portalInstructor?.email?.trim()
    || 'Unknown instructor';
};

type AcknowledgementRecord = Pick<
  TrainingRecord,
  'studentAck' | 'studentAckTimestamp' | 'recordOrigin'
>;

export type CourseRecordAcknowledgementEvidence = {
  acknowledged: boolean;
  acknowledgedAt?: Date;
  historicalImport: boolean;
};

export const courseRecordAcknowledgementEvidence = (
  record: AcknowledgementRecord,
): CourseRecordAcknowledgementEvidence => {
  const acknowledgedAt = record.studentAckTimestamp instanceof Date
    && Number.isFinite(record.studentAckTimestamp.getTime())
    ? record.studentAckTimestamp
    : undefined;

  return {
    acknowledged: Boolean(record.studentAck),
    acknowledgedAt,
    historicalImport: Boolean(record.studentAck && record.recordOrigin === 'csv_import'),
  };
};

export const courseRecordAcknowledgementLabel = (
  record: AcknowledgementRecord,
  formatDate: (date: Date) => string,
) => {
  const evidence = courseRecordAcknowledgementEvidence(record);
  if (!evidence.acknowledged) return 'No';
  if (evidence.acknowledgedAt) return `Acknowledged ${formatDate(evidence.acknowledgedAt)}`;
  if (evidence.historicalImport) {
    return 'Acknowledged (historical import; date not recorded)';
  }
  return 'Acknowledged (date not recorded)';
};

export const courseExamResultsForExport = (
  course: TrainingModule,
  exams: StudentExamResult[],
) => {
  const definitions = course.exams || [];

  return exams
    .filter((exam) => (
      exam.courseId
        ? exam.courseId === course.id
        : definitions.some((definition) => (
        definition.id === exam.examId ||
        definition.name.trim().toLowerCase() === exam.examName.trim().toLowerCase()
        ))
    ))
    .sort((a, b) => b.examDate.getTime() - a.examDate.getTime());
};

export const courseExamEvidenceForExport = (
  course: TrainingModule,
  exams: StudentExamResult[],
) => courseExamResultsForExport(course, exams)
  .filter((exam) => Boolean(exam.storagePath));
