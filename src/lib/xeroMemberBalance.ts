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
  paidWithSavedCard?: boolean;
  creditApplied?: number;
  amountToPay?: number;
  stripePaymentIntentId?: string;
  xeroPaymentId?: string;
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
  paymentMode = 'checkout',
  successUrl,
  cancelUrl,
}: {
  invoiceId: string;
  useCredit?: boolean;
  paymentMode?: 'checkout' | 'saved_card';
  successUrl?: string;
  cancelUrl?: string;
}) => {
  const { data, error } = await supabase.functions.invoke<XeroInvoicePaymentResponse>('member-xero-balance', {
    body: {
      action: 'pay-invoice',
      invoiceId,
      useCredit,
      paymentMode,
      successUrl,
      cancelUrl,
    },
  });

  if (error) {
    throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to prepare invoice payment'));
  }

  return data ?? {};
};

export const openOwnXeroInvoicePdf = async (invoiceId: string) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error('You need to be logged in to view this invoice');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const response = await fetch(`${supabaseUrl}/functions/v1/member-xero-balance`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      action: 'invoice-pdf',
      invoiceId,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let message = 'Failed to load invoice';
    try {
      const payload = JSON.parse(text);
      message = payload?.error || message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
