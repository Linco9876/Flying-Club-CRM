import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrainingModule } from '../types/index.ts';
import { auditCourseQuality, courseIsPublicationReady } from './courseQuality.ts';

const base = {
  id: 'course-1',
  title: 'RAAus Ab-Initio',
  description: 'Structured ab-initio training.',
  category: 'RAAus',
  version: '1.0',
  status: 'published',
  estimatedDurationHours: 25,
  prerequisites: ['Membership'],
  objectives: ['Operate safely'],
  evaluationCriteria: ['Demonstrate competency'],
  tags: [],
  assessmentCriteria: [{
    id: 'flight',
    name: 'Flight standard',
    gradingSystem: 'NC/S/C/-',
    passingGrade: 'C',
  }],
  requiresStudentAcknowledgement: true,
  lessons: [{
    id: 'lesson-1',
    sequenceId: 'sequence-1',
    sequenceCode: '1.01-3',
    sequenceTitle: 'Effects of Controls',
    stage: 'flight',
    durationMinutes: 60,
    minCompetency: 'Introduce',
    keyExercises: ['Primary and secondary effects'],
    studentPreparation: 'Read the lesson brief.',
    instructorNotes: 'Use the approved aircraft procedure.',
    name: 'Effects of Controls',
    objective: 'Control the aircraft accurately.',
    flightExercises: 'Demonstrate and practise control effects.',
    theory: 'Aerodynamic control principles.',
    assessmentCriteria: [],
    passMarks: { flight: 'S' },
  }],
  exams: [{ id: 'air-law', name: 'Air Law', passMark: 80 }],
  resources: [],
  lastUpdated: new Date(),
} as TrainingModule;

test('a complete training course is publication and transfer ready', () => {
  assert.deepEqual(auditCourseQuality(base), []);
  assert.equal(courseIsPublicationReady(base), true);
});

test('publication audit identifies incomplete lesson content and transfer metadata', () => {
  const broken = {
    ...base,
    version: '',
    lessons: [{ ...base.lessons[0], objective: '', keyExercises: [], passMarks: {} }],
  };
  const messages = auditCourseQuality(broken).map(issue => issue.message);
  assert.ok(messages.some(message => message.includes('course version')));
  assert.ok(messages.some(message => message.includes('measurable lesson objective')));
  assert.ok(messages.some(message => message.includes('key exercise')));
  assert.ok(messages.some(message => message.includes('define the target')));
});

test('a complete review/test template is publication and CSV-transfer ready', () => {
  const review = {
    ...base,
    id: 'review-1',
    title: 'RAAus Biennial Flight Review',
    coursePurpose: 'flight_review',
    objectives: [],
    evaluationCriteria: [],
    lessons: [],
    exams: [],
    assessmentCriteria: [],
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
      checklist: [{
        key: 'bfr-flight',
        code: 'BFR-01',
        section: 'Flight',
        title: 'Aircraft handling',
        guidance: 'Assess safe and accurate aircraft handling.',
        required: true,
      }],
    },
  } as TrainingModule;
  assert.deepEqual(auditCourseQuality(review), []);
});
