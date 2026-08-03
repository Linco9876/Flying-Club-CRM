import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  managedProfilePicturePath,
  profilePictureSettingsDestination,
} from './profilePicture.ts';

const userId = '11111111-2222-3333-4444-555555555555';
const moderationMigration = readFileSync(
  new URL('../../supabase/migrations/20260803213000_add_profile_picture_moderation.sql', import.meta.url),
  'utf8',
);

test('extracts an owned profile-picture storage path', () => {
  assert.equal(
    managedProfilePicturePath(
      `https://example.supabase.co/storage/v1/object/public/user-avatars/${userId}/avatar-123.webp`,
      userId,
    ),
    `${userId}/avatar-123.webp`,
  );
});

test('accepts encoded filenames but not another users object', () => {
  assert.equal(
    managedProfilePicturePath(
      `https://example.supabase.co/storage/v1/object/public/user-avatars/${userId}/avatar%20photo.webp?version=1`,
      userId,
    ),
    `${userId}/avatar photo.webp`,
  );
  assert.equal(
    managedProfilePicturePath(
      'https://example.supabase.co/storage/v1/object/public/user-avatars/other-user/avatar.webp',
      userId,
    ),
    null,
  );
});

test('ignores external, malformed and traversal-like URLs', () => {
  assert.equal(managedProfilePicturePath('https://images.example.com/avatar.webp', userId), null);
  assert.equal(managedProfilePicturePath('not a URL', userId), null);
  assert.equal(
    managedProfilePicturePath(
      `https://example.supabase.co/storage/v1/object/public/user-avatars/${userId}/../other/avatar.webp`,
      userId,
    ),
    null,
  );
});

test('profile photo shortcut opens the exact Update My Info field', () => {
  assert.equal(
    profilePictureSettingsDestination,
    '/settings?tab=account-info&accountTab=info&focus=profile-photo#account-profile-photo',
  );
});

test('database moderation requires an MFA-verified admin and records the change', () => {
  assert.match(moderationMigration, /new\.avatar_url is distinct from old\.avatar_url/i);
  assert.match(moderationMigration, /not public\.current_user_is_admin\(\)/i);
  assert.match(moderationMigration, /bucket_id = 'user-avatars'[\s\S]+current_user_is_admin\(\)/i);
  assert.match(moderationMigration, /audit_user_profile_picture_updates[\s\S]+private\.audit_profile_picture_change\(\)/i);
  assert.match(moderationMigration, /jsonb_build_object\('avatar_url', old\.avatar_url\)/i);
  assert.match(moderationMigration, /select private\.assert_function_permission_manifest\(\)/i);
  assert.match(moderationMigration, /revoke all on function public\.guard_users_self_service_update\(\) from service_role/i);
  assert.doesNotMatch(moderationMigration, /grant execute on function public\.guard_users_self_service_update\(\) to service_role/i);
});
