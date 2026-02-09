import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface FlightLogFieldSetting {
  id: string;
  field_name: string;
  is_enabled: boolean;
  is_mandatory: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export function useFlightLogSettings() {
  const [settings, setSettings] = useState<FlightLogFieldSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('flight_log_field_settings')
        .select('*')
        .order('display_order', { ascending: true });

      if (fetchError) throw fetchError;
      setSettings(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch settings');
      console.error('Error fetching flight log settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const updateSetting = async (
    id: string,
    updates: Partial<Omit<FlightLogFieldSetting, 'id' | 'created_at' | 'updated_at'>>
  ) => {
    try {
      const { error: updateError } = await supabase
        .from('flight_log_field_settings')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) throw updateError;

      await fetchSettings();
      return { error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update setting';
      console.error('Error updating setting:', err);
      return { error: errorMessage };
    }
  };

  return {
    settings,
    loading,
    error,
    updateSetting,
    refetch: fetchSettings,
  };
}
