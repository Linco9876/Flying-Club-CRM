import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Landmark,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useFinancialProviders } from '../../context/financialProviderState';
import {
  financialProviderModeDescription,
  financialProviderModeLabel,
} from '../../utils/financialProviderPresentation';

export const FinancialProviderStatus: React.FC<{
  compact?: boolean;
  showRefresh?: boolean;
}> = ({ compact = false, showRefresh = false }) => {
  const { capabilities, loading, error, refresh } = useFinancialProviders();
  const connected = capabilities.financeEnabled;
  const unavailable = Boolean(error);

  return (
    <section
      className={`rounded-xl border ${
        unavailable
          ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30'
          : connected
          ? 'border-slate-200 bg-white dark:border-[#2c2f36] dark:bg-[#171a21]'
          : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
      } ${compact ? 'p-3' : 'p-4'}`}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {loading ? (
            <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-blue-600" />
          ) : unavailable ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
          ) : connected ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          )}
          <div>
            <h3 className="text-sm font-bold text-slate-950 dark:text-slate-100">
              {loading
                ? 'Checking financial services'
                : unavailable
                  ? 'Financial service status unavailable'
                  : financialProviderModeLabel(capabilities)}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
              {error || financialProviderModeDescription(capabilities)}
            </p>
          </div>
        </div>
        {showRefresh && (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>
      {!loading && !unavailable && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${
            capabilities.stripe.connected
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          }`}>
            <CreditCard className="h-4 w-4" />
            Stripe {capabilities.stripe.connected ? `connected · ${capabilities.stripe.mode} mode` : 'disconnected'}
          </div>
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${
            capabilities.xero.connected
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          }`}>
            <Landmark className="h-4 w-4" />
            Xero {capabilities.xero.connected ? `connected · ${capabilities.xero.connectionMode.replace(/_/g, ' ')}` : 'disconnected'}
          </div>
        </div>
      )}
    </section>
  );
};

export const FinancialFeaturesDisabled: React.FC = () => (
  <div className="p-3 sm:p-6">
    <div className="mx-auto max-w-2xl rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-950 shadow-sm dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start gap-4">
        <div className="rounded-xl bg-amber-100 p-3 text-amber-800 dark:bg-amber-900/60 dark:text-amber-100">
          <Landmark className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Financial features are unavailable</h1>
          <p className="mt-2 text-sm leading-6">
            Stripe and Xero are both disconnected. No balances, invoices, payment methods,
            payment links, financial transactions, or accounting sync controls are shown.
          </p>
          <p className="mt-3 text-sm font-semibold">
            An administrator can connect either service in Settings → Integrations.
          </p>
        </div>
      </div>
    </div>
  </div>
);
