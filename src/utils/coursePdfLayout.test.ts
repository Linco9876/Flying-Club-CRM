import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chunkPdfColumns, normalisePdfText, truncatePdfText, wrapPdfText } from './coursePdfLayout.ts';

const exportSource = readFileSync(new URL('./coursePdfExport.ts', import.meta.url), 'utf8');

const measure = (value: string) => value.length;

test('wraps every line within its measured width, including long unbroken values', () => {
  const lines = wrapPdfText('Normal text cs_test_a1bDqcdTsb9YnEzyciSgOCzi8OdOoqpDDU4WEfXgJkamCJDu4U1LRu9E5P', measure, 18);

  assert.ok(lines.length > 2);
  assert.ok(lines.every(line => measure(line) <= 18));
  assert.equal(lines.join(' ').replace(/ /g, ''), 'Normaltextcs_test_a1bDqcdTsb9YnEzyciSgOCzi8OdOoqpDDU4WEfXgJkamCJDu4U1LRu9E5P');
});

test('truncates table cells by measured width and retains an ASCII ellipsis', () => {
  const result = truncatePdfText('Circuit Consolidation and Supervised Solo', measure, 20);

  assert.ok(measure(result) <= 20);
  assert.match(result, /\.\.\.$/);
});

test('normalises typography to PDF-safe ASCII punctuation', () => {
  assert.equal(normalisePdfText('Flight\u2011test \u201ccomplete\u201d \u2022 ready\u2026'), 'Flight-test "complete" * ready...');
});

test('transliterates names and safely replaces unsupported pasted symbols', () => {
  assert.equal(normalisePdfText('Jos\u00e9 completed \u2708\ufe0f training'), 'Jose completed ? training');
});

test('splits wide progress matrices into readable column groups', () => {
  assert.deepEqual(chunkPdfColumns(Array.from({ length: 19 }, (_, index) => index + 1), 8), [
    [1, 2, 3, 4, 5, 6, 7, 8],
    [9, 10, 11, 12, 13, 14, 15, 16],
    [17, 18, 19],
  ]);
});

test('student certification requires acknowledgement of every exported record', () => {
  assert.match(
    exportSource,
    /chronologicalCourseRecords\.length > 0 &&\s*chronologicalCourseRecords\.every\(\(record\) => record\.studentAck\)/,
  );
});

test('completion totals resolve legacy lesson codes before counting lessons', () => {
  assert.match(exportSource, /const lesson = resolveLesson\(record\);\s*return lesson\?\.id \|\| record\.lessonCodes\[0\]/);
});
