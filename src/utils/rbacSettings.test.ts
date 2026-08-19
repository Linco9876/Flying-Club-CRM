import assert from 'node:assert/strict';
import test from 'node:test';
import type { User, UserRole } from '../types';
import { canEditSettingsSection, getAuthorizedSettingsSections } from './rbac.ts';

const userWithRoles = (...roles: UserRole[]) => ({
  id: 'settings-test-user',
  role: roles[0],
  roles,
}) as User;

test('admins can see and edit every settings section', () => {
  const admin = userWithRoles('admin');
  const sections = getAuthorizedSettingsSections(admin);

  assert.ok(sections.length > 20);
  assert.ok(sections.every(({ id }) => canEditSettingsSection(admin, id)));
});

test('instructors can edit roster and personal settings but only view shared operational settings', () => {
  const instructor = userWithRoles('instructor');
  const visibleIds = getAuthorizedSettingsSections(instructor).map(({ id }) => id);

  assert.ok(visibleIds.includes('roster'));
  assert.ok(visibleIds.includes('training'));
  assert.ok(visibleIds.includes('safety'));
  assert.ok(visibleIds.includes('maintenance'));
  assert.equal(canEditSettingsSection(instructor, 'roster'), true);
  assert.equal(canEditSettingsSection(instructor, 'account-info'), true);
  assert.equal(canEditSettingsSection(instructor, 'training'), false);
  assert.equal(canEditSettingsSection(instructor, 'safety'), false);
  assert.equal(canEditSettingsSection(instructor, 'maintenance'), false);
  assert.equal(canEditSettingsSection(instructor, 'billing'), false);
});

test('senior instructors inherit instructor visibility without gaining club-wide edits', () => {
  const senior = userWithRoles('senior_instructor');
  const visibleIds = getAuthorizedSettingsSections(senior).map(({ id }) => id);

  assert.ok(visibleIds.includes('training'));
  assert.ok(visibleIds.includes('safety'));
  assert.ok(visibleIds.includes('maintenance'));
  assert.equal(canEditSettingsSection(senior, 'roster'), true);
  assert.equal(canEditSettingsSection(senior, 'maintenance'), false);
});

test('students and pilots only see and edit their own preference sections', () => {
  for (const role of ['student', 'pilot'] as const) {
    const member = userWithRoles(role);
    const visibleIds = getAuthorizedSettingsSections(member).map(({ id }) => id);

    assert.ok(visibleIds.every((id) => id.startsWith('account-')));
    assert.equal(canEditSettingsSection(member, 'account-calendar'), true);
    assert.equal(canEditSettingsSection(member, 'organisation'), false);
  }
});

test('an admin secondary role retains full access', () => {
  const mixedRole = userWithRoles('instructor', 'admin');
  const visibleIds = getAuthorizedSettingsSections(mixedRole).map(({ id }) => id);

  assert.ok(visibleIds.includes('integrations'));
  assert.equal(canEditSettingsSection(mixedRole, 'integrations'), true);
});
