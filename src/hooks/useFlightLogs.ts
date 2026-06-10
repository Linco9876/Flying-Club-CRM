import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface FlightLog {
  id: string;
  booking_id?: string;
  aircraft_id: string;
  student_id: string;
  instructor_id?: string;
  start_time: string;
  end_time: string;
  start_tach: number;
  end_tach: number;
  flight_duration: number;
  dual_time: number;
  solo_time: number;
  takeoffs?: number;
  landings?: number;
  comments?: string;
  payment_type?: string;
  observations?: string;
  oil_added?: number;
  fuel_added?: number;
  passengers?: number;
  created_at: string;
  created_by?: string;
}

export interface CreateFlightLogData {
  booking_id?: string;
  aircraft_id: string;
  student_id: string;
  instructor_id?: string;
  start_time: string;
  end_time: string;
  start_tach: number;
  end_tach: number;
  flight_duration: number;
  dual_time: number;
  solo_time: number;
  takeoffs?: number;
  landings?: number;
  comments?: string;
  payment_type?: string;
  observations?: string;
  oil_added?: number;
  fuel_added?: number;
  passengers?: number;
}

export function useFlightLogs(userId?: string) {
  const [flightLogs, setFlightLogs] = useState<FlightLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFlightLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('flight_logs')
        .select('*')
        .order('start_time', { ascending: false });

      if (userId) {
        query = query.or(`student_id.eq.${userId},instructor_id.eq.${userId}`);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setFlightLogs(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch flight logs');
      console.error('Error fetching flight logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlightLogs();
  }, [userId]);

  const createFlightLog = async (logData: CreateFlightLogData) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error: insertError } = await supabase
        .from('flight_logs')
        .insert({
          ...logData,
          created_by: user.id,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      if (logData.booking_id) {
        const { error: updateError } = await supabase
          .from('bookings')
          .update({ flight_logged: true })
          .eq('id', logData.booking_id);

        if (updateError) console.error('Error updating booking:', updateError);
      }

      const { error: aircraftUpdateError } = await supabase
        .from('aircraft')
        .update({ total_hours: logData.end_tach })
        .eq('id', logData.aircraft_id);

      if (aircraftUpdateError) {
        console.error('Error updating aircraft hours:', aircraftUpdateError);
      }

      await fetchFlightLogs();
      return { data, error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create flight log';
      console.error('Error creating flight log:', err);
      return { data: null, error: errorMessage };
    }
  };

  const updateFlightLog = async (id: string, updates: Partial<CreateFlightLogData>) => {
    try {
      const { error: updateError } = await supabase
        .from('flight_logs')
        .update(updates)
        .eq('id', id);

      if (updateError) throw updateError;

      await fetchFlightLogs();
      return { error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update flight log';
      console.error('Error updating flight log:', err);
      return { error: errorMessage };
    }
  };

  const deleteFlightLog = async (id: string) => {
    try {
      const { error: deleteError } = await supabase
        .from('flight_logs')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      await fetchFlightLogs();
      return { error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete flight log';
      console.error('Error deleting flight log:', err);
      return { error: errorMessage };
    }
  };

  const checkTachOverlap = async (aircraftId: string, startTach: number, endTach: number, excludeLogId?: string) => {
    try {
      let query = supabase
        .from('flight_logs')
        .select('id, start_tach, end_tach, start_time, end_time')
        .eq('aircraft_id', aircraftId)
        .or(`and(start_tach.lte.${endTach},end_tach.gte.${startTach})`);

      if (excludeLogId) {
        query = query.neq('id', excludeLogId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const overlappingLogs = data?.filter(log => {
        const overlapStart = Math.max(log.start_tach, startTach);
        const overlapEnd = Math.min(log.end_tach, endTach);
        return overlapEnd > overlapStart;
      }) || [];

      return { overlaps: overlappingLogs, error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check tach overlap';
      console.error('Error checking tach overlap:', err);
      return { overlaps: [], error: errorMessage };
    }
  };

  return {
    flightLogs,
    loading,
    error,
    createFlightLog,
    updateFlightLog,
    deleteFlightLog,
    checkTachOverlap,
    refetch: fetchFlightLogs,
  };
}
