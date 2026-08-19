import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  getExternalLogbookEntryValidationError,
  getLogbookBaselineValidationError,
  type ExternalLogbookEntry,
  type ExternalLogbookEntryInput,
  type LogbookBaseline,
  type LogbookBaselineInput,
} from '../utils/externalLogbook';

const normaliseBaseline = (row: Record<string, unknown>): LogbookBaseline => ({
  user_id: String(row.user_id || ''),
  as_of_date: String(row.as_of_date || ''),
  last_flight_date: row.last_flight_date ? String(row.last_flight_date) : null,
  total_hours: Number(row.total_hours || 0),
  pic_hours: Number(row.pic_hours || 0),
  dual_hours: Number(row.dual_hours || 0),
  takeoffs: Number(row.takeoffs || 0),
  landings: Number(row.landings || 0),
  created_at: row.created_at ? String(row.created_at) : undefined,
  updated_at: row.updated_at ? String(row.updated_at) : undefined,
});

const normaliseExternalEntry = (row: Record<string, unknown>): ExternalLogbookEntry => ({
  id: String(row.id || ''),
  user_id: String(row.user_id || ''),
  flight_date: String(row.flight_date || ''),
  aircraft_registration: String(row.aircraft_registration || ''),
  aircraft_type: String(row.aircraft_type || ''),
  pilot_in_command_name: row.pilot_in_command_name ? String(row.pilot_in_command_name) : null,
  other_crew_name: row.other_crew_name ? String(row.other_crew_name) : null,
  dual_hours: Number(row.dual_hours || 0),
  pic_hours: Number(row.pic_hours || 0),
  takeoffs: Number(row.takeoffs || 0),
  landings: Number(row.landings || 0),
  comments: String(row.comments || ''),
  description: String(row.description || ''),
  notes: String(row.notes || ''),
  created_at: row.created_at ? String(row.created_at) : undefined,
  updated_at: row.updated_at ? String(row.updated_at) : undefined,
});

const baselinePayload = (userId: string, input: LogbookBaselineInput) => ({
  user_id: userId,
  as_of_date: input.asOfDate,
  last_flight_date: input.lastFlightDate || null,
  total_hours: Number(input.totalHours.toFixed(1)),
  pic_hours: Number(input.picHours.toFixed(1)),
  dual_hours: Number(input.dualHours.toFixed(1)),
  takeoffs: input.takeoffs || 0,
  landings: input.landings || 0,
});

const entryPayload = (userId: string, input: ExternalLogbookEntryInput) => ({
  user_id: userId,
  flight_date: input.flightDate,
  aircraft_registration: input.aircraftRegistration.trim().toUpperCase(),
  aircraft_type: input.aircraftType.trim(),
  pilot_in_command_name: input.pilotInCommandName?.trim() || null,
  other_crew_name: input.otherCrewName?.trim() || null,
  dual_hours: Number(input.dualHours.toFixed(1)),
  pic_hours: Number(input.picHours.toFixed(1)),
  takeoffs: input.takeoffs || 0,
  landings: input.landings || 0,
  comments: input.comments?.trim() || '',
  description: input.description?.trim() || '',
  notes: input.notes?.trim() || '',
});

export const useExternalLogbook = (ownerId?: string) => {
  const { user } = useAuth();
  const [baselines, setBaselines] = useState<LogbookBaseline[]>([]);
  const [entries, setEntries] = useState<ExternalLogbookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const canEdit = Boolean(ownerId && user?.id === ownerId);

  const refresh = useCallback(() => setRefreshToken(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        let baselineQuery = supabase
          .from('logbook_baselines')
          .select('user_id,as_of_date,last_flight_date,total_hours,pic_hours,dual_hours,takeoffs,landings,created_at,updated_at');
        let entryQuery = supabase
          .from('external_logbook_entries')
          .select('id,user_id,flight_date,aircraft_registration,aircraft_type,pilot_in_command_name,other_crew_name,dual_hours,pic_hours,takeoffs,landings,comments,description,notes,created_at,updated_at')
          .order('flight_date', { ascending: false });

        if (ownerId) {
          baselineQuery = baselineQuery.eq('user_id', ownerId);
          entryQuery = entryQuery.eq('user_id', ownerId);
        }

        const [baselineResult, entryResult] = await Promise.all([baselineQuery, entryQuery]);
        if (baselineResult.error) throw baselineResult.error;
        if (entryResult.error) throw entryResult.error;
        if (!cancelled) {
          setBaselines(((baselineResult.data || []) as Record<string, unknown>[]).map(normaliseBaseline));
          setEntries(((entryResult.data || []) as Record<string, unknown>[]).map(normaliseExternalEntry));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load external logbook information');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [ownerId, refreshToken]);

  const assertOwner = useCallback(() => {
    if (!ownerId || !user?.id || ownerId !== user.id) {
      throw new Error('Only the logbook owner can change external logbook information.');
    }
    return ownerId;
  }, [ownerId, user?.id]);

  const saveBaseline = useCallback(async (input: LogbookBaselineInput) => {
    const userId = assertOwner();
    const validationError = getLogbookBaselineValidationError(input);
    if (validationError) throw new Error(validationError);

    const { data, error: saveError } = await supabase
      .from('logbook_baselines')
      .upsert(baselinePayload(userId, input), { onConflict: 'user_id' })
      .select('user_id,as_of_date,last_flight_date,total_hours,pic_hours,dual_hours,takeoffs,landings,created_at,updated_at')
      .single();
    if (saveError) throw saveError;
    const saved = normaliseBaseline(data as Record<string, unknown>);
    setBaselines(current => [saved, ...current.filter(item => item.user_id !== userId)]);
    return saved;
  }, [assertOwner]);

  const deleteBaseline = useCallback(async () => {
    const userId = assertOwner();
    const { error: deleteError } = await supabase
      .from('logbook_baselines')
      .delete()
      .eq('user_id', userId);
    if (deleteError) throw deleteError;
    setBaselines(current => current.filter(item => item.user_id !== userId));
  }, [assertOwner]);

  const saveExternalEntry = useCallback(async (input: ExternalLogbookEntryInput, entryId?: string) => {
    const userId = assertOwner();
    const validationError = getExternalLogbookEntryValidationError(input);
    if (validationError) throw new Error(validationError);
    const payload = entryPayload(userId, input);

    const query = entryId
      ? supabase.from('external_logbook_entries').update(payload).eq('id', entryId).eq('user_id', userId)
      : supabase.from('external_logbook_entries').insert(payload);
    const { data, error: saveError } = await query
      .select('id,user_id,flight_date,aircraft_registration,aircraft_type,pilot_in_command_name,other_crew_name,dual_hours,pic_hours,takeoffs,landings,comments,description,notes,created_at,updated_at')
      .single();
    if (saveError) throw saveError;
    const saved = normaliseExternalEntry(data as Record<string, unknown>);
    setEntries(current => [saved, ...current.filter(item => item.id !== saved.id)]
      .sort((left, right) => right.flight_date.localeCompare(left.flight_date)));
    return saved;
  }, [assertOwner]);

  const deleteExternalEntry = useCallback(async (entryId: string) => {
    const userId = assertOwner();
    const { error: deleteError } = await supabase
      .from('external_logbook_entries')
      .delete()
      .eq('id', entryId)
      .eq('user_id', userId);
    if (deleteError) throw deleteError;
    setEntries(current => current.filter(item => item.id !== entryId));
  }, [assertOwner]);

  return {
    baseline: ownerId ? baselines.find(item => item.user_id === ownerId) || null : null,
    baselines,
    entries,
    canEdit,
    loading,
    error,
    refresh,
    saveBaseline,
    deleteBaseline,
    saveExternalEntry,
    deleteExternalEntry,
  };
};
