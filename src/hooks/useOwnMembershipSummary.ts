import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface OwnMembershipSummary {
  applicationStatus: string | null;
  automaticCommencementAt: string | null;
  legalStatus: string | null;
  membershipClassName: string | null;
  hasVotingRights: boolean | null;
  commencedAt: string | null;
  financialYearEnd: string | null;
  feeDisposition: string | null;
  amountDue: number;
  dueDate: string | null;
  graceExpiresAt: string | null;
  financiallyCleared: boolean;
  paymentMethod: string | null;
  paymentMethodDisplay: string | null;
  autoRenew: boolean;
  xeroLinked: boolean;
  billingSyncStatus: string | null;
  billingSyncAttempts: number;
  billingSyncNextAttemptAt: string | null;
  billingSyncError: string | null;
  lastCollectionStatus: string | null;
  lastCollectionError: string | null;
}

const EMPTY_SUMMARY: OwnMembershipSummary = {
  applicationStatus: null,
  automaticCommencementAt: null,
  legalStatus: null,
  membershipClassName: null,
  hasVotingRights: null,
  commencedAt: null,
  financialYearEnd: null,
  feeDisposition: null,
  amountDue: 0,
  dueDate: null,
  graceExpiresAt: null,
  financiallyCleared: false,
  paymentMethod: null,
  paymentMethodDisplay: null,
  autoRenew: false,
  xeroLinked: false,
  billingSyncStatus: null,
  billingSyncAttempts: 0,
  billingSyncNextAttemptAt: null,
  billingSyncError: null,
  lastCollectionStatus: null,
  lastCollectionError: null,
};

const firstRelation = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const isFinanciallyCleared = (value?: string | null) =>
  value === 'paid' || value === 'waived' || value === 'fee_exempt';

export const useOwnMembershipSummary = (userId?: string) => {
  const [summary, setSummary] = useState<OwnMembershipSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!userId) {
        setSummary(EMPTY_SUMMARY);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const [membershipResult, applicationResult, preferenceResult, userResult] = await Promise.all([
          supabase
            .from('club_memberships')
            .select('id, legal_status, commenced_at, membership_class:membership_class_id(name, has_voting_rights)')
            .eq('user_id', userId)
            .order('commenced_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('membership_applications')
            .select('status, automatic_commencement_at')
            .eq('user_id', userId)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('membership_payment_preferences')
            .select('payment_method, payment_method_display, auto_renew, last_collection_status, last_collection_error')
            .eq('user_id', userId)
            .maybeSingle(),
          supabase
            .from('users')
            .select('xero_contact_id')
            .eq('id', userId)
            .maybeSingle(),
        ]);

        const firstError = membershipResult.error || applicationResult.error || preferenceResult.error || userResult.error;
        if (firstError) throw firstError;

        const membership = membershipResult.data as any;
        let period: any = null;
        if (membership?.id) {
          const periodResult = await supabase
            .from('membership_financial_periods')
            .select('financial_year_end, fee_disposition, amount_due, due_date, grace_expires_at, billing_sync_status, billing_sync_attempts, billing_sync_next_attempt_at, billing_sync_error')
            .eq('membership_id', membership.id)
            .order('financial_year_start', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (periodResult.error) throw periodResult.error;
          period = periodResult.data;
        }

        if (!active) return;
        const membershipClass = firstRelation<any>(membership?.membership_class);
        setSummary({
          applicationStatus: applicationResult.data?.status || null,
          automaticCommencementAt: applicationResult.data?.automatic_commencement_at || null,
          legalStatus: membership?.legal_status || null,
          membershipClassName: membershipClass?.name || null,
          hasVotingRights: membershipClass?.has_voting_rights == null
            ? null
            : Boolean(membershipClass.has_voting_rights),
          commencedAt: membership?.commenced_at || null,
          financialYearEnd: period?.financial_year_end || null,
          feeDisposition: period?.fee_disposition || null,
          amountDue: Number(period?.amount_due || 0),
          dueDate: period?.due_date || null,
          graceExpiresAt: period?.grace_expires_at || null,
          financiallyCleared: isFinanciallyCleared(period?.fee_disposition),
          paymentMethod: preferenceResult.data?.payment_method || null,
          paymentMethodDisplay: preferenceResult.data?.payment_method_display || null,
          autoRenew: Boolean(preferenceResult.data?.auto_renew),
          xeroLinked: Boolean(userResult.data?.xero_contact_id),
          billingSyncStatus: period?.billing_sync_status || null,
          billingSyncAttempts: Number(period?.billing_sync_attempts || 0),
          billingSyncNextAttemptAt: period?.billing_sync_next_attempt_at || null,
          billingSyncError: period?.billing_sync_error || null,
          lastCollectionStatus: preferenceResult.data?.last_collection_status || null,
          lastCollectionError: preferenceResult.data?.last_collection_error || null,
        });
      } catch (error) {
        console.error('Failed to load profile membership summary:', error);
        if (active) setSummary(EMPTY_SUMMARY);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [userId]);

  return { summary, loading };
};
