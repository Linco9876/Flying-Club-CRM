import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ClubMembership,
  MembershipApplication,
  MembershipChangeRequest,
  MembershipFinancialPeriod,
  MembershipPaymentPreference,
} from '../types';
import {
  buildMembershipDashboardSummary,
  currentMembershipPeriodMap,
  membershipMatchesDashboardFocus,
} from './membershipDashboard.ts';

const membership = (overrides: Partial<ClubMembership>): ClubMembership => ({
  id: 'membership-1',
  userId: 'user-1',
  membershipClassId: 'class-full',
  legalStatus: 'current',
  commencedAt: '2026-08-01',
  commencementMethod: 'committee_approval',
  userName: 'Member One',
  membershipClassName: 'Full',
  membershipClassCode: 'full',
  hasVotingRights: true,
  userIsActive: true,
  xeroLinked: true,
  ...overrides,
});

const period = (overrides: Partial<MembershipFinancialPeriod>): MembershipFinancialPeriod => ({
  id: 'period-1',
  membershipId: 'membership-1',
  financialYearStart: '2026-07-01',
  financialYearEnd: '2027-06-30',
  standardFee: 250,
  membershipFeeAmount: 250,
  scholarshipContributionAmount: 0,
  amountDue: 250,
  feeDisposition: 'invoiced',
  dueDate: '2026-08-01',
  graceExpiresAt: '2026-09-30',
  billingSyncAttempts: 0,
  ...overrides,
});

const application = (id: string, automaticCommencementAt: string): MembershipApplication => ({
  id,
  userId: `applicant-${id}`,
  membershipClassId: 'class-full',
  status: 'pending',
  residentialAddress: '1 Test Street',
  serviceAddress: '1 Test Street',
  guardianConsent: false,
  submittedAt: '2026-08-01',
  automaticCommencementAt,
});

const change = (id: string, status: MembershipChangeRequest['status']): MembershipChangeRequest => ({
  id,
  membershipId: 'membership-1',
  userId: 'user-1',
  fromMembershipClassId: 'class-full',
  toMembershipClassId: 'class-affiliate',
  status,
  requestedEffectiveTiming: 'next_renewal',
  effectiveOn: '2027-07-01',
  requestReason: 'Test change',
  submittedAt: '2026-08-10',
});

const preference = (overrides: Partial<MembershipPaymentPreference>): MembershipPaymentPreference => ({
  userId: 'user-1',
  paymentMethod: 'card',
  autoRenew: false,
  scholarshipContributionEnabled: false,
  scholarshipContributionAmount: 0,
  authorityStatus: 'ready',
  updatedAt: '2026-08-01',
  ...overrides,
});

test('summarises unique current members and actionable membership risks', () => {
  const memberships = [
    membership({ id: 'full-current', commencedAt: '2026-08-01' }),
    membership({ id: 'full-duplicate', commencedAt: '2025-07-01' }),
    membership({
      id: 'junior-current',
      userId: 'user-2',
      membershipClassId: 'class-junior',
      membershipClassCode: 'junior',
      membershipClassName: 'Junior',
      hasVotingRights: false,
      dateOfBirth: '2000-01-01',
      userIsActive: false,
      xeroLinked: false,
    }),
    membership({ id: 'ceased', userId: 'user-3', legalStatus: 'resigned' }),
  ];
  const summary = buildMembershipDashboardSummary({
    memberships,
    applications: [application('overdue', '2026-08-17'), application('soon', '2026-08-22')],
    changes: [change('pending', 'pending'), change('review', 'needs_review')],
    periods: [
      period({ id: 'paid', membershipId: 'full-current', feeDisposition: 'paid', amountDue: 0 }),
      period({
        id: 'overdue',
        membershipId: 'junior-current',
        feeDisposition: 'overdue',
        xeroAmountDue: 80,
        graceExpiresAt: '2026-08-17',
        billingSyncStatus: 'failed',
      }),
    ],
    paymentPreferences: [preference({ userId: 'user-2', autoRenew: true, authorityStatus: 'failed' })],
    options: {
      today: '2026-08-18',
      financeEnabled: true,
      xeroAccountingAvailable: true,
      xeroRequiredForBilling: true,
    },
  });

  assert.equal(summary.currentMembers, 2);
  assert.equal(summary.duplicateCurrentMembers, 1);
  assert.equal(summary.ceasedMemberships, 1);
  assert.equal(summary.financiallyCleared, 1);
  assert.equal(summary.financiallyOutstanding, 1);
  assert.equal(summary.outstandingAmount, 80);
  assert.equal(summary.overdueAccounts, 1);
  assert.equal(summary.graceExpiredAccounts, 1);
  assert.equal(summary.billingIssues, 1);
  assert.equal(summary.failedPaymentAuthorities, 1);
  assert.equal(summary.agedOutJuniorMembers, 1);
  assert.equal(summary.archivedCurrentProfiles, 1);
  assert.equal(summary.xeroUnlinkedMembers, 1);
  assert.equal(summary.membersRequiringAttention, 2, 'overlapping warnings count a member once');
  assert.equal(summary.totalActionItems, 6);
  assert.deepEqual(summary.classBreakdown.map(item => [item.name, item.count]), [['Full', 1], ['Junior', 1]]);
  assert.equal(summary.applicationsOverdueForCommencement, 1);
  assert.equal(summary.applicationsCommencingWithinSevenDays, 1);
});

test('does not infer financial warnings when financial services are disabled', () => {
  const current = membership({ membershipClassCode: 'junior', dateOfBirth: '2000-01-01' });
  const summary = buildMembershipDashboardSummary({
    memberships: [current],
    applications: [],
    changes: [],
    periods: [],
    paymentPreferences: [preference({ authorityStatus: 'failed' })],
    options: {
      today: '2026-08-18',
      financeEnabled: false,
      xeroAccountingAvailable: false,
      xeroRequiredForBilling: false,
    },
  });

  assert.equal(summary.missingCurrentPeriods, 0);
  assert.equal(summary.failedPaymentAuthorities, 0);
  assert.equal(summary.xeroUnlinkedMembers, 0);
  assert.equal(summary.agedOutJuniorMembers, 1, 'non-financial eligibility warnings remain active');
});

test('uses only a period that covers today and powers register filters', () => {
  const current = membership({ id: 'membership-1' });
  const periods = [
    period({ id: 'old', financialYearStart: '2025-07-01', financialYearEnd: '2026-06-30', feeDisposition: 'paid' }),
    period({ id: 'current', feeDisposition: 'overdue' }),
  ];
  assert.equal(currentMembershipPeriodMap(periods, '2026-08-18').get('membership-1')?.id, 'current');

  const summary = buildMembershipDashboardSummary({
    memberships: [current],
    applications: [],
    changes: [],
    periods,
    paymentPreferences: [],
    options: {
      today: '2026-08-18',
      financeEnabled: true,
      xeroAccountingAvailable: false,
      xeroRequiredForBilling: false,
    },
  });
  assert.equal(membershipMatchesDashboardFocus(current, 'outstanding', summary), true);
  assert.equal(membershipMatchesDashboardFocus(current, 'ceased', summary), false);
});
