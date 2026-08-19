import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  STUDENT_DOCUMENT_MAX_FILE_SIZE,
  studentDocumentUploadFailureMessage,
  studentDocumentValidationError,
} from './studentDocumentUpload.ts';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260811100000_restore_student_document_storage_policies.sql', import.meta.url),
  'utf8',
);
const folderDepthFixMigration = readFileSync(
  new URL('../../supabase/migrations/20260811103000_fix_student_document_folder_depth.sql', import.meta.url),
  'utf8',
);
const documentComponent = readFileSync(
  new URL('../components/Students/StudentDocumentsTab.tsx', import.meta.url),
  'utf8',
);

test('student document uploads validate empty and oversized files before storage', () => {
  assert.equal(studentDocumentValidationError(null), 'Choose a document to upload');
  assert.equal(studentDocumentValidationError({ name: 'empty.pdf', size: 0 }), 'The selected document is empty');
  assert.equal(
    studentDocumentValidationError({ name: 'large.pdf', size: STUDENT_DOCUMENT_MAX_FILE_SIZE + 1 }),
    'Documents must be no larger than 25 MB',
  );
  assert.equal(studentDocumentValidationError({ name: 'declaration.avif', size: 1024 }), null);
});

test('student document failures are actionable without exposing database policy wording', () => {
  const accessMessage = studentDocumentUploadFailureMessage({
    code: '42501',
    message: 'new row violates row-level security policy',
    statusCode: 400,
  });
  assert.match(accessMessage, /verify your account access/i);
  assert.doesNotMatch(accessMessage, /row-level|policy|database/i);
  assert.match(studentDocumentUploadFailureMessage({ statusCode: 413 }), /25 MB/);
  assert.match(studentDocumentUploadFailureMessage(new Error('Failed to fetch')), /connection/i);
});

test('private student document policies restore staff MFA and self-folder access', () => {
  for (const operation of ['select', 'insert', 'delete']) {
    assert.match(migration, new RegExp(`for ${operation}[\\s\\S]+bucket_id = 'student-documents'`, 'i'));
  }
  assert.match(migration, /current_user_has_staff_role\(\)[\s\S]+staff_session_has_required_assurance\(\)/i);
  assert.match(migration, /current_user_has_full_portal_access\(\)[\s\S]+foldername\(name\)\)\[1\]/i);
  assert.doesNotMatch(migration, /to\s+anon/i);
  assert.doesNotMatch(migration, /using\s*\(\s*true\s*\)/i);
});

test('valid one-folder storage paths are accepted by the final upload policy', () => {
  assert.match(folderDepthFixMigration, /foldername\(name\)\)\[1\] is not null/i);
  assert.doesNotMatch(folderDepthFixMigration, /array_length\s*\(/i);
  assert.match(folderDepthFixMigration, /current_user_has_staff_role\(\)/i);
  assert.match(folderDepthFixMigration, /foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/i);
});

test('the upload form confirms the selected file before submission', () => {
  assert.match(documentComponent, /Ready to upload/);
  assert.match(documentComponent, /selectedFile\.name/);
  assert.match(documentComponent, /formatSize\(selectedFile\.size\)/);
  assert.match(documentComponent, /Click to replace this file/);
  assert.match(documentComponent, /Remove selected file/);
  assert.match(documentComponent, /disabled=\{uploading \|\| !selectedFile\}/);
  assert.match(documentComponent, /aria-live="polite"/);
});
