import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrainingModule } from '../types/index.ts';
import { createRejectedRowsCsv, parseCsv } from './studentRecordImport.ts';
import {
  buildReviewChecklistTransferDefinitions,
  createReviewTransferCsv,
  getReviewChecklistGuideCsv,
  getReviewRecordTemplate,
  validateReviewRecordCsv,
} from './studentReviewRecordTransfer.ts';

const course = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'RAAus Biennial Flight Review',
  description: 'Biennial review',
  category: 'Flight Reviews',
  version: '2.0',
  status: 'published',
  estimatedDurationHours: 2,
  prerequisites: [],
  objectives: [],
  evaluationCriteria: [],
  tags: [],
  coursePurpose: 'flight_review',
  assessmentCriteria: [],
  lessons: [],
  exams: [],
  resources: [],
  lastUpdated: new Date(),
  reviewConfiguration: {
    review_type: 'raaus_bfr',
    authority: 'raaus',
    outcome_scheme: 'completion',
    minimum_ground_minutes: 60,
    minimum_flight_minutes: 60,
    validity_months: 24,
    resets_flight_review: true,
    candidate_ack_required: true,
    allowed_reviewer_roles: ['senior_instructor'],
    required_evidence: ['logbook_entry'],
    source_documents: ['RAAus Operations Manual'],
    requires_reviewer_summary: true,
    requires_logbook_confirmation: true,
    checklist: [{
      key: 'bfr-flight',
      code: 'BFR-01',
      section: 'Flight',
      title: 'Aircraft handling',
      guidance: 'Assess safe and accurate aircraft handling.',
      required: true,
    }, {
      key: 'bfr-discussion',
      code: 'BFR-02',
      section: 'Discussion',
      title: 'Operating judgement',
      guidance: 'Discuss operational decisions.',
      required: false,
    }],
  },
} as TrainingModule;

const identity = {
  studentId: '22222222-2222-4222-8222-222222222222',
  studentName: 'Test Student',
  course,
};
const definitions = buildReviewChecklistTransferDefinitions(course);

test('review template and checklist guide contain readable version-bound columns', () => {
  const template = parseCsv(getReviewRecordTemplate(identity, definitions));
  assert.equal(template.rows.length, 1);
  assert.equal(template.rows[0].values.student_portal_id, identity.studentId);
  assert.equal(template.rows[0].values.course_version, '2.0');
  assert.ok(template.headers.includes('check_bfr_01_result'));
  assert.ok(template.headers.includes('check_bfr_01_notes'));

  const guide = parseCsv(getReviewChecklistGuideCsv(identity, definitions));
  assert.equal(guide.rows.length, 2);
  assert.equal(guide.rows[0].values.code, 'BFR-01');
  assert.match(guide.rows[0].values.allowed_results, /satisfactory/);
});

test('a completed review round-trips with checklist, evidence and acknowledgement data', () => {
  const csv = createReviewTransferCsv(definitions, [{
    include: 'Yes',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: course.title,
    course_version: course.version,
    record_reference: 'BFR-2025-01',
    review_date: '31/07/2025',
    status: 'completed',
    reviewer_name: 'Jane Reviewer',
    reviewer_identifier: 'RAAUS-123',
    reviewer_organisation: 'BFC',
    aircraft_registration: '24-1234',
    aircraft_type: 'Tecnam P92 Echo Super',
    aircraft_group: 'Group A',
    ground_time: '1:00',
    flight_time: '1.25',
    candidate_objectives: 'Refresh emergency handling',
    reviewer_summary: 'Standard demonstrated.',
    further_training_plan: '',
    minimums_override_reason: '',
    emergency_plan_confirmed: 'Yes',
    logbook_entry_confirmed: 'Yes',
    authority_submission_confirmed: 'No',
    candidate_acknowledged: 'Yes',
    evidence_reference: 'Logbook page 42',
    next_review_due: '31/07/2027',
    check_bfr_01_result: 'satisfactory',
    check_bfr_01_notes: 'Safe handling demonstrated.',
    check_bfr_02_result: 'not_applicable',
    check_bfr_02_notes: '',
  }]);
  const result = validateReviewRecordCsv(parseCsv(csv), identity, definitions);

  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].ground_time_min, 60);
  assert.equal(result.rows[0].flight_time_min, 75);
  assert.equal(result.rows[0].student_acknowledged, true);
  assert.deepEqual(result.rows[0].checklist_results, [{
    key: 'bfr-flight',
    code: 'BFR-01',
    result: 'satisfactory',
    notes: 'Safe handling demonstrated.',
  }, {
    key: 'bfr-discussion',
    code: 'BFR-02',
    result: 'not_applicable',
    notes: '',
  }]);
});

test('completed review validation enforces course minimums and completion evidence', () => {
  const invalid = createReviewTransferCsv(definitions, [{
    include: 'Yes',
    student_portal_id: identity.studentId,
    student_name: identity.studentName,
    course: course.title,
    course_version: course.version,
    review_date: '2025-07-31',
    status: 'completed',
    reviewer_name: 'Jane Reviewer',
    ground_time: '0:30',
    flight_time: '0:30',
    candidate_acknowledged: 'No',
    logbook_entry_confirmed: 'No',
    reviewer_summary: '',
    evidence_reference: '',
    check_bfr_01_result: 'further_training',
    check_bfr_02_result: 'not_assessed',
  }]);
  const result = validateReviewRecordCsv(parseCsv(invalid), identity, definitions);
  const messages = result.errors.flatMap(error => error.messages);
  assert.ok(messages.some(message => message.includes('Evidence reference')));
  assert.ok(messages.some(message => message.includes('Reviewer summary')));
  assert.ok(messages.some(message => message.includes('Logbook entry')));
  assert.ok(messages.some(message => message.includes('Candidate acknowledged')));
  assert.ok(messages.some(message => message.includes('minimums override')));
  assert.ok(messages.some(message => message.includes('BFR-01')));
});

test('review correction downloads preserve the template row and all dynamic checklist columns', () => {
  const parsed = parseCsv(getReviewRecordTemplate(identity, definitions));
  const corrected = parseCsv(createRejectedRowsCsv(parsed, [{
    sourceRow: 1,
    messages: ['Fill in at least one completed review row.'],
  }]));
  assert.equal(corrected.rows.length, 1);
  assert.equal(corrected.rows[0].values.student_name, identity.studentName);
  assert.ok(corrected.headers.includes('check_bfr_01_result'));
  assert.match(corrected.rows[0].values.problem, /completed review row/);
});
