import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EXAM_ANSWER_SHEET_MAX_FILE_SIZE,
  examAnswerSheetValidationError,
  examResultDraftValidationError,
  examResultSaveFailureMessage,
} from './examResultLogging.ts';

const examLoggingMigration = readFileSync(
  new URL('../../supabase/migrations/20260805120000_harden_exam_result_logging.sql', import.meta.url),
  'utf8',
);

const examUploadPolicyMigration = readFileSync(
  new URL('../../supabase/migrations/20260805130000_restore_student_exam_upload_policies.sql', import.meta.url),
  'utf8',
);

test('exam result validation rejects missing and out-of-range scores', () => {
  const valid = { score: '82.5', examDate: '2026-08-05', passMark: 80 };

  assert.equal(examResultDraftValidationError(valid), null);
  assert.equal(examResultDraftValidationError({ ...valid, score: '' }), 'Enter the exam score');
  assert.equal(examResultDraftValidationError({ ...valid, score: '-1' }), 'Enter an exam score between 0 and 100');
  assert.equal(examResultDraftValidationError({ ...valid, score: '101' }), 'Enter an exam score between 0 and 100');
});

test('exam result validation rejects impossible dates and broken pass marks', () => {
  const valid = { score: '80', examDate: '2026-08-05', passMark: 80 };

  assert.equal(examResultDraftValidationError({ ...valid, examDate: '2026-02-30' }), 'Enter a valid exam date');
  assert.match(examResultDraftValidationError({ ...valid, passMark: 150 }) || '', /invalid pass mark/i);
});

test('answer sheet validation enforces the database bucket limit before upload', () => {
  assert.equal(examAnswerSheetValidationError({ size: 1 }), null);
  assert.equal(examAnswerSheetValidationError({ size: 0 }), 'The selected answer sheet is empty');
  assert.equal(
    examAnswerSheetValidationError({ size: EXAM_ANSWER_SHEET_MAX_FILE_SIZE + 1 }),
    'Answer sheets must be no larger than 25 MB',
  );
});

test('exam save failures provide actionable permission, relationship and network messages', () => {
  assert.match(
    examResultSaveFailureMessage({ code: '42501', message: 'new row violates row-level security' }, 'result-save'),
    /instructor access could not be verified/i,
  );
  assert.match(
    examResultSaveFailureMessage({ statusCode: 403, message: 'Unauthorized' }, 'answer-sheet-upload'),
    /could not verify your staff access/i,
  );
  assert.match(
    examResultSaveFailureMessage({ code: '23503', message: 'foreign key violation' }, 'result-save'),
    /student, course, or instructor changed/i,
  );
  assert.match(
    examResultSaveFailureMessage(new TypeError('Failed to fetch'), 'result-save'),
    /connection/i,
  );
});

test('unknown failures retain a shareable error reference without exposing database details', () => {
  const message = examResultSaveFailureMessage(
    { code: 'XX999', message: 'internal relation secret_table failed' },
    'result-save',
  );

  assert.equal(message, 'The exam result could not be saved. Refresh the page and try again (error XX999)');
  assert.doesNotMatch(message, /secret_table/);
});

test('exam insert policy uses the canonical role helper, MFA and the signed-in instructor', () => {
  assert.match(examLoggingMigration, /create policy "MFA staff can insert their student exam results"/i);
  assert.match(examLoggingMigration, /public\.current_user_has_staff_role\(\)/i);
  assert.match(examLoggingMigration, /auth\.jwt\(\)\s*->>\s*'aal'[\s\S]*?=\s*'aal2'/i);
  assert.match(examLoggingMigration, /instructor_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(examLoggingMigration, /record_origin\s*=\s*'portal'/i);
});

test('rejected and superseded answer sheets can be cleaned up only by verified staff uploaders', () => {
  assert.match(examLoggingMigration, /public\.staff_session_has_required_assurance\(\)/i);
  assert.match(examLoggingMigration, /owner_id\s*=\s*\(select auth\.uid\(\)\)::text/i);
  assert.match(examLoggingMigration, /bucket_id\s*=\s*'student-exam-uploads'/i);
});

test('exam answer-sheet storage restores every staff-only operation', () => {
  assert.match(examUploadPolicyMigration, /for select[\s\S]*?bucket_id\s*=\s*'student-exam-uploads'/i);
  assert.match(examUploadPolicyMigration, /for insert[\s\S]*?bucket_id\s*=\s*'student-exam-uploads'/i);
  assert.match(examUploadPolicyMigration, /for update[\s\S]*?bucket_id\s*=\s*'student-exam-uploads'/i);
  assert.match(examUploadPolicyMigration, /for delete[\s\S]*?bucket_id\s*=\s*'student-exam-uploads'/i);

  const staffChecks = examUploadPolicyMigration.match(/public\.current_user_has_staff_role\(\)/gi) || [];
  const assuranceChecks = examUploadPolicyMigration.match(/public\.staff_session_has_required_assurance\(\)/gi) || [];
  assert.ok(staffChecks.length >= 4, 'every operation must require a canonical staff role');
  assert.ok(assuranceChecks.length >= 4, 'every operation must require an MFA-verified staff session');
});
