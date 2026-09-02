import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const studentFormSource = readFileSync(new URL('../components/Students/StudentForm.tsx', import.meta.url), 'utf8');
const studentListSource = readFileSync(new URL('../components/Students/StudentList.tsx', import.meta.url), 'utf8');
const studentProfileSource = readFileSync(new URL('../components/Students/StudentProfilePage.tsx', import.meta.url), 'utf8');
const adminMfaHookSource = readFileSync(new URL('../hooks/useAdminMfaReset.ts', import.meta.url), 'utf8');
const inviteUserFunctionSource = readFileSync(new URL('../../supabase/functions/invite-user/index.ts', import.meta.url), 'utf8');

test('member edit forms show reset 2FA only after a real MFA status check', () => {
  assert.match(studentFormSource, /onCheckMfaStatus/);
  assert.match(studentFormSource, /mfaStatus\?\.hasMfa[\s\S]+Reset 2FA/);
  assert.match(studentListSource, /useAdminMfaReset/);
  assert.match(studentProfileSource, /useAdminMfaReset/);
  assert.match(adminMfaHookSource, /action:\s*'get_mfa_status'/);
  assert.match(adminMfaHookSource, /action:\s*'reset_mfa'/);
});

test('resetting member 2FA is admin MFA protected and audited server-side', () => {
  assert.match(inviteUserFunctionSource, /body\.action === "get_mfa_status"/);
  assert.match(inviteUserFunctionSource, /body\.action === "reset_mfa"/);
  assert.match(inviteUserFunctionSource, /authenticateAal2AdminOrWorker[\s\S]+resetting a member's 2FA/);
  assert.match(inviteUserFunctionSource, /adminClient\.auth\s*\n?\s*\.admin\.mfa\.listFactors/);
  assert.match(inviteUserFunctionSource, /adminClient\.auth\.admin\.mfa\s*\n?\s*\.deleteFactor/);
  assert.match(inviteUserFunctionSource, /operations_audit_events/);
  assert.match(inviteUserFunctionSource, /action:\s*"RESET_MFA"/);
});
