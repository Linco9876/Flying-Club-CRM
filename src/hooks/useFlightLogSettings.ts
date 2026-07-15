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
    try {
      const timestamp = new Date().toISOString();
      const existingRows = nextSettings.filter(setting => !setting.id.startsWith('flight-log-field-'));
      const newRows = nextSettings.filter(setting => setting.id.startsWith('flight-log-field-'));

      for (const setting of existingRows) {
        const { error: updateError } = await supabase
          .from('flight_log_field_settings')
          .update({
            aircraft_id: setting.aircraft_id ?? null,
            field_name: setting.field_name,
            is_enabled: setting.is_enabled,
            is_mandatory: setting.is_enabled ? setting.is_mandatory : false,
            display_order: setting.display_order,
            updated_at: timestamp,
          })
          .eq('id', setting.id);

        if (updateError) throw updateError;
      }

      const toPayload = (setting: FlightLogFieldSetting) => ({
        aircraft_id: setting.aircraft_id ?? null,
        field_name: setting.field_name,
        is_enabled: setting.is_enabled,
        is_mandatory: setting.is_enabled ? setting.is_mandatory : false,
        display_order: setting.display_order,
        updated_at: timestamp,
      });

      const globalDraftRows = newRows.filter(setting => !setting.aircraft_id);
      const globalRows = globalDraftRows.map(toPayload);
      if (globalRows.length > 0) {
        const { data: existingGlobalRows, error: globalLookupError } = await supabase
          .from('flight_log_field_settings')
          .select('id, field_name')
          .is('aircraft_id', null)
          .in('field_name', globalDraftRows.map(setting => setting.field_name));

        if (globalLookupError) throw globalLookupError;

        const existingGlobalByName = new Map((existingGlobalRows || []).map(row => [row.field_name, row.id]));
        const globalRowsToInsert = globalDraftRows
          .filter(setting => !existingGlobalByName.has(setting.field_name))
          .map(toPayload);

        for (const setting of globalDraftRows.filter(row => existingGlobalByName.has(row.field_name))) {
          const { error: globalUpdateError } = await supabase
            .from('flight_log_field_settings')
            .update(toPayload(setting))
            .eq('id', existingGlobalByName.get(setting.field_name));

          if (globalUpdateError) throw globalUpdateError;
        }

        if (globalRowsToInsert.length > 0) {
          const { error: globalInsertError } = await supabase
            .from('flight_log_field_settings')
            .insert(globalRowsToInsert);

          if (globalInsertError) throw globalInsertError;
        }
      }

      const aircraftGroups = new Map<string, FlightLogFieldSetting[]>();
      newRows
        .filter(setting => setting.aircraft_id)
        .forEach(setting => {
          const group = aircraftGroups.get(setting.aircraft_id!) || [];
          group.push(setting);
          aircraftGroups.set(setting.aircraft_id!, group);
        });

      for (const [aircraftId, aircraftDraftRows] of aircraftGroups.entries()) {
        const { data: existingAircraftRows, error: aircraftLookupError } = await supabase
          .from('flight_log_field_settings')
          .select('id, field_name')
          .eq('aircraft_id', aircraftId)
          .in('field_name', aircraftDraftRows.map(setting => setting.field_name));

        if (aircraftLookupError) throw aircraftLookupError;

        const existingAircraftByName = new Map((existingAircraftRows || []).map(row => [row.field_name, row.id]));

        for (const setting of aircraftDraftRows.filter(row => existingAircraftByName.has(row.field_name))) {
          const { error: aircraftUpdateError } = await supabase
            .from('flight_log_field_settings')
            .update(toPayload(setting))
            .eq('id', existingAircraftByName.get(setting.field_name));

          if (aircraftUpdateError) throw aircraftUpdateError;
        }

        const aircraftRowsToInsert = aircraftDraftRows
          .filter(setting => !existingAircraftByName.has(setting.field_name))
          .map(toPayload);

        if (aircraftRowsToInsert.length > 0) {
          const { error: aircraftInsertError } = await supabase
            .from('flight_log_field_settings')
            .insert(aircraftRowsToInsert);

          if (aircraftInsertError) throw aircraftInsertError;
        }
      }

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
