import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { TrainingRecord, TrainingSequenceResult, TrainingAuditEntry } from '../types';
import toast from 'react-hot-toast';

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

      const { data: sequenceResultsData, error: sequenceResultsError } = await supabase
        .from('training_sequence_results')
        .select('*');

      if (sequenceResultsError) throw sequenceResultsError;

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

      const combinedRecords: TrainingRecord[] = (recordsData || []).map(r => ({
        id: r.id,
        studentId: r.student_id,
        bookingId: r.booking_id,
        date: new Date(r.date),
        aircraftId: r.aircraft_id,
        aircraftType: r.aircraft_type,
        registration: r.registration,
        instructorId: r.instructor_id,
        dualTimeMin: r.dual_time_min,
        soloTimeMin: r.solo_time_min,
        comments: r.comments,
        formalBriefing: r.formal_briefing,
        lessonCodes: r.lesson_codes || [],
        nextLesson: r.next_lesson,
        status: r.status,
        instructorSignatureUrl: r.instructor_signature_url,
        studentAck: r.student_ack,
        studentAckName: r.student_ack_name,
        instructorSignTimestamp: r.instructor_sign_timestamp ? new Date(r.instructor_sign_timestamp) : undefined,
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
        sequences: sequenceResultsMap.get(r.id) || []
      }));

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

  const addTrainingRecord = async (recordData: Omit<TrainingRecord, 'id' | 'sequences' | 'auditLog'>) => {
    try {
      const { data, error } = await supabase
        .from('training_records')
        .insert({
          student_id: recordData.studentId,
          booking_id: recordData.bookingId,
          date: recordData.date.toISOString(),
          aircraft_id: recordData.aircraftId,
          aircraft_type: recordData.aircraftType,
          registration: recordData.registration,
          instructor_id: recordData.instructorId,
          dual_time_min: recordData.dualTimeMin,
          solo_time_min: recordData.soloTimeMin,
          comments: recordData.comments,
          formal_briefing: recordData.formalBriefing,
          lesson_codes: recordData.lessonCodes,
          next_lesson: recordData.nextLesson,
          status: recordData.status,
          instructor_signature_url: recordData.instructorSignatureUrl,
          student_ack: recordData.studentAck,
          student_ack_name: recordData.studentAckName,
          instructor_sign_timestamp: recordData.instructorSignTimestamp?.toISOString(),
          student_ack_timestamp: recordData.studentAckTimestamp?.toISOString(),
          attachments: recordData.attachments
        })
        .select()
        .single();

      if (error) throw error;

      await fetchTrainingRecords();
      toast.success('Training record created successfully');
      return data;
    } catch (err) {
      console.error('Error adding training record:', err);
      toast.error('Failed to create training record');
      throw err;
    }
  };

  const updateTrainingRecord = async (id: string, recordData: Partial<Omit<TrainingRecord, 'id' | 'sequences' | 'auditLog'>>) => {
    try {
      const updateData: any = {};
      if (recordData.studentId !== undefined) updateData.student_id = recordData.studentId;
      if (recordData.bookingId !== undefined) updateData.booking_id = recordData.bookingId;
      if (recordData.date !== undefined) updateData.date = recordData.date.toISOString();
      if (recordData.aircraftId !== undefined) updateData.aircraft_id = recordData.aircraftId;
      if (recordData.aircraftType !== undefined) updateData.aircraft_type = recordData.aircraftType;
      if (recordData.registration !== undefined) updateData.registration = recordData.registration;
      if (recordData.instructorId !== undefined) updateData.instructor_id = recordData.instructorId;
      if (recordData.dualTimeMin !== undefined) updateData.dual_time_min = recordData.dualTimeMin;
      if (recordData.soloTimeMin !== undefined) updateData.solo_time_min = recordData.soloTimeMin;
      if (recordData.comments !== undefined) updateData.comments = recordData.comments;
      if (recordData.formalBriefing !== undefined) updateData.formal_briefing = recordData.formalBriefing;
      if (recordData.lessonCodes !== undefined) updateData.lesson_codes = recordData.lessonCodes;
      if (recordData.nextLesson !== undefined) updateData.next_lesson = recordData.nextLesson;
      if (recordData.status !== undefined) updateData.status = recordData.status;
      if (recordData.instructorSignatureUrl !== undefined) updateData.instructor_signature_url = recordData.instructorSignatureUrl;
      if (recordData.studentAck !== undefined) updateData.student_ack = recordData.studentAck;
      if (recordData.studentAckName !== undefined) updateData.student_ack_name = recordData.studentAckName;
      if (recordData.instructorSignTimestamp !== undefined) updateData.instructor_sign_timestamp = recordData.instructorSignTimestamp?.toISOString();
      if (recordData.studentAckTimestamp !== undefined) updateData.student_ack_timestamp = recordData.studentAckTimestamp?.toISOString();
      if (recordData.attachments !== undefined) updateData.attachments = recordData.attachments;

      const { error } = await supabase
        .from('training_records')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      await fetchTrainingRecords();
      toast.success('Training record updated successfully');
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
