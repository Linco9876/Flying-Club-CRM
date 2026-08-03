import type { StudentExamResult, TrainingModule, TrainingRecord } from '../types';

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

export const courseExamEvidenceForExport = (
  course: TrainingModule,
  exams: StudentExamResult[],
) => {
  const definitions = course.exams || [];

  return exams
    .filter((exam) => Boolean(exam.storagePath))
    .filter((exam) => (
      exam.courseId === course.id ||
      definitions.some((definition) => (
        definition.id === exam.examId ||
        definition.name.trim().toLowerCase() === exam.examName.trim().toLowerCase()
      ))
    ))
    .sort((a, b) => b.examDate.getTime() - a.examDate.getTime());
};
