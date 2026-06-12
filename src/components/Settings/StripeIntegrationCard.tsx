import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, CreditCard, ExternalLink, Loader2, RefreshCw, Settings, Unlink } from 'lucide-react';
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
}

const setupSteps = [
  'Configure the CRM platform Stripe keys once',
  'Add the callback URL to the platform Connect settings',
  'Each club connects its own Stripe account from this screen',
  'Voucher checkout, top-ups, and flight payments use that club account',
];

export const StripeIntegrationCard: React.FC<StripeIntegrationCardProps> = ({ canEdit }) => {
  const [stripeStatus, setStripeStatus] = useState<StripeConnectStatus | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);

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

  const copyRedirectUri = async () => {
    if (!stripeStatus?.callbackUrl) return;
    await navigator.clipboard.writeText(stripeStatus.callbackUrl);
    toast.success('Stripe redirect URI copied');
  };

  const connected = Boolean(stripeStatus?.connected);
  const configured = Boolean(stripeStatus?.configured);

  return (
    <section className="overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm">
      <div className="bg-gradient-to-r from-blue-950 via-blue-900 to-blue-800 p-5 text-white">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold flex items-center">
              <CreditCard className="h-5 w-5 mr-2 text-blue-200" />
              Stripe Connect Platform
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-blue-100">
              Set Stripe up as a CRM platform, then let each flying club link its own Stripe account with a simple Connect button. Pilots and students never need to see the setup.
            </p>
          </div>
          <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${connected ? 'bg-green-400/15 text-green-100 ring-1 ring-green-300/30' : 'bg-amber-400/15 text-amber-100 ring-1 ring-amber-300/30'}`}>
            {connected ? 'Club connected' : configured ? 'Platform ready' : 'Platform setup needed'}
          </span>
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Connection</p>
            <p className={`mt-1 text-sm font-semibold ${connected ? 'text-green-700' : 'text-amber-700'}`}>
              {connected ? 'This club is linked' : 'No club account linked'}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Connected account</p>
            <p className="mt-1 break-all text-sm font-medium text-gray-800">{stripeStatus?.accountId || 'No account linked yet'}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Platform mode</p>
            <p className="mt-1 text-sm font-medium text-gray-800">
              {connected ? (stripeStatus?.livemode ? 'Live connected payments' : 'Test connected payments') : configured ? 'Ready for club onboarding' : 'Platform keys required'}
            </p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-sm font-semibold text-gray-900">Platform flow</p>
            <div className="mt-3 space-y-2">
              {setupSteps.map(step => (
                <div key={step} className="flex items-start gap-2 text-sm text-gray-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-green-600" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-sm font-semibold text-gray-900">Platform callback URL</p>
            <p className="mt-1 text-xs text-gray-500">Add this URL to the CRM platform's Stripe Connect settings so clubs can return safely after linking their accounts.</p>
            <div className="mt-3 flex items-center gap-2 rounded-md bg-gray-50 p-2">
              <code className="min-w-0 flex-1 break-all text-xs text-gray-700">{stripeStatus?.callbackUrl || 'Loading...'}</code>
              <button
                type="button"
                onClick={copyRedirectUri}
                disabled={!stripeStatus?.callbackUrl}
                className="rounded-md border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                title="Copy redirect URI"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {stripeStatus && !configured && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Platform setup is required once by the CRM owner.</p>
            <p className="mt-1">
              Add <span className="font-mono">STRIPE_SECRET_KEY</span> and <span className="font-mono">STRIPE_CONNECT_CLIENT_ID</span> to Supabase Edge Function secrets for the platform account. After that, each club only needs to click the Connect button.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={loadStripeStatus}
            disabled={stripeLoading}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${stripeLoading ? 'animate-spin' : ''}`} />
            Refresh status
          </button>

          {connected ? (
            canEdit && (
              <button
                type="button"
                onClick={disconnectStripe}
                disabled={stripeLoading}
                className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                <Unlink className="h-4 w-4" />
                Disconnect Stripe
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
                Connect this club's Stripe
              </button>
            )
          )}

          <a
            href="https://dashboard.stripe.com/apikeys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Settings className="h-4 w-4" />
            Platform API keys
          </a>
          <a
            href="https://dashboard.stripe.com/settings/connect/onboarding-options/oauth"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink className="h-4 w-4" />
            Connect settings
          </a>
        </div>
      </div>
    </section>
  );
};
