import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  membershipAuditActorLabel,
  membershipAuditEventDescription,
  membershipAuditEventTitle,
} from './membershipAuditTrail.ts';

test('presents an approved portal application as readable membership history', () => {
  assert.equal(membershipAuditEventTitle('application_submitted'), 'Membership application submitted');
  assert.equal(
    membershipAuditEventDescription({
      eventType: 'application_submitted',
      details: { source: 'membership_portal' },
    }),
    'Submitted through membership portal.',
  );
  assert.equal(
    membershipAuditEventDescription({
      eventType: 'membership_commenced',
      details: {
        class: 'full',
        method: 'committee_approval',
        amountDue: 126.99,
        feeDisposition: 'invoice_required',
      },
    }),
    'Full membership commenced via committee approval with $126.99 recorded as due (Invoice Required).',
  );
});

test('shows useful membership decision reasons without raw audit identifiers', () => {
  assert.equal(
    membershipAuditEventDescription({
      eventType: 'membership_ended',
      details: {
        from: 'current',
        to: 'resigned',
        reason: 'Written resignation received by the secretary',
        membershipId: 'internal-id',
      },
    }),
    'Legal status changed from Current to Resigned. Written resignation received by the secretary.',
  );
});

test('identifies staff, member and automated actors safely', () => {
  assert.equal(membershipAuditActorLabel({ actorId: 'admin-1', actorName: 'Aimee Gatford', memberId: 'member-1' }), 'Aimee Gatford');
  assert.equal(membershipAuditActorLabel({ actorId: 'member-1', memberId: 'member-1' }), 'Member');
  assert.equal(membershipAuditActorLabel({ actorId: null, memberId: 'member-1' }), 'Automated system');
});

test('membership register exposes the permanent history for every member', () => {
  const dashboardSource = readFileSync(new URL('../components/Membership/MembershipDashboard.tsx', import.meta.url), 'utf8');
  const modalSource = readFileSync(new URL('../components/Membership/MembershipAuditTrailModal.tsx', import.meta.url), 'utf8');

  assert.match(dashboardSource, /setAuditingMembership\(membership\)/);
  assert.match(dashboardSource, /<MembershipAuditTrailModal/);
  assert.match(modalSource, /membership_status_events/);
  assert.match(modalSource, /Applications and decisions/);
  assert.match(modalSource, /Permanent audit timeline/);
});
