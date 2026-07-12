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
  outstandingInvoiceTotal?: number;
  netBalance?: number;
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

type CachedValue<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const CLIENT_XERO_READ_CACHE_MS = 60_000;
const xeroReadCache = new Map<string, CachedValue<any>>();

const clearOwnXeroReadCache = () => {
  xeroReadCache.delete('self');
  xeroReadCache.delete('invoices');
};

const cachedXeroRead = async <T>(key: string, loader: () => Promise<T>, forceRefresh = false) => {
  const now = Date.now();
  const cached = xeroReadCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = loader().catch((error) => {
    xeroReadCache.delete(key);
    throw error;
  });
  xeroReadCache.set(key, {
    expiresAt: now + CLIENT_XERO_READ_CACHE_MS,
    promise,
  });
  return promise;
};

export const fetchOwnXeroBalance = async () => {
  return cachedXeroRead<XeroMemberBalance>('self', async () => {
    const { data, error } = await supabase.functions.invoke<XeroMemberBalance>('member-xero-balance', {
      body: { action: 'self' },
    });

    if (error) {
      throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to load Xero balance'));
    }

    return data ?? { connected: false };
  });
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

export const fetchOwnXeroInvoices = async (options: { forceRefresh?: boolean } = {}) => {
  return cachedXeroRead<XeroPortalInvoicesResponse>('invoices', async () => {
    const { data, error } = await supabase.functions.invoke<XeroPortalInvoicesResponse>('member-xero-balance', {
      body: { action: 'invoices' },
    });

    if (error) {
      throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to load Xero invoices'));
    }

    return data ?? { connected: false, invoices: [] };
  }, options.forceRefresh === true);
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
  clearOwnXeroReadCache();
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

  clearOwnXeroReadCache();
  return data ?? {};
};

const safePdfFilename = (value: string) => {
  const clean = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${clean || 'BFC-Invoice'}.pdf`;
};

export const openOwnXeroInvoicePdf = async (invoiceId: string, invoiceNumber?: string | null) => {
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
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.download = safePdfFilename(invoiceNumber ? `BFC-Invoice-${invoiceNumber}` : `BFC-Invoice-${invoiceId}`);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 300_000);
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
