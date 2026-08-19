import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { GroundSessionDescriptionOption, GroundSessionRate } from '../types';

const mapRate = (row: any): GroundSessionRate => ({
  id: row.id,
  descriptionOptionId: row.description_option_id,
  flightTypeId: row.flight_type_id,
  enabled: row.enabled === true,
  hourlyRate: Number(row.hourly_rate || 0),
});

const mapRow = (row: any, rates: GroundSessionRate[] = []): GroundSessionDescriptionOption => ({
  id: row.id,
  name: row.name || '',
  description: row.description || '',
  active: row.active !== false,
  displayOrder: Number(row.display_order || 0),
  pricingMode: row.pricing_mode === 'fixed' ? 'fixed' : 'flight_type_hourly',
  fixedRate: Number(row.fixed_rate || 0),
  flightTypeId: row.flight_type_id || null,
  rates,
});

type GroundSessionDescriptionDraft = GroundSessionDescriptionOption | string | null | undefined;

export const useGroundSessionDescriptions = () => {
  const [options, setOptions] = useState<GroundSessionDescriptionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOptions = async () => {
    try {
      setLoading(true);
      const [
        { data, error },
        { data: rateData, error: rateError },
      ] = await Promise.all([
        supabase
          .from('ground_session_description_options')
          .select('*')
          .order('display_order', { ascending: true }),
        supabase
          .from('ground_session_rates')
          .select('*'),
      ]);

      if (error) throw error;
      if (rateError) throw rateError;
      const ratesByDescription = new Map<string, GroundSessionRate[]>();
      for (const row of rateData || []) {
        const rate = mapRate(row);
        const current = ratesByDescription.get(rate.descriptionOptionId) || [];
        current.push(rate);
        ratesByDescription.set(rate.descriptionOptionId, current);
      }
      setOptions((data || []).map(row => mapRow(row, ratesByDescription.get(row.id) || [])));
      setError(null);
    } catch (caught) {
      console.error('Error loading ground session description options:', caught);
      setOptions([]);
      setError(caught instanceof Error ? caught.message : 'Ground session descriptions could not be loaded');
      toast.error('Failed to load ground session descriptions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchOptions();
  }, []);

  const saveOptions = async (nextOptions: GroundSessionDescriptionDraft[]) => {
    if (error) throw new Error('Ground session descriptions must load successfully before they can be changed.');
    try {
      const activeOptions = options.filter(option => option.active);
      const cleaned = nextOptions
        .map((option, index) => {
          const existing = activeOptions[index];
          if (typeof option === 'string') {
            return {
              ...(existing || {}),
              id: existing?.id || `new-ground-description-${index}`,
              name: option.trim(),
              description: existing?.description || '',
              active: existing?.active ?? true,
              displayOrder: index + 1,
              pricingMode: existing?.pricingMode || 'flight_type_hourly',
              fixedRate: existing?.fixedRate || 0,
              flightTypeId: existing?.flightTypeId || null,
              rates: existing?.rates || [],
            };
          }

          return {
            ...(option || {}),
            id: option?.id || existing?.id || `new-ground-description-${index}`,
            name: String(option?.name || '').trim(),
            description: String(option?.description || '').trim(),
            active: option?.active ?? existing?.active ?? true,
            displayOrder: index + 1,
            pricingMode: option?.pricingMode === 'fixed' ? 'fixed' : 'flight_type_hourly',
            fixedRate: Number(option?.fixedRate ?? existing?.fixedRate ?? 0),
            flightTypeId: option?.flightTypeId || existing?.flightTypeId || null,
            rates: option?.rates || existing?.rates || [],
          };
        })
        .filter(option => option.name);

      const existingIds = new Set(options.map(option => option.id));
      const nextIds = new Set(cleaned.map(option => option.id));

      for (const option of cleaned) {
        const payload = {
          name: option.name,
          description: option.description || null,
          active: option.active,
          display_order: option.displayOrder,
          pricing_mode: option.pricingMode,
          fixed_rate: option.pricingMode === 'fixed' ? Number(option.fixedRate || 0) : 0,
          flight_type_id: option.pricingMode === 'flight_type_hourly' ? option.flightTypeId || null : null,
          updated_at: new Date().toISOString(),
        };

        const { data: savedOption, error } = existingIds.has(option.id)
          ? await supabase.from('ground_session_description_options').update(payload).eq('id', option.id).select('id').single()
          : await supabase.from('ground_session_description_options').insert(payload).select('id').single();

        if (error) throw error;

        const descriptionOptionId = savedOption.id;
        const rates = option.rates
          .filter(rate => rate.flightTypeId)
          .map(rate => ({
            description_option_id: descriptionOptionId,
            flight_type_id: rate.flightTypeId,
            enabled: option.pricingMode === 'flight_type_hourly' && rate.enabled === true,
            hourly_rate: Number(rate.hourlyRate || 0),
            updated_at: new Date().toISOString(),
          }));

        if (rates.length > 0) {
          const { error: ratesError } = await supabase
            .from('ground_session_rates')
            .upsert(rates, { onConflict: 'description_option_id,flight_type_id' });
          if (ratesError) throw ratesError;
        }

        if (option.pricingMode === 'fixed') {
          const { error: disableRatesError } = await supabase
            .from('ground_session_rates')
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq('description_option_id', descriptionOptionId);
          if (disableRatesError) throw disableRatesError;
        }
      }

      const removedIds = [...existingIds].filter(id => !nextIds.has(id));
      if (removedIds.length > 0) {
        const { error } = await supabase
          .from('ground_session_description_options')
          .update({ active: false, updated_at: new Date().toISOString() })
          .in('id', removedIds);
        if (error) throw error;
      }

      await fetchOptions();
      toast.success('Ground session descriptions saved');
    } catch (error) {
      console.error('Error saving ground session description options:', error);
      toast.error('Failed to save ground session descriptions');
      throw error;
    }
  };

  return {
    options,
    loading,
    error,
    saveOptions,
    refetch: fetchOptions,
  };
};
