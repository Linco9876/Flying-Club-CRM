import assert from 'node:assert/strict';
import test from 'node:test';

import {
  briefingCommentsForTrainingRecord,
  defaultNextTrainingLesson,
  trainingLessonOptionLabel,
} from './trainingRecordEdit.ts';

const lessons = [
  { id: 'lesson-1', sequenceCode: '1.01-1', name: 'Effects of controls' },
  { id: 'lesson-2', sequenceCode: '1.01-2', name: 'Straight and level' },
];

test('lesson dropdown labels include readable codes and identify a repeat selection', () => {
  assert.equal(
    trainingLessonOptionLabel(lessons[0], 'lesson-1'),
    '1.01-1 — Effects of controls (repeat this lesson)',
  );
});

test('changing the recorded lesson recommends the following course lesson', () => {
  assert.equal(defaultNextTrainingLesson(lessons, 'lesson-1'), 'Straight and level');
  assert.equal(defaultNextTrainingLesson(lessons, 'lesson-2'), 'Course complete');
  assert.equal(defaultNextTrainingLesson(lessons, 'missing'), '');
});

test('hidden briefing comments cannot remain on a non-formal record', () => {
  assert.equal(briefingCommentsForTrainingRecord(false, 'Old briefing notes'), '');
  assert.equal(briefingCommentsForTrainingRecord(true, '  Useful notes  '), 'Useful notes');
});
