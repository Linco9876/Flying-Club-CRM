import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, FileText, Loader2, RefreshCw, Settings2, Sparkles, Unlink, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

interface XeroIntegrationCardProps {
  canEdit: boolean;
  onFormChange?: () => void;
}

interface XeroSyncSettings {
  create_contacts?: boolean;
  sync_flight_charges?: boolean;
  sync_account_topups?: boolean;
  sync_gift_vouchers?: boolean;
  default_sync_mode?: string;
  default_invoice_status?: string;
  revenue_account_code?: string | null;
  topup_account_code?: string | null;
  topup_receipt_account_code?: string | null;
  voucher_account_code?: string | null;
  tax_type?: string | null;
  stripe_payment_account_code?: string | null;
  prepaid_payment_account_code?: string | null;
  stripe_fee_expense_account_code?: string | null;
  auto_queue_flight_invoices?: boolean;
  auto_apply_verified_payments?: boolean;
}

interface XeroStatus {
  connected: boolean;
  tenantId: string | null;
  tenantName: string | null;
  tenantType: string | null;
  scope: string | null;
  expiresAt: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
  configured: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  callbackUrl: string;
  scopes: string;
  syncSettings: XeroSyncSettings;
}

interface XeroAccountOption {
  accountId: string;
  code: string;
  name: string;
  type: string;
  status: string;
  enablePaymentsToAccount: boolean;
}

interface XeroSettingsForm {
  createContacts: boolean;
  syncFlightCharges: boolean;
  syncAccountTopups: boolean;
  syncGiftVouchers: boolean;
  defaultSyncMode: string;
  defaultInvoiceStatus: string;
  revenueAccountCode: string;
  topupAccountCode: string;
  topupReceiptAccountCode: string;
  voucherAccountCode: string;
  taxType: string;
  stripePaymentAccountCode: string;
  prepaidPaymentAccountCode: string;
  stripeFeeExpenseAccountCode: string;
  autoQueueFlightInvoices: boolean;
  autoApplyVerifiedPayments: boolean;
}

const defaultForm: XeroSettingsForm = {
  createContacts: true,
  syncFlightCharges: true,
  syncAccountTopups: false,
  syncGiftVouchers: false,
  defaultSyncMode: 'manual-review',
  defaultInvoiceStatus: 'DRAFT',
  revenueAccountCode: '',
  topupAccountCode: '',
  topupReceiptAccountCode: '',
  voucherAccountCode: '',
  taxType: '',
  stripePaymentAccountCode: '',
  prepaidPaymentAccountCode: '',
  stripeFeeExpenseAccountCode: '',
  autoQueueFlightInvoices: true,
  autoApplyVerifiedPayments: false,
};

const fromStatus = (status?: XeroStatus | null): XeroSettingsForm => ({
  createContacts: status?.syncSettings?.create_contacts ?? true,
  syncFlightCharges: status?.syncSettings?.sync_flight_charges ?? true,
  syncAccountTopups: status?.syncSettings?.sync_account_topups ?? false,
  syncGiftVouchers: status?.syncSettings?.sync_gift_vouchers ?? false,
  defaultSyncMode: status?.syncSettings?.default_sync_mode || 'manual-review',
  defaultInvoiceStatus: status?.syncSettings?.default_invoice_status || 'DRAFT',
  revenueAccountCode: status?.syncSettings?.revenue_account_code || '',
  topupAccountCode: status?.syncSettings?.topup_account_code || '',
  topupReceiptAccountCode: status?.syncSettings?.topup_receipt_account_code || '',
  voucherAccountCode: status?.syncSettings?.voucher_account_code || '',
  taxType: status?.syncSettings?.tax_type || '',
  stripePaymentAccountCode: status?.syncSettings?.stripe_payment_account_code || '',
  prepaidPaymentAccountCode: status?.syncSettings?.prepaid_payment_account_code || '',
  stripeFeeExpenseAccountCode: status?.syncSettings?.stripe_fee_expense_account_code || '',
  autoQueueFlightInvoices: status?.syncSettings?.auto_queue_flight_invoices ?? true,
  autoApplyVerifiedPayments: status?.syncSettings?.auto_apply_verified_payments ?? false,
});

export const XeroIntegrationCard: React.FC<XeroIntegrationCardProps> = ({ canEdit, onFormChange }) => {
  const [xeroStatus, setXeroStatus] = useState<XeroStatus | null>(null);
  const [xeroLoading, setXeroLoading] = useState(true);
  const [xeroLoaded, setXeroLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accounts, setAccounts] = useState<XeroAccountOption[]>([]);
  const [creatingStripeAccount, setCreatingStripeAccount] = useState(false);
  const [creatingPrepaidAccount, setCreatingPrepaidAccount] = useState(false);
  const [creatingTopupReceiptAccount, setCreatingTopupReceiptAccount] = useState(false);
  const [creatingVoucherLiabilityAccount, setCreatingVoucherLiabilityAccount] = useState(false);
  const [creatingPrepaidLiabilityAccount, setCreatingPrepaidLiabilityAccount] = useState(false);
  const [creatingStripeFeeAccount, setCreatingStripeFeeAccount] = useState(false);
  const [showAccountTools, setShowAccountTools] = useState(false);
  const [form, setForm] = useState<XeroSettingsForm>(defaultForm);
  const connected = Boolean(xeroStatus?.connected);
  const configured = Boolean(xeroStatus?.configured);

  const loadXeroStatus = useCallback(async () => {
    setXeroLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<XeroStatus>('xero-connect', {
        body: { action: 'status' },
      });
      if (error) throw error;
      setXeroStatus(data ?? null);
      setForm(fromStatus(data ?? null));
    } catch (error: any) {
      console.error('Error loading Xero connection:', error);
      toast.error(error?.message || 'Failed to load Xero connection');
    } finally {
      setXeroLoading(false);
      setXeroLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadXeroStatus();
  }, [loadXeroStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('xero_connect');
    if (!result) return;

    if (result === 'success') {
      toast.success('Xero organisation linked');
      loadXeroStatus();
    } else {
      toast.error(params.get('xero_error') || 'Xero could not be linked');
    }

    params.delete('xero_connect');
    params.delete('xero_error');
    const cleanQuery = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`);
  }, [loadXeroStatus]);

  const updateForm = <K extends keyof XeroSettingsForm>(key: K, value: XeroSettingsForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    onFormChange?.();
  };

  const loadAccounts = useCallback(async () => {
    if (!connected) return;
    setAccountsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ accounts?: XeroAccountOption[] }>('xero-sync', {
        body: { action: 'list-accounts' },
      });
      if (error) throw error;
      setAccounts((data?.accounts || []).filter(account => account.status === 'ACTIVE' && account.code));
    } catch (error: any) {
      console.error('Error loading Xero accounts:', error);
      toast.error(error?.message || 'Failed to load Xero accounts');
    } finally {
      setAccountsLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    if (!connected) {
      setAccounts([]);
      return;
    }
    loadAccounts();
  }, [connected, loadAccounts]);

  const createStripeClearingAccount = async () => {
    if (!connected || !canEdit) return;
    setCreatingStripeAccount(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ created?: boolean; account?: XeroAccountOption }>('xero-sync', {
        body: { action: 'ensure-stripe-clearing-account' },
      });
      if (error) throw error;

      const account = data?.account;
      if (account?.code) {
        setAccounts(prev => {
          const merged = [...prev.filter(existing => existing.code !== account.code), account];
          return merged.sort((left, right) => left.name.localeCompare(right.name));
        });
        updateForm('stripePaymentAccountCode', account.code);
      }

      toast.success(data?.created ? 'Stripe clearing account created in Xero' : 'Stripe clearing account already exists in Xero');
    } catch (error: any) {
      console.error('Error creating Stripe clearing account:', error);
      toast.error(error?.message || 'Failed to create Stripe clearing account');
    } finally {
      setCreatingStripeAccount(false);
    }
  };

  const createPrepaidClearingAccount = async () => {
    if (!connected || !canEdit) return;
    setCreatingPrepaidAccount(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ created?: boolean; account?: XeroAccountOption }>('xero-sync', {
        body: { action: 'ensure-prepaid-clearing-account' },
      });
      if (error) throw error;

      const account = data?.account;
      if (account?.code) {
        setAccounts(prev => {
          const merged = [...prev.filter(existing => existing.code !== account.code), account];
          return merged.sort((left, right) => left.name.localeCompare(right.name));
        });
        updateForm('prepaidPaymentAccountCode', account.code);
      }

      toast.success(data?.created ? 'Prepaid clearing account created in Xero' : 'Prepaid clearing account already exists in Xero');
    } catch (error: any) {
      console.error('Error creating prepaid clearing account:', error);
      toast.error(error?.message || 'Failed to create prepaid clearing account');
    } finally {
      setCreatingPrepaidAccount(false);
    }
  };

  const createTopupReceiptAccount = async () => {
    if (!connected || !canEdit) return;
    setCreatingTopupReceiptAccount(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ created?: boolean; account?: XeroAccountOption }>('xero-sync', {
        body: { action: 'ensure-topup-receipt-account' },
      });
      if (error) throw error;

      const account = data?.account;
      if (account?.code) {
        setAccounts(prev => {
          const merged = [...prev.filter(existing => existing.code !== account.code), account];
          return merged.sort((left, right) => left.name.localeCompare(right.name));
        });
        updateForm('topupReceiptAccountCode', account.code);
      }

      toast.success(data?.created ? 'Member top-up receipt account created in Xero' : 'Member top-up receipt account already exists in Xero');
    } catch (error: any) {
      console.error('Error creating member top-up receipt account:', error);
      toast.error(error?.message || 'Failed to create member top-up receipt account');
    } finally {
      setCreatingTopupReceiptAccount(false);
    }
  };

  const createVoucherLiabilityAccount = async () => {
    if (!connected || !canEdit) return;
    setCreatingVoucherLiabilityAccount(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ created?: boolean; account?: XeroAccountOption }>('xero-sync', {
        body: { action: 'ensure-voucher-liability-account' },
      });
      if (error) throw error;

      const account = data?.account;
      if (account?.code) {
        setAccounts(prev => {
          const merged = [...prev.filter(existing => existing.code !== account.code), account];
          return merged.sort((left, right) => left.name.localeCompare(right.name));
        });
        updateForm('voucherAccountCode', account.code);
      }

      toast.success(data?.created ? 'Gift voucher liability account created in Xero' : 'Gift voucher liability account already exists in Xero');
    } catch (error: any) {
      console.error('Error creating gift voucher liability account:', error);
      toast.error(error?.message || 'Failed to create gift voucher liability account');
    } finally {
      setCreatingVoucherLiabilityAccount(false);
    }
  };

  const createPrepaidLiabilityAccount = async () => {
    if (!connected || !canEdit) return;
    setCreatingPrepaidLiabilityAccount(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ created?: boolean; account?: XeroAccountOption }>('xero-sync', {
        body: { action: 'ensure-prepaid-liability-account' },
      });
      if (error) throw error;

      const account = data?.account;
      if (account?.code) {
        setAccounts(prev => {
          const merged = [...prev.filter(existing => existing.code !== account.code), account];
          return merged.sort((left, right) => left.name.localeCompare(right.name));
        });
        updateForm('topupAccountCode', account.code);
      }

      toast.success(data?.created ? 'Member prepaid liability account created in Xero' : 'Member prepaid liability account already exists in Xero');
    } catch (error: any) {
      console.error('Error creating member prepaid liability account:', error);
      toast.error(error?.message || 'Failed to create member prepaid liability account');
    } finally {
      setCreatingPrepaidLiabilityAccount(false);
    }
  };

  const createStripeFeeExpenseAccount = async () => {
    if (!connected || !canEdit) return;
    setCreatingStripeFeeAccount(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ created?: boolean; account?: XeroAccountOption }>('xero-sync', {
        body: { action: 'ensure-stripe-fee-expense-account' },
      });
      if (error) throw error;

      const account = data?.account;
      if (account?.code) {
        setAccounts(prev => {
          const merged = [...prev.filter(existing => existing.code !== account.code), account];
          return merged.sort((left, right) => left.name.localeCompare(right.name));
        });
        updateForm('stripeFeeExpenseAccountCode', account.code);
      }

      toast.success(data?.created ? 'Stripe fees expense account created in Xero' : 'Stripe fees expense account already exists in Xero');
    } catch (error: any) {
      console.error('Error creating Stripe fees expense account:', error);
      toast.error(error?.message || 'Failed to create Stripe fees expense account');
    } finally {
      setCreatingStripeFeeAccount(false);
    }
  };

  const connectXero = async () => {
    if (!canEdit) return;
    setXeroLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string; callbackUrl?: string }>('xero-connect', {
        body: { action: 'start' },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || 'Xero did not return a link URL');
      window.location.href = data.url;
    } catch (error: any) {
      console.error('Error starting Xero connection:', error);
      toast.error(error?.message || 'Failed to start Xero connection');
    } finally {
      setXeroLoading(false);
    }
  };

  const disconnectXero = async () => {
    if (!canEdit || !window.confirm('Disconnect Xero from the CRM? Existing CRM billing records remain, but syncing to Xero will stop.')) return;
    setXeroLoading(true);
    try {
      const { error } = await supabase.functions.invoke('xero-connect', {
        body: { action: 'disconnect' },
      });
      if (error) throw error;
      toast.success('Xero disconnected');
      await loadXeroStatus();
    } catch (error: any) {
      console.error('Error disconnecting Xero:', error);
      toast.error(error?.message || 'Failed to disconnect Xero');
    } finally {
      setXeroLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke<XeroStatus>('xero-connect', {
        body: { action: 'save-settings', settings: form },
      });
      if (error) throw error;
      setXeroStatus(data ?? null);
      setForm(fromStatus(data ?? null));
      toast.success('Xero sync settings saved');
    } catch (error: any) {
      console.error('Error saving Xero settings:', error);
      toast.error(error?.message || 'Failed to save Xero settings');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    (window as any).__integrationsSettingsSave = saveSettings;
    (window as any).__integrationsSettingsCancel = () => {
      setForm(fromStatus(xeroStatus));
      setShowAccountTools(false);
    };

    return () => {
      delete (window as any).__integrationsSettingsSave;
      delete (window as any).__integrationsSettingsCancel;
    };
  }, [saveSettings, xeroStatus]);

  const incomeAccounts = useMemo(
    () => accounts.filter(account => ['REVENUE', 'SALES', 'OTHERINCOME'].includes(account.type)),
    [accounts],
  );
  const expenseAccounts = useMemo(
    () => accounts.filter(account => ['EXPENSE', 'DIRECTCOSTS', 'OVERHEADS'].includes(account.type)),
    [accounts],
  );
  const paymentAccounts = useMemo(
    () => accounts.filter(account => account.enablePaymentsToAccount || account.type === 'BANK' || account.code === 'STRIPECLR'),
    [accounts],
  );
  const allActiveAccounts = useMemo(
    () => [...accounts].sort((left, right) => left.name.localeCompare(right.name)),
    [accounts],
  );
  const statusLabel = connected ? 'Xero is connected' : configured ? 'Ready to connect' : 'Setup needed';
  const statusDetail = connected
    ? `Linked to ${xeroStatus?.tenantName || 'a Xero organisation'}. Billing sync can be configured here before invoice posting is enabled.`
    : configured
      ? 'Connect the club Xero organisation to prepare contact and invoice syncing.'
      : 'Add the Xero app client ID and secret to Supabase Edge Function secrets before connecting.';

  const syncModeLabel = useMemo(() => {
    if (form.defaultSyncMode === 'auto-approved') return 'Create approved invoices';
    if (form.defaultSyncMode === 'auto-draft') return 'Create draft invoices';
    return 'Manual review before sync';
  }, [form.defaultSyncMode]);

  if (!xeroLoaded) {
    return (
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 p-5 text-gray-600">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Xero accounting</h3>
            <p className="text-sm text-gray-500">Loading integration status...</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-12 w-12 flex-none items-center justify-center rounded-xl ${connected ? 'bg-green-100 text-green-700' : 'bg-sky-100 text-sky-700'}`}>
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-900">Xero accounting</h3>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? 'bg-green-100 text-green-800' : configured ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
                  {statusLabel}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-gray-600">{statusDetail}</p>
              {connected && (
                <div className="mt-2 space-y-1 text-xs text-gray-500">
                  {xeroStatus?.connectedAt && <p>Connected {new Date(xeroStatus.connectedAt).toLocaleDateString()}.</p>}
                  {xeroStatus?.tenantId && <p>Xero tenant: {xeroStatus.tenantId}</p>}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {connected ? (
              canEdit && (
                <button
                  type="button"
                  onClick={disconnectXero}
                  disabled={xeroLoading}
                  className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  <Unlink className="h-4 w-4" />
                  Disconnect
                </button>
              )
            ) : (
              canEdit && (
                <button
                  type="button"
                  onClick={connectXero}
                  disabled={xeroLoading || !configured}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {xeroLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Connect Xero
                </button>
              )
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Contacts
            </p>
            <p className="mt-1 text-xs text-gray-500">Prepare pilots and students as Xero contacts.</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Invoices
            </p>
            <p className="mt-1 text-xs text-gray-500">Map flight charges, top-ups and vouchers before posting.</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Settings2 className="h-4 w-4 text-blue-600" />
              {syncModeLabel}
            </p>
            <p className="mt-1 text-xs text-gray-500">Keep sync controlled while the accounting mapping is tuned.</p>
          </div>
        </div>

        {xeroStatus && !configured && (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Xero is not ready yet.</p>
            <p className="mt-1">Create a Xero app, add this callback URL, then add XERO_CLIENT_ID and XERO_CLIENT_SECRET to Supabase Edge Function secrets.</p>
            <p className="mt-2 rounded bg-white/70 px-2 py-1 font-mono text-xs text-amber-950">{xeroStatus.callbackUrl}</p>
          </div>
        )}

        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Sync defaults</h4>
              <p className="text-xs text-gray-500">These settings prepare the invoice/contact sync. Actual posting will still be built as a reviewed queue.</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 sm:mt-0">
              <button
                type="button"
                onClick={loadAccounts}
                disabled={!connected || accountsLoading}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {accountsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {accounts.length > 0 ? 'Refresh Xero accounts' : 'Load Xero accounts'}
              </button>
              {canEdit && connected && (
                <button
                  type="button"
                  onClick={() => setShowAccountTools(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
                >
                  <Sparkles className="h-4 w-4" />
                  Account setup tools
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 text-xs text-blue-900">
            <p className="font-semibold">Recommended setup</p>
            <p className="mt-1">Flight revenue should point to an income account. Gift voucher liability and member prepaid liability should point to current liability accounts. Stripe and prepaid payment clearing should point to payments-enabled clearing or bank accounts.</p>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
              <input
                type="checkbox"
                checked={form.createContacts}
                disabled={!canEdit}
                onChange={event => updateForm('createContacts', event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">Create Xero contacts for members</span>
                <span className="block text-xs text-gray-500">Use the member profile as the source for customer details.</span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
              <input
                type="checkbox"
                checked={form.syncFlightCharges}
                disabled={!canEdit}
                onChange={event => updateForm('syncFlightCharges', event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">Prepare flight charges for Xero invoices</span>
                <span className="block text-xs text-gray-500">Aircraft hire, instruction and other flight charges can become invoice lines.</span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
              <input
                type="checkbox"
                checked={form.syncAccountTopups}
                disabled={!canEdit}
                onChange={event => updateForm('syncAccountTopups', event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">Include account top-ups</span>
                <span className="block text-xs text-gray-500">Queue approved pilot account top-ups for Xero once account mapping is ready.</span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
              <input
                type="checkbox"
                checked={form.syncGiftVouchers}
                disabled={!canEdit}
                onChange={event => updateForm('syncGiftVouchers', event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">Include gift vouchers</span>
                <span className="block text-xs text-gray-500">Queue paid voucher sales into liability, then release them into revenue when the flight is actually flown.</span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
              <input
                type="checkbox"
                checked={form.autoQueueFlightInvoices}
                disabled={!canEdit}
                onChange={event => updateForm('autoQueueFlightInvoices', event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">Queue logged flights for Xero</span>
                <span className="block text-xs text-gray-500">New billable flight logs can be queued for invoice review.</span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
              <input
                type="checkbox"
                checked={form.autoApplyVerifiedPayments}
                disabled={!canEdit}
                onChange={event => updateForm('autoApplyVerifiedPayments', event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">Apply verified payments to Xero invoices</span>
                <span className="block text-xs text-gray-500">Only works when payment clearing account codes are set.</span>
              </span>
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Default sync mode</label>
              <select
                value={form.defaultSyncMode}
                disabled={!canEdit}
                onChange={event => updateForm('defaultSyncMode', event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="manual-review">Manual review before sync</option>
                <option value="auto-draft">Auto-create draft invoices</option>
                <option value="auto-approved">Auto-create approved invoices</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Default Xero invoice status</label>
              <select
                value={form.defaultInvoiceStatus}
                disabled={!canEdit}
                onChange={event => updateForm('defaultInvoiceStatus', event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="DRAFT">Draft</option>
                <option value="SUBMITTED">Awaiting approval</option>
                <option value="AUTHORISED">Approved</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Tax type</label>
              <input
                value={form.taxType}
                disabled={!canEdit}
                onChange={event => updateForm('taxType', event.target.value)}
                placeholder="Example: OUTPUT"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Flight revenue account</label>
              <select
                value={form.revenueAccountCode}
                disabled={!canEdit}
                onChange={event => updateForm('revenueAccountCode', event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select income account</option>
                {incomeAccounts.map(account => (
                  <option key={account.accountId} value={account.code}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Member prepaid liability account</label>
              <select
                value={form.topupAccountCode}
                disabled={!canEdit}
                onChange={event => updateForm('topupAccountCode', event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select liability account</option>
                {allActiveAccounts.map(account => (
                  <option key={account.accountId} value={account.code}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Member top-up receipt account</label>
              <select
                value={form.topupReceiptAccountCode}
                disabled={!canEdit}
                onChange={event => updateForm('topupReceiptAccountCode', event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select bank or clearing account</option>
                {allActiveAccounts.map(account => (
                  <option key={`${account.accountId}-receipt`} value={account.code}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Gift voucher liability account</label>
              <select
                value={form.voucherAccountCode}
                disabled={!canEdit}
                onChange={event => updateForm('voucherAccountCode', event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select liability account</option>
                {allActiveAccounts.map(account => (
                  <option key={account.accountId} value={account.code}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Stripe payment clearing account</label>
              <select
                value={form.stripePaymentAccountCode}
                disabled={!canEdit}
                onChange={event => updateForm('stripePaymentAccountCode', event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select payments-enabled account</option>
                {paymentAccounts.map(account => (
                  <option key={account.accountId} value={account.code}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Prepaid payment clearing account</label>
              <select
                value={form.prepaidPaymentAccountCode}
                disabled={!canEdit}
                onChange={event => updateForm('prepaidPaymentAccountCode', event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select payments-enabled account</option>
                {paymentAccounts.map(account => (
                  <option key={account.accountId} value={account.code}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Stripe fees expense account</label>
              <select
                value={form.stripeFeeExpenseAccountCode}
                disabled={!canEdit}
                onChange={event => updateForm('stripeFeeExpenseAccountCode', event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select expense account</option>
                {expenseAccounts.map(account => (
                  <option key={account.accountId} value={account.code}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-500">
            {connected ? 'Xero is linked. Contacts and billable flights can now be synced from the reviewed queue.' : 'You will be sent to Xero to approve access to the club organisation.'}
          </p>
          <button
            type="button"
            onClick={loadXeroStatus}
            disabled={xeroLoading}
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${xeroLoading ? 'animate-spin' : ''}`} />
            Refresh status
          </button>
        </div>
      </div>

      {showAccountTools && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
              <div>
                <h4 className="text-lg font-semibold text-gray-900">Xero account setup tools</h4>
                <p className="mt-1 text-sm text-gray-600">
                  Create the clearing, liability and Stripe fee accounts the CRM expects, then the account selectors below will be ready to use.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAccountTools(false)}
                className="rounded-md p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close account setup tools"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 px-6 py-5 md:grid-cols-2">
              <button
                type="button"
                onClick={createStripeClearingAccount}
                disabled={!connected || !canEdit || creatingStripeAccount}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingStripeAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Make Stripe clearing account
              </button>
              <button
                type="button"
                onClick={createPrepaidClearingAccount}
                disabled={!connected || !canEdit || creatingPrepaidAccount}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingPrepaidAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Make Prepaid payment clearing account
              </button>
              <button
                type="button"
                onClick={createTopupReceiptAccount}
                disabled={!connected || !canEdit || creatingTopupReceiptAccount}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingTopupReceiptAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Make Member top-up receipt account
              </button>
              <button
                type="button"
                onClick={createVoucherLiabilityAccount}
                disabled={!connected || !canEdit || creatingVoucherLiabilityAccount}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingVoucherLiabilityAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Make Gift voucher liability account
              </button>
              <button
                type="button"
                onClick={createPrepaidLiabilityAccount}
                disabled={!connected || !canEdit || creatingPrepaidLiabilityAccount}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-700 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingPrepaidLiabilityAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Make Member prepaid liability account
              </button>
              <button
                type="button"
                onClick={createStripeFeeExpenseAccount}
                disabled={!connected || !canEdit || creatingStripeFeeAccount}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2"
              >
                {creatingStripeFeeAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Make Stripe fees account
              </button>
            </div>

            <div className="flex justify-end border-t border-gray-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowAccountTools(false)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
