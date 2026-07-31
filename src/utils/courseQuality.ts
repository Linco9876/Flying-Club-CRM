import type { TrainingModule } from '../types/index.ts';

export type CourseQualityArea =
  | 'identity'
  | 'structure'
  | 'assessment'
  | 'content'
  | 'review-workflow'
  | 'transfer';

export interface CourseQualityIssue {
  area: CourseQualityArea;
  message: string;
}

const blank = (value?: string | null) => !value?.trim();
const duplicates = (values: string[]) => values.filter((value, index) => values.indexOf(value) !== index);

export const auditCourseQuality = (course: TrainingModule): CourseQualityIssue[] => {
  const issues: CourseQualityIssue[] = [];
  const add = (area: CourseQualityArea, message: string) => issues.push({ area, message });
  const purpose = course.coursePurpose || 'training';

  if (blank(course.title)) add('identity', 'Add a clear course title.');
  if (blank(course.description)) add('identity', 'Add a plain-language course description.');
  if (blank(course.category)) add('identity', 'Choose a course category.');
  if (blank(course.version)) add('identity', 'Add a course version.');

  if (purpose === 'training') {
    if (course.objectives.length === 0) add('structure', 'Add at least one measurable course objective.');
    if (course.evaluationCriteria.length === 0) add('assessment', 'Explain how course completion will be evaluated.');
    if (course.lessons.length === 0) add('structure', 'Add at least one lesson.');

    const lessonIds = course.lessons.map(lesson => lesson.id);
    const lessonCodes = course.lessons.map(lesson => lesson.sequenceCode.trim().toLocaleLowerCase()).filter(Boolean);
    if (new Set(lessonIds).size !== lessonIds.length) add('structure', 'Lesson IDs must be unique.');
    if (duplicates(lessonCodes).length > 0) add('structure', 'Lesson sequence codes must be unique.');

    course.lessons.forEach((lesson, index) => {
      const label = lesson.sequenceCode || lesson.name || `Lesson ${index + 1}`;
      if (blank(lesson.sequenceCode)) add('structure', `${label}: add a stable sequence code.`);
      if (blank(lesson.name) || blank(lesson.sequenceTitle)) add('structure', `${label}: add a readable lesson name and sequence title.`);
      if (blank(lesson.objective)) add('content', `${label}: add a measurable lesson objective.`);
      if (lesson.durationMinutes <= 0) add('structure', `${label}: duration must be greater than zero.`);
      if (lesson.keyExercises.length === 0) add('content', `${label}: add at least one key exercise.`);
      if (blank(lesson.studentPreparation)) add('content', `${label}: add student preparation guidance.`);
      if (blank(lesson.instructorNotes)) add('content', `${label}: add instructor delivery notes.`);
      if (blank(lesson.theory)) add('content', `${label}: add theory content.`);
      if (blank(lesson.flightExercises)) add('content', `${label}: add practical exercises.`);
      course.assessmentCriteria.forEach(criterion => {
        if (!(criterion.id in (lesson.passMarks || {}))) {
          add('assessment', `${label}: define the target or mark ${criterion.name} as not applicable.`);
        }
      });
    });

    const criterionIds = course.assessmentCriteria.map(criterion => criterion.id);
    const criterionNames = course.assessmentCriteria.map(criterion => criterion.name.trim().toLocaleLowerCase());
    if (new Set(criterionIds).size !== criterionIds.length) add('assessment', 'Assessment criterion IDs must be unique.');
    if (duplicates(criterionNames).length > 0) add('assessment', 'Assessment criterion names must be unique.');
    course.assessmentCriteria.forEach(criterion => {
      if (blank(criterion.id) || blank(criterion.name)) add('assessment', 'Every assessment criterion needs an ID and readable name.');
    });

    const examIds = (course.exams || []).map(exam => exam.id);
    if (new Set(examIds).size !== examIds.length) add('assessment', 'Exam IDs must be unique.');
    (course.exams || []).forEach(exam => {
      if (blank(exam.id) || blank(exam.name)) add('assessment', 'Every exam needs an ID and readable name.');
      if (!Number.isFinite(exam.passMark) || exam.passMark < 0 || exam.passMark > 100) {
        add('assessment', `${exam.name || 'Exam'}: pass mark must be between 0 and 100.`);
      }
    });

    if (course.lessons.length > 0) {
      addTransferReadinessIssues(course, issues);
    }
    return issues;
  }

  const config = course.reviewConfiguration;
  if (!config) {
    add('review-workflow', 'Add a review/test workflow configuration.');
    return issues;
  }
  if (blank(config.review_type)) add('review-workflow', 'Add a stable review type.');
  if (config.allowed_reviewer_roles.length === 0) add('review-workflow', 'Choose at least one authorised reviewer role.');
  if (config.source_documents.length === 0) add('review-workflow', 'Record at least one governing source document.');
  if (config.checklist.length === 0) add('review-workflow', 'Add at least one checklist item.');
  if (config.minimum_ground_minutes < 0 || config.minimum_flight_minutes < 0) {
    add('review-workflow', 'Minimum ground and flight time cannot be negative.');
  }
  if (config.validity_months < 0) add('review-workflow', 'Validity cannot be negative.');

  const keys = config.checklist.map(item => item.key);
  const codes = config.checklist.map(item => item.code.trim().toLocaleLowerCase());
  if (new Set(keys).size !== keys.length) add('review-workflow', 'Checklist item keys must be unique.');
  if (duplicates(codes).length > 0) add('review-workflow', 'Checklist codes must be unique.');
  config.checklist.forEach((item, index) => {
    const label = item.code || `Checklist item ${index + 1}`;
    if (blank(item.key) || blank(item.code)) add('review-workflow', `${label}: add a stable key and code.`);
    if (blank(item.section) || blank(item.title)) add('review-workflow', `${label}: add a section and readable title.`);
    if (blank(item.guidance)) add('review-workflow', `${label}: add assessment guidance.`);
  });
  addTransferReadinessIssues(course, issues);
  return issues;
};

const addTransferReadinessIssues = (
  course: TrainingModule,
  issues: CourseQualityIssue[],
) => {
  if (!course.id) issues.push({ area: 'transfer', message: 'Save the course before importing or exporting records.' });
  if (!course.version.trim()) issues.push({ area: 'transfer', message: 'A version is required for safe round-trip transfers.' });
};

export const courseIsPublicationReady = (course: TrainingModule) =>
  auditCourseQuality(course).length === 0;

export const publicationIssueSummary = (course: TrainingModule, limit = 4) => {
  const issues = auditCourseQuality(course);
  if (issues.length === 0) return '';
  const visible = issues.slice(0, limit).map(issue => issue.message).join(' ');
  return issues.length > limit ? `${visible} Plus ${issues.length - limit} more issue${issues.length - limit === 1 ? '' : 's'}.` : visible;
};
