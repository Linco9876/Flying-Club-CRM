export interface CourseFlightTestLessonRef {
  id: string;
  isFlightTest?: boolean;
}

export interface CourseFlightTestRecordRef {
  status: 'draft' | 'submitted' | 'locked';
  flightReviewResult?: 'pass' | 'fail' | 'not_assessed';
}

export interface CourseFlightTestCompletion {
  completedByFlightTest: boolean;
  passedFlightTestLessonIndex: number;
  inferredPassedLessonIds: Set<string>;
}

/**
 * A submitted or locked flight-test pass is the final competency decision for
 * the course. Lessons up to and including that test are therefore passed. The
 * pass is derived from the authoritative flight-test record so correcting or
 * deleting that record also corrects progress without falsifying historical
 * lesson records.
 */
export const getCourseFlightTestCompletion = <TRecord extends CourseFlightTestRecordRef>(
  lessons: CourseFlightTestLessonRef[],
  records: TRecord[],
  resolveLessonId: (record: TRecord) => string | undefined,
): CourseFlightTestCompletion => {
  const lessonIndexById = new Map(lessons.map((lesson, index) => [lesson.id, index]));
  let passedFlightTestLessonIndex = -1;

  for (const record of records) {
    if (record.status === 'draft' || record.flightReviewResult !== 'pass') continue;

    const lessonId = resolveLessonId(record);
    const lessonIndex = lessonId ? lessonIndexById.get(lessonId) : undefined;
    if (lessonIndex === undefined || !lessons[lessonIndex]?.isFlightTest) continue;

    passedFlightTestLessonIndex = Math.max(passedFlightTestLessonIndex, lessonIndex);
  }

  return {
    completedByFlightTest: passedFlightTestLessonIndex >= 0,
    passedFlightTestLessonIndex,
    inferredPassedLessonIds: new Set(
      passedFlightTestLessonIndex >= 0
        ? lessons.slice(0, passedFlightTestLessonIndex + 1).map(lesson => lesson.id)
        : [],
    ),
  };
};

export const getCourseLessonCompletionPercentage = (
  completedLessonCount: number,
  totalLessonCount: number,
  completedByFlightTest: boolean,
) => {
  if (completedByFlightTest) return 100;
  if (totalLessonCount <= 0) return 0;
  return Math.min(100, Math.round((completedLessonCount / totalLessonCount) * 100));
};
