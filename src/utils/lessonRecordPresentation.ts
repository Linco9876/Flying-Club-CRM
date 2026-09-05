import type { TrainingRecord } from '../types';

export interface CompactLessonRecordSummary {
  date: Date;
  aircraft: string;
  instructor: string;
  lessonName: string;
  dualHours: string;
  soloHours: string;
}

export interface OrderedLessonAssessment {
  id: string;
  label: string;
  grade: string;
}

type AssessmentCriterionDefinition = {
  id?: string;
  name?: string;
};

const hasRecordedGrade = (grade: unknown): grade is string => (
  typeof grade === 'string' && grade.length > 0 && grade !== '-'
);

/**
 * JSON object key order reflects how a record happened to be saved. Lesson cards
 * should instead use the deliberate assessment order configured on the course.
 * Unmatched historical criteria are retained at the end to avoid hiding data.
 */
export const orderLessonRecordAssessments = (
  criteriaGrades: Record<string, string> | null | undefined,
  courseCriteria: AssessmentCriterionDefinition[] | null | undefined,
): OrderedLessonAssessment[] => {
  const remainingGrades = new Map(
    Object.entries(criteriaGrades ?? {}).filter(([, grade]) => hasRecordedGrade(grade)),
  );
  const ordered: OrderedLessonAssessment[] = [];

  for (const criterion of courseCriteria ?? []) {
    const criterionId = criterion.id?.trim();
    if (!criterionId) continue;
    const grade = remainingGrades.get(criterionId);
    if (!hasRecordedGrade(grade)) continue;

    ordered.push({
      id: criterionId,
      label: criterion.name?.trim() || 'Assessment item',
      grade,
    });
    remainingGrades.delete(criterionId);
  }

  remainingGrades.forEach((grade, criterionId) => {
    ordered.push({ id: criterionId, label: 'Assessment item', grade });
  });

  return ordered;
};

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
