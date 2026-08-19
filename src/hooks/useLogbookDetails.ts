import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { FlightLog } from './useFlightLogs';
import { canEditLogbookNotes } from '../utils/logbookNotePermissions';

export interface LogbookEntryContext {
  bookingDescription: string;
  courseId: string | null;
  courseTitle: string;
  flightTypeName: string;
  lessonId: string | null;
  lessonName: string;
  trainingRecordId: string | null;
}

interface TrainingRecordRow {
  id: string;
  booking_id: string | null;
  flight_log_id: string | null;
  course_id: string | null;
  lesson_id: string | null;
  status: string;
  updated_at: string | null;
  training_courses?: { title?: string | null } | null;
  training_lessons?: { name?: string | null } | null;
}

interface BookingRow {
  id: string;
  notes: string | null;
  flight_types?: {
    name?: string | null;
    description?: string | null;
  } | null;
}

const EMPTY_CONTEXT: LogbookEntryContext = {
  bookingDescription: '',
  courseId: null,
  courseTitle: '',
  flightTypeName: '',
  lessonId: null,
  lessonName: '',
  trainingRecordId: null,
};

const statusRank = (status: string) => ({ locked: 3, submitted: 2, draft: 1 }[status] || 0);

const preferTrainingRecord = (left: TrainingRecordRow | undefined, right: TrainingRecordRow) => {
  if (!left) return right;
  const rankDifference = statusRank(right.status) - statusRank(left.status);
  if (rankDifference !== 0) return rankDifference > 0 ? right : left;
  return String(right.updated_at || '').localeCompare(String(left.updated_at || '')) > 0 ? right : left;
};

export const useLogbookDetails = (flightLogs: FlightLog[], logbookOwnerId: string) => {
  const { user } = useAuth();
  const [contextByFlightId, setContextByFlightId] = useState<Record<string, LogbookEntryContext>>({});
  const [notesByFlightId, setNotesByFlightId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const flightIds = useMemo(() => [...new Set(flightLogs.map(log => log.id).filter(Boolean))], [flightLogs]);
  const bookingIds = useMemo(
    () => [...new Set(flightLogs.map(log => log.booking_id).filter((id): id is string => Boolean(id)))],
    [flightLogs],
  );
  const flightIdsKey = flightIds.join(',');
  const bookingIdsKey = bookingIds.join(',');
  const canEditNotes = canEditLogbookNotes(user?.id, logbookOwnerId);

  const refresh = useCallback(() => setRefreshToken(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (flightIds.length === 0) {
        setContextByFlightId({});
        setNotesByFlightId({});
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const recordSelect = 'id,booking_id,flight_log_id,course_id,lesson_id,status,updated_at,training_courses:course_id(title),training_lessons:lesson_id(name)';
        const directRecordsPromise = supabase
          .from('training_records')
          .select(recordSelect)
          .in('flight_log_id', flightIds);
        const bookingRecordsPromise = bookingIds.length > 0
          ? supabase.from('training_records').select(recordSelect).in('booking_id', bookingIds)
          : Promise.resolve({ data: [], error: null });
        const bookingsPromise = bookingIds.length > 0
          ? supabase
            .from('bookings')
            .select('id,notes,flight_types:flight_type_id(name,description)')
            .in('id', bookingIds)
          : Promise.resolve({ data: [], error: null });
        const notesPromise = user?.id && logbookOwnerId
          ? supabase
            .from('logbook_entry_notes')
            .select('flight_log_id,note')
            .eq('user_id', logbookOwnerId)
            .in('flight_log_id', flightIds)
          : Promise.resolve({ data: [], error: null });

        const [directResult, bookingRecordResult, bookingResult, notesResult] = await Promise.all([
          directRecordsPromise,
          bookingRecordsPromise,
          bookingsPromise,
          notesPromise,
        ]);

        const firstError = directResult.error || bookingRecordResult.error || bookingResult.error || notesResult.error;
        if (firstError) throw firstError;

        const allRecords = [
          ...((directResult.data || []) as unknown as TrainingRecordRow[]),
          ...((bookingRecordResult.data || []) as unknown as TrainingRecordRow[]),
        ];
        const recordByFlightId = new Map<string, TrainingRecordRow>();
        const recordByBookingId = new Map<string, TrainingRecordRow>();
        for (const record of allRecords) {
          if (record.flight_log_id) {
            recordByFlightId.set(record.flight_log_id, preferTrainingRecord(recordByFlightId.get(record.flight_log_id), record));
          }
          if (record.booking_id) {
            recordByBookingId.set(record.booking_id, preferTrainingRecord(recordByBookingId.get(record.booking_id), record));
          }
        }

        const bookingById = new Map(
          ((bookingResult.data || []) as unknown as BookingRow[]).map(booking => [booking.id, booking]),
        );
        const nextContexts: Record<string, LogbookEntryContext> = {};
        for (const log of flightLogs) {
          const booking = log.booking_id ? bookingById.get(log.booking_id) : undefined;
          const record = recordByFlightId.get(log.id)
            || (log.booking_id ? recordByBookingId.get(log.booking_id) : undefined);
          const flightTypeName = String(booking?.flight_types?.name || '').trim();
          const bookingNotes = String(booking?.notes || '').trim();
          const flightTypeDescription = String(booking?.flight_types?.description || '').trim();
          nextContexts[log.id] = {
            bookingDescription: bookingNotes || flightTypeDescription || flightTypeName,
            courseId: record?.course_id || null,
            courseTitle: String(record?.training_courses?.title || '').trim(),
            flightTypeName,
            lessonId: record?.lesson_id || null,
            lessonName: String(record?.training_lessons?.name || '').trim(),
            trainingRecordId: record?.id || null,
          };
        }

        if (!cancelled) {
          setContextByFlightId(nextContexts);
          setNotesByFlightId(Object.fromEntries(
            ((notesResult.data || []) as Array<{ flight_log_id: string; note: string }>).map(row => [row.flight_log_id, row.note || '']),
          ));
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : 'Could not load booking and lesson details';
          setError(message);
          console.error('Error loading logbook details:', loadError);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  // Stable ID keys deliberately control refetches without reloading as object identities change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingIdsKey, flightIdsKey, logbookOwnerId, refreshToken, user?.id]);

  const saveNote = useCallback(async (flightLogId: string, note: string) => {
    if (!canEditLogbookNotes(user?.id, logbookOwnerId)) {
      throw new Error('Only the logbook owner can change these notes.');
    }
    const nextNote = note.trim();

    if (!nextNote) {
      const { error: deleteError } = await supabase
        .from('logbook_entry_notes')
        .delete()
        .eq('user_id', logbookOwnerId)
        .eq('flight_log_id', flightLogId);
      if (deleteError) throw deleteError;
    } else {
      const { error: saveError } = await supabase
        .from('logbook_entry_notes')
        .upsert({
          user_id: logbookOwnerId,
          flight_log_id: flightLogId,
          note: nextNote,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,flight_log_id' });
      if (saveError) throw saveError;
    }

    setNotesByFlightId(current => ({ ...current, [flightLogId]: nextNote }));
  }, [logbookOwnerId, user?.id]);

  return {
    contextByFlightId,
    emptyContext: EMPTY_CONTEXT,
    notesByFlightId,
    saveNote,
    canEditNotes,
    loading,
    error,
    refresh,
  };
};
