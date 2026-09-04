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

const humaniseAuditKey = (value: string) => value
  .replace(/_/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\b\w/g, character => character.toUpperCase());

export const lessonRecordAuditSummary = (changes: Record<string, unknown>) => {
  const summary = changes.summary;
  if (Array.isArray(summary)) {
    return summary.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof summary === 'string' && summary.trim()) return [summary.trim()];

  return Object.keys(changes)
    .filter(key => key !== 'studentAcknowledgementRequired')
    .map(humaniseAuditKey);
};

export const shouldUseCompactLessonRecord = (
  record: Pick<TrainingRecord, 'studentAck'>,
  {
    detailsExpanded,
    requiresAcknowledgement,
    viewerCanExpand,
  }: {
    detailsExpanded: boolean;
    requiresAcknowledgement: boolean;
    viewerCanExpand: boolean;
  },
) => {
  if (record.studentAck) return !viewerCanExpand || !detailsExpanded;
  return !requiresAcknowledgement && !viewerCanExpand;
};

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
