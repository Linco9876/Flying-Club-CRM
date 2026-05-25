import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export interface OutstandingFlightLog {
  id: string;
  booking_id?: string;
  aircraft_id: string;
  student_id: string;
  instructor_id: string;
  start_time: string;
  end_time: string;
  dual_time: number;
  solo_time: number;
  training_record_status: 'pending' | 'dismissed' | 'recorded';
  // joined fields
  student_name?: string;
  student_email?: string;
  aircraft_registration?: string;
  aircraft_type?: string;
}

export function useOutstandingRecords(instructorId?: string) {
  const [outstandingLogs, setOutstandingLogs] = useState<OutstandingFlightLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!instructorId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);

      // Fetch flight logs for this instructor that are still pending
      const { data: logs, error } = await supabase
        .from('flight_logs')
        .select('id, booking_id, aircraft_id, student_id, instructor_id, start_time, end_time, dual_time, solo_time, training_record_status')
        .eq('instructor_id', instructorId)
        .eq('training_record_status', 'pending')
        .order('start_time', { ascending: false });

      if (error) throw error;

      if (!logs || logs.length === 0) {
        setOutstandingLogs([]);
        return;
      }

      // Fetch related student and aircraft info
      const studentIds = [...new Set(logs.map(l => l.student_id).filter(Boolean))];
      const aircraftIds = [...new Set(logs.map(l => l.aircraft_id).filter(Boolean))];

      const [{ data: usersData }, { data: aircraftData }] = await Promise.all([
        supabase.from('users').select('id, name, email').in('id', studentIds),
        supabase.from('aircraft').select('id, registration, type').in('id', aircraftIds),
      ]);

      const userMap = new Map((usersData ?? []).map(u => [u.id, u]));
      const aircraftMap = new Map((aircraftData ?? []).map(a => [a.id, a]));

      const enriched: OutstandingFlightLog[] = logs.map(log => ({
        ...log,
        training_record_status: log.training_record_status as OutstandingFlightLog['training_record_status'],
        student_name: userMap.get(log.student_id)?.name,
        student_email: userMap.get(log.student_id)?.email,
        aircraft_registration: aircraftMap.get(log.aircraft_id)?.registration,
        aircraft_type: aircraftMap.get(log.aircraft_id)?.type,
      }));

      setOutstandingLogs(enriched);
    } catch (err) {
      console.error('Error fetching outstanding records:', err);
    } finally {
      setLoading(false);
    }
  }, [instructorId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const dismissRecord = async (flightLogId: string) => {
    const { error } = await supabase
      .from('flight_logs')
      .update({ training_record_status: 'dismissed' })
      .eq('id', flightLogId);

    if (error) {
      toast.error('Failed to dismiss record');
      throw error;
    }

    setOutstandingLogs(prev => prev.filter(l => l.id !== flightLogId));
    toast.success('Record dismissed');
  };

  const markRecorded = async (flightLogId: string) => {
    const { error } = await supabase
      .from('flight_logs')
      .update({ training_record_status: 'recorded' })
      .eq('id', flightLogId);

    if (error) {
      toast.error('Failed to mark as recorded');
      throw error;
    }

    setOutstandingLogs(prev => prev.filter(l => l.id !== flightLogId));
  };

  return { outstandingLogs, loading, refetch: fetch, dismissRecord, markRecorded };
}
