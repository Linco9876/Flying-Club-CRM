import type { LearningQuestion, LearningStep, LearningStepProgress } from '../hooks/useLearningCentre';

export type LearningQuizAnswers = Record<string, string | number | string[]>;

export interface LearningQuizGrade {
  scorePercent: number;
  passingScorePercent: number;
  passed: boolean;
  correctCount: number;
  questionCount: number;
}

const normalizeScalar = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase();

const normalizeMultiple = (value: unknown) => {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  return values.map(normalizeScalar).filter(Boolean).sort();
};

export const isQuestionAnswered = (question: LearningQuestion, answer: unknown) => {
  if (!question.required) return true;
  if (question.type === 'multiple_choice') return normalizeMultiple(answer).length > 0;
  return normalizeScalar(answer).length > 0;
};

export const gradeLearningQuiz = (
  questions: LearningQuestion[],
  answers: LearningQuizAnswers,
  passingScorePercent = 80,
): LearningQuizGrade => {
  const gradable = questions.filter(question =>
    question.correctAnswer !== undefined
    && ['single_choice', 'image_choice', 'multiple_choice', 'short_answer', 'number'].includes(question.type)
  );
  const correctCount = gradable.filter(question => {
    const answer = answers[question.id];
    if (question.type === 'multiple_choice') {
      return JSON.stringify(normalizeMultiple(answer)) === JSON.stringify(normalizeMultiple(question.correctAnswer));
    }
    return normalizeScalar(answer) === normalizeScalar(question.correctAnswer);
  }).length;
  const scorePercent = gradable.length === 0 ? 0 : Math.round((correctCount / gradable.length) * 100);
  return {
    scorePercent,
    passingScorePercent,
    passed: gradable.length > 0 && scorePercent >= passingScorePercent,
    correctCount,
    questionCount: gradable.length,
  };
};

export const isLearningStepUnlocked = (
  steps: LearningStep[],
  progress: LearningStepProgress[],
  step: LearningStep,
) => !steps.some(candidate =>
  candidate.isRequired
  && candidate.sortOrder < step.sortOrder
  && !progress.some(item => item.stepId === candidate.id && item.status === 'completed')
);
