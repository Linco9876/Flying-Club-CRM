import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useFinancialProviders } from '../context/financialProviderState';

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
  financeEnabled: boolean;
  stripeAvailable: boolean;
  xeroAvailable: boolean;
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
  financeEnabled: false,
  stripeAvailable: false,
  xeroAvailable: false,
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
  const { capabilities, loading: providersLoading } = useFinancialProviders();
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
      if (providersLoading) return;

      setLoading(true);
      try {
        const [membershipResult, applicationResult, userResult] = await Promise.all([
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
            .from('users')
            .select('xero_contact_id')
            .eq('id', userId)
            .maybeSingle(),
        ]);

        const firstError = membershipResult.error || applicationResult.error || userResult.error;
        if (firstError) throw firstError;

        const membership = membershipResult.data as any;
        const xeroLinked = capabilities.xero.accountingAvailable &&
          Boolean(userResult.data?.xero_contact_id);
        let period: any = null;
        let preference: any = null;
        if (capabilities.financeEnabled) {
          const preferenceResult = await supabase
            .from('membership_payment_preferences')
            .select('payment_method, payment_method_display, auto_renew, last_collection_status, last_collection_error')
            .eq('user_id', userId)
            .maybeSingle();
          if (preferenceResult.error) throw preferenceResult.error;
          preference = preferenceResult.data;
        }
        if (membership?.id && capabilities.financeEnabled) {
          const periodResult = await supabase
            .from('membership_financial_periods')
            .select('financial_year_start, financial_year_end, fee_disposition, amount_due, due_date, grace_expires_at, billing_sync_status, billing_sync_attempts, billing_sync_next_attempt_at, billing_sync_error')
            .eq('membership_id', membership.id)
            .lte('financial_year_start', new Date().toISOString().slice(0, 10))
            .gte('financial_year_end', new Date().toISOString().slice(0, 10))
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
          paymentMethod: preference?.payment_method || null,
          paymentMethodDisplay: preference?.payment_method_display || null,
          autoRenew: Boolean(preference?.auto_renew),
          xeroLinked,
          financeEnabled: capabilities.financeEnabled,
          stripeAvailable: capabilities.stripe.paymentsAvailable,
          xeroAvailable: capabilities.xero.accountingAvailable,
          billingSyncStatus: period?.billing_sync_status || null,
          billingSyncAttempts: Number(period?.billing_sync_attempts || 0),
          billingSyncNextAttemptAt: period?.billing_sync_next_attempt_at || null,
          billingSyncError: period?.billing_sync_error || null,
          lastCollectionStatus: preference?.last_collection_status || null,
          lastCollectionError: preference?.last_collection_error || null,
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
  }, [
    capabilities.financeEnabled,
    capabilities.stripe.paymentsAvailable,
    capabilities.xero.accountingAvailable,
    providersLoading,
    userId,
  ]);

  return { summary, loading };
};
