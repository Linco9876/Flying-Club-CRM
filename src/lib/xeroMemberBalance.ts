import { supabase } from './supabase';
import { getSupabaseFunctionErrorMessage } from './supabaseFunctionErrors';

export interface XeroMemberBalance {
  connected: boolean;
  userId?: string;
  name?: string;
  email?: string;
  xeroContactId?: string | null;
  linked?: boolean;
  availableCredit?: number;
  overpaymentCredit?: number;
  prepaymentCredit?: number;
  minimumPrepaidPack?: number;
  eligibleForPrepaid?: boolean;
}

export interface XeroMemberBalanceListResponse {
  connected: boolean;
  minimumPrepaidPack?: number;
  balances?: Array<XeroMemberBalance>;
}

export const fetchOwnXeroBalance = async () => {
  const { data, error } = await supabase.functions.invoke<XeroMemberBalance>('member-xero-balance', {
    body: { action: 'self' },
  });

  if (error) {
    throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to load Xero balance'));
  }

  return data ?? { connected: false };
};

export const fetchUserXeroBalance = async (userId: string) => {
  const { data, error } = await supabase.functions.invoke<XeroMemberBalance>('member-xero-balance', {
    body: { action: 'user', userId },
  });

  if (error) {
    throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to load Xero balance'));
  }

  return data ?? { connected: false };
};

export const fetchAllMemberXeroBalances = async () => {
  const { data, error } = await supabase.functions.invoke<XeroMemberBalanceListResponse>('member-xero-balance', {
    body: { action: 'all' },
  });

  if (error) {
    throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to load member Xero balances'));
  }

  return data ?? { connected: false, balances: [] };
};
