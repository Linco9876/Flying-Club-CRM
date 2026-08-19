import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

export interface FlightLogFieldSetting {
  id: string;
  aircraft_id?: string | null;
  field_name: string;
  is_enabled: boolean;
  is_mandatory: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export function getEffectiveFlightLogSettings(
  settings: FlightLogFieldSetting[],
  aircraftId?: string | null
) {
  const globalByName = new Map(
    settings
      .filter(setting => !setting.aircraft_id)
      .map(setting => [setting.field_name, setting])
  );
  const aircraftByName = new Map(
    settings
      .filter(setting => aircraftId && setting.aircraft_id === aircraftId)
      .map(setting => [setting.field_name, setting])
  );

  return Array.from(globalByName.values())
    .map(globalSetting => aircraftByName.get(globalSetting.field_name) || globalSetting)
    .sort((a, b) => a.display_order - b.display_order);
}

export function useFlightLogSettings(aircraftId?: string | null) {
  const [settings, setSettings] = useState<FlightLogFieldSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const effectiveSettings = useMemo(
    () => getEffectiveFlightLogSettings(settings, aircraftId),
    [settings, aircraftId]
  );

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

  const updateSettings = async (nextSettings: FlightLogFieldSetting[]) => {
    if (error) return { error: 'Flight log settings must load successfully before they can be changed.' };
    try {
      const timestamp = new Date().toISOString();
      const payload = nextSettings.map(setting => ({
        id: setting.id.startsWith('flight-log-field-') ? crypto.randomUUID() : setting.id,
        aircraft_id: setting.aircraft_id ?? null,
        field_name: setting.field_name,
        is_enabled: setting.is_enabled,
        is_mandatory: setting.is_enabled ? setting.is_mandatory : false,
        display_order: setting.display_order,
        updated_at: timestamp,
      }));

      const { error: upsertError } = await supabase
        .from('flight_log_field_settings')
        .upsert(payload, { onConflict: 'id' });

      if (upsertError) throw upsertError;

      await fetchSettings();
      return { error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save flight log settings';
      console.error('Error saving flight log settings:', err);
      return { error: errorMessage };
    }
  };

  const deleteAircraftSettings = async (aircraftId: string) => {
    try {
      const { error: deleteError } = await supabase
        .from('flight_log_field_settings')
        .delete()
        .eq('aircraft_id', aircraftId);

      if (deleteError) throw deleteError;

      await fetchSettings();
      return { error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to reset aircraft flight log settings';
      console.error('Error resetting aircraft flight log settings:', err);
      return { error: errorMessage };
    }
  };

  return {
    settings,
    effectiveSettings,
    loading,
    error,
    updateSetting,
    updateSettings,
    deleteAircraftSettings,
    refetch: fetchSettings,
  };
}
