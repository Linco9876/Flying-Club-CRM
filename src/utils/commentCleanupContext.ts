import type { TrainingLesson, TrainingModule, TrainingRecord } from '../types/index.ts';

export interface CommentCleanupContext {
  studentId?: string;
  courseId?: string;
  lessonId?: string;
  studentName?: string;
  studentProgress?: string;
  recentLessons?: string[];
  lessonName?: string;
  lessonCode?: string;
  lessonStage?: string;
  lessonObjective?: string;
  lessonCompetency?: string;
  keyExercises?: string[];
  courseName?: string;
  courseObjectives?: string[];
  assessmentResults?: string[];
  nextLesson?: string;
  aircraft?: string;
  date?: string;
  duration?: string;
}

interface TrainingCommentContextInput {
  studentId?: string;
  studentName?: string;
  course?: TrainingModule | null;
  lesson?: TrainingLesson | null;
  records?: TrainingRecord[];
  currentCriteriaGrades?: Record<string, string>;
  matrixResults?: string[];
  nextLessonName?: string;
  aircraft?: string;
  date?: string;
  durationMinutes?: number;
}

const uniqueNonEmpty = (values: Array<string | undefined>, limit: number) =>
  [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))]
    .slice(0, limit);

export const buildTrainingCommentContext = ({
  studentId,
  studentName,
  course,
  lesson,
  records = [],
  currentCriteriaGrades = {},
  matrixResults = [],
  nextLessonName,
  aircraft,
  date,
  durationMinutes,
}: TrainingCommentContextInput): CommentCleanupContext => {
  const relevantRecords = records
    .filter(record => (
      record.status !== 'draft'
      && (!studentId || record.studentId === studentId)
      && (!course?.id || record.courseId === course.id)
    ))
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const recentLessons = uniqueNonEmpty(
    relevantRecords.flatMap(record => {
      const recordLesson = course?.lessons.find(candidate => candidate.id === record.lessonId);
      return [
        recordLesson?.name || recordLesson?.sequenceTitle,
        ...(record.lessonCodes || []),
      ];
    }),
    4,
  );

  const criterionResults = (course?.assessmentCriteria || [])
    .map(criterion => {
      const grade = currentCriteriaGrades[criterion.id];
      if (!grade || grade === '-') return '';
      const target = lesson?.passMarks?.[criterion.id];
      return `${criterion.name}: ${grade}${target && target !== '-' ? ` (lesson target ${target})` : ''}`;
    })
    .filter(Boolean);

  return {
    studentId,
    courseId: course?.id,
    lessonId: lesson?.id,
    studentName,
    studentProgress: course && relevantRecords.length > 0
      ? `${relevantRecords.length} prior submitted lesson record${relevantRecords.length === 1 ? '' : 's'} in this course`
      : undefined,
    recentLessons,
    courseName: course?.title,
    courseObjectives: uniqueNonEmpty(course?.objectives || [], 5),
    lessonName: lesson?.name || lesson?.sequenceTitle,
    lessonCode: lesson?.sequenceCode,
    lessonStage: lesson?.stage,
    lessonObjective: lesson?.objective,
    lessonCompetency: lesson?.minCompetency,
    keyExercises: uniqueNonEmpty(lesson?.keyExercises || [], 8),
    assessmentResults: uniqueNonEmpty([...criterionResults, ...matrixResults], 12),
    nextLesson: nextLessonName,
    aircraft,
    date,
    duration: Number.isFinite(durationMinutes) && Number(durationMinutes) > 0
      ? `${Math.round(Number(durationMinutes))} minutes`
      : undefined,
  };
};
