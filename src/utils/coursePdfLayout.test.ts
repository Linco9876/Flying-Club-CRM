import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  calculateCourseProgressMatrixLayout,
  chunkPdfColumns,
  criterionCode,
  normalisePdfText,
  truncatePdfText,
  wrapPdfText,
} from './coursePdfLayout.ts';
import {
  courseExamEvidenceForExport,
  courseRecordAcknowledgementEvidence,
  courseRecordAcknowledgementLabel,
} from './coursePdfOptions.ts';

const exportSource = readFileSync(new URL('./coursePdfExport.ts', import.meta.url), 'utf8');
const studentProfileSource = readFileSync(new URL('../components/Students/StudentProfilePage.tsx', import.meta.url), 'utf8');

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

test('fits the RAAus 20-column assessment matrix on one landscape row', () => {
  const layout = calculateCourseProgressMatrixLayout(842, 34, 20);
  const fixedWidth = layout.coreWidths.reduce((sum, width) => sum + width, 0) + layout.timeColumnWidth * 2;
  const criterionWidth = (842 - 34 * 2 - fixedWidth) / 20;

  assert.equal(layout.columnsPerGroup, 20);
  assert.equal(layout.compact, true);
  assert.ok(criterionWidth >= 18);
});

test('uses distinct one-row matrix codes for landing and forced landing', () => {
  assert.equal(criterionCode('Landing', 0), 'LD');
  assert.equal(criterionCode('Forced Landings', 1), 'FL');
});

test('retains readable assessment widths by splitting only when one row cannot fit', () => {
  const layout = calculateCourseProgressMatrixLayout(842, 34, 30);

  assert.ok(layout.columnsPerGroup < 30);
  assert.ok(layout.columnsPerGroup >= 20);
});

test('exam evidence prompt uses only uploaded files belonging to the selected course', () => {
  const course = {
    id: 'course-rpc',
    exams: [{ id: 'exam-air-law', name: 'Air Law', passMark: 80 }],
  } as any;
  const exam = (overrides: Record<string, unknown>) => ({
    id: 'result-1',
    studentId: 'student-1',
    examId: 'exam-air-law',
    examName: 'Air Law',
    score: 90,
    passMark: 80,
    result: 'pass',
    examDate: new Date('2026-07-01'),
    notes: '',
    createdAt: new Date('2026-07-01'),
    ...overrides,
  }) as any;

  const evidence = courseExamEvidenceForExport(course, [
    exam({ id: 'direct', courseId: 'course-rpc', storagePath: 'direct.pdf' }),
    exam({ id: 'legacy-name', courseId: undefined, examId: 'legacy', storagePath: 'legacy.pdf' }),
    exam({ id: 'no-file', courseId: 'course-rpc', storagePath: undefined }),
    exam({ id: 'other-course', courseId: 'course-other', examId: 'other', examName: 'Other', storagePath: 'other.pdf' }),
  ]);

  assert.deepEqual(evidence.map(item => item.id), ['direct', 'legacy-name']);
});

test('student declaration is deliberately rendered before details without a page-breaking paragraph', () => {
  const declarationIndex = exportSource.indexOf("drawSectionTitle(course.flyingDeclarationTitle || 'Flying Declaration')");
  const detailsIndex = exportSource.indexOf("drawSectionTitle(isStructuredAviationCourse ? 'Student and Course Details' : 'Details')");

  assert.ok(declarationIndex >= 0 && declarationIndex < detailsIndex);
  assert.match(exportSource, /drawFirstPageDeclarationWording\(/);
  assert.doesNotMatch(exportSource, /const declarationRows:/);
});

test('staff are asked before uploaded exam evidence is attached', () => {
  assert.match(studentProfileSource, /Attach exam evidence\?/);
  assert.match(studentProfileSource, /Export without evidence/);
  assert.match(studentProfileSource, /Attach evidence and export/);
  assert.match(studentProfileSource, /includeExamSheets: includeExamEvidence && canAccessExamSheets/);
});

test('student certification requires acknowledgement of every exported record', () => {
  assert.match(
    exportSource,
    /chronologicalCourseRecords\.length > 0 &&\s*acknowledgementEvidence\.every\(\(\{ evidence \}\) => evidence\.acknowledged\)/,
  );
});

test('historical imported acknowledgements remain explicit when no timestamp was imported', () => {
  const importedRecord = {
    studentAck: true,
    studentAckTimestamp: undefined,
    recordOrigin: 'csv_import',
  } as const;

  assert.deepEqual(courseRecordAcknowledgementEvidence(importedRecord), {
    acknowledged: true,
    acknowledgedAt: undefined,
    historicalImport: true,
  });
  assert.equal(
    courseRecordAcknowledgementLabel(importedRecord, () => 'unused'),
    'Acknowledged (historical import; date not recorded)',
  );
  assert.match(exportSource, /Student acknowledgement status/);
  assert.match(exportSource, /status evidence rather than a timestamped portal signature/);
});

test('timestamped portal acknowledgements retain their recorded date', () => {
  const acknowledgedAt = new Date('2026-07-31T09:15:00+10:00');
  const label = courseRecordAcknowledgementLabel({
    studentAck: true,
    studentAckTimestamp: acknowledgedAt,
    recordOrigin: 'portal',
  }, date => date === acknowledgedAt ? '31 Jul 2026' : 'wrong date');

  assert.equal(label, 'Acknowledged 31 Jul 2026');
});

test('records that were not acknowledged still say No', () => {
  assert.equal(courseRecordAcknowledgementLabel({
    studentAck: false,
    studentAckTimestamp: undefined,
    recordOrigin: 'csv_import',
  }, () => 'unused'), 'No');
});

test('completion totals resolve legacy lesson codes before counting lessons', () => {
  assert.match(exportSource, /const lesson = resolveLesson\(record\);\s*return lesson\?\.id \|\| record\.lessonCodes\[0\]/);
});
