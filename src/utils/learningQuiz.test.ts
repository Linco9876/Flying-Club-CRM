import assert from 'node:assert/strict';
import test from 'node:test';
import type { LearningQuestion, LearningStep, LearningStepProgress } from '../hooks/useLearningCentre';
import { gradeLearningQuiz, isLearningStepUnlocked, isQuestionAnswered } from './learningQuiz.ts';

const questions: LearningQuestion[] = [
  {
    id: 'q1',
    type: 'single_choice',
    prompt: 'Primary source?',
    options: [{ id: 'a', label: 'POH' }, { id: 'b', label: 'Forum' }],
    correctAnswer: 'a',
    required: true,
  },
  {
    id: 'q2',
    type: 'multiple_choice',
    prompt: 'Select both',
    options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
    correctAnswer: ['x', 'y'],
    required: true,
  },
];

test('grades choice answers without depending on case or multiple-choice order', () => {
  assert.deepEqual(gradeLearningQuiz(questions, { q1: 'A', q2: ['y', 'x'] }, 80), {
    scorePercent: 100,
    passingScorePercent: 80,
    passed: true,
    correctCount: 2,
    questionCount: 2,
  });
});

test('a quiz cannot pass when the score is below its configured threshold', () => {
  const result = gradeLearningQuiz(questions, { q1: 'a', q2: ['x'] }, 80);
  assert.equal(result.scorePercent, 50);
  assert.equal(result.passed, false);
});

test('required quiz questions must contain a meaningful answer', () => {
  assert.equal(isQuestionAnswered(questions[0], '   '), false);
  assert.equal(isQuestionAnswered(questions[0], 'a'), true);
  assert.equal(isQuestionAnswered(questions[1], []), false);
});

test('required earlier steps lock later work until completion', () => {
  const steps = [
    { id: 'first', sortOrder: 0, isRequired: true },
    { id: 'second', sortOrder: 1, isRequired: true },
  ] as LearningStep[];
  assert.equal(isLearningStepUnlocked(steps, [], steps[1]), false);
  assert.equal(isLearningStepUnlocked(
    steps,
    [{ stepId: 'first', status: 'completed' } as LearningStepProgress],
    steps[1],
  ), true);
});
