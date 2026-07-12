import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TransactionsTab } from './TransactionsTab';
import { PilotAccountsTab } from './PilotAccountsTab';
import { StripeTestModeBanner } from './StripeTestModeBanner';
import { XeroSyncQueueCard } from '../Settings/XeroSyncQueueCard';
import { useBillingAccounts } from '../../hooks/useBillingAccounts';
import { CreditCard, ExternalLink, FileText, GitBranch, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, Users, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePortalUxSettings } from '../../hooks/useSettings';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { PortalSectionLoader } from '../Layout/PortalSectionLoader';
import { usePageLoadState } from '../../context/PageLoadContext';
import { supabase } from '../../lib/supabase';
import { getSupabaseFunctionErrorMessage } from '../../lib/supabaseFunctionErrors';
import { fetchOwnXeroInvoices, openOwnXeroInvoicePdf, payOwnXeroInvoice, XeroPortalInvoice } from '../../lib/xeroMemberBalance';
import { writeStripeLoadingPage } from '../../utils/stripePopup';
import toast from 'react-hot-toast';

const creditTypes = new Set(['topup', 'refund']);

const getSignedTransactionAmount = (type: string, amount: number) =>
  creditTypes.has(type) ? Math.abs(amount) : -Math.abs(amount);

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

interface BillingDashboardProps {
  mode?: 'auto' | 'own' | 'financial';
}

interface StripeCardStatus {
  configured: boolean;
  connected: boolean;
  consentText: string;
  card: null | {
    id: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
    consentAcceptedAt: string | null;
  };
}

export const BillingDashboard: React.FC<BillingDashboardProps> = ({ mode = 'auto' }) => {
  const [activeTab, setActiveTab] = useState('transactions');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpPaymentMethodId, setTopUpPaymentMethodId] = useState('');
  const [topUpReference, setTopUpReference] = useState('');
  const [topUpDate, setTopUpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submittingTopUp, setSubmittingTopUp] = useState(false);
  const [stripeCardStatus, setStripeCardStatus] = useState<StripeCardStatus | null>(null);
  const [stripeCardLoading, setStripeCardLoading] = useState(true);
  const [stripeConsentAccepted, setStripeConsentAccepted] = useState(false);
  const [xeroInvoices, setXeroInvoices] = useState<XeroPortalInvoice[]>([]);
  const [xeroCredit, setXeroCredit] = useState({
    availableCredit: 0,
    overpaymentCredit: 0,
    prepaymentCredit: 0,
    eligibleForPrepaid: false,
  });
  const [xeroInvoicesLoading, setXeroInvoicesLoading] = useState(true);
  const [xeroInvoicesChecked, setXeroInvoicesChecked] = useState(false);
  const [ownXeroConnected, setOwnXeroConnected] = useState<boolean | null>(null);
  const [xeroInvoicesLinked, setXeroInvoicesLinked] = useState(true);
  const [invoicePaymentLoadingId, setInvoicePaymentLoadingId] = useState<string | null>(null);
  const [invoiceViewingId, setInvoiceViewingId] = useState<string | null>(null);
  const invoiceViewRequestsRef = useRef<Set<string>>(new Set());
  const billing = useBillingAccounts();
  const { user } = useAuth();
  const { settings: portalSettings } = usePortalUxSettings();
  const { paymentMethods, loading: paymentMethodsLoading } = useBillingSettings();
  const userRoles = user?.roles && user.roles.length > 0 ? user.roles : (user?.role ? [user.role] : []);
  const isAdminBilling = userRoles.includes('admin');
  const isStudentOrPilotOnly = userRoles.some(role => ['student', 'pilot'].includes(role)) &&
    !userRoles.some(role => ['admin', 'instructor', 'senior_instructor'].includes(role));
  const showOwnBillingOnly = mode === 'own' || (mode === 'auto' && !isAdminBilling);

  const loadStripeCardStatus = useCallback(async () => {
    if (!user?.id) {
      setStripeCardLoading(false);
      return;
    }
    setStripeCardLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<StripeCardStatus>('member-card-setup', {
        body: { action: 'status' },
      });
      if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to load saved card status'));
      setStripeCardStatus(data ?? null);
    } catch (error: any) {
      console.warn('Failed to load saved card status:', error);
      setStripeCardStatus(null);
    } finally {
      setStripeCardLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!showOwnBillingOnly) {
      setStripeCardLoading(false);
      return;
    }
    void loadStripeCardStatus();
  }, [loadStripeCardStatus, showOwnBillingOnly]);

  const loadXeroInvoices = useCallback(async (options: { forceRefresh?: boolean } = {}) => {
    if (!showOwnBillingOnly || !user?.id) {
      setXeroInvoicesLoading(false);
      setXeroInvoicesChecked(true);
      return;
    }
    setXeroInvoicesLoading(true);
    try {
      const data = await fetchOwnXeroInvoices(options);
      setOwnXeroConnected(Boolean(data.connected));
      setXeroInvoices(data.invoices || []);
      setXeroInvoicesLinked(data.linked !== false);
      setXeroCredit({
        availableCredit: Number(data.availableCredit || 0),
        overpaymentCredit: Number(data.overpaymentCredit || 0),
        prepaymentCredit: Number(data.prepaymentCredit || 0),
        eligibleForPrepaid: Boolean(data.eligibleForPrepaid),
      });
    } catch (error: any) {
      console.warn('Failed to load Xero invoices:', error);
      toast.error(error?.message || 'Failed to load Xero invoices');
      setOwnXeroConnected(false);
      setXeroInvoices([]);
      setXeroCredit({
        availableCredit: 0,
        overpaymentCredit: 0,
        prepaymentCredit: 0,
        eligibleForPrepaid: false,
      });
    } finally {
      setXeroInvoicesChecked(true);
      setXeroInvoicesLoading(false);
    }
  }, [showOwnBillingOnly, user?.id]);

  useEffect(() => {
    void loadXeroInvoices();
  }, [loadXeroInvoices]);

  useEffect(() => {
    if (!showOwnBillingOnly) return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get('card_setup');
    const invoicePaymentResult = params.get('xero_invoice');
    if (!result && !invoicePaymentResult) return;

    if (result === 'success') {
      toast.success('Card saved for future flight payments');
      void loadStripeCardStatus();
    } else if (result === 'cancelled') {
      toast('Card setup cancelled');
    }

    if (invoicePaymentResult === 'success') {
      toast.success('Invoice payment received. Xero will update shortly.');
      void loadXeroInvoices();
    } else if (invoicePaymentResult === 'cancelled') {
      toast('Invoice payment cancelled');
    }

    params.delete('card_setup');
    params.delete('xero_invoice');
    params.delete('session_id');
    const cleanQuery = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`);
  }, [loadStripeCardStatus, loadXeroInvoices, showOwnBillingOnly]);

  const handleSaveStripeCard = async () => {
    if (!stripeConsentAccepted) {
      toast.error('Accept the card-on-file authority before saving a card');
      return;
    }

    const checkoutWindow = window.open('about:blank', '_blank');
    if (checkoutWindow) {
      checkoutWindow.opener = null;
      writeStripeLoadingPage(checkoutWindow, {
        title: 'Opening secure card setup',
        message: 'Preparing your encrypted Stripe card setup page for future flight payments.',
      });
    }

    setStripeCardLoading(true);
    try {
      const returnUrl = `${window.location.origin}/billing`;
      const { data, error } = await withTimeout(
        supabase.functions.invoke<{ checkoutUrl?: string }>('member-card-setup', {
          body: {
            action: 'start',
            consentAccepted: true,
            successUrl: `${returnUrl}?card_setup=success`,
            cancelUrl: `${returnUrl}?card_setup=cancelled`,
          },
        }),
        30000,
        'Stripe card setup is taking too long. Please close the Stripe window and try again.'
      );
      if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to start card setup'));
      if (!data?.checkoutUrl) throw new Error('Stripe did not return a setup link');
      if (checkoutWindow) {
        checkoutWindow.location.href = data.checkoutUrl;
      } else {
        window.location.href = data.checkoutUrl;
      }
    } catch (error: any) {
      checkoutWindow?.close();
      console.error('Failed to start card setup:', error);
      toast.error(error?.message || 'Failed to start card setup');
    } finally {
      setStripeCardLoading(false);
    }
  };

  const handleRemoveStripeCard = async () => {
    if (!window.confirm('Remove your saved card from automatic flight payments?')) return;
    setStripeCardLoading(true);
    try {
      const { error } = await supabase.functions.invoke('member-card-setup', {
        body: { action: 'remove' },
      });
      if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to remove saved card'));
      toast.success('Saved card removed');
      setStripeConsentAccepted(false);
      await loadStripeCardStatus();
    } catch (error: any) {
      console.error('Failed to remove saved card:', error);
      toast.error(error?.message || 'Failed to remove saved card');
    } finally {
      setStripeCardLoading(false);
    }
  };

  const pageLoading = billing.loading || paymentMethodsLoading || (showOwnBillingOnly && (stripeCardLoading || xeroInvoicesLoading || !xeroInvoicesChecked));
  usePageLoadState(
    pageLoading,
    showOwnBillingOnly ? 'Loading your balance' : 'Loading financial dashboard',
    showOwnBillingOnly
      ? 'Checking Xero credit, saved card status and recent transactions...'
      : 'Loading transactions, payment methods, Xero invoices and sync status...'
  );
  if (pageLoading) {
    return (
      <div className="p-3 sm:p-6">
        <PortalSectionLoader
          message={showOwnBillingOnly ? 'Loading your balance' : 'Loading financial dashboard'}
          detail={showOwnBillingOnly
            ? 'Checking Xero credit, saved card status and recent transactions...'
            : 'Loading transactions, pilot accounts, payment methods and Xero sync status...'}
        />
      </div>
    );
  }

  if (showOwnBillingOnly) {
    if (isStudentOrPilotOnly && !portalSettings.show_invoices_in_portal) {
      return <div className="p-3 text-sm text-gray-500 sm:p-6">Billing history is not available in the student portal.</div>;
    }

    const account = billing.pilotAccounts.find(item => item.userId === user?.id);
    const transactions = billing.transactions.filter(item => item.userId === user?.id);
    const accountTopUpPaymentMethods = paymentMethods.filter(method => method.active && method.allowAccountTopup !== false);
    const approvedBalance = account?.balance ?? 0;
    const pendingTopUpAmount = transactions
      .filter(transaction => transaction.type === 'topup' && transaction.verifiedStatus === 'pending')
      .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
    const currencyFormatter = (amount: number) =>
      `$${amount.toFixed(portalSettings.currency_decimals)}`;
    const dateLocale = portalSettings.date_format === 'MM/dd/yyyy' ? 'en-US' : 'en-AU';
    const xeroConnectedForOwnBilling = ownXeroConnected ?? billing.xeroConnected;
    const displayedCredit = xeroConnectedForOwnBilling ? xeroCredit.availableCredit : approvedBalance;
    const prepaidEligible = xeroConnectedForOwnBilling ? xeroCredit.eligibleForPrepaid : approvedBalance > 0.005;
    const outstandingInvoiceTotal = xeroInvoices.reduce((total, invoice) => total + Math.max(0, Number(invoice.amountDue || 0)), 0);
    const formatInvoiceDate = (value: string) => {
      if (!value) return '-';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString(dateLocale);
    };
    const getInvoiceStatusClass = (status: string, amountDue: number) => {
      const normalised = status.toUpperCase();
      if (amountDue <= 0.005 || normalised === 'PAID') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200';
      if (normalised === 'AUTHORISED' || normalised === 'SUBMITTED') return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
    };
    const handlePayXeroInvoice = async (invoice: XeroPortalInvoice, paymentMode: 'checkout' | 'saved_card') => {
      if (invoice.amountDue <= 0.005) return;
      if (paymentMode === 'saved_card' && !stripeCardStatus?.card) {
        toast.error('Save a card before using saved-card invoice payments');
        return;
      }
      const checkoutWindow = paymentMode === 'checkout' ? window.open('about:blank', '_blank') : null;
      if (checkoutWindow) {
        checkoutWindow.opener = null;
        writeStripeLoadingPage(checkoutWindow, {
          title: 'Preparing invoice payment',
          message: 'Checking Xero credit first, then opening Stripe only for anything still owing.',
        });
      }

      setInvoicePaymentLoadingId(invoice.invoiceId);
      try {
        const returnUrl = `${window.location.origin}/billing`;
        const result = await payOwnXeroInvoice({
          invoiceId: invoice.invoiceId,
          useCredit: true,
          paymentMode,
          successUrl: `${returnUrl}?xero_invoice=success`,
          cancelUrl: `${returnUrl}?xero_invoice=cancelled`,
        });

        if (result.paidWithCredit || result.paidWithSavedCard || result.invoice) {
          checkoutWindow?.close();
          if (result.paidWithSavedCard) {
            toast.success(result.creditApplied && result.creditApplied > 0
              ? `Applied ${currencyFormatter(result.creditApplied)} Xero credit and charged saved card for the rest`
              : 'Saved card charged and Xero invoice updated');
          } else {
            toast.success(result.creditApplied && result.creditApplied > 0
              ? `Applied ${currencyFormatter(result.creditApplied)} Xero credit`
              : 'Invoice is already settled');
          }
          await loadXeroInvoices();
          return;
        }

        if (!result.checkoutUrl) {
          checkoutWindow?.close();
          toast.success(result.creditApplied && result.creditApplied > 0
            ? `Applied ${currencyFormatter(result.creditApplied)} Xero credit`
            : 'No card payment needed');
          await loadXeroInvoices();
          return;
        }

        if (result.creditApplied && result.creditApplied > 0) {
          toast.success(`Applied ${currencyFormatter(result.creditApplied)} Xero credit. Opening card payment for the remaining amount.`);
        }

        if (checkoutWindow) {
          checkoutWindow.location.href = result.checkoutUrl;
        } else {
          window.location.href = result.checkoutUrl;
        }
      } catch (error: any) {
        checkoutWindow?.close();
        console.error('Failed to prepare Xero invoice payment:', error);
        toast.error(error?.message || 'Failed to prepare invoice payment');
      } finally {
        setInvoicePaymentLoadingId(null);
      }
    };

    const handleViewXeroInvoice = async (invoice: XeroPortalInvoice) => {
      if (invoiceViewRequestsRef.current.has(invoice.invoiceId)) return;
      invoiceViewRequestsRef.current.add(invoice.invoiceId);
      setInvoiceViewingId(invoice.invoiceId);
      try {
        await openOwnXeroInvoicePdf(invoice.invoiceId);
      } catch (error: any) {
        console.error('Failed to open Xero invoice PDF:', error);
        toast.error(error?.message || 'Failed to open invoice');
      } finally {
        invoiceViewRequestsRef.current.delete(invoice.invoiceId);
        setInvoiceViewingId(null);
      }
    };

    const handleTopUpSubmit = async (event: React.FormEvent) => {
      event.preventDefault();
      if (!user?.id) return;

      const amount = Number(topUpAmount);
      if (!Number.isFinite(amount) || amount < billing.minimumPrepaidPack || amount % billing.minimumPrepaidPack !== 0) {
        toast.error(`Top-ups must be made in ${currencyFormatter(billing.minimumPrepaidPack)} increments.`);
        return;
      }

      setSubmittingTopUp(true);
      try {
        const methodName = accountTopUpPaymentMethods.find(method => method.id === topUpPaymentMethodId)?.name;
        const description = topUpReference.trim()
          ? `Funds added by member: ${topUpReference.trim()}`
          : methodName
            ? `Funds added by member via ${methodName}`
            : 'Funds added by member';
        await billing.addTopUp(user.id, amount, description, topUpPaymentMethodId || undefined, topUpDate);
        setTopUpAmount('');
        setTopUpPaymentMethodId('');
        setTopUpReference('');
        setTopUpDate(new Date().toISOString().slice(0, 10));
      } finally {
        setSubmittingTopUp(false);
      }
    };

    return (
      <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
        <StripeTestModeBanner />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Billing</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {xeroConnectedForOwnBilling
              ? 'Review your Xero credit, invoices owing, saved card and billing history.'
              : 'Review your verified prepaid balance, pending top-ups, and billing history.'}
          </p>
        </div>

        {!xeroConnectedForOwnBilling && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                  <Wallet className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-amber-950 dark:text-amber-100">Xero is not connected right now</h2>
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                    Your verified CRM prepaid balance still works here. Xero invoices and automatic reconciliation stay hidden until the club reconnects Xero.
                  </p>
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    An admin can reconnect Xero from Settings &gt; Integrations. If Xero was just connected, refresh this page.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setXeroInvoicesChecked(false);
                  void Promise.all([billing.refetch(), loadXeroInvoices({ forceRefresh: true })]);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-[#171a21] dark:text-amber-100 dark:hover:bg-amber-950/40"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </section>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {xeroConnectedForOwnBilling ? 'Xero credit available' : 'Verified prepaid balance'}
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{currencyFormatter(displayedCredit)}</p>
            {xeroConnectedForOwnBilling && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Overpayments {currencyFormatter(xeroCredit.overpaymentCredit)} / Prepayments {currencyFormatter(xeroCredit.prepaymentCredit)}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {xeroConnectedForOwnBilling ? 'Invoices owing in Xero' : 'Pending approval'}
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-900 dark:text-amber-100">
              {currencyFormatter(xeroConnectedForOwnBilling ? outstandingInvoiceTotal : pendingTopUpAmount)}
            </p>
            {xeroConnectedForOwnBilling && pendingTopUpAmount > 0.005 && (
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                {currencyFormatter(pendingTopUpAmount)} submitted in CRM, awaiting admin verification.
              </p>
            )}
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/20">
            <p className="text-sm text-blue-700 dark:text-blue-300">Prepaid rate access</p>
            <p className="mt-1 text-2xl font-bold text-blue-900 dark:text-blue-100">{prepaidEligible ? 'Unlocked' : 'Locked'}</p>
            <p className="mt-1 text-xs text-blue-800 dark:text-blue-200">
              {xeroConnectedForOwnBilling
                ? `Requires positive Xero credit. Top-ups are made in ${currencyFormatter(billing.minimumPrepaidPack)} increments.`
                : `Requires a positive verified prepaid balance. Top-ups are made in ${currencyFormatter(billing.minimumPrepaidPack)} increments.`}
            </p>
          </div>
        </div>

        {xeroConnectedForOwnBilling && (
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 dark:border-[#2c2f36] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Xero invoices</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  All invoices linked to your Xero contact, including invoices created outside the CRM.
                </p>
                {xeroCredit.availableCredit > 0.005 && (
                  <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                    Available Xero credit is applied first. If it does not cover the invoice, you can pay the difference by saved card or checkout.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
                Owing {currencyFormatter(outstandingInvoiceTotal)}
              </span>
              <button
                type="button"
                onClick={() => loadXeroInvoices({ forceRefresh: true })}
                disabled={xeroInvoicesLoading}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-[#363b45] dark:text-gray-200 dark:hover:bg-[#20242c]"
              >
                <RefreshCw className={`h-4 w-4 ${xeroInvoicesLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {!xeroInvoicesLinked ? (
            <div className="p-5 text-sm text-amber-800 dark:text-amber-200">
              Your CRM account is not linked to a Xero contact yet, so invoices cannot be shown here.
            </div>
          ) : xeroInvoices.length === 0 ? (
            <p className="p-5 text-sm text-gray-500 dark:text-gray-400">No Xero invoices found for your account.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-[#2c2f36]">
              {xeroInvoices.map(invoice => {
                const amountDue = Number(invoice.amountDue || 0);
                return (
                  <div key={invoice.invoiceId} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_12rem] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {invoice.invoiceNumber || 'Xero invoice'}
                        </p>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getInvoiceStatusClass(invoice.status, amountDue)}`}>
                          {amountDue <= 0.005 ? 'Paid' : invoice.status || 'Open'}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">
                        {invoice.reference || 'No reference'}
                      </p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Invoice {formatInvoiceDate(invoice.date)} · Due {formatInvoiceDate(invoice.dueDate)}
                      </p>
                    </div>
                    <div className="lg:text-right">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Total</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{currencyFormatter(Number(invoice.total || 0))}</p>
                    </div>
                    <div className="lg:text-right">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Owing</p>
                      <p className={`text-sm font-semibold ${amountDue > 0.005 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                        {currencyFormatter(amountDue)}
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-2 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => handleViewXeroInvoice(invoice)}
                        disabled={invoiceViewingId === invoice.invoiceId}
                        className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-[#363b45] dark:text-gray-200 dark:hover:bg-[#20242c]"
                      >
                        {invoiceViewingId === invoice.invoiceId ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        Invoice
                      </button>
                      {amountDue > 0.005 && (
                        <button
                          type="button"
                          onClick={() => handlePayXeroInvoice(invoice, 'checkout')}
                          disabled={invoicePaymentLoadingId === invoice.invoiceId}
                          className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          {invoicePaymentLoadingId === invoice.invoiceId ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                          Pay checkout
                        </button>
                      )}
                      {amountDue > 0.005 && stripeCardStatus?.card && (
                        <button
                          type="button"
                          onClick={() => handlePayXeroInvoice(invoice, 'saved_card')}
                          disabled={invoicePaymentLoadingId === invoice.invoiceId}
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200 dark:hover:bg-blue-950/50"
                        >
                          {invoicePaymentLoadingId === invoice.invoiceId ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                          Saved card
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        )}

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-100 p-2 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Saved card for flight payments</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Your card is saved securely with Stripe. The CRM stores only a card reference, brand and last four digits.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadStripeCardStatus}
              disabled={stripeCardLoading}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-[#363b45] dark:text-gray-200 dark:hover:bg-[#20242c]"
            >
              {stripeCardLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Refresh
            </button>
          </div>

          {stripeCardStatus?.card ? (
            <div className="mt-4 flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                  {stripeCardStatus.card.brand || 'Card'} ending {stripeCardStatus.card.last4 || '----'}
                </p>
                <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                  Expires {String(stripeCardStatus.card.expMonth || '').padStart(2, '0')}/{stripeCardStatus.card.expYear || '----'}
                  {stripeCardStatus.card.consentAcceptedAt
                    ? ` · Authority accepted ${new Date(stripeCardStatus.card.consentAcceptedAt).toLocaleDateString(dateLocale)}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setStripeConsentAccepted(false)}
                  className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-[#171a21] dark:text-emerald-100"
                >
                  Replace card below
                </button>
                <button
                  type="button"
                  onClick={handleRemoveStripeCard}
                  disabled={stripeCardLoading}
                  className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:bg-[#171a21] dark:text-red-200"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
              No saved card is active for automatic flight payments.
            </div>
          )}

          <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-[#2c2f36] dark:bg-[#11141a]">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={stripeConsentAccepted}
                onChange={event => setStripeConsentAccepted(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-200">
                {stripeCardStatus?.consentText || 'I authorise Bendigo Flying Club to securely store my card with Stripe and charge my saved card for flight charges, aircraft hire, training flights, and related flying charges that are logged and confirmed in the Members Flight Management System. I understand the final amount may be calculated after the flight from the aircraft rate, flight type, tach/flight time, instructor charges, and any approved adjustments. I understand my card details are stored by Stripe, not by the CRM, and I can remove or replace my saved card from my portal. If a charge fails, I remain responsible for the outstanding balance.'}
              </span>
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Use this only if you agree to card-on-file billing for confirmed flight charges. Card numbers never touch the CRM.
              </p>
              <button
                type="button"
                onClick={handleSaveStripeCard}
                disabled={stripeCardLoading || !stripeConsentAccepted || !stripeCardStatus?.connected}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-[#363b45]"
              >
                {stripeCardLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                {stripeCardStatus?.card ? 'Replace saved card' : 'Save card with Stripe'}
              </button>
            </div>
            {stripeCardStatus && !stripeCardStatus.connected && (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-200">
                Stripe is not connected for this club yet, so cards cannot be saved.
              </p>
            )}
          </div>
        </section>

        <form onSubmit={handleTopUpSubmit} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-600 dark:text-blue-300" />
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Add funds</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {xeroConnectedForOwnBilling
                  ? `Submitted funds appear as pending until an admin verifies them. They are not counted as Xero credit until reconciled in Xero. Top-ups must be in ${currencyFormatter(billing.minimumPrepaidPack)} increments.`
                  : `Submitted funds appear as pending until an admin approves the payment. Top-ups must be in ${currencyFormatter(billing.minimumPrepaidPack)} increments.`}
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(9rem,0.7fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(12rem,1.4fr)_auto] md:items-end">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Amount</span>
              <input
                type="number"
                min={billing.minimumPrepaidPack}
                step={billing.minimumPrepaidPack}
                value={topUpAmount}
                onChange={event => setTopUpAmount(event.target.value)}
                placeholder={String(billing.minimumPrepaidPack)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Payment method</span>
              <select
                value={topUpPaymentMethodId}
                onChange={event => setTopUpPaymentMethodId(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
              >
                <option value="">Select method</option>
                {accountTopUpPaymentMethods.map(method => (
                  <option key={method.id} value={method.id}>{method.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Payment date</span>
              <input
                type="date"
                value={topUpDate}
                onChange={event => setTopUpDate(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Reference or note</span>
              <input
                type="text"
                value={topUpReference}
                onChange={event => setTopUpReference(event.target.value)}
                placeholder="Receipt number, bank reference..."
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
              />
            </label>
            <button
              type="submit"
              disabled={submittingTopUp || !Number(topUpAmount) || Number(topUpAmount) < billing.minimumPrepaidPack || Number(topUpAmount) % billing.minimumPrepaidPack !== 0}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-[#363b45]"
            >
              <Plus className="h-4 w-4" />
              Add funds
            </button>
          </div>
        </form>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-[#2c2f36]">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Billing history</h2>
          </div>
          {transactions.length === 0 ? (
            <p className="p-5 text-sm text-gray-500 dark:text-gray-400">No billing transactions recorded yet.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-[#2c2f36]">
              {transactions.map(transaction => {
                const signedAmount = getSignedTransactionAmount(transaction.type, transaction.amount);
                return (
                  <div key={transaction.id} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{transaction.description || transaction.type}</p>
                        {transaction.verifiedStatus !== 'verified' && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            transaction.verifiedStatus === 'pending'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                              : 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200'
                          }`}>
                            {transaction.verifiedStatus}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {new Date(transaction.createdAt).toLocaleDateString(dateLocale)}
                        {transaction.paymentMethodName ? ` · ${transaction.paymentMethodName}` : ''}
                      </p>
                    </div>
                    <p className={`text-sm font-semibold ${signedAmount >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                      {signedAmount >= 0 ? '+' : '-'}{currencyFormatter(Math.abs(signedAmount))}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'transactions', label: 'Transactions', icon: <CreditCard className="h-4 w-4" /> },
    { id: 'accounts', label: 'Pilot Accounts', icon: <Users className="h-4 w-4" /> },
    ...(isAdminBilling && !showOwnBillingOnly
      ? [{ id: 'xero-sync', label: 'Xero Sync', icon: <GitBranch className="h-4 w-4" /> }]
      : []),
  ];

  return (
      <div className="p-3 sm:p-6">
      <div className="mb-4">
        <StripeTestModeBanner />
      </div>
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Financial Dashboard</h1>
        <p className="text-gray-600">Manage organisation transactions and pilot accounts</p>
      </div>

      {/* Tab Navigation */}
      <div className="app-tab-scroller">
        <nav className="app-tab-list">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`app-tab-button ${
                activeTab === tab.id
                  ? 'app-tab-button-active'
                  : ''
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'transactions' && <TransactionsTab billing={billing} />}
        {activeTab === 'accounts' && <PilotAccountsTab billing={billing} />}
        {activeTab === 'xero-sync' && isAdminBilling && !showOwnBillingOnly && <XeroSyncQueueCard />}
      </div>
    </div>
  );
};
