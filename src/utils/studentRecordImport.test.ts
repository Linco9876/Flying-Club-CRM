import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRejectedRowsCsv,
  getStudentRecordTemplate,
  parseCsv,
  validateStudentRecordCsv,
} from './studentRecordImport.ts';
import type { TrainingModule } from '../types/index.ts';

const course = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'RPC Training',
  exams: [{ id: 'air-law', name: 'Air Law', passMark: 80 }],
  lessons: [{
    id: '22222222-2222-4222-8222-222222222222',
    sequenceCode: 'RPC-01',
    sequenceTitle: 'Effects of controls',
    name: 'Effects of Controls',
  }],
} as TrainingModule;

const emptyMappings = { courses: {}, lessons: {}, exams: {} };

test('CSV parser handles quoted commas, escaped quotes and Australian dates', () => {
  const parsed = parseCsv(`${getStudentRecordTemplate('lesson')}31/07/2026,RPC Training,RPC-01,VH-EKO,Tecnam P92,1:15,0,Jane Instructor,BFC,"Good work, ""steady""",Yes,RPC-02,BOOK-2,No\r\n`);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0].values.comments, 'Good work, "steady"');

  const result = validateStudentRecordCsv(parsed, 'lesson', [course], emptyMappings);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].date, '2026-07-31');
  assert.equal(result.rows[0].dual_time_min, 75);
  assert.equal(result.rows[0].aircraft_registration, 'VH-EKO');
});

test('lesson validation detects unsafe or incomplete records', () => {
  const parsed = parseCsv(`${getStudentRecordTemplate('lesson')}31/02/2026,Unknown,Unknown,,,0,0,,,Maybe,,,Maybe\r\n`);
  const result = validateStudentRecordCsv(parsed, 'lesson', [course], emptyMappings);
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors[0].messages.some(message => message.includes('valid date')));
  assert.ok(result.errors[0].messages.some(message => message.includes('some dual or solo')));
  assert.deepEqual(result.unmatchedCourses, ['Unknown']);
});

test('course and lesson mappings resolve historical labels', () => {
  const parsed = parseCsv(`${getStudentRecordTemplate('lesson')}2026-07-31,Old RPC,Lesson One,,,1.25,0,Jane Instructor,Old School,Imported,No,,,No\r\n`);
  const result = validateStudentRecordCsv(parsed, 'lesson', [course], {
    courses: { 'old rpc': course.id },
    lessons: { 'old rpc::lesson one': course.lessons[0].id },
    exams: {},
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].lesson_id, course.lessons[0].id);
  assert.equal(result.rows[0].dual_time_min, 75);
});

test('exam validation maps configured exams and derives a safe normalized row', () => {
  const parsed = parseCsv(`${getStudentRecordTemplate('exam')}2026-07-30,RPC Training,Air Law,84,80,Jane Instructor,BFC,Historical result,Yes,EX-4\r\n`);
  const result = validateStudentRecordCsv(parsed, 'exam', [course], emptyMappings);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].exam_id, 'air-law');
  assert.equal(result.rows[0].score, 84);
  assert.equal(result.rows[0].kdr_completed, true);
});

test('rejected CSV protects spreadsheet formula values', () => {
  const parsed = parseCsv(`${getStudentRecordTemplate('exam')}2026-07-30,RPC Training,Unknown,84,80,=IMPORTXML(x),BFC,,,EX-4\r\n`);
  const result = validateStudentRecordCsv(parsed, 'exam', [course], emptyMappings);
  const csv = createRejectedRowsCsv(parsed, result.errors);
  assert.match(csv, /'=IMPORTXML/);
  assert.match(csv, /Choose a portal exam/);
});
