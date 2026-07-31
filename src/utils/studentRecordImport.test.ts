import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRejectedRowsCsv,
  getStudentRecordTemplate,
  parseCsv,
  validateStudentRecordCsv,
} from './studentRecordImport.ts';
import type { TrainingModule } from '../types/index.ts';
import {
  buildCourseCompetencyDefinitions,
  createCourseTransferCsv,
  getCourseStudentRecordTemplate,
  validateCourseStudentRecordCsv,
} from './studentCourseRecordTransfer.ts';

const course = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'RPC Training',
  version: '2.1',
  exams: [{ id: 'air-law', name: 'Air Law', passMark: 80 }],
  lessons: [{
    id: '22222222-2222-4222-8222-222222222222',
    sequenceCode: 'RPC-01',
    sequenceTitle: 'Effects of controls',
    name: 'Effects of Controls',
  }],
} as TrainingModule;

const emptyMappings = { courses: {}, lessons: {}, exams: {} };
const identity = {
  studentId: '33333333-3333-4333-8333-333333333333',
  studentName: 'Test Student',
  course,
};
const competencyDefinitions = buildCourseCompetencyDefinitions(
  [{ id: '44444444-4444-4444-8444-444444444444', code: 'RPC.1.1', description: 'Prepare aircraft' }],
  [{ matrix_row_id: '44444444-4444-4444-8444-444444444444', lesson_id: course.lessons[0].id }],
);

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

test('course template binds the student, course version, lessons and competency codes', () => {
  const csv = getCourseStudentRecordTemplate('lesson', identity, competencyDefinitions);
  assert.match(csv, /student_portal_id/);
  assert.match(csv, /course_version/);
  assert.match(csv, /competency_rpc_1_1/);
  assert.match(csv, /No,33333333-3333-4333-8333-333333333333,Test Student,RPC Training/);
});

test('course CSV validates and normalises competency results atomically with the lesson', () => {
  const csv = createCourseTransferCsv('lesson', competencyDefinitions, [{
    include: 'Yes',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: course.title,
    course_version: course.version,
    record_reference: 'OLD-LESSON-1',
    date: '31/07/2026',
    lesson: 'RPC-01',
    dual_time: '1:15',
    solo_time: '0',
    instructor_name: 'Jane Instructor',
    comments: 'Historical lesson',
    formal_briefing: 'No',
    student_acknowledged: 'No',
    competency_rpc_1_1: '2',
    competency_rpc_1_1_comments: 'Supervised standard demonstrated',
  }]);
  const result = validateCourseStudentRecordCsv(
    parseCsv(csv),
    'lesson',
    identity,
    competencyDefinitions,
    emptyMappings,
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].student_portal_id, identity.studentId);
  assert.equal(result.rows[0].course_version, course.version);
  assert.deepEqual(result.rows[0].competencies, [{
    matrix_row_id: competencyDefinitions[0].id,
    code: 'RPC.1.1',
    achieved_standard: 2,
    comments: 'Supervised standard demonstrated',
  }]);
});

test('course CSV ignores unused template rows and rejects identity or version drift', () => {
  const template = getCourseStudentRecordTemplate('lesson', identity, competencyDefinitions);
  const unused = validateCourseStudentRecordCsv(
    parseCsv(template),
    'lesson',
    identity,
    competencyDefinitions,
    emptyMappings,
  );
  assert.match(unused.errors[0].messages[0], /Mark Include as Yes/);

  const changed = template
    .replace(/^No,/m, 'Yes,')
    .replace(identity.studentId, '55555555-5555-4555-8555-555555555555')
    .replace(`,${course.version},`, ',99.0,');
  const invalid = validateCourseStudentRecordCsv(
    parseCsv(changed),
    'lesson',
    identity,
    competencyDefinitions,
    emptyMappings,
  );
  assert.ok(invalid.errors.some(error => error.messages.some(message => message.includes('Student portal ID'))));
  assert.ok(invalid.errors.some(error => error.messages.some(message => message.includes('Course version'))));
});

test('course CSV requires a unique stable reference for every included record', () => {
  const row = {
    include: 'Yes',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: course.title,
    course_version: course.version,
    record_reference: 'DUPLICATE-REFERENCE',
    date: '2026-07-30',
    lesson: 'RPC-01',
    dual_time: '1.0',
    solo_time: '0',
    instructor_name: 'Jane Instructor',
    comments: 'Imported record',
    formal_briefing: 'No',
    student_acknowledged: 'No',
  };
  const result = validateCourseStudentRecordCsv(
    parseCsv(createCourseTransferCsv('lesson', competencyDefinitions, [row, row])),
    'lesson',
    identity,
    competencyDefinitions,
    emptyMappings,
  );
  assert.ok(result.errors.some(error => error.messages.some(message => message.includes('duplicates row'))));
});
