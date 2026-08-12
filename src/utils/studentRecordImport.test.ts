import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRejectedRowsCsv,
  formatLessonLabel,
  getRecordImportCourses,
  getImportWorkflowPresentation,
  getStudentRecordTemplate,
  parseCsv,
  validateStudentRecordCsv,
  withUtf8CsvBom,
} from './studentRecordImport.ts';
import type { TrainingModule } from '../types/index.ts';
import {
  courseVersionsMatch,
  createAutomaticRecordReference,
  buildCourseCompetencyDefinitions,
  buildCourseCriterionDefinitions,
  createCourseTransferCsv,
  getCourseCompetencyGuideCsv,
  getCourseStudentRecordTemplate,
  normaliseImportedFlightTestResult,
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

test('record importer keeps review and test forms available from the full course catalogue', () => {
  const reviewCourse = {
    ...course,
    id: '55555555-5555-4555-8555-555555555555',
    title: 'RAAus Biennial Flight Review',
    coursePurpose: 'flight_review',
    status: 'published',
    lessons: [],
    exams: [],
  } as TrainingModule;
  const testCourse = {
    ...reviewCourse,
    id: '77777777-7777-4777-8777-777777777777',
    title: 'RPC Flight Test',
    coursePurpose: 'flight_test',
  } as TrainingModule;
  const draftReviewCourse = {
    ...reviewCourse,
    id: '88888888-8888-4888-8888-888888888888',
    title: 'Unfinished Review Form',
    status: 'draft',
  } as TrainingModule;

  assert.deepEqual(
    getRecordImportCourses([course, reviewCourse, testCourse, draftReviewCourse], 'review').map(item => item.id),
    [reviewCourse.id, testCourse.id],
  );
  assert.deepEqual(
    getRecordImportCourses([course, reviewCourse, testCourse], 'lesson').map(item => item.id),
    [course.id],
  );
});

test('import workflow shows the locally matched count before server preview', () => {
  assert.deepEqual(
    getImportWorkflowPresentation({ localReadyRows: 60, previewComplete: false }),
    {
      action: 'preview',
      actionLabel: 'Preview 60 records',
      title: '60 records matched',
      detail: 'Run the safe server preview before anything is imported.',
    },
  );
});

test('import workflow shows the server-approved count only after preview', () => {
  const presentation = getImportWorkflowPresentation({
    localReadyRows: 60,
    previewComplete: true,
    serverCanImport: true,
    serverReadyRows: 60,
  });

  assert.equal(presentation.action, 'import');
  assert.equal(presentation.actionLabel, 'Import 60 records');
  assert.equal(presentation.title, '60 records ready to import');
});

test('import workflow explains an all-duplicate preview instead of offering Import 0', () => {
  const presentation = getImportWorkflowPresentation({
    localReadyRows: 60,
    previewComplete: true,
    serverCanImport: true,
    serverReadyRows: 0,
    duplicateRows: 60,
  });

  assert.equal(presentation.action, 'none');
  assert.equal(presentation.actionLabel, 'Nothing new to import');
  assert.equal(presentation.title, 'All records already exist');
});
const criteriaCourse = {
  ...course,
  assessmentCriteria: [
    {
      id: 'effects-of-controls',
      name: 'Effects of Controls',
      gradingSystem: 'NC/S/C/-',
      passingGrade: 'S',
    },
    {
      id: 'landing',
      name: 'Landing',
      gradingSystem: 'NC/S/C/-',
      passingGrade: 'S',
    },
  ],
  lessons: [
    {
      ...course.lessons[0],
      passMarks: {
        'effects-of-controls': 'S',
        landing: '-',
      },
    },
  ],
} as TrainingModule;
const criteriaIdentity = { ...identity, course: criteriaCourse };
const criterionDefinitions = buildCourseCriterionDefinitions(criteriaCourse);
const flightTestCourse = {
  ...course,
  lessons: [{
    id: '66666666-6666-4666-8666-666666666666',
    sequenceCode: 'RPC-FT',
    sequenceTitle: 'Pilot Certificate Flight Test',
    name: 'Pilot Certificate Flight Test',
    isFlightTest: true,
  }],
} as TrainingModule;
const flightTestIdentity = { ...identity, course: flightTestCourse };

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
  assert.match(csv, /,33333333-3333-4333-8333-333333333333,Test Student,RPC Training/);
  assert.match(csv, /RPC-01 · Effects of Controls/);
  assert.match(csv, /flight_test_result/);
  assert.match(csv, /flight_test_findings/);
});

test('course flight-test results normalise from CSV labels and remain optional for legacy files', () => {
  assert.equal(normaliseImportedFlightTestResult('Pass'), 'pass');
  assert.equal(normaliseImportedFlightTestResult('Further training required'), 'fail');
  assert.equal(normaliseImportedFlightTestResult(''), 'not_assessed');
  assert.equal(normaliseImportedFlightTestResult('Almost passed'), null);

  const completedCsv = createCourseTransferCsv('lesson', [], [{
    include: 'Yes',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: flightTestCourse.title,
    course_version: flightTestCourse.version,
    record_reference: 'FLIGHT-TEST-1',
    date: '31/07/2026',
    lesson: 'RPC-FT',
    aircraft_registration: '24-0001',
    aircraft_type: 'Tecnam P92',
    dual_time: '1:15',
    solo_time: '0',
    instructor_name: 'Jane Examiner',
    comments: 'Historical flight test',
    formal_briefing: 'No',
    student_acknowledged: 'No',
    flight_test_result: 'Further training required',
    flight_test_findings: 'Repeat forced landing and circuit assessment.',
  }]);
  const completed = validateCourseStudentRecordCsv(
    parseCsv(completedCsv),
    'lesson',
    flightTestIdentity,
    [],
    emptyMappings,
  );
  assert.deepEqual(completed.errors, []);
  assert.equal(completed.rows[0].is_flight_review, true);
  assert.equal(completed.rows[0].flight_review_result, 'fail');
  assert.equal(completed.rows[0].flight_review_notes, 'Repeat forced landing and circuit assessment.');

  const legacyCsv = completedCsv
    .replace(',flight_test_result,flight_test_findings', '')
    .replace(',Further training required,Repeat forced landing and circuit assessment.', '');
  const legacy = validateCourseStudentRecordCsv(
    parseCsv(legacyCsv),
    'lesson',
    flightTestIdentity,
    [],
    emptyMappings,
  );
  assert.deepEqual(legacy.errors, []);
  assert.equal(legacy.rows[0].flight_review_result, 'not_assessed');
});

test('course flight-test CSV rejects an unknown result instead of guessing', () => {
  const csv = createCourseTransferCsv('lesson', [], [{
    include: 'Yes',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: flightTestCourse.title,
    course_version: flightTestCourse.version,
    record_reference: 'FLIGHT-TEST-INVALID',
    date: '31/07/2026',
    lesson: 'RPC-FT',
    dual_time: '1:00',
    solo_time: '0',
    instructor_name: 'Jane Examiner',
    comments: 'Historical flight test',
    formal_briefing: 'No',
    student_acknowledged: 'No',
    flight_test_result: 'Maybe',
  }]);
  const result = validateCourseStudentRecordCsv(
    parseCsv(csv),
    'lesson',
    flightTestIdentity,
    [],
    emptyMappings,
  );

  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.some(error => error.messages.some(message => message.includes('Flight test result'))));
});

test('course template includes the authoritative NC/S/C criteria matrix and guide', () => {
  const csv = getCourseStudentRecordTemplate('lesson', criteriaIdentity, criterionDefinitions);
  const guide = getCourseCompetencyGuideCsv(criteriaIdentity, criterionDefinitions);

  assert.match(csv, /criterion_effects_of_controls/);
  assert.match(csv, /criterion_landing/);
  assert.match(guide, /effects-of-controls/);
  assert.match(guide, /NC \/ S \/ C \/ -/);
  assert.match(guide, /RPC-01/);
});

test('course CSV normalises and validates NC/S/C grades against the selected lesson', () => {
  const csv = createCourseTransferCsv('lesson', criterionDefinitions, [{
    include: 'Yes',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: criteriaCourse.title,
    course_version: criteriaCourse.version,
    record_reference: 'CRITERIA-1',
    date: '31/07/2026',
    lesson: 'RPC-01',
    dual_time: '1:00',
    solo_time: '0',
    instructor_name: 'Jane Instructor',
    comments: 'Historical lesson',
    formal_briefing: 'No',
    student_acknowledged: 'No',
    criterion_effects_of_controls: 'nc',
  }]);
  const result = validateCourseStudentRecordCsv(
    parseCsv(csv),
    'lesson',
    criteriaIdentity,
    criterionDefinitions,
    emptyMappings,
  );

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows[0].criteria_grades, { 'effects-of-controls': 'NC' });
});

test('course CSV rejects invalid NC/S/C grades', () => {
  const csv = createCourseTransferCsv('lesson', criterionDefinitions, [{
    include: 'Yes',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: criteriaCourse.title,
    course_version: criteriaCourse.version,
    record_reference: 'CRITERIA-2',
    date: '31/07/2026',
    lesson: 'RPC-01',
    dual_time: '1:00',
    solo_time: '0',
    instructor_name: 'Jane Instructor',
    comments: 'Historical lesson',
    formal_briefing: 'No',
    student_acknowledged: 'No',
    criterion_effects_of_controls: 'Good',
    criterion_landing: 'S',
  }]);
  const result = validateCourseStudentRecordCsv(
    parseCsv(csv),
    'lesson',
    criteriaIdentity,
    criterionDefinitions,
    emptyMappings,
  );

  assert.ok(result.errors.some(error => error.messages.some(message => message.includes('must be NC, S, C, -'))));
  assert.equal(result.rows.length, 0);
});

test('course CSV preserves valid historical criteria outside the current lesson target matrix', () => {
  const csv = createCourseTransferCsv('lesson', criterionDefinitions, [{
    include: 'Yes',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: criteriaCourse.title,
    course_version: criteriaCourse.version,
    record_reference: 'HISTORICAL-CRITERIA-1',
    date: '31/07/2026',
    lesson: 'RPC-01',
    dual_time: '1:00',
    solo_time: '0',
    instructor_name: 'Jane Instructor',
    comments: 'Landing was also assessed during this historical lesson.',
    formal_briefing: 'No',
    student_acknowledged: 'No',
    criterion_effects_of_controls: 'S',
    criterion_landing: 'NC',
  }]);
  const result = validateCourseStudentRecordCsv(
    parseCsv(csv),
    'lesson',
    criteriaIdentity,
    criterionDefinitions,
    emptyMappings,
  );

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows[0].criteria_grades, {
    'effects-of-controls': 'S',
    landing: 'NC',
  });
});

test('course versions survive Excel removing insignificant decimal zeros', () => {
  assert.equal(courseVersionsMatch('1', '1.0'), true);
  assert.equal(courseVersionsMatch('v1.0.0', '1'), true);
  assert.equal(courseVersionsMatch('1.1', '1.0'), false);
  assert.equal(courseVersionsMatch('Issue 1', 'Issue 1'), true);
  assert.equal(courseVersionsMatch('Issue 1', 'Issue 2'), false);
});

test('downloaded CSV content declares UTF-8 exactly once for Excel', () => {
  const csv = 'lesson\r\nRPC-01 · Effects of Controls\r\n';
  assert.equal(withUtf8CsvBom(csv), `\uFEFF${csv}`);
  assert.equal(withUtf8CsvBom(withUtf8CsvBom(csv)), `\uFEFF${csv}`);
});

test('readable lesson labels retain the stable code and round-trip through import', () => {
  const lessonLabel = formatLessonLabel(course.lessons[0]);
  assert.equal(lessonLabel, 'RPC-01 · Effects of Controls');

  const csv = createCourseTransferCsv('lesson', competencyDefinitions, [{
    include: 'Yes',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: course.title,
    course_version: course.version,
    record_reference: 'READABLE-LESSON-1',
    date: '31/07/2026',
    lesson: lessonLabel,
    dual_time: '1:00',
    solo_time: '0',
    instructor_name: 'Jane Instructor',
    comments: 'Readable exported lesson',
    formal_briefing: 'No',
    student_acknowledged: 'No',
  }]);
  const result = validateCourseStudentRecordCsv(
    parseCsv(csv),
    'lesson',
    identity,
    competencyDefinitions,
    emptyMappings,
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].lesson_code, 'RPC-01');
  assert.equal(result.rows[0].lesson_name, 'Effects of Controls');
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
  assert.match(unused.errors[0].messages[0], /Fill in at least one completed row/);

  const changed = template
    .replace(/^,/m, 'Yes,')
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

test('filled template rows are included without making the user change the old default No cell', () => {
  const legacyFilledTemplate = createCourseTransferCsv('lesson', competencyDefinitions, [{
    include: 'No',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: course.title,
    course_version: course.version,
    record_reference: 'LEGACY-1',
    date: '31/07/2026',
    lesson: 'RPC-01',
    aircraft_registration: 'VH-EKO',
    aircraft_type: 'Tecnam P92',
    dual_time: '1:00',
    solo_time: '0',
    instructor_name: 'Jane Instructor',
    source_organisation: 'BFC',
    comments: 'Completed lesson',
    formal_briefing: 'No',
    student_acknowledged: 'No',
  }]);
  const result = validateCourseStudentRecordCsv(
    parseCsv(legacyFilledTemplate),
    'lesson',
    identity,
    competencyDefinitions,
    emptyMappings,
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].source_reference, 'LEGACY-1');
});

test('blank record references receive a stable content-based reference', () => {
  const row = {
    include: 'No',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: course.title,
    course_version: '2.1.0',
    record_reference: '',
    date: '31/07/2026',
    lesson: 'RPC-01',
    aircraft_registration: 'VH-EKO',
    aircraft_type: 'Tecnam P92',
    dual_time: '1:00',
    solo_time: '0',
    instructor_name: 'Jane Instructor',
    source_organisation: 'BFC',
    comments: 'Completed lesson without a source record number',
    formal_briefing: 'No',
    student_acknowledged: 'No',
  };
  const csv = createCourseTransferCsv('lesson', competencyDefinitions, [row]);
  const first = validateCourseStudentRecordCsv(
    parseCsv(csv),
    'lesson',
    identity,
    competencyDefinitions,
    emptyMappings,
  );
  const second = validateCourseStudentRecordCsv(
    parseCsv(csv),
    'lesson',
    identity,
    competencyDefinitions,
    emptyMappings,
  );

  assert.deepEqual(first.errors, []);
  assert.match(String(first.rows[0].source_reference), /^LESSON-AUTO-[a-f0-9]{16}$/);
  assert.equal(first.rows[0].source_reference, second.rows[0].source_reference);
  assert.equal(
    first.rows[0].source_reference,
    createAutomaticRecordReference('lesson', identity.studentId, parseCsv(csv).rows[0].values),
  );
});

test('lesson matching tolerates ampersand and punctuation changes from spreadsheets', () => {
  const csv = createCourseTransferCsv('lesson', competencyDefinitions, [{
    include: 'Yes',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: course.title,
    course_version: course.version,
    record_reference: '',
    date: '31/07/2026',
    lesson: 'Effects & Controls',
    dual_time: '1',
    solo_time: '0',
    instructor_name: 'Jane Instructor',
    comments: 'Spreadsheet-friendly lesson label',
    formal_briefing: 'No',
    student_acknowledged: 'No',
  }]);
  const result = validateCourseStudentRecordCsv(
    parseCsv(csv),
    'lesson',
    {
      ...identity,
      course: {
        ...course,
        lessons: [{ ...course.lessons[0], name: 'Effects and Controls', sequenceTitle: 'Effects and Controls' }],
      },
    },
    competencyDefinitions,
    emptyMappings,
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
});

test('Skip explicitly excludes a populated template row', () => {
  const csv = createCourseTransferCsv('lesson', competencyDefinitions, [{
    include: 'Skip',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: course.title,
    course_version: course.version,
    record_reference: 'SKIPPED-1',
    date: '31/07/2026',
    lesson: 'RPC-01',
    dual_time: '1:00',
    instructor_name: 'Jane Instructor',
    comments: 'Do not import this row',
  }]);
  const result = validateCourseStudentRecordCsv(
    parseCsv(csv),
    'lesson',
    identity,
    competencyDefinitions,
    emptyMappings,
  );

  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0].messages[0], /Fill in at least one completed row/);
});

test('file-level correction downloads preserve every original column and data row', () => {
  const parsed = parseCsv(getCourseStudentRecordTemplate('lesson', identity, competencyDefinitions));
  const rejected = createRejectedRowsCsv(parsed, [{
    sourceRow: 1,
    messages: ['Fill in at least one completed row or mark Include as Yes.'],
  }]);
  const reparsed = parseCsv(rejected);

  assert.equal(reparsed.rows.length, parsed.rows.length);
  assert.equal(reparsed.rows[0].values.student_portal_id, identity.studentId);
  assert.equal(reparsed.rows[0].values.student_name, identity.studentName);
  assert.equal(reparsed.rows[0].values.lesson, formatLessonLabel(course.lessons[0]));
  assert.match(reparsed.rows[0].values.problem, /Fill in at least one completed row/);
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
