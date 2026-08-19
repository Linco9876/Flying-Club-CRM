export interface TrainingDeficiencyLessonLike {
  id: string;
  name?: string;
  sequenceTitle?: string;
  objective?: string;
  isFlightTest?: boolean;
}

export type TrainingDeficiencyGate = 'pre_solo' | 'pre_test' | null;

export const isSoloGateLesson = (lesson: TrainingDeficiencyLessonLike) =>
  /\b(first\s+)?solo\b/i.test(`${lesson.name ?? ''} ${lesson.sequenceTitle ?? ''} ${lesson.objective ?? ''}`);

export const isSoloDeficiencyGateLesson = (lesson: TrainingDeficiencyLessonLike) => {
  const title = `${lesson.name ?? ''} ${lesson.sequenceTitle ?? ''}`;
  return /\b(first\s+)?solo\b/i.test(title)
    && !/\bpre[\s-]*solo\b/i.test(title)
    && !/\bsolo[\s-]+(assessment|check|readiness)\b/i.test(title);
};

export const isFlightTestGateLesson = (lesson: TrainingDeficiencyLessonLike) =>
  Boolean(lesson.isFlightTest || /flight\s*(test|review)|practice\s+flight\s+test/i.test(`${lesson.name ?? ''} ${lesson.sequenceTitle ?? ''}`));

export const getTrainingDeficiencyGate = (lesson?: TrainingDeficiencyLessonLike | null): TrainingDeficiencyGate => {
  if (!lesson) return null;
  if (lesson.isFlightTest) return 'pre_test';
  if (isSoloDeficiencyGateLesson(lesson)) return 'pre_solo';
  return null;
};

export const getDefaultTrainingDeficiencyStage = (
  course?: { lessons: TrainingDeficiencyLessonLike[] } | null,
  lesson?: TrainingDeficiencyLessonLike | null,
): Exclude<TrainingDeficiencyGate, null> => {
  if (!course || !lesson) return 'pre_test';
  const lessonIndex = course.lessons.findIndex(item => item.id === lesson.id);
  const firstSoloIndex = course.lessons.findIndex(isSoloDeficiencyGateLesson);
  return firstSoloIndex >= 0 && lessonIndex >= 0 && lessonIndex < firstSoloIndex
    ? 'pre_solo'
    : 'pre_test';
};
