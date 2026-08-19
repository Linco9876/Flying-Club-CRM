import type {
  ClubMembership,
  MembershipApplication,
  MembershipChangeRequest,
  MembershipFinancialPeriod,
  MembershipPaymentPreference,
} from '../types';
import { localDateString, membershipClassEligibility } from './membershipChangeRules.ts';

export type MembershipRegisterFocus =
  | 'all'
  | 'current'
  | 'attention'
  | 'outstanding'
  | 'billing_issue'
  | 'aged_out'
  | 'ceased';

export interface MembershipDashboardOptions {
  today?: string;
  financeEnabled: boolean;
  xeroAccountingAvailable: boolean;
  xeroRequiredForBilling: boolean;
}

export interface MembershipClassSummary {
  code: string;
  name: string;
  count: number;
  percentage: number;
}

export interface MembershipDashboardSummary {
  currentMembers: number;
  ceasedMemberships: number;
  votingMembers: number;
  newMembersLast30Days: number;
  archivedCurrentProfiles: number;
  duplicateCurrentMembers: number;
  pendingApplications: number;
  applicationsOverdueForCommencement: number;
  applicationsCommencingWithinSevenDays: number;
  pendingChanges: number;
  changesNeedingReview: number;
  financiallyCleared: number;
  financiallyOutstanding: number;
  outstandingAmount: number;
  overdueAccounts: number;
  graceExpiredAccounts: number;
  graceExpiringWithinFourteenDays: number;
  missingCurrentPeriods: number;
  billingIssues: number;
  failedPaymentAuthorities: number;
  autoRenewEnabled: number;
  agedOutJuniorMembers: number;
  xeroUnlinkedMembers: number;
  xeroLinkedMembers: number;
  membersRequiringAttention: number;
  totalActionItems: number;
  classBreakdown: MembershipClassSummary[];
  currentMembershipIds: string[];
  attentionMembershipIds: string[];
  outstandingMembershipIds: string[];
  billingIssueMembershipIds: string[];
  agedOutJuniorMembershipIds: string[];
}

const financiallyCleared = (value?: MembershipFinancialPeriod['feeDisposition']) =>
  value === 'paid' || value === 'waived' || value === 'fee_exempt';

const dateAtUtcMidnight = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
};

const addDays = (value: string, days: number) => {
  const timestamp = dateAtUtcMidnight(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp + days * 86_400_000).toISOString().slice(0, 10);
};

export const currentMembershipPeriodMap = (
  periods: MembershipFinancialPeriod[],
  today = localDateString(),
) => {
  const result = new Map<string, MembershipFinancialPeriod>();
  periods.forEach(period => {
    if (period.financialYearStart > today || period.financialYearEnd < today) return;
    const existing = result.get(period.membershipId);
    if (!existing || period.financialYearStart > existing.financialYearStart) {
      result.set(period.membershipId, period);
    }
  });
  return result;
};

const uniqueCurrentMemberships = (memberships: ClubMembership[]) => {
  const grouped = new Map<string, ClubMembership[]>();
  memberships
    .filter(membership => membership.legalStatus === 'current')
    .forEach(membership => grouped.set(
      membership.userId,
      [...(grouped.get(membership.userId) || []), membership],
    ));

  const selected: ClubMembership[] = [];
  const duplicateUserIds = new Set<string>();
  grouped.forEach(records => {
    if (records.length > 1) duplicateUserIds.add(records[0].userId);
    selected.push([...records].sort((left, right) => right.commencedAt.localeCompare(left.commencedAt))[0]);
  });
  return { selected, duplicateUserIds };
};

export const buildMembershipDashboardSummary = ({
  memberships,
  applications,
  changes,
  periods,
  paymentPreferences,
  options,
}: {
  memberships: ClubMembership[];
  applications: MembershipApplication[];
  changes: MembershipChangeRequest[];
  periods: MembershipFinancialPeriod[];
  paymentPreferences: MembershipPaymentPreference[];
  options: MembershipDashboardOptions;
}): MembershipDashboardSummary => {
  const today = options.today || localDateString();
  const thirtyDaysAgo = addDays(today, -29);
  const sevenDaysFromNow = addDays(today, 7);
  const fourteenDaysFromNow = addDays(today, 14);
  const { selected: current, duplicateUserIds } = uniqueCurrentMemberships(memberships);
  const periodByMembership = currentMembershipPeriodMap(periods, today);
  const preferenceByUser = new Map(paymentPreferences.map(preference => [preference.userId, preference]));

  const attentionIds = new Set<string>();
  const outstandingIds = new Set<string>();
  const billingIssueIds = new Set<string>();
  const agedOutIds = new Set<string>();
  let cleared = 0;
  let outstandingAmount = 0;
  let overdue = 0;
  let graceExpired = 0;
  let graceExpiring = 0;
  let missingPeriods = 0;
  let failedAuthorities = 0;
  let autoRenewEnabled = 0;
  let xeroUnlinked = 0;
  let xeroLinked = 0;
  let archivedCurrentProfiles = 0;

  current.forEach(membership => {
    if (membership.userIsActive === false) {
      archivedCurrentProfiles += 1;
      attentionIds.add(membership.id);
    }
    if (duplicateUserIds.has(membership.userId)) attentionIds.add(membership.id);
    if (
      membership.membershipClassCode?.toLowerCase() === 'junior'
      && !membershipClassEligibility('junior', membership.dateOfBirth, today).eligible
    ) {
      agedOutIds.add(membership.id);
      attentionIds.add(membership.id);
    }
    if (options.xeroAccountingAvailable) {
      if (membership.xeroLinked) xeroLinked += 1;
      else {
        xeroUnlinked += 1;
        if (options.xeroRequiredForBilling) attentionIds.add(membership.id);
      }
    }

    const preference = preferenceByUser.get(membership.userId);
    if (preference?.autoRenew) autoRenewEnabled += 1;
    if (
      options.financeEnabled
      && (preference?.authorityStatus === 'failed' || preference?.lastCollectionStatus === 'failed')
    ) {
      failedAuthorities += 1;
      attentionIds.add(membership.id);
    }

    if (!options.financeEnabled) return;
    const period = periodByMembership.get(membership.id);
    if (!period) {
      missingPeriods += 1;
      attentionIds.add(membership.id);
      return;
    }
    if (
      ['failed', 'needs_review'].includes(period.billingSyncStatus || '')
      || Boolean(period.billingSyncError)
      || Boolean(period.xeroSyncError)
    ) {
      billingIssueIds.add(membership.id);
    }
    if (financiallyCleared(period.feeDisposition)) {
      cleared += 1;
      return;
    }

    outstandingIds.add(membership.id);
    attentionIds.add(membership.id);
    outstandingAmount += Math.max(0, period.xeroAmountDue ?? period.amountDue);
    if (period.feeDisposition === 'overdue' || period.dueDate < today) overdue += 1;
    if (period.graceExpiresAt < today) graceExpired += 1;
    else if (period.graceExpiresAt <= fourteenDaysFromNow) graceExpiring += 1;
  });

  billingIssueIds.forEach(id => attentionIds.add(id));
  const attentionFilterIds = new Set(attentionIds);
  memberships
    .filter(membership => membership.legalStatus === 'current' && duplicateUserIds.has(membership.userId))
    .forEach(membership => attentionFilterIds.add(membership.id));
  const pendingApplications = applications.filter(application => application.status === 'pending');
  const pendingChanges = changes.filter(change => change.status === 'pending').length;
  const changesNeedingReview = changes.filter(change => change.status === 'needs_review').length;
  const classCounts = new Map<string, { code: string; name: string; count: number }>();
  current.forEach(membership => {
    const code = membership.membershipClassCode || 'unknown';
    const key = membership.membershipClassId || code;
    const existing = classCounts.get(key);
    classCounts.set(key, {
      code,
      name: membership.membershipClassName || 'Unclassified',
      count: (existing?.count || 0) + 1,
    });
  });

  return {
    currentMembers: current.length,
    ceasedMemberships: memberships.filter(membership => membership.legalStatus !== 'current').length,
    votingMembers: current.filter(membership => membership.hasVotingRights).length,
    newMembersLast30Days: current.filter(membership => {
      const commenced = membership.commencedAt.slice(0, 10);
      return commenced >= thirtyDaysAgo && commenced <= today;
    }).length,
    archivedCurrentProfiles,
    duplicateCurrentMembers: duplicateUserIds.size,
    pendingApplications: pendingApplications.length,
    applicationsOverdueForCommencement: pendingApplications.filter(application => application.automaticCommencementAt.slice(0, 10) < today).length,
    applicationsCommencingWithinSevenDays: pendingApplications.filter(application => {
      const commencement = application.automaticCommencementAt.slice(0, 10);
      return commencement >= today && commencement <= sevenDaysFromNow;
    }).length,
    pendingChanges,
    changesNeedingReview,
    financiallyCleared: cleared,
    financiallyOutstanding: outstandingIds.size,
    outstandingAmount,
    overdueAccounts: overdue,
    graceExpiredAccounts: graceExpired,
    graceExpiringWithinFourteenDays: graceExpiring,
    missingCurrentPeriods: missingPeriods,
    billingIssues: billingIssueIds.size,
    failedPaymentAuthorities: failedAuthorities,
    autoRenewEnabled,
    agedOutJuniorMembers: agedOutIds.size,
    xeroUnlinkedMembers: xeroUnlinked,
    xeroLinkedMembers: xeroLinked,
    membersRequiringAttention: attentionIds.size,
    totalActionItems: attentionIds.size + pendingApplications.length + pendingChanges + changesNeedingReview,
    classBreakdown: Array.from(classCounts.values())
      .map(item => ({ ...item, percentage: current.length ? Math.round((item.count / current.length) * 100) : 0 }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
    currentMembershipIds: current.map(membership => membership.id),
    attentionMembershipIds: Array.from(attentionFilterIds),
    outstandingMembershipIds: Array.from(outstandingIds),
    billingIssueMembershipIds: Array.from(billingIssueIds),
    agedOutJuniorMembershipIds: Array.from(agedOutIds),
  };
};

export const membershipMatchesDashboardFocus = (
  membership: ClubMembership,
  focus: MembershipRegisterFocus,
  summary: MembershipDashboardSummary,
) => {
  if (focus === 'all') return true;
  if (focus === 'current') return summary.currentMembershipIds.includes(membership.id);
  if (focus === 'ceased') return membership.legalStatus !== 'current';
  if (focus === 'attention') return summary.attentionMembershipIds.includes(membership.id);
  if (focus === 'outstanding') return summary.outstandingMembershipIds.includes(membership.id);
  if (focus === 'billing_issue') return summary.billingIssueMembershipIds.includes(membership.id);
  return summary.agedOutJuniorMembershipIds.includes(membership.id);
};
