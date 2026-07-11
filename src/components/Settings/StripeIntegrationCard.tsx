import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CreditCard, ExternalLink, Loader2, RefreshCw, ShieldCheck, TestTube2, Unlink } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

interface StripeIntegrationCardProps {
  canEdit: boolean;
}

interface StripeConnectStatus {
  connected: boolean;
  accountId: string | null;
  scope: string | null;
  livemode: boolean;
  connectedAt: string | null;
  updatedAt: string | null;
  configured: boolean;
  hasClientId: boolean;
  hasSecretKey: boolean;
  callbackUrl: string;
  stripeMode?: 'test' | 'live';
  allowTestModeXeroSync?: boolean;
  testCredentialsConfigured?: boolean;
  liveCredentialsConfigured?: boolean;
  activeModeConfigured?: boolean;
  activePublishableKeyConfigured?: boolean;
  activeWebhookConfigured?: boolean;
}

export const StripeIntegrationCard: React.FC<StripeIntegrationCardProps> = ({ canEdit }) => {
  const [stripeStatus, setStripeStatus] = useState<StripeConnectStatus | null>(null);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [stripeLoaded, setStripeLoaded] = useState(false);
  const [savingMode, setSavingMode] = useState(false);

  const loadStripeStatus = useCallback(async () => {
    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<StripeConnectStatus>('stripe-connect', {
        body: { action: 'status' },
      });
      if (error) throw error;
      setStripeStatus(data ?? null);
    } catch (error: any) {
      console.error('Error loading Stripe connection:', error);
      toast.error(error?.message || 'Failed to load Stripe connection');
    } finally {
      setStripeLoading(false);
      setStripeLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadStripeStatus();
  }, [loadStripeStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('stripe_connect');
    if (!result) return;

    if (result === 'success') {
      toast.success('Stripe account linked');
      loadStripeStatus();
    } else {
      toast.error(params.get('stripe_error') || 'Stripe account could not be linked');
    }

    params.delete('stripe_connect');
    params.delete('stripe_error');
    const cleanQuery = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`);
  }, [loadStripeStatus]);

  const connectStripe = async () => {
    if (!canEdit) return;
    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string; callbackUrl?: string }>('stripe-connect', {
        body: { action: 'start' },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || 'Stripe did not return a link URL');
      window.location.href = data.url;
    } catch (error: any) {
      console.error('Error starting Stripe connection:', error);
      toast.error(error?.message || 'Failed to start Stripe connection');
    } finally {
      setStripeLoading(false);
    }
  };

  const disconnectStripe = async () => {
    if (!canEdit || !window.confirm('Disconnect Stripe from the CRM? Existing records remain, but online payment setup will stop using this linked account.')) return;
    setStripeLoading(true);
    try {
      const { error } = await supabase.functions.invoke('stripe-connect', {
        body: { action: 'disconnect' },
      });
      if (error) throw error;
      toast.success('Stripe disconnected');
      await loadStripeStatus();
    } catch (error: any) {
      console.error('Error disconnecting Stripe:', error);
      toast.error(error?.message || 'Failed to disconnect Stripe');
    } finally {
      setStripeLoading(false);
    }
  };

  const updateStripeMode = async (mode: 'test' | 'live') => {
    if (!canEdit || !stripeStatus || mode === stripeStatus.stripeMode) return;
    const confirmLiveSwitch = mode !== 'live' || window.confirm(
      'Switch Stripe back to Live mode? Real card payments can be created immediately after this change. Continue?'
    );
    if (!confirmLiveSwitch) return;

    setSavingMode(true);
    try {
      const { data, error } = await supabase.functions.invoke<StripeConnectStatus>('stripe-connect', {
        body: {
          action: 'set-mode',
          mode,
          confirmLiveSwitch,
          allowTestModeXeroSync: stripeStatus.allowTestModeXeroSync === true,
        },
      });
      if (error) throw error;
      setStripeStatus(data ?? null);
      toast.success(mode === 'test' ? 'Stripe Test Mode enabled' : 'Stripe Live Mode enabled');
    } catch (error: any) {
      console.error('Error updating Stripe mode:', error);
      toast.error(error?.message || 'Failed to update Stripe mode');
    } finally {
      setSavingMode(false);
    }
  };

  const updateTestXeroSync = async (allow: boolean) => {
    if (!canEdit || !stripeStatus) return;
    setSavingMode(true);
    try {
      const { data, error } = await supabase.functions.invoke<StripeConnectStatus>('stripe-connect', {
        body: {
          action: 'set-mode',
          mode: stripeStatus.stripeMode || 'live',
          confirmLiveSwitch: true,
          allowTestModeXeroSync: allow,
        },
      });
      if (error) throw error;
      setStripeStatus(data ?? null);
      toast.success('Stripe/Xero test sync setting saved');
    } catch (error: any) {
      console.error('Error updating Stripe test Xero sync:', error);
      toast.error(error?.message || 'Failed to update Stripe test sync setting');
    } finally {
      setSavingMode(false);
    }
  };

  const connected = Boolean(stripeStatus?.connected);
  const configured = Boolean(stripeStatus?.configured);
  const stripeMode = stripeStatus?.stripeMode || 'live';
  const activeModeMissing = Boolean(connected && !stripeStatus?.activeModeConfigured);
  const statusLabel = connected ? 'Stripe is connected' : configured ? 'Ready to connect' : 'Setup needed';
  const statusDetail = connected
    ? 'Online voucher payments, pilot top-ups and card payments can use this club Stripe account.'
    : configured
      ? 'Connect the club Stripe account to start taking online payments.'
      : 'The CRM owner needs to finish the platform Stripe setup before this club can connect.';

  if (!stripeLoaded) {
    return (
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 p-5 text-gray-600">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Stripe payments</h3>
            <p className="text-sm text-gray-500">Loading integration status...</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-12 w-12 flex-none items-center justify-center rounded-xl ${connected ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
              <CreditCard className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-900">Stripe payments</h3>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${connected ? 'bg-green-100 text-green-800' : configured ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
                  {statusLabel}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-gray-600">{statusDetail}</p>
              {connected && stripeStatus?.connectedAt && (
                <p className="mt-2 text-xs text-gray-500">
                  Connected {new Date(stripeStatus.connectedAt).toLocaleDateString()}
                  {stripeStatus.livemode ? ' in live mode.' : ' in test mode.'}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {connected ? (
              canEdit && (
                <button
                  type="button"
                  onClick={disconnectStripe}
                  disabled={stripeLoading}
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
                  onClick={connectStripe}
                  disabled={stripeLoading || !configured}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {stripeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Connect Stripe
                </button>
              )
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Vouchers
            </p>
            <p className="mt-1 text-xs text-gray-500">Take trial flight voucher payments online.</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Account top-ups
            </p>
            <p className="mt-1 text-xs text-gray-500">Let members add funds to their pilot account.</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              Secure checkout
            </p>
            <p className="mt-1 text-xs text-gray-500">Stripe handles card details and verification.</p>
          </div>
        </div>

        <div className={`mt-5 rounded-xl border p-4 ${stripeMode === 'test' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <TestTube2 className={`h-4 w-4 ${stripeMode === 'test' ? 'text-amber-700' : 'text-gray-600'}`} />
                Stripe mode
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {stripeMode === 'test'
                  ? 'Test Mode is active. Stripe actions use test credentials and no real card money moves.'
                  : 'Live Mode is active. Stripe actions use live credentials and can create real payments.'}
              </p>
            </div>
            {canEdit && (
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => updateStripeMode('test')}
                  disabled={savingMode}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${stripeMode === 'test' ? 'bg-amber-100 text-amber-900' : 'text-gray-600 hover:bg-gray-50'} disabled:opacity-60`}
                >
                  Test mode
                </button>
                <button
                  type="button"
                  onClick={() => updateStripeMode('live')}
                  disabled={savingMode}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${stripeMode === 'live' ? 'bg-blue-100 text-blue-900' : 'text-gray-600 hover:bg-gray-50'} disabled:opacity-60`}
                >
                  Live mode
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-white/70 bg-white/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Current mode</p>
              <p className="mt-1 text-sm font-bold text-gray-900">{stripeMode === 'test' ? 'Test mode' : 'Live mode'}</p>
            </div>
            <div className="rounded-lg border border-white/70 bg-white/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Test credentials</p>
              <p className={`mt-1 text-sm font-bold ${stripeStatus?.testCredentialsConfigured ? 'text-green-700' : 'text-amber-700'}`}>
                {stripeStatus?.testCredentialsConfigured ? 'Configured' : 'Missing'}
              </p>
            </div>
            <div className="rounded-lg border border-white/70 bg-white/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Live credentials</p>
              <p className={`mt-1 text-sm font-bold ${stripeStatus?.liveCredentialsConfigured ? 'text-green-700' : 'text-amber-700'}`}>
                {stripeStatus?.liveCredentialsConfigured ? 'Configured' : 'Missing'}
              </p>
            </div>
          </div>

          {activeModeMissing && (
            <div className="mt-4 flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              <p>Stripe is connected, but the active mode is missing required server-side secrets. Payments in this mode will fail until the Supabase Edge Function secrets are added.</p>
            </div>
          )}

          {stripeMode === 'test' && (
            <label className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-white/80 p-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={stripeStatus?.allowTestModeXeroSync === true}
                onChange={(event) => updateTestXeroSync(event.target.checked)}
                disabled={!canEdit || savingMode}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <span>
                <span className="block font-semibold text-gray-900">Allow test payments to sync into Xero</span>
                Off by default. Keep this disabled unless an admin deliberately wants test Stripe records to appear in the connected Xero organisation.
              </span>
            </label>
          )}
        </div>

        {stripeStatus && !configured && (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Stripe is not ready yet.</p>
            <p className="mt-1">The CRM platform Stripe key needs to be added before this club can connect payments.</p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-500">
            {connected ? 'Payments are linked to this club Stripe account.' : 'You will be sent to Stripe to finish setup.'}
          </p>
          <button
            type="button"
            onClick={loadStripeStatus}
            disabled={stripeLoading}
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${stripeLoading ? 'animate-spin' : ''}`} />
            Refresh status
          </button>
        </div>
      </div>
    </section>
  );
};
