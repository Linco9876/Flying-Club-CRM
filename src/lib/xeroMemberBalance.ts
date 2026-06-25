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

export interface XeroPortalInvoice {
  invoiceId: string;
  invoiceNumber: string;
  reference: string;
  status: string;
  date: string;
  dueDate: string;
  currency: string;
  total: number;
  amountPaid: number;
  amountCredited: number;
  amountDue: number;
  url: string;
}

export interface XeroPortalInvoicesResponse extends XeroMemberBalance {
  invoices: XeroPortalInvoice[];
}

export interface XeroInvoicePaymentResponse {
  paidWithCredit?: boolean;
  creditApplied?: number;
  amountToPay?: number;
  allocations?: Array<Record<string, unknown>>;
  checkoutUrl?: string;
  sessionId?: string;
  paymentRecordId?: string;
  invoice?: XeroPortalInvoice;
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

export const fetchOwnXeroInvoices = async () => {
  const { data, error } = await supabase.functions.invoke<XeroPortalInvoicesResponse>('member-xero-balance', {
    body: { action: 'invoices' },
  });

  if (error) {
    throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to load Xero invoices'));
  }

  return data ?? { connected: false, invoices: [] };
};

export const payOwnXeroInvoice = async ({
  invoiceId,
  useCredit = true,
  successUrl,
  cancelUrl,
}: {
  invoiceId: string;
  useCredit?: boolean;
  successUrl?: string;
  cancelUrl?: string;
}) => {
  const { data, error } = await supabase.functions.invoke<XeroInvoicePaymentResponse>('member-xero-balance', {
    body: {
      action: 'pay-invoice',
      invoiceId,
      useCredit,
      successUrl,
      cancelUrl,
    },
  });

  if (error) {
    throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to prepare invoice payment'));
  }

  return data ?? {};
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
