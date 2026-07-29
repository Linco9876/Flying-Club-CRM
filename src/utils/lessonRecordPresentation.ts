import type { TrainingRecord } from '../types';

export interface CompactLessonRecordSummary {
  date: Date;
  aircraft: string;
  instructor: string;
  lessonName: string;
  dualHours: string;
  soloHours: string;
}

export const formatLessonRecordHours = (minutes: number) =>
  `${(Math.max(0, Number(minutes) || 0) / 60).toFixed(1)} h`;

export const shouldCompactAcknowledgedLesson = (
  record: Pick<TrainingRecord, 'studentAck'>,
  detailsExpanded: boolean,
) => Boolean(record.studentAck) && !detailsExpanded;

export const buildCompactLessonRecordSummary = ({
  record,
  instructorName,
  lessonName,
}: {
  record: Pick<
    TrainingRecord,
    'date' | 'registration' | 'aircraftType' | 'dualTimeMin' | 'soloTimeMin'
  >;
  instructorName?: string;
  lessonName?: string;
}): CompactLessonRecordSummary => ({
  date: record.date,
  aircraft: record.registration || record.aircraftType || 'Not recorded',
  instructor: instructorName || 'Not recorded',
  lessonName: lessonName || 'Lesson not recorded',
  dualHours: formatLessonRecordHours(record.dualTimeMin),
  soloHours: formatLessonRecordHours(record.soloTimeMin),
});
