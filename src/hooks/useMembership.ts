import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useFinancialProviders } from '../context/financialProviderState';
import { PRIVACY_NOTICE_VERSION } from '../utils/privacyNotice';
import { supabase } from '../lib/supabase';
import { statutoryRegisterCsv } from '../utils/membershipSettings';
import {
  ClubMembership,
  MembershipChangeRequest,
  MembershipChangeTiming,
  MembershipApplication,
  MembershipClass,
  MembershipFeeDisposition,
  MembershipFinancialPeriod,
  MembershipLegalStatus,
  MembershipPaymentMethod,
  MembershipPaymentPreference,
  MembershipRolloutMode,
  MembershipSettings,
} from '../types';

interface MembershipClassRow {
  id: string;
  code: MembershipClass['code'];
  name: string;
  description: string | null;
  annual_fee: number | string | null;
  has_voting_rights: boolean | null;
  can_self_book_aircraft: boolean | null;
  is_fee_exempt: boolean | null;
  is_active: boolean | null;
  sort_order: number | string | null;
  xero_item_code: string | null;
  xero_account_code: string | null;
}

interface MembershipApplicationRow {
  id: string;
  user_id: string;
  membership_class_id: string;
  status: MembershipApplication['status'];
  residential_address: string;
  service_address: string;
  date_of_birth: string | null;
  guardian_name: string | null;
  guardian_consent: boolean | null;
  submitted_at: string;
  automatic_commencement_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_reason: string | null;
  applicant?: { name?: string; email?: string } | null;
  membership_class?: { name?: string; code?: MembershipClass['code'] } | null;
}

interface ClubMembershipRow {
  id: string;
  user_id: string;
  membership_class_id: string;
  application_id: string | null;
  legal_status: ClubMembership['legalStatus'];
  commenced_at: string;
  commencement_method: ClubMembership['commencementMethod'];
  ended_at: string | null;
  end_reason: string | null;
  member?: { name?: string; email?: string; is_active?: boolean | null; xero_contact_id?: string | null; date_of_birth?: string | null } | null;
  membership_class?: {
    name?: string;
    code?: MembershipClass['code'];
    has_voting_rights?: boolean;
    can_self_book_aircraft?: boolean;
  } | null;
}

interface MembershipFinancialPeriodRow {
  id: string;
  membership_id: string;
  financial_year_start: string;
  financial_year_end: string;
  standard_fee: number | string | null;
  membership_fee_amount: number | string | null;
  scholarship_contribution_amount: number | string | null;
  amount_due: number | string | null;
  fee_disposition: MembershipFeeDisposition;
  due_date: string;
  grace_expires_at: string;
  financially_cleared_at: string | null;
  xero_invoice_id: string | null;
  xero_invoice_number: string | null;
  xero_invoice_status: string | null;
  xero_amount_due: number | string | null;
  xero_last_synced_at: string | null;
  xero_sync_error: string | null;
  billing_sync_status: MembershipFinancialPeriod['billingSyncStatus'];
  billing_sync_attempts: number | string | null;
  billing_sync_next_attempt_at: string | null;
  billing_sync_error: string | null;
  billing_sync_updated_at: string | null;
  waiver_reason: string | null;
  waiver_type: string | null;
  waiver_authority_reference: string | null;
  waiver_authorised_by: string | null;
  waiver_authorised_at: string | null;
}

interface MembershipPaymentPreferenceRow {
  user_id: string;
  payment_method: MembershipPaymentMethod;
  auto_renew: boolean | null;
  scholarship_contribution_enabled: boolean | null;
  scholarship_contribution_amount: number | string | null;
  authority_status: MembershipPaymentPreference['authorityStatus'];
  payment_method_display: string | null;
  consent_accepted_at: string | null;
  last_collection_attempt_at: string | null;
  last_collection_status: string | null;
  last_collection_error: string | null;
  updated_at: string;
}

interface MembershipChangeRequestRow {
  id: string;
  membership_id: string;
  user_id: string;
  from_membership_class_id: string;
  to_membership_class_id: string;
  status: MembershipChangeRequest['status'];
  requested_effective_timing: MembershipChangeTiming;
  effective_on: string;
  request_reason: string;
  requested_by: string | null;
  submitted_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_reason: string | null;
  applied_at: string | null;
  member?: { name?: string; email?: string } | null;
  from_membership_class?: { name?: string; code?: string } | null;
  to_membership_class?: { name?: string; code?: string } | null;
}

export interface LegacyMembershipImportInput {
  userId: string;
  membershipClassCode: string;
  commencedAt: string;
  feeDisposition: 'invoice_required' | 'paid' | 'waived';
  reason?: string;
}

export interface LegacyMembershipImportResult extends LegacyMembershipImportInput {
  success: boolean;
  error?: string;
}

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
};

const mapClass = (row: MembershipClassRow): MembershipClass => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description || '',
  annualFee: Number(row.annual_fee || 0),
  hasVotingRights: Boolean(row.has_voting_rights),
  canSelfBookAircraft: row.can_self_book_aircraft !== false,
  isFeeExempt: Boolean(row.is_fee_exempt),
  isActive: Boolean(row.is_active),
  sortOrder: Number(row.sort_order || 0),
  xeroItemCode: row.xero_item_code,
  xeroAccountCode: row.xero_account_code,
});

const mapApplication = (row: MembershipApplicationRow): MembershipApplication => ({
  id: row.id,
  userId: row.user_id,
  membershipClassId: row.membership_class_id,
  status: row.status,
  residentialAddress: row.residential_address,
  serviceAddress: row.service_address,
  dateOfBirth: row.date_of_birth,
  guardianName: row.guardian_name,
  guardianConsent: Boolean(row.guardian_consent),
  submittedAt: row.submitted_at,
  automaticCommencementAt: row.automatic_commencement_at,
  decidedAt: row.decided_at,
  decidedBy: row.decided_by,
  decisionReason: row.decision_reason,
  userName: row.applicant?.name,
  userEmail: row.applicant?.email,
  membershipClassName: row.membership_class?.name,
  membershipClassCode: row.membership_class?.code,
});

const mapMembership = (row: ClubMembershipRow): ClubMembership => ({
  id: row.id,
  userId: row.user_id,
  membershipClassId: row.membership_class_id,
  applicationId: row.application_id,
  legalStatus: row.legal_status,
  commencedAt: row.commenced_at,
  commencementMethod: row.commencement_method,
  endedAt: row.ended_at,
  endReason: row.end_reason,
  userName: row.member?.name,
  userEmail: row.member?.email,
  userIsActive: row.member?.is_active !== false,
  xeroLinked: Boolean(row.member?.xero_contact_id),
  membershipClassName: row.membership_class?.name,
  membershipClassCode: row.membership_class?.code,
  hasVotingRights: Boolean(row.membership_class?.has_voting_rights),
  canSelfBookAircraft: row.membership_class?.can_self_book_aircraft !== false,
  dateOfBirth: row.member?.date_of_birth,
});

const mapChangeRequest = (row: MembershipChangeRequestRow): MembershipChangeRequest => ({
  id: row.id,
  membershipId: row.membership_id,
  userId: row.user_id,
  fromMembershipClassId: row.from_membership_class_id,
  toMembershipClassId: row.to_membership_class_id,
  status: row.status,
  requestedEffectiveTiming: row.requested_effective_timing,
  effectiveOn: row.effective_on,
  requestReason: row.request_reason,
  requestedBy: row.requested_by,
  submittedAt: row.submitted_at,
  decidedAt: row.decided_at,
  decidedBy: row.decided_by,
  decisionReason: row.decision_reason,
  appliedAt: row.applied_at,
  userName: row.member?.name,
  userEmail: row.member?.email,
  fromMembershipClassName: row.from_membership_class?.name,
  fromMembershipClassCode: row.from_membership_class?.code,
  toMembershipClassName: row.to_membership_class?.name,
  toMembershipClassCode: row.to_membership_class?.code,
});

const mapPeriod = (row: MembershipFinancialPeriodRow): MembershipFinancialPeriod => ({
  id: row.id,
  membershipId: row.membership_id,
  financialYearStart: row.financial_year_start,
  financialYearEnd: row.financial_year_end,
  standardFee: Number(row.standard_fee || 0),
  membershipFeeAmount: Number(row.membership_fee_amount ?? row.amount_due ?? 0),
  scholarshipContributionAmount: Number(row.scholarship_contribution_amount || 0),
  amountDue: Number(row.amount_due || 0),
  feeDisposition: row.fee_disposition,
  dueDate: row.due_date,
  graceExpiresAt: row.grace_expires_at,
  financiallyClearedAt: row.financially_cleared_at,
  xeroInvoiceId: row.xero_invoice_id,
  xeroInvoiceNumber: row.xero_invoice_number,
  xeroInvoiceStatus: row.xero_invoice_status,
  xeroAmountDue: row.xero_amount_due === null ? null : Number(row.xero_amount_due),
  xeroLastSyncedAt: row.xero_last_synced_at,
  xeroSyncError: row.xero_sync_error,
  billingSyncStatus: row.billing_sync_status,
  billingSyncAttempts: Number(row.billing_sync_attempts || 0),
  billingSyncNextAttemptAt: row.billing_sync_next_attempt_at,
  billingSyncError: row.billing_sync_error,
  billingSyncUpdatedAt: row.billing_sync_updated_at,
  waiverReason: row.waiver_reason,
  waiverType: row.waiver_type,
  waiverAuthorityReference: row.waiver_authority_reference,
  waiverAuthorisedBy: row.waiver_authorised_by,
  waiverAuthorisedAt: row.waiver_authorised_at,
});

const mapPaymentPreference = (row: MembershipPaymentPreferenceRow): MembershipPaymentPreference => ({
  userId: row.user_id,
  paymentMethod: row.payment_method,
  autoRenew: Boolean(row.auto_renew),
  scholarshipContributionEnabled: Boolean(row.scholarship_contribution_enabled),
  scholarshipContributionAmount: Number(row.scholarship_contribution_amount ?? 5),
  authorityStatus: row.authority_status,
  paymentMethodDisplay: row.payment_method_display,
  consentAcceptedAt: row.consent_accepted_at,
  lastCollectionAttemptAt: row.last_collection_attempt_at,
  lastCollectionStatus: row.last_collection_status,
  lastCollectionError: row.last_collection_error,
  updatedAt: row.updated_at,
});

export const useMembership = () => {
  const { user } = useAuth();
  const { capabilities: financialProviders } = useFinancialProviders();
  const isAdmin = Boolean(user?.role === 'admin' || user?.roles?.includes('admin'));
  const [classes, setClasses] = useState<MembershipClass[]>([]);
  const [applications, setApplications] = useState<MembershipApplication[]>([]);
  const [memberships, setMemberships] = useState<ClubMembership[]>([]);
  const [changeRequests, setChangeRequests] = useState<MembershipChangeRequest[]>([]);
  const [periods, setPeriods] = useState<MembershipFinancialPeriod[]>([]);
  const [paymentPreferences, setPaymentPreferences] = useState<MembershipPaymentPreference[]>([]);
  const [settings, setSettings] = useState<MembershipSettings>({
    rolloutMode: 'staff_warning',
    financialYearStartMonth: 7,
    financialYearStartDay: 1,
    automaticCommencementDays: 30,
    nonPaymentGraceDays: 60,
    xeroStatusStaleHours: 12,
    xeroMembershipItemCode: null,
    xeroScholarshipItemCode: null,
    xeroScholarshipAccountCode: null,
    scholarshipContributionAvailable: true,
    scholarshipDefaultAmount: 5,
    scholarshipMinimumAmount: 0.01,
    requireStaffOverrideReason: true,
    prorationMethod: 'daily',
    minimumProratedFee: 0,
    renewalInvoiceLeadDays: 30,
    renewalReminderDaysBeforeDue: [30, 7],
    overdueReminderDays: [7, 30, 45, 55],
    technicalRetryMinutes: [5, 30, 120, 720],
    paymentRetryDays: [3, 7],
    waiverTypes: ['Volunteer contribution', 'Hardship', 'Honorary', 'Promotional', 'Administrative correction'],
    requireWaiverAuthorityReference: true,
    statutoryRegisterCleanupDays: 14,
  });
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [classesResult, settingsResult, applicationsResult, membershipsResult, changeRequestsResult, periodsResult, preferencesResult] = await Promise.all([
        supabase.from('membership_classes').select('*').order('sort_order'),
        supabase.from('membership_settings').select('*').eq('id', true).maybeSingle(),
        supabase.from('membership_applications').select(`
          *,
          applicant:users!membership_applications_user_id_fkey(name,email),
          membership_class:membership_classes!membership_applications_membership_class_id_fkey(name,code)
        `).order('submitted_at', { ascending: false }),
        supabase.from('club_memberships').select(`
          *,
          member:users!club_memberships_user_id_fkey(name,email,is_active,xero_contact_id,date_of_birth),
          membership_class:membership_classes!club_memberships_membership_class_id_fkey(name,code,has_voting_rights,can_self_book_aircraft)
        `).order('commenced_at', { ascending: false }),
        supabase.from('membership_change_requests').select(`
          *,
          member:users!membership_change_requests_user_id_fkey(name,email),
          from_membership_class:membership_classes!membership_change_requests_from_membership_class_id_fkey(name,code),
          to_membership_class:membership_classes!membership_change_requests_to_membership_class_id_fkey(name,code)
        `).order('submitted_at', { ascending: false }),
        supabase.from('membership_financial_periods').select('*').order('financial_year_start', { ascending: false }),
        supabase.from('membership_payment_preferences').select('*'),
      ]);

      const firstError = classesResult.error || settingsResult.error || applicationsResult.error || membershipsResult.error || changeRequestsResult.error || periodsResult.error || preferencesResult.error;
      if (firstError) throw firstError;
      setClasses(((classesResult.data || []) as MembershipClassRow[]).map(mapClass));
      setApplications(((applicationsResult.data || []) as MembershipApplicationRow[]).map(mapApplication));
      setMemberships(((membershipsResult.data || []) as ClubMembershipRow[]).map(mapMembership));
      setChangeRequests(((changeRequestsResult.data || []) as MembershipChangeRequestRow[]).map(mapChangeRequest));
      setPeriods(((periodsResult.data || []) as MembershipFinancialPeriodRow[]).map(mapPeriod));
      setPaymentPreferences(((preferencesResult.data || []) as MembershipPaymentPreferenceRow[]).map(mapPaymentPreference));
      if (settingsResult.data) {
        setSettings({
          rolloutMode: settingsResult.data.rollout_mode,
          financialYearStartMonth: Number(settingsResult.data.financial_year_start_month || 7),
          financialYearStartDay: Number(settingsResult.data.financial_year_start_day || 1),
          automaticCommencementDays: Number(settingsResult.data.automatic_commencement_days || 30),
          nonPaymentGraceDays: Number(settingsResult.data.non_payment_grace_days || 60),
          xeroStatusStaleHours: Number(settingsResult.data.xero_status_stale_hours || 12),
          xeroMembershipItemCode: settingsResult.data.xero_membership_item_code,
          xeroScholarshipItemCode: settingsResult.data.xero_scholarship_item_code,
          xeroScholarshipAccountCode: settingsResult.data.xero_scholarship_account_code,
          scholarshipContributionAvailable: settingsResult.data.scholarship_contribution_available !== false,
          scholarshipDefaultAmount: Number(settingsResult.data.scholarship_default_amount ?? 5),
          scholarshipMinimumAmount: Number(settingsResult.data.scholarship_minimum_amount ?? 0.01),
          requireStaffOverrideReason: Boolean(settingsResult.data.require_staff_override_reason),
          prorationMethod: settingsResult.data.proration_method || 'daily',
          minimumProratedFee: Number(settingsResult.data.minimum_prorated_fee || 0),
          renewalInvoiceLeadDays: Number(settingsResult.data.renewal_invoice_lead_days || 30),
          renewalReminderDaysBeforeDue: settingsResult.data.renewal_reminder_days_before_due || [30, 7],
          overdueReminderDays: settingsResult.data.overdue_reminder_days || [7, 30, 45, 55],
          technicalRetryMinutes: settingsResult.data.technical_retry_minutes || [5, 30, 120, 720],
          paymentRetryDays: settingsResult.data.payment_retry_days || [3, 7],
          waiverTypes: settingsResult.data.waiver_types || ['Volunteer contribution', 'Hardship', 'Honorary', 'Promotional', 'Administrative correction'],
          requireWaiverAuthorityReference: Boolean(settingsResult.data.require_waiver_authority_reference),
          statutoryRegisterCleanupDays: Number(settingsResult.data.statutory_register_cleanup_days || 14),
        });
      }
      setError(null);
    } catch (nextError) {
      console.error('Failed to load BFC membership records:', nextError);
      setError(errorMessage(nextError, 'Membership records could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { void refetch(); }, [refetch]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('payment_setup');
    if (!outcome) return;

    if (outcome === 'success') {
      toast.success('Payment method securely saved');
    } else if (outcome === 'cancelled') {
      toast('Payment setup cancelled. No money was transferred.', { icon: 'ℹ️' });
    }

    params.delete('payment_setup');
    params.delete('session_id');
    const nextQuery = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`);

    if (outcome !== 'success') return;
    const firstRefresh = window.setTimeout(() => { void refetch(); }, 1200);
    const secondRefresh = window.setTimeout(() => { void refetch(); }, 3500);
    return () => {
      window.clearTimeout(firstRefresh);
      window.clearTimeout(secondRefresh);
    };
  }, [refetch]);

  const runAction = useCallback(async <T,>(key: string, action: () => Promise<T>, success: string) => {
    setBusyAction(key);
    try {
      const result = await action();
      toast.success(success);
      await refetch();
      return result;
    } catch (actionError) {
      const message = errorMessage(actionError, 'Membership action failed.');
      toast.error(message);
      throw actionError;
    } finally {
      setBusyAction(null);
    }
  }, [refetch]);

  const decideApplication = (applicationId: string, decision: 'approve' | 'reject', reason?: string) =>
    runAction(`application:${applicationId}`, async () => {
      const { data, error: rpcError } = await supabase.rpc('decide_membership_application', {
        p_application_id: applicationId,
        p_decision: decision,
        p_reason: reason || null,
      });
      if (rpcError) throw rpcError;
      if (decision === 'approve') {
        const applicantUserId = applications.find(application => application.id === applicationId)?.userId;
        if (applicantUserId) {
          const { data: welcomeData, error: welcomeError } = await supabase.functions.invoke('send-membership-welcome-email', {
            body: { action: 'send-for-user', userId: applicantUserId },
          });
          if (welcomeError || welcomeData?.error) {
            console.warn('Membership approved; welcome email deferred:', welcomeError || welcomeData?.error);
            toast('Membership approved. The welcome email will be retried by the daily job.', { icon: 'ℹ️' });
          }
          if (financialProviders.xero.postingAvailable) {
            const { data: invoiceData, error: invoiceError } = await supabase.functions.invoke('xero-sync', {
              body: { action: 'issue-member-membership-invoice', userId: applicantUserId, sendEmail: true },
            });
            if (invoiceError || invoiceData?.error) {
              console.warn('Membership approved; Xero invoice issue deferred:', invoiceError || invoiceData?.error);
              toast('Membership approved. The Xero invoice will be retried by the daily billing job.', { icon: 'ℹ️' });
            }
          } else if (financialProviders.stripe.paymentsAvailable) {
            const { data: collection, error: collectionError } = await supabase.functions.invoke(
              'membership-payment-setup',
              { body: { action: 'collect-approved-membership', userId: applicantUserId } },
            );
            if (collectionError || collection?.error) {
              console.warn('Membership approved; direct Stripe collection needs attention:', collectionError || collection?.error);
              toast('Membership approved. Stripe collection needs administrator review.', { icon: 'ℹ️' });
            } else if (collection?.status === 'processing') {
              toast('Membership approved. The bank debit is processing.', { icon: 'ℹ️' });
            } else if (collection?.reason === 'payment_authority_required') {
              toast('Membership approved. The member still needs to choose a payment method.', { icon: 'ℹ️' });
            }
          } else {
            toast('Membership approved. Financial services are disconnected, so no invoice or debit was created.', { icon: 'ℹ️' });
          }
        }
      }
      return data;
    }, decision === 'approve' ? 'Membership approved' : 'Application rejected');

  const submitApplication = (input: {
    membershipClassCode: string;
    residentialAddress: string;
    serviceAddress: string;
    dateOfBirth?: string;
    guardianName?: string;
    guardianConsent: boolean;
    privacyNoticeAccepted: boolean;
    acknowledgedDocumentIds: string[];
  }) => runAction('application:submit', async () => {
    const { data, error: rpcError } = await supabase.rpc('submit_membership_application', {
      p_membership_class_code: input.membershipClassCode,
      p_residential_address: input.residentialAddress,
      p_service_address: input.serviceAddress,
      p_date_of_birth: input.dateOfBirth || null,
      p_guardian_name: input.guardianName || null,
      p_guardian_consent: input.guardianConsent,
      p_supports_club_purposes: true,
      p_agrees_to_constitution: true,
      p_agrees_to_member_guarantee: true,
      p_agrees_to_code_of_conduct: true,
      p_agrees_to_members_manual: true,
      p_privacy_notice_accepted: input.privacyNoticeAccepted,
      p_privacy_notice_version: input.privacyNoticeAccepted ? PRIVACY_NOTICE_VERSION : null,
      p_acknowledged_document_ids: input.acknowledgedDocumentIds,
    });
    if (rpcError) throw rpcError;
    return data;
  }, 'Membership application submitted');

  const setFeeDisposition = (periodId: string, disposition: MembershipFeeDisposition, reason?: string) =>
    runAction(`period:${periodId}`, async () => {
      const { error: rpcError } = await supabase.rpc('set_membership_fee_disposition', {
        p_period_id: periodId,
        p_disposition: disposition,
        p_reason: reason || null,
      });
      if (rpcError) throw rpcError;
    }, disposition === 'waived' ? 'Membership fee waived' : 'Membership fee status updated');

  const authorizeFeeWaiver = (
    periodId: string,
    waiverType: string,
    reason: string,
    authorityReference?: string,
  ) =>
    runAction(`period:${periodId}`, async () => {
      const { error: rpcError } = await supabase.rpc('authorize_membership_fee_waiver', {
        p_period_id: periodId,
        p_waiver_type: waiverType,
        p_reason: reason,
        p_authority_reference: authorityReference?.trim() || null,
      });
      if (rpcError) throw rpcError;
    }, 'Membership fee waiver authorised');

  const importLegacyMembership = (input: LegacyMembershipImportInput) => runAction('membership:import', async () => {
    const { data, error: rpcError } = await supabase.rpc('import_legacy_membership', {
      p_user_id: input.userId,
      p_membership_class_code: input.membershipClassCode,
      p_commenced_at: input.commencedAt,
      p_fee_disposition: input.feeDisposition,
      p_reason: input.reason || null,
    });
    if (rpcError) throw rpcError;
    return data;
  }, 'Existing member added to the BFC register');

  const importLegacyMembershipCsv = async (inputs: LegacyMembershipImportInput[]) => {
    setBusyAction('membership:csv-import');
    const results: LegacyMembershipImportResult[] = [];
    try {
      // Keep database pressure predictable for large opening-register files.
      // Each RPC remains independently audited by the existing server function.
      for (let offset = 0; offset < inputs.length; offset += 5) {
        const batch = inputs.slice(offset, offset + 5);
        const batchResults = await Promise.all(batch.map(async (input): Promise<LegacyMembershipImportResult> => {
          try {
            const { error: rpcError } = await supabase.rpc('import_legacy_membership', {
              p_user_id: input.userId,
              p_membership_class_code: input.membershipClassCode,
              p_commenced_at: input.commencedAt,
              p_fee_disposition: input.feeDisposition,
              p_reason: input.reason || null,
            });
            return rpcError
              ? { ...input, success: false, error: rpcError.message }
              : { ...input, success: true };
          } catch (importError) {
            return {
              ...input,
              success: false,
              error: errorMessage(importError, 'The member import request could not be completed.'),
            };
          }
        }));
        results.push(...batchResults);
      }

      await refetch();
      const imported = results.filter(result => result.success).length;
      const failed = results.length - imported;
      if (imported > 0) toast.success(`${imported} existing member${imported === 1 ? '' : 's'} added to the BFC register`);
      if (failed > 0) toast.error(`${failed} member${failed === 1 ? '' : 's'} could not be imported. Review the row results.`);
      return results;
    } finally {
      setBusyAction(null);
    }
  };

  const createOrRefreshXeroInvoice = (periodId: string) =>
    runAction(`xero:${periodId}`, async () => {
      const { data, error: functionError } = await supabase.functions.invoke('xero-sync', {
        body: { action: 'create-membership-invoice', periodId },
      });
      if (functionError) throw functionError;
      if (data?.error) throw new Error(data.error);
      return data;
    }, 'Xero membership invoice synchronised');

  const refreshAllXeroInvoices = () =>
    runAction('xero:all', async () => {
      const { data, error: functionError } = await supabase.functions.invoke('xero-sync', {
        body: { action: 'refresh-membership-invoices' },
      });
      if (functionError) throw functionError;
      if (data?.error) throw new Error(data.error);
      return data;
    }, 'Xero membership payments refreshed');

  const issueMembershipRenewals = () =>
    runAction('xero:issue-renewals', async () => {
      const { data, error: functionError } = await supabase.functions.invoke('xero-sync', {
        body: { action: 'issue-membership-renewals', sendEmail: true },
      });
      if (functionError) throw functionError;
      if (data?.error) throw new Error(data.error);
      if (data?.failed) {
        await refetch();
        throw new Error(`${data.queued || 0} invoice(s) queued, but ${data.failed} could not be queued. Check the billing queue and retry.`);
      }
      return data;
    }, 'Outstanding membership invoices queued for issue and email');

  const refreshOwnXeroInvoices = () =>
    runAction('xero:own', async () => {
      const { data, error: functionError } = await supabase.functions.invoke('member-xero-balance', {
        body: { action: 'invoices', userId: user?.id, priorityRefresh: true },
      });
      if (functionError) throw functionError;
      if (data?.error) throw new Error(data.error);
      return data;
    }, 'Xero membership payment refreshed');

  const collectApprovedMembership = (targetUserId: string) =>
    runAction(`stripe:membership:${targetUserId}`, async () => {
      const { data, error: functionError } = await supabase.functions.invoke(
        'membership-payment-setup',
        {
          body: {
            action: 'collect-approved-membership',
            userId: targetUserId,
          },
        },
      );
      if (functionError) throw functionError;
      if (data?.error) throw new Error(data.error);
      if (data?.attempted === false) {
        const reason = String(data?.reason || '').replace(/_/g, ' ');
        throw new Error(reason || 'The membership payment was not collected.');
      }
      if (data?.status === 'failed') {
        throw new Error(data?.error || 'The membership payment failed.');
      }
      return data;
    }, 'Membership payment submitted');

  const savePaymentPreference = async (input: {
    paymentMethod: MembershipPaymentMethod;
    autoRenew: boolean;
    scholarshipContributionEnabled: boolean;
    scholarshipContributionAmount: number;
    authorityAccepted: boolean;
    forceSetup?: boolean;
  }) => {
    setBusyAction('payment-preference');
    try {
      const returnUrl = `${window.location.origin}/membership`;
      const { data, error: functionError } = await supabase.functions.invoke('membership-payment-setup', {
        body: {
          action: 'save',
          ...input,
          successUrl: `${returnUrl}?payment_setup=success`,
          cancelUrl: `${returnUrl}?payment_setup=cancelled`,
        },
      });
      if (functionError) throw functionError;
      if (data?.error) throw new Error(data.error);
      if (data?.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return data;
      }
      toast.success(input.paymentMethod === 'invoice' ? 'Invoice preference saved' : 'Payment preference saved');
      await refetch();
      return data;
    } catch (actionError) {
      toast.error(errorMessage(actionError, 'Payment preference could not be saved.'));
      throw actionError;
    } finally {
      setBusyAction(null);
    }
  };

  const cancelMembership = (reason: string) =>
    runAction('membership-cancel', async () => {
      const { data, error: functionError } = await supabase.functions.invoke('membership-payment-setup', {
        body: { action: 'cancel-membership', reason },
      });
      if (functionError) throw functionError;
      if (data?.error) throw new Error(data.error);
      return data;
    }, memberships.some(membership => membership.userId === user?.id && membership.legalStatus === 'current')
      ? 'Membership cancelled'
      : 'Membership application withdrawn');

  const requestMembershipChange = (input: {
    toMembershipClassCode: string;
    effectiveTiming: MembershipChangeTiming;
    reason: string;
  }) => runAction('membership-change:request', async () => {
    const { data, error: rpcError } = await supabase.rpc('request_membership_change', {
      p_to_membership_class_code: input.toMembershipClassCode,
      p_effective_timing: input.effectiveTiming,
      p_reason: input.reason,
    });
    if (rpcError) throw rpcError;
    return data;
  }, 'Membership change request submitted');

  const cancelMembershipChange = (requestId: string) =>
    runAction(`membership-change:${requestId}`, async () => {
      const { error: rpcError } = await supabase.rpc('cancel_membership_change_request', {
        p_request_id: requestId,
      });
      if (rpcError) throw rpcError;
    }, 'Membership change request cancelled');

  const decideMembershipChange = (
    requestId: string,
    decision: 'approve' | 'reject',
    reason: string,
  ) => runAction(`membership-change:${requestId}`, async () => {
    const { data, error: rpcError } = await supabase.rpc('decide_membership_change_request', {
      p_request_id: requestId,
      p_decision: decision,
      p_reason: reason,
    });
    if (rpcError) throw rpcError;
    return data;
  }, decision === 'approve' ? 'Membership change approved' : 'Membership change rejected');

  const changeMembership = (input: {
    membershipId: string;
    toMembershipClassCode: string;
    effectiveTiming: MembershipChangeTiming;
    reason: string;
  }) => runAction(`membership-change:${input.membershipId}`, async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_change_membership', {
      p_membership_id: input.membershipId,
      p_to_membership_class_code: input.toMembershipClassCode,
      p_effective_timing: input.effectiveTiming,
      p_reason: input.reason,
    });
    if (rpcError) throw rpcError;
    return data;
  }, input.effectiveTiming === 'immediate' ? 'Membership changed' : 'Membership change scheduled');

  const updateMembershipStatus = (input: {
    membershipId: string;
    legalStatus: MembershipLegalStatus;
    reason: string;
    membershipClassCode?: string;
  }) => runAction(`membership-status:${input.membershipId}`, async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_update_membership_status', {
      p_membership_id: input.membershipId,
      p_legal_status: input.legalStatus,
      p_reason: input.reason,
      p_membership_class_code: input.membershipClassCode || null,
    });
    if (rpcError) throw rpcError;
    return data;
  }, input.legalStatus === 'current' ? 'Membership restored' : 'Membership status updated');

  const runLifecycle = () =>
    runAction('lifecycle', async () => {
      const { data, error: rpcError } = await supabase.rpc('process_membership_lifecycle');
      if (rpcError) throw rpcError;
      return data;
    }, 'Membership lifecycle processed');

  const updateSettings = (
    updates: Partial<MembershipSettings>,
    updatedClasses: MembershipClass[] = classes,
  ) =>
    runAction('settings', async () => {
      const payload: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: user?.id || null };
      if (updates.rolloutMode !== undefined) payload.rollout_mode = updates.rolloutMode;
      if (updates.financialYearStartMonth !== undefined) payload.financial_year_start_month = updates.financialYearStartMonth;
      if (updates.financialYearStartDay !== undefined) payload.financial_year_start_day = updates.financialYearStartDay;
      if (updates.automaticCommencementDays !== undefined) payload.automatic_commencement_days = updates.automaticCommencementDays;
      if (updates.nonPaymentGraceDays !== undefined) payload.non_payment_grace_days = updates.nonPaymentGraceDays;
      if (updates.xeroStatusStaleHours !== undefined) payload.xero_status_stale_hours = updates.xeroStatusStaleHours;
      if (updates.xeroMembershipItemCode !== undefined) payload.xero_membership_item_code = updates.xeroMembershipItemCode?.trim() || null;
      if (updates.xeroScholarshipItemCode !== undefined) payload.xero_scholarship_item_code = updates.xeroScholarshipItemCode?.trim() || null;
      if (updates.xeroScholarshipAccountCode !== undefined) payload.xero_scholarship_account_code = updates.xeroScholarshipAccountCode?.trim() || null;
      if (updates.scholarshipContributionAvailable !== undefined) payload.scholarship_contribution_available = updates.scholarshipContributionAvailable;
      if (updates.scholarshipDefaultAmount !== undefined) payload.scholarship_default_amount = updates.scholarshipDefaultAmount;
      if (updates.scholarshipMinimumAmount !== undefined) payload.scholarship_minimum_amount = updates.scholarshipMinimumAmount;
      if (updates.requireStaffOverrideReason !== undefined) payload.require_staff_override_reason = updates.requireStaffOverrideReason;
      if (updates.prorationMethod !== undefined) payload.proration_method = updates.prorationMethod;
      if (updates.minimumProratedFee !== undefined) payload.minimum_prorated_fee = updates.minimumProratedFee;
      if (updates.renewalInvoiceLeadDays !== undefined) payload.renewal_invoice_lead_days = updates.renewalInvoiceLeadDays;
      if (updates.renewalReminderDaysBeforeDue !== undefined) payload.renewal_reminder_days_before_due = updates.renewalReminderDaysBeforeDue;
      if (updates.overdueReminderDays !== undefined) payload.overdue_reminder_days = updates.overdueReminderDays;
      if (updates.technicalRetryMinutes !== undefined) payload.technical_retry_minutes = updates.technicalRetryMinutes;
      if (updates.paymentRetryDays !== undefined) payload.payment_retry_days = updates.paymentRetryDays;
      if (updates.waiverTypes !== undefined) payload.waiver_types = updates.waiverTypes.map(value => value.trim()).filter(Boolean);
      if (updates.requireWaiverAuthorityReference !== undefined) payload.require_waiver_authority_reference = updates.requireWaiverAuthorityReference;
      if (updates.statutoryRegisterCleanupDays !== undefined) payload.statutory_register_cleanup_days = updates.statutoryRegisterCleanupDays;
      const { error: updateError } = await supabase.from('membership_settings').update(payload).eq('id', true);
      if (updateError) throw updateError;

      const { error: classError } = await supabase.rpc('save_membership_products', {
        p_products: updatedClasses.map((membershipClass, index) => ({
          id: membershipClass.id,
          code: membershipClass.code.trim().toLowerCase(),
          name: membershipClass.name.trim(),
          description: membershipClass.description.trim(),
          annualFee: Number(membershipClass.annualFee || 0),
          hasVotingRights: membershipClass.hasVotingRights,
          canSelfBookAircraft: membershipClass.canSelfBookAircraft,
          isFeeExempt: membershipClass.isFeeExempt,
          isActive: membershipClass.isActive,
          sortOrder: membershipClass.sortOrder || index + 1,
          xeroItemCode: membershipClass.xeroItemCode?.trim().toUpperCase() || null,
          xeroAccountCode: membershipClass.xeroAccountCode?.trim().toUpperCase() || null,
        })),
      });
      if (classError) throw classError;
    }, 'Membership settings saved');

  const exportStatutoryRegister = async () => {
    setBusyAction('register:export');
    try {
      const { data, error: registerError } = await supabase
        .from('membership_statutory_register')
        .select('*')
        .order('name');
      if (registerError) throw registerError;
      const csv = statutoryRegisterCsv((data || []) as Array<Record<string, unknown>>);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `bfc-membership-register-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Privacy-minimised membership register exported');
    } catch (exportError) {
      toast.error(errorMessage(exportError, 'The membership register could not be exported.'));
      throw exportError;
    } finally {
      setBusyAction(null);
    }
  };

  const ownApplication = useMemo(
    () => applications.find(application => application.userId === user?.id && application.status === 'pending'),
    [applications, user?.id],
  );
  const ownMembership = useMemo(() => memberships.find(membership => membership.userId === user?.id), [memberships, user?.id]);
  const ownPeriods = useMemo(
    () => ownMembership ? periods.filter(period => period.membershipId === ownMembership.id) : [],
    [ownMembership, periods],
  );
  const ownPaymentPreference = useMemo(
    () => paymentPreferences.find(preference => preference.userId === user?.id),
    [paymentPreferences, user?.id],
  );
  const ownChangeRequest = useMemo(
    () => changeRequests.find(request =>
      request.userId === user?.id
      && ['pending', 'approved', 'needs_review'].includes(request.status)
    ),
    [changeRequests, user?.id],
  );

  return {
    isAdmin,
    classes,
    applications,
    memberships,
    changeRequests,
    periods,
    paymentPreferences,
    settings,
    ownApplication,
    ownMembership,
    ownPeriods,
    ownPaymentPreference,
    ownChangeRequest,
    loading,
    busyAction,
    error,
    refetch,
    decideApplication,
    submitApplication,
    setFeeDisposition,
    authorizeFeeWaiver,
    importLegacyMembership,
    importLegacyMembershipCsv,
    createOrRefreshXeroInvoice,
    refreshAllXeroInvoices,
    issueMembershipRenewals,
    refreshOwnXeroInvoices,
    collectApprovedMembership,
    savePaymentPreference,
    cancelMembership,
    requestMembershipChange,
    cancelMembershipChange,
    decideMembershipChange,
    changeMembership,
    updateMembershipStatus,
    runLifecycle,
    updateSettings,
    exportStatutoryRegister,
  };
};

export const membershipStatusLabel = (value?: string | null) =>
  (value || 'not recorded').replace(/_/g, ' ').replace(/^./, (character: string) => character.toUpperCase());

export const isFinanciallyCleared = (value?: MembershipFeeDisposition | null) =>
  value === 'paid' || value === 'waived' || value === 'fee_exempt';

export const rolloutModeDescription: Record<MembershipRolloutMode, string> = {
  information_only: 'Show membership information without changing booking behaviour.',
  staff_warning: 'Warn staff and collect overrides; member self-booking remains unchanged during data review.',
  enforced: 'Block aircraft self-booking unless the member is financially cleared. Staff can override with a reason.',
};
