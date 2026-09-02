import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../components/Training/TrainingCourseCatalog.tsx', import.meta.url),
  'utf8',
);

test('lesson create and edit flows open in a focused dialog', () => {
  assert.match(source, /aria-labelledby="lesson-editor-title"/);
  assert.match(source, /fixed inset-0 z-\[65\]/);
  assert.match(source, /onClick=\{\(\) => handleEditLesson\(lesson\)\}/);
  assert.match(source, /max-h-\[calc\(100vh-1rem\)\]/);
  assert.match(source, /sticky bottom-0/);
});

test('assessment and exam criteria are available from compact popup buttons', () => {
  assert.match(source, /setCourseReferenceModal\('assessment'\)/);
  assert.match(source, /setCourseReferenceModal\('exams'\)/);
  assert.match(source, /course-reference-modal-title/);
  assert.match(source, />Assessment criteria</);
  assert.match(source, />Exam criteria</);
  assert.match(source, /Edit \{courseReferenceModal === 'assessment' \? 'assessment criteria' : 'exam criteria'\}/);
});

test('lesson cards retain essential metadata in their compact state', () => {
  assert.match(source, /lesson\.durationMinutes \|\| 60\} min/);
  assert.match(source, /lessonCriteriaCount/);
  assert.match(source, /study files/);
  assert.match(source, /line-clamp-1 text-sm/);
});
