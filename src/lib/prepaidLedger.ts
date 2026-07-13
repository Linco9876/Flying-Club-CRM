import { supabase } from './supabase';
import { fetchAllMemberXeroBalances, fetchUserXeroBalance } from './xeroMemberBalance';

export type LedgerTransactionType = 'topup' | 'flight_charge' | 'refund' | 'adjustment';
export type LedgerVerificationStatus = 'pending' | 'verified' | 'rejected' | null | undefined;

export interface LedgerTransactionRow {
  user_id: string;
  type: LedgerTransactionType;
  amount: number | string | null;
  verified_status?: LedgerVerificationStatus;
  created_at?: string | null;
}

export interface PrepaidLedgerSummary {
  verifiedBalance: number;
  pendingTopups: number;
  totalTransactions: number;
  lastTransactionDate: string | null;
  eligibleForPrepaid: boolean;
  source: 'xero' | 'crm_disabled';
  xeroConnected: boolean;
}

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const normaliseAmount = (value: number | string | null | undefined) =>
  roundMoney(Number(value || 0));

export const getLedgerDelta = (type: LedgerTransactionType, amount: number) => {
  const magnitude = Math.abs(normaliseAmount(amount));
  if (type === 'topup' || type === 'refund') return magnitude;
  return -magnitude;
};

export const summarisePrepaidLedger = (rows: LedgerTransactionRow[]): PrepaidLedgerSummary => {
  let verifiedBalance = 0;
  let pendingTopups = 0;
  let lastTransactionDate: string | null = null;

  rows.forEach(row => {
    const amount = normaliseAmount(row.amount);
    if (!lastTransactionDate && row.created_at) {
      lastTransactionDate = row.created_at;
    }

    if (row.type === 'topup' && row.verified_status === 'pending') {
      pendingTopups = roundMoney(pendingTopups + Math.abs(amount));
    }

    if (row.verified_status !== 'verified') return;
    verifiedBalance = roundMoney(verifiedBalance + getLedgerDelta(row.type, amount));
  });

  return {
    verifiedBalance,
    pendingTopups,
    totalTransactions: rows.length,
    lastTransactionDate,
    eligibleForPrepaid: verifiedBalance > 0.005,
    source: 'crm_disabled',
    xeroConnected: false,
  };
};

const zeroSummary = (rows: LedgerTransactionRow[] = [], xeroConnected = false): PrepaidLedgerSummary => {
  const pendingAndHistory = summarisePrepaidLedger(rows);
  return {
    ...pendingAndHistory,
    verifiedBalance: 0,
    eligibleForPrepaid: false,
    source: 'crm_disabled',
    xeroConnected,
  };
};

export const fetchUserPrepaidLedgerBalance = async (userId: string) => {
  const { data, error } = await supabase
    .from('account_transactions')
    .select('user_id, type, amount, verified_status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  const rows = (data || []) as LedgerTransactionRow[];

  try {
    const xero = await fetchUserXeroBalance(userId);
    if (xero.connected) {
      const pendingAndHistory = summarisePrepaidLedger(rows);
      const verifiedBalance = Math.round((Number(xero.availableCredit || 0) + Number.EPSILON) * 100) / 100;
      return {
        ...pendingAndHistory,
        verifiedBalance,
        eligibleForPrepaid: Boolean(xero.eligibleForPrepaid ?? verifiedBalance > 0.005),
        source: 'xero' as const,
        xeroConnected: true,
      };
    }
  } catch (xeroError) {
    console.warn('Unable to load Xero prepaid balance; legacy CRM balance will not be used:', xeroError);
  }

  return zeroSummary(rows);
};

export const fetchAllPrepaidLedgerBalances = async () => {
  const { data, error } = await supabase
    .from('account_transactions')
    .select('user_id, type, amount, verified_status, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const byUser = new Map<string, LedgerTransactionRow[]>();
  ((data || []) as LedgerTransactionRow[]).forEach(row => {
    const current = byUser.get(row.user_id) || [];
    current.push(row);
    byUser.set(row.user_id, current);
  });

  const summaries: Record<string, PrepaidLedgerSummary> = {};
  byUser.forEach((rows, userId) => {
    summaries[userId] = zeroSummary(rows);
  });

  try {
    const xero = await fetchAllMemberXeroBalances();
    if (xero.connected) {
      (xero.balances || []).forEach(balance => {
        if (!balance.userId) return;
        const pendingAndHistory = summaries[balance.userId] || zeroSummary([]);
        const verifiedBalance = Math.round((Number(balance.availableCredit || 0) + Number.EPSILON) * 100) / 100;
        summaries[balance.userId] = {
          ...pendingAndHistory,
          verifiedBalance,
          eligibleForPrepaid: Boolean(balance.eligibleForPrepaid ?? verifiedBalance > 0.005),
          source: 'xero',
          xeroConnected: true,
        };
      });
    }
  } catch (xeroError) {
    console.warn('Unable to load all Xero prepaid balances; legacy CRM balances will not be used:', xeroError);
  }

  return summaries;
};
