import type { StudentExamResult, TrainingModule } from '../types';

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
