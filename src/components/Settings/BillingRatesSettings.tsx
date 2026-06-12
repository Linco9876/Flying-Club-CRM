import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, DollarSign, ExternalLink, GripVertical, Loader2, Plus, RefreshCw, Trash2, Unlink, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { useBillingSettings, FlightType, PaymentMethod } from '../../hooks/useBillingSettings';
import { useAircraft } from '../../hooks/useAircraft';
import { UserRole } from '../../types';
import { supabase } from '../../lib/supabase';

interface BillingRatesSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

const allRoles: UserRole[] = ['admin', 'instructor', 'pilot', 'student'];
const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

export const BillingRatesSettings: React.FC<BillingRatesSettingsProps> = ({ canEdit, onFormChange }) => {
  const { flightTypes, paymentMethods, loading, saveBillingSettings } = useBillingSettings();
  const { aircraft } = useAircraft();
  const [draftFlightTypes, setDraftFlightTypes] = useState<FlightType[]>([]);
  const [draftPaymentMethods, setDraftPaymentMethods] = useState<PaymentMethod[]>([]);
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
    setDraftFlightTypes(flightTypes);
  }, [flightTypes]);

  useEffect(() => {
    setDraftPaymentMethods(paymentMethods);
  }, [paymentMethods]);

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

  useEffect(() => {
    (window as any).__billingSettingsSave = async () => {
      await saveBillingSettings(draftFlightTypes, draftPaymentMethods);
    };
    (window as any).__billingSettingsCancel = () => {
      setDraftFlightTypes(flightTypes);
      setDraftPaymentMethods(paymentMethods);
    };
    return () => {
      delete (window as any).__billingSettingsSave;
      delete (window as any).__billingSettingsCancel;
    };
  }, [draftFlightTypes, draftPaymentMethods, flightTypes, paymentMethods, saveBillingSettings]);

  const updateFlightType = (id: string, updates: Partial<FlightType>) => {
    setDraftFlightTypes(current => current.map(type => type.id === id ? { ...type, ...updates } : type));
    onFormChange();
  };

  const updatePaymentMethod = (id: string, updates: Partial<PaymentMethod>) => {
    setDraftPaymentMethods(current => current.map(method => method.id === id ? { ...method, ...updates } : method));
    onFormChange();
  };

  const moveFlightType = (id: string, direction: -1 | 1) => {
    setDraftFlightTypes(current => {
      const index = current.findIndex(type => type.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((type, order) => ({ ...type, displayOrder: order + 1 }));
    });
    onFormChange();
  };

  const addFlightType = () => {
    setDraftFlightTypes(current => [
      ...current,
      {
        id: newId('flight-type'),
        name: 'New Flight Type',
        description: '',
        active: true,
        allowedRoles: ['student', 'pilot', 'instructor', 'admin'],
        displayOrder: current.length + 1,
        forcedPaymentMethodId: null,
      },
    ]);
    onFormChange();
  };

  const addPaymentMethod = () => {
    setDraftPaymentMethods(current => [
      ...current,
      {
        id: newId('payment-method'),
        name: 'New Payment Method',
        description: '',
        active: true,
        displayOrder: current.length + 1,
        allowAccountTopup: true,
      },
    ]);
    onFormChange();
  };

  const removeFlightType = (id: string) => {
    setDraftFlightTypes(current => current.map(type => type.id === id ? { ...type, active: false } : type));
    onFormChange();
  };

  const removePaymentMethod = (id: string) => {
    setDraftPaymentMethods(current => current.map(method => method.id === id ? { ...method, active: false } : method));
    setDraftFlightTypes(current => current.map(type =>
      type.forcedPaymentMethodId === id ? { ...type, forcedPaymentMethodId: null } : type
    ));
    onFormChange();
  };

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
    if (!canEdit || !window.confirm('Disconnect Stripe from the CRM? Existing records will remain, but new online payment setup will stop using this linked account.')) return;
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

  const activePaymentMethods = draftPaymentMethods.filter(method => method.active);
  const activeFlightTypes = draftFlightTypes.filter(type => type.active);

  const rateSummary = useMemo(() => {
    return aircraft.flatMap(item => (item.rates || []).map(rate => ({
      aircraft: item.registration,
      flightType: draftFlightTypes.find(type => type.id === rate.flightTypeId)?.name || rate.flightTypeName || 'Unknown',
      chargeType: rate.chargeType,
      soloRate: rate.soloRate,
      dualRate: rate.dualRate,
      surcharge: rate.flatSurcharge,
    })));
  }, [aircraft, draftFlightTypes]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <DollarSign className="h-5 w-5 mr-2" />
          Billing & Rates
        </h2>
        <p className="text-gray-600">Configure flight types, payment methods and the rate rules used when flights are logged.</p>
      </div>

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <CreditCard className="h-5 w-5 mr-2 text-blue-600" />
              Stripe Connection
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Link the club Stripe account so online payment features can be managed from the CRM without exposing Stripe secrets in the browser.
            </p>
            {stripeStatus?.callbackUrl && (
              <p className="mt-3 text-xs text-gray-500">
                Stripe redirect URI: <span className="font-mono text-gray-700 break-all">{stripeStatus.callbackUrl}</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadStripeStatus}
              disabled={stripeLoading}
              className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${stripeLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {stripeStatus?.connected ? (
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
                  disabled={stripeLoading}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {stripeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Connect Stripe
                </button>
              )
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-blue-100 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</p>
            <p className={`mt-1 text-sm font-semibold ${stripeStatus?.connected ? 'text-green-700' : 'text-amber-700'}`}>
              {stripeStatus?.connected ? 'Connected' : 'Not connected'}
            </p>
          </div>
          <div className="rounded-lg border border-blue-100 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Account</p>
            <p className="mt-1 break-all text-sm font-medium text-gray-800">{stripeStatus?.accountId || 'No Stripe account linked'}</p>
          </div>
          <div className="rounded-lg border border-blue-100 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Mode</p>
            <p className="mt-1 text-sm font-medium text-gray-800">
              {stripeStatus?.connected ? (stripeStatus.livemode ? 'Live payments' : 'Test mode') : 'Waiting for setup'}
            </p>
          </div>
        </div>

        {stripeStatus && !stripeStatus.configured && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Add <span className="font-mono">STRIPE_CONNECT_CLIENT_ID</span> and <span className="font-mono">STRIPE_SECRET_KEY</span> to Supabase Edge Function secrets, then add the redirect URI above in Stripe Connect OAuth settings.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <CreditCard className="h-5 w-5 mr-2 text-blue-600" />
              Payment Methods
            </h3>
            <p className="text-sm text-gray-500 mt-1">Control where each payment method appears for flight charges and account top-ups.</p>
          </div>
          {canEdit && (
            <button onClick={addPaymentMethod} className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
              <Plus className="h-4 w-4" />
              Add Method
            </button>
          )}
        </div>

        <div className="space-y-3">
          {activePaymentMethods.map(method => (
            <div key={method.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="grid grid-cols-1 md:grid-cols-[1.2fr_2fr_auto] gap-3 items-start">
                <input
                  value={method.name}
                  onChange={event => updatePaymentMethod(method.id, { name: event.target.value })}
                  disabled={!canEdit}
                  className={inputClass}
                  placeholder="Payment method"
                />
                <input
                  value={method.description}
                  onChange={event => updatePaymentMethod(method.id, { description: event.target.value })}
                  disabled={!canEdit}
                  className={inputClass}
                  placeholder="Description shown to staff"
                />
                {canEdit && (
                  <button
                    onClick={() => removePaymentMethod(method.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                    title="Deactivate payment method"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={method.allowAccountTopup !== false}
                    disabled={!canEdit}
                    onChange={event => updatePaymentMethod(method.id, { allowAccountTopup: event.target.checked })}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Allow for pilot account top-ups
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Users className="h-5 w-5 mr-2 text-blue-600" />
              Flight Types
            </h3>
            <p className="text-sm text-gray-500 mt-1">Flight types control booking choices, forced payment methods and aircraft rate rows.</p>
          </div>
          {canEdit && (
            <button onClick={addFlightType} className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
              <Plus className="h-4 w-4" />
              Add Flight Type
            </button>
          )}
        </div>

        <div className="space-y-3">
          {activeFlightTypes.map((type, index) => (
            <div key={type.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4">
              <div className="grid grid-cols-1 xl:grid-cols-[auto_1fr_1.3fr_1fr_auto] gap-3 items-start">
                <div className="flex items-center gap-1 pt-2 text-gray-400">
                  <GripVertical className="h-4 w-4" />
                  <div className="flex flex-col">
                    <button disabled={!canEdit || index === 0} onClick={() => moveFlightType(type.id, -1)} className="text-xs disabled:opacity-30">Up</button>
                    <button disabled={!canEdit || index === activeFlightTypes.length - 1} onClick={() => moveFlightType(type.id, 1)} className="text-xs disabled:opacity-30">Down</button>
                  </div>
                </div>
                <input
                  value={type.name}
                  onChange={event => updateFlightType(type.id, { name: event.target.value })}
                  disabled={!canEdit}
                  className={inputClass}
                  placeholder="Flight type"
                />
                <input
                  value={type.description}
                  onChange={event => updateFlightType(type.id, { description: event.target.value })}
                  disabled={!canEdit}
                  className={inputClass}
                  placeholder="Description"
                />
                <select
                  value={type.forcedPaymentMethodId ?? ''}
                  onChange={event => updateFlightType(type.id, { forcedPaymentMethodId: event.target.value || null })}
                  disabled={!canEdit}
                  className={inputClass}
                >
                  <option value="">No forced method</option>
                  {activePaymentMethods.map(method => (
                    <option key={method.id} value={method.id}>{method.name}</option>
                  ))}
                </select>
                {canEdit && (
                  <button
                    onClick={() => removeFlightType(type.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                    title="Deactivate flight type"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Allowed roles</p>
                <div className="flex flex-wrap gap-2">
                  {allRoles.map(role => (
                    <label key={role} className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 capitalize">
                      <input
                        type="checkbox"
                        checked={type.allowedRoles.includes(role)}
                        disabled={!canEdit}
                        onChange={() => {
                          const roles = type.allowedRoles.includes(role)
                            ? type.allowedRoles.filter(item => item !== role)
                            : [...type.allowedRoles, role];
                          updateFlightType(type.id, { allowedRoles: roles });
                        }}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      {role}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Aircraft Rate Matrix</h3>
          <p className="text-sm text-gray-500 mt-1">Rates are edited on each aircraft record. This table shows the active rules currently feeding flight-log billing.</p>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Aircraft</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Flight Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Charge</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Solo</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Dual</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Surcharge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {rateSummary.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No aircraft rates configured yet.</td>
                </tr>
              ) : (
                rateSummary.map((rate, index) => (
                  <tr key={`${rate.aircraft}-${rate.flightType}-${index}`}>
                    <td className="px-4 py-3 font-medium text-gray-900">{rate.aircraft}</td>
                    <td className="px-4 py-3 text-gray-700">{rate.flightType}</td>
                    <td className="px-4 py-3 text-gray-700 capitalize">{rate.chargeType.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-right text-gray-700">${rate.soloRate.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">${rate.dualRate.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">${rate.surcharge.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
