import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  memberCardAttentionItems,
  memberCardMembershipPresentation,
} from './memberCardSummary.ts';

test('presents club membership separately from portal access', () => {
  assert.deepEqual(memberCardMembershipPresentation({
    userId: 'member-1',
    legalStatus: 'current',
    membershipClassName: 'Full',
    membershipClassCode: 'full',
    applicationStatus: null,
    applicationClassName: null,
  }), {
    label: 'Current',
    detail: 'Full',
    tone: 'current',
  });

  assert.equal(memberCardMembershipPresentation(undefined).label, 'Portal only');
});

test('shows a pending application without calling it current membership', () => {
  const presentation = memberCardMembershipPresentation({
    userId: 'member-2',
    legalStatus: null,
    membershipClassName: null,
    membershipClassCode: null,
    applicationStatus: 'pending',
    applicationClassName: 'Junior',
  });

  assert.equal(presentation.label, 'Application pending');
  assert.equal(presentation.detail, 'Junior');
  assert.equal(presentation.tone, 'pending');
});

test('limits pilot compliance warnings to members with flying records', () => {
  assert.deepEqual(memberCardAttentionItems({
    email: 'member@example.com',
    phone: '',
    hasFlyingRecords: false,
    now: new Date(2026, 7, 19),
  }), ['Phone not recorded']);

  assert.deepEqual(memberCardAttentionItems({
    email: 'pilot@example.com',
    phone: '0400 000 000',
    hasFlyingRecords: true,
    raausId: '123456',
    medicalRequired: true,
    medicalType: 'CASA Class 2',
    medicalExpiry: new Date(2026, 7, 18),
    raausMembershipExpiry: new Date(2026, 9, 18),
    now: new Date(2026, 7, 19),
  }), [
    'Medical expired 18 Aug 2026',
    'RAAus membership due 18 Oct 2026',
  ]);

  assert.deepEqual(memberCardAttentionItems({
    email: 'student@example.com',
    phone: '0400 000 000',
    hasFlyingRecords: true,
    raausId: '654321',
    medicalRequired: false,
    medicalType: 'CASA Class 2',
    medicalExpiry: new Date(2020, 0, 1),
    raausMembershipExpiry: new Date(2027, 0, 1),
    now: new Date(2026, 7, 19),
  }), []);
});

test('staff directory RPC exposes membership status without financial or application details', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260819140000_add_staff_member_directory_membership_summary.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /where public\.current_user_has_staff_role\(\)/i);
  assert.match(migration, /revoke all on function public\.get_member_directory_membership_summaries\(\) from public, anon/i);
  assert.doesNotMatch(migration, /membership_financial_periods|residential_address|service_address|guardian_name/i);
});
