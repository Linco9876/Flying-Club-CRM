import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { TrainingRecord, TrainingSequenceResult } from '../types';
import toast from 'react-hot-toast';

const toLocalDateOnly = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const fromDateOnly = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const useTrainingRecords = () => {
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrainingRecords = async () => {
    try {
      setLoading(true);
      const { data: recordsData, error: recordsError } = await supabase
        .from('training_records')
        .select('*')
        .order('date', { ascending: false });

      if (recordsError) throw recordsError;

      const recordIds = (recordsData || []).map(record => record.id);
      const flightLogIds = [...new Set((recordsData || []).map(record => record.flight_log_id).filter(Boolean))];
      const bookingIds = [...new Set((recordsData || []).map(record => record.booking_id).filter(Boolean))];

      const { data: sequenceResultsData, error: sequenceResultsError } = recordIds.length > 0
        ? await supabase
            .from('training_sequence_results')
            .select('*')
            .in('training_record_id', recordIds)
        : { data: [], error: null };

      if (sequenceResultsError) throw sequenceResultsError;

      const [
        { data: flightLogRows, error: flightLogError },
        { data: bookingRows, error: bookingError },
      ] = await Promise.all([
        flightLogIds.length > 0
          ? supabase.from('flight_logs').select('id, start_time').in('id', flightLogIds)
          : Promise.resolve({ data: [], error: null }),
        bookingIds.length > 0
          ? supabase.from('bookings').select('id, start_time').in('id', bookingIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (flightLogError) throw flightLogError;
      if (bookingError) throw bookingError;

      const flightLogStartMap = new Map((flightLogRows || []).map(row => [row.id, row.start_time]));
      const bookingStartMap = new Map((bookingRows || []).map(row => [row.id, row.start_time]));

      const sequenceResultsMap = new Map<string, TrainingSequenceResult[]>();
      sequenceResultsData?.forEach(sr => {
        const results = sequenceResultsMap.get(sr.training_record_id) || [];
        results.push({
          id: sr.id,
          trainingRecordId: sr.training_record_id,
          sequenceId: sr.sequence_id,
          sequenceCode: sr.sequence_code,
          sequenceTitle: sr.sequence_title,
          competence: sr.competence
        });
        sequenceResultsMap.set(sr.training_record_id, results);
      });

      const combinedRecords: TrainingRecord[] = (recordsData || []).map(r => {
        const bookingStart = (r.flight_log_id ? flightLogStartMap.get(r.flight_log_id) : null)
          || (r.booking_id ? bookingStartMap.get(r.booking_id) : null);

        return {
          id: r.id,
          studentId: r.student_id,
          bookingId: r.booking_id,
          flightLogId: r.flight_log_id,
          courseId: r.course_id,
          lessonId: r.lesson_id,
          date: fromDateOnly(r.date),
          bookingStartTime: bookingStart ? new Date(bookingStart) : undefined,
          aircraftId: r.aircraft_id,
          aircraftType: r.aircraft_type,
          registration: r.registration,
          instructorId: r.instructor_id,
          dualTimeMin: r.dual_time_min,
          soloTimeMin: r.solo_time_min,
          comments: r.comments,
          briefingComments: r.briefing_comments || '',
          formalBriefing: r.formal_briefing,
          criteriaGrades: r.criteria_grades || {},
          lessonCodes: r.lesson_codes || [],
          nextLesson: r.next_lesson,
          status: r.status,
          instructorSignatureUrl: r.instructor_signature_url,
          studentAck: r.student_ack,
          studentAckName: r.student_ack_name,
          studentComments: r.student_comments || '',
          instructorSignTimestamp: r.instructor_sign_timestamp ? new Date(r.instructor_sign_timestamp) : (r.created_at ? new Date(r.created_at) : undefined),
          studentAckTimestamp: r.student_ack_timestamp ? new Date(r.student_ack_timestamp) : undefined,
          attachments: r.attachments || [],
          auditLog: (r.audit_log || []).map((entry: any) => ({
            id: entry.id,
            timestamp: new Date(entry.timestamp),
            userId: entry.userId,
            userName: entry.userName,
            action: entry.action,
            changes: entry.changes
          })),
          isFlightReview: r.is_flight_review || false,
          flightReviewType: r.flight_review_type || undefined,
          flightReviewResult: r.flight_review_result || undefined,
          flightReviewNotes: r.flight_review_notes || undefined,
          pilotRoleGranted: r.pilot_role_granted || false,
          sequences: sequenceResultsMap.get(r.id) || []
        };
      });

      setTrainingRecords(combinedRecords);
      setError(null);
    } catch (err) {
      console.error('Error fetching training records:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch training records');
      toast.error('Failed to load training records');
    } finally {
      setLoading(false);
    }
  };

  const addTrainingRecord = async (recordData: Omit<TrainingRecord, 'id' | 'sequences' | 'auditLog'> & { sequences?: TrainingSequenceResult[] }) => {
    try {
      const { data, error } = await supabase
        .from('training_records')
        .insert({
          student_id: recordData.studentId,
          booking_id: recordData.bookingId,
          flight_log_id: recordData.flightLogId,
          course_id: recordData.courseId,
          lesson_id: recordData.lessonId,
          date: toLocalDateOnly(recordData.date),
          aircraft_id: recordData.aircraftId,
          aircraft_type: recordData.aircraftType,
          registration: recordData.registration,
          instructor_id: recordData.instructorId,
          dual_time_min: recordData.dualTimeMin,
          solo_time_min: recordData.soloTimeMin,
          comments: recordData.comments,
          briefing_comments: recordData.briefingComments,
          formal_briefing: recordData.formalBriefing,
          criteria_grades: recordData.criteriaGrades,
          lesson_codes: recordData.lessonCodes,
          next_lesson: recordData.nextLesson,
          status: recordData.status,
          instructor_signature_url: recordData.instructorSignatureUrl,
          student_ack: recordData.studentAck,
          student_ack_name: recordData.studentAckName,
          instructor_sign_timestamp: recordData.instructorSignTimestamp?.toISOString()
            ?? (recordData.status === 'submitted' || recordData.status === 'locked' ? new Date().toISOString() : undefined),
          student_ack_timestamp: recordData.studentAckTimestamp?.toISOString(),
          attachments: recordData.attachments,
          is_flight_review: recordData.isFlightReview || false,
          flight_review_type: recordData.flightReviewType || null,
          flight_review_result: recordData.flightReviewResult || null,
          flight_review_notes: recordData.flightReviewNotes || null,
          pilot_role_granted: recordData.pilotRoleGranted || false,
        })
        .select()
        .single();

      if (error) throw error;

      const sequenceRows = recordData.sequences
        ?.filter(sequence => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sequence.sequenceId))
        .map(sequence => ({
          training_record_id: data.id,
          sequence_id: sequence.sequenceId,
          sequence_code: sequence.sequenceCode,
          sequence_title: sequence.sequenceTitle,
          competence: sequence.competence,
        })) ?? [];

      if (sequenceRows.length > 0) {
        const { error: sequenceError } = await supabase
          .from('training_sequence_results')
          .insert(sequenceRows);
        if (sequenceError) throw sequenceError;
      }

      await fetchTrainingRecords();
      return data;
    } catch (err) {
      console.error('Error adding training record:', err);
      toast.error('Failed to create training record');
      throw err;
    }
  };

  const updateTrainingRecord = async (id: string, recordData: Partial<Omit<TrainingRecord, 'id' | 'sequences'>>) => {
    try {
      const updateData: any = {};
      if (recordData.studentId !== undefined) updateData.student_id = recordData.studentId;
      if (recordData.bookingId !== undefined) updateData.booking_id = recordData.bookingId;
      if (recordData.flightLogId !== undefined) updateData.flight_log_id = recordData.flightLogId;
      if (recordData.courseId !== undefined) updateData.course_id = recordData.courseId;
      if (recordData.lessonId !== undefined) updateData.lesson_id = recordData.lessonId;
      if (recordData.date !== undefined) updateData.date = toLocalDateOnly(recordData.date);
      if (recordData.aircraftId !== undefined) updateData.aircraft_id = recordData.aircraftId;
      if (recordData.aircraftType !== undefined) updateData.aircraft_type = recordData.aircraftType;
      if (recordData.registration !== undefined) updateData.registration = recordData.registration;
      if (recordData.instructorId !== undefined) updateData.instructor_id = recordData.instructorId;
      if (recordData.dualTimeMin !== undefined) updateData.dual_time_min = recordData.dualTimeMin;
      if (recordData.soloTimeMin !== undefined) updateData.solo_time_min = recordData.soloTimeMin;
      if (recordData.comments !== undefined) updateData.comments = recordData.comments;
      if (recordData.briefingComments !== undefined) updateData.briefing_comments = recordData.briefingComments;
      if (recordData.formalBriefing !== undefined) updateData.formal_briefing = recordData.formalBriefing;
      if (recordData.criteriaGrades !== undefined) updateData.criteria_grades = recordData.criteriaGrades;
      if (recordData.lessonCodes !== undefined) updateData.lesson_codes = recordData.lessonCodes;
      if (recordData.nextLesson !== undefined) updateData.next_lesson = recordData.nextLesson;
      if (recordData.status !== undefined) updateData.status = recordData.status;
      if (recordData.instructorSignatureUrl !== undefined) updateData.instructor_signature_url = recordData.instructorSignatureUrl;
      if (recordData.studentAck !== undefined) updateData.student_ack = recordData.studentAck;
      if (recordData.studentAckName !== undefined) updateData.student_ack_name = recordData.studentAckName ?? null;
      if (recordData.studentComments !== undefined) updateData.student_comments = recordData.studentComments;
      if (recordData.instructorSignTimestamp !== undefined) updateData.instructor_sign_timestamp = recordData.instructorSignTimestamp?.toISOString();
      if (recordData.studentAckTimestamp !== undefined) updateData.student_ack_timestamp = recordData.studentAckTimestamp ? recordData.studentAckTimestamp.toISOString() : null;
      if (recordData.attachments !== undefined) updateData.attachments = recordData.attachments;
      if (recordData.isFlightReview !== undefined) updateData.is_flight_review = recordData.isFlightReview;
      if (recordData.flightReviewType !== undefined) updateData.flight_review_type = recordData.flightReviewType || null;
      if (recordData.flightReviewResult !== undefined) updateData.flight_review_result = recordData.flightReviewResult || null;
      if (recordData.flightReviewNotes !== undefined) updateData.flight_review_notes = recordData.flightReviewNotes || null;
      if (recordData.pilotRoleGranted !== undefined) updateData.pilot_role_granted = recordData.pilotRoleGranted;
      if (recordData.auditLog !== undefined) {
        updateData.audit_log = recordData.auditLog.map(entry => ({
          id: entry.id,
          timestamp: entry.timestamp.toISOString(),
          userId: entry.userId,
          userName: entry.userName,
          action: entry.action,
          changes: entry.changes,
        }));
      }

      const { error } = await supabase
        .from('training_records')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      await fetchTrainingRecords();
    } catch (err) {
      console.error('Error updating training record:', err);
      toast.error('Failed to update training record');
      throw err;
    }
  };

  const deleteTrainingRecord = async (id: string) => {
    try {
      const { error } = await supabase
        .from('training_records')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await fetchTrainingRecords();
      toast.success('Training record deleted successfully');
    } catch (err) {
      console.error('Error deleting training record:', err);
      toast.error('Failed to delete training record');
      throw err;
    }
  };

  useEffect(() => {
    fetchTrainingRecords();
  }, []);

  return {
    trainingRecords,
    loading,
    error,
    addTrainingRecord,
    updateTrainingRecord,
    deleteTrainingRecord,
    refetch: fetchTrainingRecords
  };
};
