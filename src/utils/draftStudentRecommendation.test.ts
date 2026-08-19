import assert from 'node:assert/strict';
import test from 'node:test';
import { getDraftStudentRecommendation } from './draftStudentRecommendation.ts';

const now = new Date('2026-08-16T03:00:00.000Z');

test('the current booked student is preferred over the next booked student', () => {
  const result = getDraftStudentRecommendation([
    { studentId: 'next-student', startTime: '2026-08-16T04:00:00.000Z', endTime: '2026-08-16T05:00:00.000Z', status: 'confirmed' },
    { studentId: 'current-student', startTime: '2026-08-16T02:30:00.000Z', endTime: '2026-08-16T03:30:00.000Z', status: 'confirmed' },
  ], ['current-student', 'next-student'], now);

  assert.deepEqual(result, { studentId: 'current-student', source: 'current' });
});

test('the next booked student is used when there is no active booking', () => {
  const result = getDraftStudentRecommendation([
    { studentId: 'later', startTime: '2026-08-16T06:00:00.000Z', endTime: '2026-08-16T07:00:00.000Z', status: 'confirmed' },
    { studentId: 'next', startTime: '2026-08-16T04:00:00.000Z', endTime: '2026-08-16T05:00:00.000Z', status: 'pending_supervision' },
  ], ['next', 'later'], now);

  assert.deepEqual(result, { studentId: 'next', source: 'next' });
});

test('cancelled, deleted, expired and unavailable students are ignored', () => {
  const result = getDraftStudentRecommendation([
    { studentId: 'cancelled', startTime: '2026-08-16T02:30:00.000Z', endTime: '2026-08-16T03:30:00.000Z', status: 'cancelled' },
    { studentId: 'archived', startTime: '2026-08-16T03:15:00.000Z', endTime: '2026-08-16T04:00:00.000Z', status: 'confirmed' },
    { studentId: 'deleted', startTime: '2026-08-16T03:30:00.000Z', endTime: '2026-08-16T04:30:00.000Z', status: 'confirmed', deletedAt: '2026-08-15T00:00:00.000Z' },
    { studentId: 'expired', startTime: '2026-08-16T01:00:00.000Z', endTime: '2026-08-16T02:00:00.000Z', status: 'completed' },
  ], ['cancelled', 'deleted', 'expired'], now);

  assert.equal(result, null);
});
