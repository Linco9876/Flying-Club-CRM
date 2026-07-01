import { supabase } from './supabase';

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
  };
};

export const fetchUserPrepaidLedgerBalance = async (userId: string) => {
  const { data, error } = await supabase
    .from('account_transactions')
    .select('user_id, type, amount, verified_status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return summarisePrepaidLedger((data || []) as LedgerTransactionRow[]);
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
    summaries[userId] = summarisePrepaidLedger(rows);
  });
  return summaries;
};
