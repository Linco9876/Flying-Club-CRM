import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export interface AircraftRate {
  id: string;
  aircraftId: string;
  flightTypeId: string;
  chargeType: 'tach' | 'flat' | 'per_pax' | 'free' | 'not_used';
  soloRate: number;
  dualRate: number;
  flatSurcharge: number;
  weekendSurcharge: number;
  defaultPaymentMethodId: string | null;
  includedTaxes: number;
}

export const useAircraftRates = (aircraftId?: string, enabled = true) => {
  const [rates, setRates] = useState<AircraftRate[]>([]);
  const [loading, setLoading] = useState(enabled && Boolean(aircraftId));

  useEffect(() => {
    if (aircraftId && enabled) {
      fetchRates();
    } else {
      setRates([]);
      setLoading(false);
    }
  }, [aircraftId, enabled]);

  const fetchRates = async () => {
    if (!aircraftId) return;

    try {
      const { data, error } = await supabase
        .from('aircraft_rates')
        .select('*')
        .eq('aircraft_id', aircraftId);

      if (error) throw error;

      if (data) {
        setRates(data.map(r => ({
          id: r.id,
          aircraftId: r.aircraft_id,
          flightTypeId: r.flight_type_id,
          chargeType: r.charge_type,
          soloRate: parseFloat(r.solo_rate || 0),
          dualRate: parseFloat(r.dual_rate || 0),
          flatSurcharge: parseFloat(r.flat_surcharge || 0),
          weekendSurcharge: parseFloat(r.weekend_surcharge || 0),
          defaultPaymentMethodId: r.default_payment_method_id,
          includedTaxes: parseFloat(r.included_taxes || 0)
        })));
      }
    } catch (error) {
      console.error('Error fetching aircraft rates:', error);
    } finally {
      setLoading(false);
    }
  };

  const upsertRate = async (rate: Omit<AircraftRate, 'id'> & { id?: string }) => {
    try {
      const dbData = {
        aircraft_id: rate.aircraftId,
        flight_type_id: rate.flightTypeId,
        charge_type: rate.chargeType,
        solo_rate: rate.soloRate,
        dual_rate: rate.dualRate,
        flat_surcharge: rate.flatSurcharge,
        weekend_surcharge: rate.weekendSurcharge,
        default_payment_method_id: rate.defaultPaymentMethodId,
        included_taxes: rate.includedTaxes,
        updated_at: new Date().toISOString()
      };

      if (rate.id) {
        const { error } = await supabase
          .from('aircraft_rates')
          .update(dbData)
          .eq('id', rate.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('aircraft_rates')
          .insert(dbData);

        if (error) throw error;
      }

      await fetchRates();
      toast.success('Rate saved');
    } catch (error) {
      console.error('Error saving rate:', error);
      toast.error('Failed to save rate');
      throw error;
    }
  };

  const deleteRate = async (id: string) => {
    try {
      const { error } = await supabase
        .from('aircraft_rates')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setRates(rates.filter(r => r.id !== id));
      toast.success('Rate deleted');
    } catch (error) {
      console.error('Error deleting rate:', error);
      toast.error('Failed to delete rate');
    }
  };

  return {
    rates,
    loading,
    upsertRate,
    deleteRate,
    refetch: fetchRates
  };
};
