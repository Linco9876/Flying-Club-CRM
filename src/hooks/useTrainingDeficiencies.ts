import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

export type TrainingDeficiencyStage = 'pre_solo' | 'pre_test';
export type TrainingDeficiencyStatus = 'open' | 'resolved';

export interface TrainingDeficiency {
  id: string;
  studentId: string;
  courseId: string;
  sourceLessonId?: string;
  sourceTrainingRecordId?: string;
  stage: TrainingDeficiencyStage;
  description: string;
  status: TrainingDeficiencyStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolutionTrainingRecordId?: string;
  resolutionNote?: string;
}

export interface NewTrainingDeficiency {
  clientReference: string;
  stage: TrainingDeficiencyStage;
  description: string;
}

interface TrainingDeficiencyRow {
  id: string;
  student_id: string;
  course_id: string;
  source_lesson_id?: string | null;
  source_training_record_id?: string | null;
  stage: TrainingDeficiencyStage;
  description: string;
  status: TrainingDeficiencyStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_training_record_id?: string | null;
  resolution_note?: string | null;
}

const mapDeficiency = (row: TrainingDeficiencyRow): TrainingDeficiency => ({
  id: row.id,
  studentId: row.student_id,
  courseId: row.course_id,
  sourceLessonId: row.source_lesson_id || undefined,
  sourceTrainingRecordId: row.source_training_record_id || undefined,
  stage: row.stage,
  description: row.description,
  status: row.status,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
  resolvedBy: row.resolved_by || undefined,
  resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
  resolutionTrainingRecordId: row.resolution_training_record_id || undefined,
  resolutionNote: row.resolution_note || undefined,
});

export const applyTrainingDeficiencyChanges = async ({
  trainingRecordId,
  newDeficiencies,
  resolvedDeficiencyIds,
  resolutionNote,
}: {
  trainingRecordId: string;
  newDeficiencies?: NewTrainingDeficiency[];
  resolvedDeficiencyIds?: string[];
  resolutionNote?: string;
}) => {
  const { data, error } = await supabase.rpc('apply_training_deficiency_changes', {
    p_training_record_id: trainingRecordId,
    p_new_deficiencies: newDeficiencies ?? [],
    p_resolved_deficiency_ids: resolvedDeficiencyIds ?? [],
    p_resolution_note: resolutionNote?.trim() || null,
  });

  if (error) throw error;
  return data;
};

export const useTrainingDeficiencies = (studentId?: string) => {
  const [deficiencies, setDeficiencies] = useState<TrainingDeficiency[]>([]);
  const [loading, setLoading] = useState(Boolean(studentId));
  const [error, setError] = useState<string | null>(null);

  const fetchDeficiencies = useCallback(async () => {
    if (!studentId) {
      setDeficiencies([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    const { data, error: queryError } = await supabase
      .from('training_deficiencies')
      .select('id, student_id, course_id, source_lesson_id, source_training_record_id, stage, description, status, created_by, created_at, updated_at, resolved_by, resolved_at, resolution_training_record_id, resolution_note')
      .eq('student_id', studentId)
      .eq('status', 'open')
      .order('created_at', { ascending: true });

    if (queryError) {
      console.error('Failed to load training deficiencies:', queryError);
      setError(queryError.message);
      setDeficiencies([]);
    } else {
      setError(null);
      setDeficiencies(((data ?? []) as TrainingDeficiencyRow[]).map(mapDeficiency));
    }
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    void fetchDeficiencies();
  }, [fetchDeficiencies]);

  useEffect(() => {
    if (!studentId) return undefined;
    const channel = supabase
      .channel(`training-deficiencies-${studentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'training_deficiencies', filter: `student_id=eq.${studentId}` },
        () => void fetchDeficiencies(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchDeficiencies, studentId]);

  const openByCourse = useMemo(() => {
    const grouped = new Map<string, TrainingDeficiency[]>();
    deficiencies.forEach(deficiency => {
      grouped.set(deficiency.courseId, [...(grouped.get(deficiency.courseId) ?? []), deficiency]);
    });
    return grouped;
  }, [deficiencies]);

  return {
    deficiencies,
    openByCourse,
    loading,
    error,
    refetch: fetchDeficiencies,
  };
};
