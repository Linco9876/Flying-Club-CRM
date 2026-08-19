import assert from 'node:assert/strict';
import test from 'node:test';
import type { User, UserRole } from '../types/index.ts';
import {
  canAccessUploadedExamSheets,
  examResultColumnsForViewer,
} from './examSheetAccess.ts';

const userWithRoles = (...roles: UserRole[]) => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Test User',
  email: 'test@example.com',
  role: roles[0] || 'student',
  roles,
} as User);

test('students and pilots cannot access uploaded exam sheets', () => {
  for (const user of [userWithRoles('student'), userWithRoles('pilot'), userWithRoles('student', 'pilot')]) {
    assert.equal(canAccessUploadedExamSheets(user), false);
    const columns = examResultColumnsForViewer(user);
    assert.doesNotMatch(columns, /file_name|file_type|file_size|storage_path|answer_sheet_only/);
    assert.match(columns, /exam_name/);
    assert.match(columns, /score/);
  }

  const stalePrimaryRole = userWithRoles('student');
  stalePrimaryRole.role = 'admin';
  assert.equal(canAccessUploadedExamSheets(stalePrimaryRole), false);
});

test('authorised instructional staff retain exam-sheet metadata access', () => {
  for (const role of ['admin', 'cfi', 'instructor', 'senior_instructor'] as const) {
    const user = userWithRoles(role);
    assert.equal(canAccessUploadedExamSheets(user), true);
    assert.match(examResultColumnsForViewer(user), /storage_path/);
  }
});
