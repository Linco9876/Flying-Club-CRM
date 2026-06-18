import { LessonAssessmentCriterion, TrainingLesson, TrainingModule, TrainingRecord } from '../types';

const SOLO_READY_GRADE = 'S';
const FLIGHT_TEST_READY_GRADE = 'C';

const ORDERED_GRADES = ['-', 'NC', 'S', 'C'];

const gradeRank = (grade?: string) => ORDERED_GRADES.indexOf(String(grade || '-').toUpperCase());

const isGradeAtLeast = (grade: string | undefined, target: string, criterion?: LessonAssessmentCriterion) => {
  if (!target || target === '-') return true;
  if (criterion?.gradingSystem === 'Pass or Fail') return String(grade || '').toLowerCase() === 'pass';
  if (criterion?.gradingSystem === 'Out of 100') return Number(grade) >= Number(target || 0);
  return gradeRank(grade) >= gradeRank(target);
};

const isSoloGateLesson = (lesson: TrainingLesson) =>
  /\b(first\s+)?solo\b/i.test(`${lesson.name} ${lesson.sequenceTitle} ${lesson.objective}`);

const isFlightTestGateLesson = (lesson: TrainingLesson) =>
  Boolean(lesson.isFlightTest || /flight\s*(test|review)|practice\s+flight\s+test/i.test(`${lesson.name} ${lesson.sequenceTitle}`));

const getPriorCriterionIdsForGate = (
  course: TrainingModule,
  gateLessonIndex: number,
  targetGrade: string
) => {
  const criterionIds = new Set<string>();
  course.lessons.slice(0, Math.max(0, gateLessonIndex)).forEach((lesson) => {
    Object.entries(lesson.passMarks || {}).forEach(([criterionId, passMark]) => {
      const criterion = course.assessmentCriteria.find((item) => item.id === criterionId);
      if (passMark && passMark !== '-' && isGradeAtLeast(passMark, targetGrade, criterion)) {
        criterionIds.add(criterionId);
      }
    });
  });
  return Array.from(criterionIds);
};

const countCompetencyOccasions = (
  course: TrainingModule,
  records: TrainingRecord[],
  studentId: string,
  criterionId: string,
  targetGrade: string,
  currentRecordGrades?: Record<string, string>,
  excludeRecordId?: string
) => {
  const criterion = course.assessmentCriteria.find((item) => item.id === criterionId);
  const historicalCount = records.filter((record) => {
    if (excludeRecordId && record.id === excludeRecordId) return false;
    if (record.studentId !== studentId || record.courseId !== course.id || record.status === 'draft') return false;
    return isGradeAtLeast(record.criteriaGrades?.[criterionId], targetGrade, criterion);
  }).length;

  const currentCount = currentRecordGrades && isGradeAtLeast(currentRecordGrades[criterionId], targetGrade, criterion) ? 1 : 0;
  return historicalCount + currentCount;
};

export interface TwoOccasionReadinessResult {
  blocked: boolean;
  gateType: 'solo' | 'flight_test' | null;
  targetGrade: string;
  targetLessonName: string;
  missing: Array<{ criterionId: string; name: string; count: number }>;
}

export const getTwoOccasionReadiness = ({
  course,
  records,
  studentId,
  nextLesson,
  currentRecordGrades,
  excludeRecordId,
}: {
  course?: TrainingModule | null;
  records: TrainingRecord[];
  studentId?: string | null;
  nextLesson?: TrainingLesson | null;
  currentRecordGrades?: Record<string, string>;
  excludeRecordId?: string;
}): TwoOccasionReadinessResult => {
  if (!course?.twoOccasionCompetencyRuleEnabled || !studentId || !nextLesson) {
    return { blocked: false, gateType: null, targetGrade: '', targetLessonName: '', missing: [] };
  }

  const gateType = isSoloGateLesson(nextLesson)
    ? 'solo'
    : isFlightTestGateLesson(nextLesson)
      ? 'flight_test'
      : null;

  if (!gateType) {
    return { blocked: false, gateType: null, targetGrade: '', targetLessonName: '', missing: [] };
  }

  const targetGrade = gateType === 'solo' ? SOLO_READY_GRADE : FLIGHT_TEST_READY_GRADE;
  const gateLessonIndex = course.lessons.findIndex((lesson) => lesson.id === nextLesson.id);
  const criterionIds = getPriorCriterionIdsForGate(course, gateLessonIndex, targetGrade);

  const missing = criterionIds
    .map((criterionId) => {
      const criterion = course.assessmentCriteria.find((item) => item.id === criterionId);
      const count = countCompetencyOccasions(course, records, studentId, criterionId, targetGrade, currentRecordGrades, excludeRecordId);
      return {
        criterionId,
        name: criterion?.name || criterionId,
        count,
      };
    })
    .filter((item) => item.count < 2);

  return {
    blocked: missing.length > 0,
    gateType,
    targetGrade,
    targetLessonName: nextLesson.name || nextLesson.sequenceTitle || (gateType === 'solo' ? 'first solo' : 'flight test'),
    missing,
  };
};
