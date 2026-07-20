import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  ClubMembership,
  MembershipApplication,
  MembershipClass,
  MembershipFeeDisposition,
  MembershipFinancialPeriod,
  MembershipRolloutMode,
  MembershipSettings,
} from '../types';

interface MembershipClassRow {
  id: string;
  code: MembershipClass['code'];
  name: string;
  annual_fee: number | string | null;
  has_voting_rights: boolean | null;
  is_fee_exempt: boolean | null;
  is_active: boolean | null;
  sort_order: number | string | null;
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
  member?: { name?: string; email?: string } | null;
  membership_class?: { name?: string; code?: MembershipClass['code']; has_voting_rights?: boolean } | null;
}

interface MembershipFinancialPeriodRow {
  id: string;
  membership_id: string;
  financial_year_start: string;
  financial_year_end: string;
  standard_fee: number | string | null;
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
  waiver_reason: string | null;
  waiver_authorised_by: string | null;
  waiver_authorised_at: string | null;
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
  annualFee: Number(row.annual_fee || 0),
  hasVotingRights: Boolean(row.has_voting_rights),
  isFeeExempt: Boolean(row.is_fee_exempt),
  isActive: Boolean(row.is_active),
  sortOrder: Number(row.sort_order || 0),
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
  membershipClassName: row.membership_class?.name,
  membershipClassCode: row.membership_class?.code,
  hasVotingRights: Boolean(row.membership_class?.has_voting_rights),
});

const mapPeriod = (row: MembershipFinancialPeriodRow): MembershipFinancialPeriod => ({
  id: row.id,
  membershipId: row.membership_id,
  financialYearStart: row.financial_year_start,
  financialYearEnd: row.financial_year_end,
  standardFee: Number(row.standard_fee || 0),
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
  waiverReason: row.waiver_reason,
  waiverAuthorisedBy: row.waiver_authorised_by,
  waiverAuthorisedAt: row.waiver_authorised_at,
});

export const useMembership = () => {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.role === 'admin' || user?.roles?.includes('admin'));
  const [classes, setClasses] = useState<MembershipClass[]>([]);
  const [applications, setApplications] = useState<MembershipApplication[]>([]);
  const [memberships, setMemberships] = useState<ClubMembership[]>([]);
  const [periods, setPeriods] = useState<MembershipFinancialPeriod[]>([]);
  const [settings, setSettings] = useState<MembershipSettings>({
    rolloutMode: 'staff_warning',
    automaticCommencementDays: 30,
    nonPaymentGraceDays: 60,
    xeroStatusStaleHours: 24,
    xeroMembershipItemCode: null,
    requireStaffOverrideReason: true,
  });
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [classesResult, settingsResult, applicationsResult, membershipsResult, periodsResult] = await Promise.all([
        supabase.from('membership_classes').select('*').order('sort_order'),
        supabase.from('membership_settings').select('*').eq('id', true).maybeSingle(),
        supabase.from('membership_applications').select(`
          *,
          applicant:users!membership_applications_user_id_fkey(name,email),
          membership_class:membership_classes!membership_applications_membership_class_id_fkey(name,code)
        `).order('submitted_at', { ascending: false }),
        supabase.from('club_memberships').select(`
          *,
          member:users!club_memberships_user_id_fkey(name,email),
          membership_class:membership_classes!club_memberships_membership_class_id_fkey(name,code,has_voting_rights)
        `).order('commenced_at', { ascending: false }),
        supabase.from('membership_financial_periods').select('*').order('financial_year_start', { ascending: false }),
      ]);

      const firstError = classesResult.error || settingsResult.error || applicationsResult.error || membershipsResult.error || periodsResult.error;
      if (firstError) throw firstError;
      setClasses(((classesResult.data || []) as MembershipClassRow[]).map(mapClass));
      setApplications(((applicationsResult.data || []) as MembershipApplicationRow[]).map(mapApplication));
      setMemberships(((membershipsResult.data || []) as ClubMembershipRow[]).map(mapMembership));
      setPeriods(((periodsResult.data || []) as MembershipFinancialPeriodRow[]).map(mapPeriod));
      if (settingsResult.data) {
        setSettings({
          rolloutMode: settingsResult.data.rollout_mode,
          automaticCommencementDays: Number(settingsResult.data.automatic_commencement_days || 30),
          nonPaymentGraceDays: Number(settingsResult.data.non_payment_grace_days || 60),
          xeroStatusStaleHours: Number(settingsResult.data.xero_status_stale_hours || 24),
          xeroMembershipItemCode: settingsResult.data.xero_membership_item_code,
          requireStaffOverrideReason: Boolean(settingsResult.data.require_staff_override_reason),
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
      return data;
    }, decision === 'approve' ? 'Membership approved' : 'Application rejected');

  const submitApplication = (input: {
    membershipClassCode: string;
    residentialAddress: string;
    serviceAddress: string;
    dateOfBirth?: string;
    guardianName?: string;
    guardianConsent: boolean;
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

  const importLegacyMembership = (input: {
    userId: string;
    membershipClassCode: string;
    commencedAt: string;
    feeDisposition: 'invoice_required' | 'paid' | 'waived';
    reason?: string;
  }) => runAction('membership:import', async () => {
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
        throw new Error(`${data.issued} invoice(s) issued, but ${data.failed} failed. Check Xero links and member email addresses, then retry.`);
      }
      return data;
    }, 'Outstanding membership invoices issued and emailed from Xero');

  const refreshOwnXeroInvoices = () =>
    runAction('xero:own', async () => {
      const { data, error: functionError } = await supabase.functions.invoke('member-xero-balance', {
        body: { action: 'invoices', userId: user?.id, priorityRefresh: true },
      });
      if (functionError) throw functionError;
      if (data?.error) throw new Error(data.error);
      return data;
    }, 'Xero membership payment refreshed');

  const runLifecycle = () =>
    runAction('lifecycle', async () => {
      const { data, error: rpcError } = await supabase.rpc('process_membership_lifecycle');
      if (rpcError) throw rpcError;
      return data;
    }, 'Membership lifecycle processed');

  const updateSettings = (updates: Partial<MembershipSettings>) =>
    runAction('settings', async () => {
      const payload: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: user?.id || null };
      if (updates.rolloutMode !== undefined) payload.rollout_mode = updates.rolloutMode;
      if (updates.automaticCommencementDays !== undefined) payload.automatic_commencement_days = updates.automaticCommencementDays;
      if (updates.nonPaymentGraceDays !== undefined) payload.non_payment_grace_days = updates.nonPaymentGraceDays;
      if (updates.xeroStatusStaleHours !== undefined) payload.xero_status_stale_hours = updates.xeroStatusStaleHours;
      if (updates.xeroMembershipItemCode !== undefined) payload.xero_membership_item_code = updates.xeroMembershipItemCode?.trim() || null;
      if (updates.requireStaffOverrideReason !== undefined) payload.require_staff_override_reason = updates.requireStaffOverrideReason;
      const { error: updateError } = await supabase.from('membership_settings').update(payload).eq('id', true);
      if (updateError) throw updateError;
    }, 'Membership settings saved');

  const ownApplication = useMemo(() => applications.find(application => application.userId === user?.id), [applications, user?.id]);
  const ownMembership = useMemo(() => memberships.find(membership => membership.userId === user?.id), [memberships, user?.id]);
  const ownPeriods = useMemo(
    () => ownMembership ? periods.filter(period => period.membershipId === ownMembership.id) : [],
    [ownMembership, periods],
  );

  return {
    isAdmin,
    classes,
    applications,
    memberships,
    periods,
    settings,
    ownApplication,
    ownMembership,
    ownPeriods,
    loading,
    busyAction,
    error,
    refetch,
    decideApplication,
    submitApplication,
    setFeeDisposition,
    importLegacyMembership,
    createOrRefreshXeroInvoice,
    refreshAllXeroInvoices,
    issueMembershipRenewals,
    refreshOwnXeroInvoices,
    runLifecycle,
    updateSettings,
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
