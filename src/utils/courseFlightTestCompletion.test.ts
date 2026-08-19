import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCourseFlightTestCompletion,
  getCourseLessonCompletionPercentage,
} from './courseFlightTestCompletion.ts';

const lessons = [
  { id: 'effects-of-controls' },
  { id: 'circuits' },
  { id: 'flight-test', isFlightTest: true },
  { id: 'optional-post-test-module' },
];

test('a submitted flight-test pass satisfies every lesson up to the test', () => {
  const result = getCourseFlightTestCompletion(
    lessons,
    [{ lessonId: 'flight-test', status: 'submitted' as const, flightReviewResult: 'pass' as const }],
    record => record.lessonId,
  );

  assert.equal(result.completedByFlightTest, true);
  assert.equal(result.passedFlightTestLessonIndex, 2);
  assert.deepEqual(
    [...result.inferredPassedLessonIds],
    ['effects-of-controls', 'circuits', 'flight-test'],
  );
  assert.equal(result.inferredPassedLessonIds.has('optional-post-test-module'), false);
});

test('draft and failed flight tests do not complete the course', () => {
  for (const record of [
    { lessonId: 'flight-test', status: 'draft' as const, flightReviewResult: 'pass' as const },
    { lessonId: 'flight-test', status: 'locked' as const, flightReviewResult: 'fail' as const },
  ]) {
    const result = getCourseFlightTestCompletion(lessons, [record], item => item.lessonId);
    assert.equal(result.completedByFlightTest, false);
    assert.equal(result.inferredPassedLessonIds.size, 0);
  }
});

test('a pass on an ordinary lesson cannot be mistaken for a flight-test pass', () => {
  const result = getCourseFlightTestCompletion(
    lessons,
    [{ lessonId: 'circuits', status: 'locked' as const, flightReviewResult: 'pass' as const }],
    record => record.lessonId,
  );

  assert.equal(result.completedByFlightTest, false);
});

test('a passed flight test always makes course progress 100 percent', () => {
  assert.equal(getCourseLessonCompletionPercentage(2, 18, true), 100);
  assert.equal(getCourseLessonCompletionPercentage(9, 18, false), 50);
  assert.equal(getCourseLessonCompletionPercentage(0, 0, false), 0);
});
