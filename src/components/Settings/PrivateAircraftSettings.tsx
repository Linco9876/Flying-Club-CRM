import React, { useEffect, useState } from 'react';
import { SearchableSelect } from '../common/SearchableSelect';
import { useAircraft } from '../../hooks/useAircraft';
import { useAircraftRates } from '../../hooks/useAircraftRates';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { useFinancialProviders } from '../../context/financialProviderState';
import { isPaymentMethodAvailable } from '../../utils/paymentMethodAvailability';
import { PRIVATE_AIRCRAFT_ID } from '../../utils/privateAircraft';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

export const PrivateAircraftSettings: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const { aircraft, loading, error, refetch } = useAircraft({ includePrivateOption: true });
  const { rates, loading: ratesLoading, error: ratesError, refetch: refetchRates } = useAircraftRates(PRIVATE_AIRCRAFT_ID);
  const { flightTypes, paymentMethods, loading: billingLoading, error: billingError } = useBillingSettings();
  const { capabilities, loading: providersLoading, error: providersError } = useFinancialProviders();
  const option = aircraft.find(item => item.id === PRIVATE_AIRCRAFT_ID);
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState(rates);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setEnabled(option?.privateBookingEnabled === true); }, [option?.privateBookingEnabled]);
  useEffect(() => { setDraft(rates); }, [rates]);
  const fieldClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100';
  if (loading || ratesLoading || billingLoading || providersLoading) return <p>Loading private aircraft settings…</p>;
  if (error || ratesError || billingError || providersError || !option) return <p role="alert" className="text-red-700">Private aircraft settings are unavailable. Check that the database migration has been applied and reload Settings.</p>;
  const changeRate = (flightTypeId: string, updates: Partial<typeof rates[number]>) => setDraft(current => {
    const existing = current.find(rate => rate.flightTypeId === flightTypeId);
    const next = { id: '', aircraftId: PRIVATE_AIRCRAFT_ID, flightTypeId, chargeType: 'not_used' as const, soloRate: 0, dualRate: 0, flatSurcharge: 0, weekendSurcharge: 0, defaultPaymentMethodId: null, includedTaxes: 0, ...existing, ...updates };
    return [...current.filter(rate => rate.flightTypeId !== flightTypeId), next];
  });
  const save = async () => {
    setSaving(true);
    try {
      const { error: saveError } = await supabase.rpc('save_private_aircraft_configuration', { p_enabled: enabled, p_rates: draft });
      if (saveError) throw saveError;
      await Promise.all([refetch(), refetchRates()]);
      toast.success('Private aircraft settings saved');
    } catch (err) { toast.error(err instanceof Error ? err.message : (err as { message?: string })?.message || 'Could not save private aircraft settings'); }
    finally { setSaving(false); }
  };
  return <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
    <div><h3 className="text-lg font-semibold text-gray-900">Private aircraft instruction</h3><p className="mt-1 text-sm text-gray-500">Book instruction in a privately owned aircraft. Rates cover instruction only and include GST. Configure its logging fields under Flight Log Form by selecting Private aircraft.</p></div>
    <label className="flex items-center gap-2 text-sm font-medium text-gray-700"><input type="checkbox" checked={enabled} disabled={!canEdit || saving} onChange={e => setEnabled(e.target.checked)} />Allow new private-aircraft bookings</label>
    <p className="text-xs text-gray-500">Existing bookings can still be completed when disabled. Flying duration is entered in decimal hours; different private aircraft do not share meter history.</p>
    {flightTypes.filter(type => type.active).map(type => {
      const rate = draft.find(item => item.flightTypeId === type.id);
      return <fieldset key={type.id} disabled={!canEdit || saving} className="grid gap-3 rounded-lg border border-gray-200 p-3 sm:grid-cols-2 xl:grid-cols-3">
        <legend className="px-1 text-sm font-semibold text-gray-900">{type.name}</legend>
        <label className="text-xs text-gray-600">Charge basis<SearchableSelect className={fieldClass} value={rate?.chargeType || 'not_used'} onChange={e => changeRate(type.id, { chargeType: e.target.value as typeof rates[number]['chargeType'] })}><option value="not_used">Not available</option><option value="tach">Flying hours</option><option value="flat">Fixed fee</option><option value="free">No charge</option></SearchableSelect></label>
        <label className="text-xs text-gray-600">Instruction rate ($)<input className={fieldClass} type="number" min="0" step="0.01" value={rate?.dualRate || 0} onChange={e => changeRate(type.id, { dualRate: Number(e.target.value) })} /></label>
        <label className="text-xs text-gray-600">Flat surcharge ($)<input className={fieldClass} type="number" min="0" step="0.01" value={rate?.flatSurcharge || 0} onChange={e => changeRate(type.id, { flatSurcharge: Number(e.target.value) })} /></label>
        <label className="text-xs text-gray-600">Weekend surcharge ($)<input className={fieldClass} type="number" min="0" step="0.01" value={rate?.weekendSurcharge || 0} onChange={e => changeRate(type.id, { weekendSurcharge: Number(e.target.value) })} /></label>
        <label className="text-xs text-gray-600">Default payment method<SearchableSelect className={fieldClass} value={rate?.defaultPaymentMethodId || ''} onChange={e => changeRate(type.id, { defaultPaymentMethodId: e.target.value || null })}><option value="">Payment Type default</option>{paymentMethods.filter(method => isPaymentMethodAvailable(method, capabilities)).map(method => <option key={method.id} value={method.id}>{method.name}</option>)}</SearchableSelect></label>
      </fieldset>;
    })}
    {canEdit && <button type="button" onClick={() => void save()} disabled={saving} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save private aircraft settings'}</button>}
  </section>;
};
