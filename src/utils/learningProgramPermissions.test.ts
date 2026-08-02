import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { User } from '../types';
import { canDeleteLearningProgram } from './learningProgramPermissions.ts';

const user = (id: string, role: User['role'], roles?: User['roles']): User => ({
  id,
  email: `${id}@example.com`,
  name: id,
  role,
  roles,
});

test('administrators can delete any online program', () => {
  assert.equal(canDeleteLearningProgram(user('admin', 'admin'), { createdBy: 'creator' }), true);
  assert.equal(canDeleteLearningProgram(user('multi-role', 'instructor', ['instructor', 'admin']), { createdBy: 'creator' }), true);
});

test('program creators can delete their own online programs', () => {
  assert.equal(canDeleteLearningProgram(user('creator', 'instructor'), { createdBy: 'creator' }), true);
});

test('other staff and unsigned users cannot delete a program', () => {
  assert.equal(canDeleteLearningProgram(user('other', 'senior_instructor'), { createdBy: 'creator' }), false);
  assert.equal(canDeleteLearningProgram(null, { createdBy: 'creator' }), false);
  assert.equal(canDeleteLearningProgram(user('creator', 'instructor'), null), false);
});

test('database deletion policy independently enforces administrator or creator access', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260803090000_restrict_learning_program_deletion.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /DROP POLICY IF EXISTS "Staff manage learning programs"/);
  assert.match(migration, /FOR DELETE[\s\S]*public\.current_user_is_admin\(\)[\s\S]*created_by = \(SELECT auth\.uid\(\)\)/);
});
