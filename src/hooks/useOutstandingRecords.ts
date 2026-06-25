import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { usePageLoadState } from '../context/PageLoadContext';

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
  instructor_name?: string;
  aircraft_registration?: string;
  aircraft_type?: string;
}

export function useOutstandingRecords(instructorId?: string, fetchAll?: boolean) {
  const [outstandingLogs, setOutstandingLogs] = useState<OutstandingFlightLog[]>([]);
  const [dismissedLogs, setDismissedLogs] = useState<OutstandingFlightLog[]>([]);
  const [loading, setLoading] = useState(true);
  usePageLoadState(
    loading,
    'Loading outstanding records',
    'Finding flights that still need training records or instructor action...'
  );

  const fetch = useCallback(async () => {
    if (!instructorId && !fetchAll) {
      setOutstandingLogs([]);
      setDismissedLogs([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);

      const enrichLogs = async (logs: any[]): Promise<OutstandingFlightLog[]> => {
        if (!logs || logs.length === 0) return [];

        const studentIds = [...new Set(logs.map(l => l.student_id).filter(Boolean))];
        const instructorIds = [...new Set(logs.map(l => l.instructor_id).filter(Boolean))];
        const aircraftIds = [...new Set(logs.map(l => l.aircraft_id).filter(Boolean))];
        const allUserIds = [...new Set([...studentIds, ...instructorIds])];

        const [{ data: usersData }, { data: aircraftData }] = await Promise.all([
          allUserIds.length > 0
            ? supabase.from('users').select('id, name, email').in('id', allUserIds)
            : Promise.resolve({ data: [] }),
          aircraftIds.length > 0
            ? supabase.from('aircraft').select('id, registration, type').in('id', aircraftIds)
            : Promise.resolve({ data: [] }),
        ]);

        const userMap = new Map((usersData ?? []).map(u => [u.id, u]));
        const aircraftMap = new Map((aircraftData ?? []).map(a => [a.id, a]));

        return logs.map(log => ({
          ...log,
          training_record_status: log.training_record_status as OutstandingFlightLog['training_record_status'],
          student_name: userMap.get(log.student_id)?.name,
          student_email: userMap.get(log.student_id)?.email,
          instructor_name: userMap.get(log.instructor_id)?.name,
          aircraft_registration: aircraftMap.get(log.aircraft_id)?.registration,
          aircraft_type: aircraftMap.get(log.aircraft_id)?.type,
        }));
      };

      let query = supabase
        .from('flight_logs')
        .select('id, booking_id, aircraft_id, student_id, instructor_id, start_time, end_time, dual_time, solo_time, training_record_status')
        .not('instructor_id', 'is', null)
        .neq('training_record_status', 'dismissed')
        .order('start_time', { ascending: true })
        .limit(1000);

      if (!fetchAll && instructorId) {
        query = query.eq('instructor_id', instructorId);
      }

      const { data: candidateLogs, error } = await query;

      if (error) throw error;

      const candidateLogIds = [...new Set((candidateLogs ?? []).map(l => l.id).filter(Boolean))];
      const candidateBookingIds = [...new Set((candidateLogs ?? []).map(l => l.booking_id).filter(Boolean))];

      const { data: linkedRecords, error: recordsError } =
        candidateLogIds.length > 0 || candidateBookingIds.length > 0
          ? await supabase
              .from('training_records')
              .select('flight_log_id, booking_id')
              .or([
                candidateLogIds.length > 0 ? `flight_log_id.in.(${candidateLogIds.join(',')})` : '',
                candidateBookingIds.length > 0 ? `booking_id.in.(${candidateBookingIds.join(',')})` : '',
              ].filter(Boolean).join(','))
          : { data: [], error: null };

      if (recordsError) throw recordsError;

      const recordedFlightLogIds = new Set((linkedRecords ?? []).map(record => record.flight_log_id).filter(Boolean));
      const recordedBookingIds = new Set((linkedRecords ?? []).map(record => record.booking_id).filter(Boolean));
      const logs = (candidateLogs ?? []).filter(log =>
        !recordedFlightLogIds.has(log.id) &&
        !(log.booking_id && recordedBookingIds.has(log.booking_id))
      );

      let dismissedQuery = supabase
        .from('flight_logs')
        .select('id, booking_id, aircraft_id, student_id, instructor_id, start_time, end_time, dual_time, solo_time, training_record_status')
        .not('instructor_id', 'is', null)
        .eq('training_record_status', 'dismissed')
        .order('start_time', { ascending: false })
        .limit(100);

      if (!fetchAll && instructorId) {
        dismissedQuery = dismissedQuery.eq('instructor_id', instructorId);
      }

      const { data: dismissedData, error: dismissedError } = await dismissedQuery;
      if (dismissedError) throw dismissedError;

      const dismissedLogIds = [...new Set((dismissedData ?? []).map(l => l.id).filter(Boolean))];
      const dismissedBookingIds = [...new Set((dismissedData ?? []).map(l => l.booking_id).filter(Boolean))];
      const { data: dismissedLinkedRecords, error: dismissedRecordsError } =
        dismissedLogIds.length > 0 || dismissedBookingIds.length > 0
          ? await supabase
              .from('training_records')
              .select('flight_log_id, booking_id')
              .or([
                dismissedLogIds.length > 0 ? `flight_log_id.in.(${dismissedLogIds.join(',')})` : '',
                dismissedBookingIds.length > 0 ? `booking_id.in.(${dismissedBookingIds.join(',')})` : '',
              ].filter(Boolean).join(','))
          : { data: [], error: null };

      if (dismissedRecordsError) throw dismissedRecordsError;

      const dismissedRecordedFlightLogIds = new Set((dismissedLinkedRecords ?? []).map(record => record.flight_log_id).filter(Boolean));
      const dismissedRecordedBookingIds = new Set((dismissedLinkedRecords ?? []).map(record => record.booking_id).filter(Boolean));
      const restoreCandidates = (dismissedData ?? []).filter(log =>
        !dismissedRecordedFlightLogIds.has(log.id) &&
        !(log.booking_id && dismissedRecordedBookingIds.has(log.booking_id))
      );

      const [enriched, enrichedDismissed] = await Promise.all([
        enrichLogs(logs),
        enrichLogs(restoreCandidates),
      ]);

      setOutstandingLogs(enriched);
      setDismissedLogs(enrichedDismissed);
    } catch (err) {
      console.error('Error fetching outstanding records:', err);
    } finally {
      setLoading(false);
    }
  }, [instructorId, fetchAll]);

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
    setDismissedLogs(prev => prev.filter(l => l.id !== flightLogId));
    toast.success('Record dismissed');
    await fetch();
  };

  const restoreRecord = async (flightLogId: string) => {
    const { error } = await supabase
      .from('flight_logs')
      .update({ training_record_status: 'pending' })
      .eq('id', flightLogId);

    if (error) {
      toast.error('Failed to restore record');
      throw error;
    }

    toast.success('Record restored to Outstanding Records');
    await fetch();
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

  return { outstandingLogs, dismissedLogs, loading, refetch: fetch, dismissRecord, restoreRecord, markRecorded };
}
