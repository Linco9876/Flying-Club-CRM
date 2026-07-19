import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { DutyContext, StartDutyInput } from '../types';
import { supabase } from '../lib/supabase';

const EMPTY_CONTEXT: DutyContext = {
  allowed: true,
  activeDuty: null,
  activeBreak: null,
  loggedFlightMinutes: 0,
  loggedFlightCount: 0,
  locations: [],
  maximumBackdateMinutes: 120,
  serverTime: new Date().toISOString(),
};

export const useDutyClock = (userId?: string) => {
  const [context, setContext] = useState<DutyContext>(EMPTY_CONTEXT);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!userId) return;
    setError(undefined);
    const { data, error: queryError } = await supabase.rpc('mobile_get_duty_context');
    if (queryError) {
      setError(queryError.message);
    } else if (data) {
      setContext(data as DutyContext);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    const timer = setInterval(() => void refresh(), 60_000);
    const channel = supabase
      .channel(`mobile-duty-${userId || 'none'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duty_periods', filter: userId ? `instructor_id=eq.${userId}` : undefined }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duty_break_sessions', filter: userId ? `instructor_id=eq.${userId}` : undefined }, () => void refresh())
      .subscribe();
    return () => {
      appState.remove();
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  const perform = async (operation: () => Promise<{ error: { message: string } | null }>) => {
    setWorking(true);
    setError(undefined);
    try {
      const result = await operation();
      if (result.error) throw new Error(result.error.message);
      await refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The duty action could not be completed';
      setError(message);
      throw new Error(message);
    } finally {
      setWorking(false);
    }
  };

  const startDuty = (input: StartDutyInput) => perform(async () => {
    const { error: actionError } = await supabase.rpc('mobile_start_duty', {
      p_actual_start: input.actualStart.toISOString(),
      p_location_label: input.locationLabel,
      p_latitude: input.geo.latitude ?? null,
      p_longitude: input.geo.longitude ?? null,
      p_accuracy_metres: input.geo.accuracyMetres ?? null,
      p_duty_clock_location_id: input.geo.nearestLocation?.id ?? null,
      p_geofence_notes: input.geofenceNotes || null,
      p_fit_for_duty: input.fitForDuty,
      p_external_duty_declared: input.externalDutyDeclared,
      p_sleep_opportunity_confirmed: input.sleepOpportunityConfirmed,
      p_kss_score: input.kssScore ?? null,
      p_private_note: input.privateNote || null,
      p_device_platform: Platform.OS,
    });
    return { error: actionError };
  });

  const startBreak = () => perform(async () => {
    const { error: actionError } = await supabase.rpc('mobile_start_break', { p_started_at: new Date().toISOString() });
    return { error: actionError };
  });

  const endBreak = () => perform(async () => {
    const { error: actionError } = await supabase.rpc('mobile_end_break', { p_ended_at: new Date().toISOString() });
    return { error: actionError };
  });

  const endDuty = (actualEnd: Date, flightMinutes: number, notes: string) => perform(async () => {
    const { error: actionError } = await supabase.rpc('mobile_end_duty', {
      p_actual_end: actualEnd.toISOString(),
      p_flight_minutes: flightMinutes,
      p_notes: notes || null,
      p_device_platform: Platform.OS,
    });
    return { error: actionError };
  });

  return { context, loading, working, error, refresh, startDuty, startBreak, endBreak, endDuty };
};
