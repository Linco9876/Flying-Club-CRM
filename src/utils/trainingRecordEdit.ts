export interface EditableLessonOption {
  id: string;
  name?: string;
  sequenceTitle?: string;
  sequenceCode?: string;
}

export const trainingLessonName = (lesson?: EditableLessonOption) =>
  lesson?.name || lesson?.sequenceTitle || lesson?.sequenceCode || 'Untitled lesson';

export const trainingLessonOptionLabel = (
  lesson: EditableLessonOption,
  selectedLessonId?: string,
) => {
  const name = trainingLessonName(lesson);
  const prefix = lesson.sequenceCode && lesson.sequenceCode !== name
    ? `${lesson.sequenceCode} — `
    : '';
  const repeat = lesson.id === selectedLessonId ? ' (repeat this lesson)' : '';
  return `${prefix}${name}${repeat}`;
};

export const defaultNextTrainingLesson = (
  lessons: EditableLessonOption[],
  selectedLessonId: string,
) => {
  const index = lessons.findIndex(lesson => lesson.id === selectedLessonId);
  if (index < 0) return '';
  return lessons[index + 1] ? trainingLessonName(lessons[index + 1]) : 'Course complete';
};

export const briefingCommentsForTrainingRecord = (
  formalBriefing: boolean,
  comments: string,
) => formalBriefing ? comments.trim() : '';
