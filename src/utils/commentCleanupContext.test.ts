import assert from 'node:assert/strict';
import test from 'node:test';

import type { TrainingLesson, TrainingModule, TrainingRecord } from '../types/index.ts';
import { buildTrainingCommentContext } from './commentCleanupContext.ts';

const lesson = {
  id: 'lesson-2',
  name: 'Circuits',
  sequenceTitle: 'Circuit operations',
  sequenceCode: 'RPC-07',
  stage: 'flight',
  objective: 'Fly safe and consistent circuits.',
  minCompetency: 'Practice',
  keyExercises: ['Normal circuits', 'Go-arounds'],
  passMarks: { planning: 'S' },
} as unknown as TrainingLesson;

const course = {
  id: 'course-1',
  title: 'Recreational Pilot Certificate',
  objectives: ['Operate safely in the circuit'],
  assessmentCriteria: [{
    id: 'planning',
    name: 'Circuit planning',
    gradingSystem: 'NC/S/C/-',
    passingGrade: 'S',
  }],
  lessons: [
    { ...lesson, id: 'lesson-1', name: 'Straight and Level', sequenceCode: 'RPC-01' },
    lesson,
  ],
} as TrainingModule;

const priorRecord = {
  id: 'record-1',
  studentId: 'student-1',
  courseId: course.id,
  lessonId: 'lesson-1',
  lessonCodes: ['RPC-01'],
  status: 'submitted',
  date: new Date('2026-08-01T00:00:00Z'),
} as TrainingRecord;

test('training comment context includes only relevant progress and current lesson data', () => {
  const context = buildTrainingCommentContext({
    studentId: 'student-1',
    studentName: 'Example Student',
    course,
    lesson,
    records: [
      priorRecord,
      { ...priorRecord, id: 'other-student', studentId: 'student-2' },
      { ...priorRecord, id: 'draft', status: 'draft' },
    ],
    currentCriteriaGrades: { planning: 'S' },
    matrixResults: ['Circuit spacing: achieved 2, required 2'],
    nextLessonName: 'Advanced circuits',
    aircraft: '24-8511',
    date: '2026-08-04',
    durationMinutes: 55,
  });

  assert.equal(context.studentProgress, '1 prior submitted lesson record in this course');
  assert.deepEqual(context.recentLessons, ['Straight and Level', 'RPC-01']);
  assert.equal(context.lessonObjective, 'Fly safe and consistent circuits.');
  assert.deepEqual(context.keyExercises, ['Normal circuits', 'Go-arounds']);
  assert.deepEqual(context.assessmentResults, [
    'Circuit planning: S (lesson target S)',
    'Circuit spacing: achieved 2, required 2',
  ]);
  assert.equal(context.duration, '55 minutes');
});

test('context excludes sensitive profile fields by construction', () => {
  const context = buildTrainingCommentContext({
    studentId: 'student-1',
    studentName: 'Example Student',
    course,
    lesson,
  });

  const serialised = JSON.stringify(context);
  assert.doesNotMatch(serialised, /email|phone|medical|billing|licenceNumber|emergency/i);
});
