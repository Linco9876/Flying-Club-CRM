import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { StripeTestModeBanner } from './StripeTestModeBanner';
import { useBillingAccounts } from '../../hooks/useBillingAccounts';
import { AlertTriangle, CreditCard, ExternalLink, FileText, GitBranch, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, Users, Wallet, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePortalUxSettings } from '../../hooks/useSettings';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { PortalSectionLoader } from '../Layout/PortalSectionLoader';
import { usePageLoadState } from '../../context/PageLoadContext';
import { supabase } from '../../lib/supabase';
import { getSupabaseFunctionErrorMessage } from '../../lib/supabaseFunctionErrors';
import { fetchOwnXeroInvoices, openOwnXeroInvoicePdf, payOwnXeroInvoice, publishXeroMemberBalance, XeroPortalInvoice } from '../../lib/xeroMemberBalance';
import { writeStripeLoadingPage } from '../../utils/stripePopup';
import { getMemberBillingState } from '../../utils/memberBillingState';
import toast from 'react-hot-toast';

const TransactionsTab = lazy(() => import('./TransactionsTab').then(module => ({ default: module.TransactionsTab })));
const PilotAccountsTab = lazy(() => import('./PilotAccountsTab').then(module => ({ default: module.PilotAccountsTab })));
const XeroSyncQueueCard = lazy(() => import('../Settings/XeroSyncQueueCard').then(module => ({ default: module.XeroSyncQueueCard })));

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
  const [showSavedCardModal, setShowSavedCardModal] = useState(false);
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const invoiceViewRequestsRef = useRef<Set<string>>(new Set());
  const savedCardTriggerRef = useRef<HTMLButtonElement>(null);
  const savedCardDialogRef = useRef<HTMLElement>(null);
  const { user } = useAuth();
  const { settings: portalSettings } = usePortalUxSettings();
  const userRoles = user?.roles && user.roles.length > 0 ? user.roles : (user?.role ? [user.role] : []);
  const isAdminBilling = userRoles.includes('admin');
  const isStudentOrPilotOnly = userRoles.some(role => ['student', 'pilot'].includes(role)) &&
    !userRoles.some(role => ['admin', 'instructor', 'senior_instructor'].includes(role));
  const showOwnBillingOnly = mode === 'own' || (mode === 'auto' && !isAdminBilling);
  const { paymentMethods, loading: paymentMethodsLoading } = useBillingSettings({ paymentMethodsOnly: showOwnBillingOnly });
  const billing = useBillingAccounts({
    scope: showOwnBillingOnly ? 'member' : 'admin',
    userId: showOwnBillingOnly ? user?.id : null,
    enabled: !showOwnBillingOnly || Boolean(user?.id),
  });
  const stripeCardReady = Boolean(
    stripeCardStatus?.card?.id &&
    stripeCardStatus.card.brand &&
    /^\d{4}$/.test(stripeCardStatus.card.last4 || '') &&
    Number(stripeCardStatus.card.expMonth || 0) >= 1 &&
    Number(stripeCardStatus.card.expMonth || 0) <= 12 &&
    Number(stripeCardStatus.card.expYear || 0) >= new Date().getFullYear()
  );

  useEffect(() => {
    if (!showSavedCardModal) return undefined;

    const previousOverflow = document.body.style.overflow;
    const dialog = savedCardDialogRef.current;
    const triggerElement = savedCardTriggerRef.current;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const focusableElements = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)) : [];
    focusableElements[0]?.focus();

    const handleDialogKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSavedCardModal(false);
        return;
      }
      if (event.key !== 'Tab' || focusableElements.length === 0) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleDialogKeyboard);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleDialogKeyboard);
      triggerElement?.focus();
    };
  }, [showSavedCardModal]);

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
      publishXeroMemberBalance(data);
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
      publishXeroMemberBalance(null);
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
    const topUpResult = params.get('topup');
    if (!result && !invoicePaymentResult && !topUpResult) return;

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

    if (topUpResult === 'success') {
      toast.success('Top-up payment received. Refreshing Xero credit now...');
      setXeroInvoicesChecked(false);
      void Promise.all([
        billing.refetch(),
        loadXeroInvoices({ forceRefresh: true }),
      ]);
    } else if (topUpResult === 'cancelled') {
      toast('Top-up payment cancelled');
    }

    params.delete('card_setup');
    params.delete('xero_invoice');
    params.delete('topup');
    params.delete('session_id');
    const cleanQuery = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`);
  }, [billing, loadStripeCardStatus, loadXeroInvoices, showOwnBillingOnly]);

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

  const pageLoading = billing.loading || paymentMethodsLoading || (showOwnBillingOnly && (xeroInvoicesLoading || !xeroInvoicesChecked));
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

    const transactions = billing.transactions.filter(item => item.userId === user?.id);
    const accountTopUpPaymentMethods = paymentMethods.filter(method => method.active && method.allowAccountTopup !== false);
    const selectedTopUpMethod = accountTopUpPaymentMethods.find(method => method.id === topUpPaymentMethodId);
    const isStripeTopUpSelected =
      selectedTopUpMethod?.systemKey === 'stripe_card' ||
      selectedTopUpMethod?.name.toLowerCase().includes('stripe');
    const pendingTopUpAmount = transactions
      .filter(transaction => transaction.type === 'topup' && transaction.verifiedStatus === 'pending')
      .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
    const awaitingXeroTopUpAmount = transactions
      .filter(transaction =>
        transaction.type === 'topup' &&
        transaction.verifiedStatus === 'verified' &&
        !['synced', 'matched'].includes(transaction.xeroSyncStatus || '')
      )
      .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
    const currencyFormatter = (amount: number) =>
      `$${amount.toFixed(portalSettings.currency_decimals)}`;
    const dateLocale = portalSettings.date_format === 'MM/dd/yyyy' ? 'en-US' : 'en-AU';
    const memberBillingState = getMemberBillingState({
      xeroConnected: ownXeroConnected,
      memberLinked: xeroInvoicesLinked,
    });
    const xeroAccountLinked = memberBillingState === 'linked';
    const displayedCredit = xeroCredit.availableCredit;
    const prepaidEligible = xeroAccountLinked && xeroCredit.eligibleForPrepaid;
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
        await openOwnXeroInvoicePdf(invoice.invoiceId, invoice.invoiceNumber);
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
        const methodName = selectedTopUpMethod?.name;

        if (isStripeTopUpSelected) {
          const checkoutWindow = window.open('about:blank', '_blank');
          if (checkoutWindow) {
            checkoutWindow.opener = null;
            writeStripeLoadingPage(checkoutWindow, {
              title: 'Opening secure Stripe top-up...',
              message: 'Once Stripe confirms payment, your CRM top-up will be verified automatically and synced to Xero as account credit.',
            });
          }

          const returnUrl = `${window.location.origin}/billing`;
          const { data, error } = await supabase.functions.invoke('create-member-topup-checkout', {
            body: {
              userId: user.id,
              amount,
              sendEmail: false,
              triggerReason: 'member_balance_tab',
              successUrl: `${returnUrl}?topup=success`,
              cancelUrl: `${returnUrl}?topup=cancelled`,
            },
          });

          if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to create Stripe top-up checkout'));
          if (!data?.checkoutUrl) throw new Error('Stripe checkout did not return a payment link');

          if (checkoutWindow) {
            checkoutWindow.location.href = data.checkoutUrl;
          } else {
            window.location.href = data.checkoutUrl;
          }

          toast.success('Stripe checkout opened. Your credit will update after payment is confirmed.');
          setTopUpAmount('');
          setTopUpPaymentMethodId('');
          setTopUpReference('');
          setTopUpDate(new Date().toISOString().slice(0, 10));
          return;
        }

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

    const processingFundsTotal = pendingTopUpAmount + awaitingXeroTopUpAmount;
    const visibleTransactions = showAllTransactions ? transactions : transactions.slice(0, 8);
    const prepaidStatusMessage = prepaidEligible
      ? 'Prepaid aircraft rates are available on your account.'
      : 'A positive cleared balance is required to use prepaid aircraft rates.';
    const refreshXeroAccount = () => {
      setXeroInvoicesChecked(false);
      void Promise.all([billing.refetch(), loadXeroInvoices({ forceRefresh: true })]);
    };

    return (
      <div className="space-y-5 p-3 sm:space-y-6 sm:p-6">
        <StripeTestModeBanner />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Balance &amp; billing</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Your Bendigo Flying Club flying account. All prices and charges include GST.</p>
        </div>

        {memberBillingState === 'temporarily-unavailable' && (
          <section className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
              <div>
                <h2 className="text-sm font-semibold">Your current balance is temporarily unavailable</h2>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">Try refreshing in a moment. Contact the club if this continues.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <button
                type="button"
                ref={savedCardTriggerRef}
                onClick={() => setShowSavedCardModal(true)}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-[#171a21] dark:text-amber-100 dark:hover:bg-amber-950/40"
              >
                <CreditCard className="h-4 w-4" />
                Manage payment card
              </button>
              <button
                type="button"
                onClick={refreshXeroAccount}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-[#171a21] dark:text-amber-100 dark:hover:bg-amber-950/40"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </section>
        )}

        {memberBillingState === 'setup-required' && (
          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/20 sm:p-6" aria-labelledby="billing-setup-title">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200">
                  <Wallet className="h-5 w-5" />
                </span>
                <div>
                  <h2 id="billing-setup-title" className="font-semibold text-blue-950 dark:text-blue-100">Billing account setup required</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-blue-800 dark:text-blue-200">
                    Your portal account is not linked to a Xero contact, so no balance is available to display. Contact a club administrator to have your billing account set up.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <button
                  type="button"
                  ref={savedCardTriggerRef}
                  onClick={() => setShowSavedCardModal(true)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-blue-800 dark:bg-[#171a21] dark:text-blue-100 dark:hover:bg-blue-950/40"
                >
                  <CreditCard className="h-4 w-4" />
                  Manage payment card
                </button>
                <button
                  type="button"
                  onClick={refreshXeroAccount}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-blue-300 bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-blue-700"
                >
                  <RefreshCw className="h-4 w-4" />
                  Check again
                </button>
              </div>
            </div>
          </section>
        )}

        {xeroAccountLinked && (
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]" aria-labelledby="account-balance-title">
          <div className="bg-gradient-to-br from-blue-700 to-blue-600 p-5 text-white sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p id="account-balance-title" className="text-sm font-medium text-blue-100">Available balance</p>
                <p className="mt-1 text-4xl font-bold tracking-tight">
                  {currencyFormatter(displayedCredit)}
                </p>
                <p className="mt-2 max-w-xl text-sm text-blue-100">
                  Cleared funds available for flying and eligible account charges.
                </p>
              </div>
              <span className={`inline-flex w-fit items-center rounded-full px-3 py-1.5 text-sm font-semibold ${
                prepaidEligible
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-900'
              }`}>
                Prepaid access {prepaidEligible ? 'unlocked' : 'locked'}
              </span>
            </div>
            <p className="mt-4 text-sm text-blue-50">{prepaidStatusMessage}</p>
          </div>

          <div className="grid divide-y divide-gray-200 dark:divide-[#2c2f36] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="p-4 sm:p-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">Invoices owing</p>
              <p className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">
                {currencyFormatter(outstandingInvoiceTotal)}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {outstandingInvoiceTotal > 0.005 ? 'Payment is required on open invoices.' : 'Nothing currently due.'}
              </p>
            </div>
            <div className="p-4 sm:p-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">Funds processing</p>
              <p className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">{currencyFormatter(processingFundsTotal)}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {processingFundsTotal > 0.005 ? 'Submitted funds will appear after confirmation.' : 'No payments awaiting confirmation.'}
              </p>
            </div>
            <div className="p-4 sm:p-5">
              <button
                type="button"
                ref={savedCardTriggerRef}
                onClick={() => setShowSavedCardModal(true)}
                className="flex w-full items-center gap-3 rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-[#171a21]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
                  <CreditCard className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">Manage payment card</span>
                  <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
                    {stripeCardLoading
                      ? 'Checking card status…'
                      : stripeCardReady && stripeCardStatus?.card
                      ? `${stripeCardStatus.card.brand || 'Card'} ending ${stripeCardStatus.card.last4 || '----'}`
                      : stripeCardStatus?.card
                        ? 'Saved card needs attention'
                        : 'No saved card'}
                  </span>
                </span>
              </button>
            </div>
          </div>
        </section>
        )}

        {xeroAccountLinked && (
        <form onSubmit={handleTopUpSubmit} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Add funds</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Add funds in {currencyFormatter(billing.minimumPrepaidPack)} increments. Card payments update automatically; manual payments appear after confirmation.
              </p>
            </div>
          </div>
          <div className={`grid gap-3 md:items-end ${
            isStripeTopUpSelected
              ? 'md:grid-cols-[minmax(9rem,0.7fr)_minmax(12rem,1fr)_auto]'
              : selectedTopUpMethod
                ? 'md:grid-cols-[minmax(9rem,0.7fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(12rem,1.4fr)_auto]'
                : 'md:grid-cols-[minmax(9rem,0.7fr)_minmax(12rem,1fr)_auto]'
          }`}>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Amount</span>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-500 dark:text-gray-400">$</span>
                <input
                  type="number"
                  min={billing.minimumPrepaidPack}
                  step={billing.minimumPrepaidPack}
                  value={topUpAmount}
                  onChange={event => setTopUpAmount(event.target.value)}
                  placeholder={String(billing.minimumPrepaidPack)}
                  className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-7 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
                  required
                />
              </div>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Payment method</span>
              <select
                value={topUpPaymentMethodId}
                onChange={event => setTopUpPaymentMethodId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
                required
              >
                <option value="">Select method</option>
                {accountTopUpPaymentMethods.map(method => (
                  <option key={method.id} value={method.id}>{method.name}</option>
                ))}
              </select>
            </label>
            {selectedTopUpMethod && !isStripeTopUpSelected && (
              <>
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Payment date</span>
                  <input
                    type="date"
                    value={topUpDate}
                    onChange={event => setTopUpDate(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Reference or note</span>
                  <input
                    type="text"
                    value={topUpReference}
                    onChange={event => setTopUpReference(event.target.value)}
                    placeholder="Receipt or bank reference"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
                  />
                </label>
              </>
            )}
            <button
              type="submit"
              disabled={submittingTopUp || !selectedTopUpMethod || !Number(topUpAmount) || Number(topUpAmount) < billing.minimumPrepaidPack || Number(topUpAmount) % billing.minimumPrepaidPack !== 0}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-[#363b45]"
            >
              {submittingTopUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {isStripeTopUpSelected ? 'Continue to payment' : 'Add funds'}
            </button>
          </div>
        </form>
        )}

        {xeroAccountLinked && (
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 dark:border-[#2c2f36] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Invoices</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">View or pay invoices linked to your club account.</p>
                {xeroCredit.availableCredit > 0.005 && (
                  <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                    Your available balance is applied before any card payment.
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
              Invoices are not available for this account yet. Contact the club if you expected to see one.
            </div>
          ) : xeroInvoices.length === 0 ? (
            <p className="p-5 text-sm text-gray-500 dark:text-gray-400">No invoices to show.</p>
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
                           Pay now
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
                           Use saved card
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

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <div className="flex flex-col gap-1 border-b border-gray-200 px-5 py-4 dark:border-[#2c2f36] sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Recent activity</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Payments, credits and flying charges.</p>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">{transactions.length} total</span>
          </div>
          {transactions.length === 0 ? (
            <p className="p-5 text-sm text-gray-500 dark:text-gray-400">No account activity yet.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-[#2c2f36]">
              {visibleTransactions.map(transaction => {
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
                            {transaction.verifiedStatus === 'pending' ? 'Processing' : 'Not approved'}
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
              {transactions.length > 8 && (
                <div className="px-5 py-3 text-center">
                  <button
                    type="button"
                    onClick={() => setShowAllTransactions(value => !value)}
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30"
                  >
                    {showAllTransactions ? 'Show recent only' : `View all ${transactions.length} transactions`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {showSavedCardModal && (
          <div
            className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/80 p-3 sm:p-6"
            role="presentation"
            onMouseDown={() => setShowSavedCardModal(false)}
          >
            <section
              ref={savedCardDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="saved-card-dialog-title"
              className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#363b45] dark:bg-[#171a21]"
              onMouseDown={event => event.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4 dark:border-[#2c2f36] dark:bg-[#171a21]">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 id="saved-card-dialog-title" className="font-semibold text-gray-950 dark:text-gray-100">Saved payment card</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Manage the card used for confirmed flight charges.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSavedCardModal(false)}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-300 dark:hover:bg-[#252a33] dark:hover:text-white"
                  aria-label="Close saved card settings"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4 p-5">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void loadStripeCardStatus()}
                    disabled={stripeCardLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-[#363b45] dark:text-gray-200 dark:hover:bg-[#20242c]"
                  >
                    <RefreshCw className={`h-4 w-4 ${stripeCardLoading ? 'animate-spin' : ''}`} />
                    Refresh status
                  </button>
                </div>

                {stripeCardLoading && !stripeCardStatus ? (
                  <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-[#2c2f36] dark:bg-[#11141a] dark:text-gray-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking your saved card…
                  </div>
                ) : stripeCardReady && stripeCardStatus?.card ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold capitalize text-emerald-950 dark:text-emerald-100">
                        {stripeCardStatus.card.brand || 'Card'} ending {stripeCardStatus.card.last4 || '----'}
                      </p>
                      <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                        Expires {String(stripeCardStatus.card.expMonth || '').padStart(2, '0')}/{stripeCardStatus.card.expYear || '----'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveStripeCard}
                      disabled={stripeCardLoading}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:bg-[#171a21] dark:text-red-200"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove card
                    </button>
                  </div>
                ) : stripeCardStatus?.card ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">Saved card needs attention</p>
                      <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">Remove or replace it before using saved-card payments.</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveStripeCard}
                      disabled={stripeCardLoading}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:bg-[#171a21] dark:text-red-200"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove card
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-[#2c2f36] dark:bg-[#11141a] dark:text-gray-200">
                    No saved card is currently active.
                  </div>
                )}

                <div className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-[#2c2f36]">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {stripeCardStatus?.card ? 'Replace saved card' : 'Save a card'}
                    </h3>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Your card details are stored by Stripe, not by the CRM.</p>
                  </div>
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={stripeConsentAccepted}
                      onChange={event => setStripeConsentAccepted(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm leading-6 text-gray-700 dark:text-gray-200">
                      {stripeCardStatus?.consentText || 'I authorise Bendigo Flying Club to securely store my card with Stripe and charge my saved card for flight charges, aircraft hire, training flights, and related flying charges that are logged and confirmed in the Members Flight Management System. I understand the final amount may be calculated after the flight from the aircraft rate, Payment Type, tach/flight time, instructor charges, and any approved adjustments. I understand my card details are stored by Stripe, not by the CRM, and I can remove or replace my saved card from my portal. If a charge fails, I remain responsible for the outstanding balance.'}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={handleSaveStripeCard}
                    disabled={stripeCardLoading || !stripeConsentAccepted || !stripeCardStatus?.connected}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-[#363b45]"
                  >
                    {stripeCardLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                    {stripeCardStatus?.card ? 'Replace card with Stripe' : 'Save card with Stripe'}
                  </button>
                  {stripeCardStatus && !stripeCardStatus.connected && (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-200">Card setup is temporarily unavailable.</p>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
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

      {billing.loadWarning && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">Some Xero information is still catching up</p>
            <p className="mt-1 text-sm">{billing.loadWarning}</p>
            <button
              type="button"
              onClick={() => void billing.refetch()}
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-[#171a21] dark:text-amber-100 dark:hover:bg-amber-950/50"
            >
              <RefreshCw className="h-4 w-4" />
              Retry Xero data
            </button>
          </div>
        </div>
      )}

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
        <Suspense fallback={<PortalSectionLoader message="Loading financial section" detail="Preparing this billing view..." />}>
          {activeTab === 'transactions' && <TransactionsTab billing={billing} />}
          {activeTab === 'accounts' && <PilotAccountsTab billing={billing} />}
          {activeTab === 'xero-sync' && isAdminBilling && !showOwnBillingOnly && <XeroSyncQueueCard />}
        </Suspense>
      </div>
    </div>
  );
};
