import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  StudentMatrixAssessment,
  SyllabusMatrixRequirement,
  SyllabusMatrixRow,
  SyllabusMatrixStandard,
} from '../types';

const toMatrixRow = (row: any): SyllabusMatrixRow => ({
  id: row.id,
  courseId: row.course_id,
  code: row.code,
  rowType: row.row_type,
  unitCode: row.unit_code ?? undefined,
  elementCode: row.element_code ?? undefined,
  parentCode: row.parent_code ?? undefined,
  description: row.description,
  sourceRowNumber: row.source_row_number ?? undefined,
  sortOrder: row.sort_order,
});

const toRequirement = (row: any): SyllabusMatrixRequirement => ({
  id: row.id,
  courseId: row.course_id,
  lessonId: row.lesson_id ?? undefined,
  matrixRowId: row.matrix_row_id,
  lessonSequenceCode: row.lesson_sequence_code,
  lessonColumnTitle: row.lesson_column_title,
  requiredStandard: row.required_standard,
  assessmentCriterionId: row.assessment_criterion_id ?? undefined,
});

const toAssessment = (row: any): StudentMatrixAssessment => ({
  id: row.id,
  studentId: row.student_id,
  courseId: row.course_id,
  lessonId: row.lesson_id ?? undefined,
  trainingRecordId: row.training_record_id ?? undefined,
  matrixRowId: row.matrix_row_id,
  achievedStandard: row.achieved_standard ?? undefined,
  comments: row.comments ?? '',
  instructorId: row.instructor_id ?? undefined,
  assessedAt: row.assessed_at ? new Date(row.assessed_at) : new Date(row.created_at),
});

type SaveAssessmentInput = {
  studentId: string;
  courseId: string;
  lessonId?: string;
  trainingRecordId?: string;
  instructorId?: string;
  assessments: Array<{
    matrixRowId: string;
    achievedStandard?: SyllabusMatrixStandard;
    comments?: string;
  }>;
};

const fetchAllPages = async <T,>(
  buildQuery: () => any,
  pageSize = 1000
): Promise<T[]> => {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
};

const normaliseLessonKey = (value?: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const addRequirementGroup = (
  grouped: Map<string, SyllabusMatrixRequirement[]>,
  key: string | undefined,
  requirement: SyllabusMatrixRequirement
) => {
  const rawKey = String(key || '').trim();
  if (!rawKey) return;

  const keys = new Set([rawKey, normaliseLessonKey(rawKey)].filter(Boolean));
  keys.forEach((groupKey) => {
    const current = grouped.get(groupKey) ?? [];
    if (!current.some((item) => item.id === requirement.id)) {
      grouped.set(groupKey, [...current, requirement]);
    }
  });
};

export const matrixStandardLabel = (standard?: SyllabusMatrixStandard) => {
  if (standard === 1) return '1 - Qualification standard';
  if (standard === 2) return '2 - Supervised solo standard';
  if (standard === 3) return '3 - Training received';
  return 'Not assessed';
};

export const matrixStandardShortLabel = (standard?: SyllabusMatrixStandard) =>
  standard ? String(standard) : '-';

export const formatSyllabusMatrixText = (value?: string) => {
  const text = (value ?? '').trim();
  if (!text) return '';

  return text.replace(/[A-Za-z]/, (letter) => letter.toUpperCase());
};

export const matrixStandardMeetsRequirement = (
  achieved?: SyllabusMatrixStandard,
  required?: SyllabusMatrixStandard
) => {
  if (!achieved || !required) return false;
  return achieved <= required;
};

export const useSyllabusMatrix = (courseId?: string, studentId?: string) => {
  const [rows, setRows] = useState<SyllabusMatrixRow[]>([]);
  const [requirements, setRequirements] = useState<SyllabusMatrixRequirement[]>([]);
  const [assessments, setAssessments] = useState<StudentMatrixAssessment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchMatrix = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!courseId) {
      setRows([]);
      setRequirements([]);
      setAssessments([]);
      setError(null);
      setLoading(false);
      return;
    }

    setRows([]);
    setRequirements([]);
    setAssessments([]);
    setError(null);
    setLoading(true);
    try {
      const [matrixRows, matrixRequirements, matrixAssessments] = await Promise.all([
        fetchAllPages<any>(() =>
          supabase
            .from('syllabus_matrix_rows')
            .select('*')
            .eq('course_id', courseId)
            .order('sort_order', { ascending: true })
        ),
        fetchAllPages<any>(() =>
          supabase
            .from('syllabus_matrix_requirements')
            .select('*')
            .eq('course_id', courseId)
            .order('lesson_sequence_code', { ascending: true })
        ),
        studentId
          ? fetchAllPages<any>(() =>
              supabase
                .from('student_matrix_assessments')
                .select('*')
                .eq('course_id', courseId)
                .eq('student_id', studentId)
                .order('assessed_at', { ascending: false })
            )
          : Promise.resolve([]),
      ]);

      if (requestId !== requestIdRef.current) return;
      setRows(matrixRows.map(toMatrixRow));
      setRequirements(matrixRequirements.map(toRequirement));
      setAssessments(matrixAssessments.map(toAssessment));
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.error('Failed to load syllabus matrix:', err);
      setError(err instanceof Error ? err.message : 'Failed to load syllabus matrix');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [courseId, studentId]);

  useEffect(() => {
    void fetchMatrix();
  }, [fetchMatrix]);

  const requirementsByLesson = useMemo(() => {
    const grouped = new Map<string, SyllabusMatrixRequirement[]>();
    requirements.forEach((requirement) => {
      addRequirementGroup(grouped, requirement.lessonId, requirement);
      addRequirementGroup(grouped, requirement.lessonSequenceCode, requirement);
      addRequirementGroup(grouped, requirement.lessonColumnTitle, requirement);
    });
    return grouped;
  }, [requirements]);

  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows]
  );

  const bestAssessmentByRow = useMemo(() => {
    const best = new Map<string, StudentMatrixAssessment>();
    assessments.forEach((assessment) => {
      const current = best.get(assessment.matrixRowId);
      if (!current || (
        assessment.achievedStandard &&
        (!current.achievedStandard || assessment.achievedStandard < current.achievedStandard)
      )) {
        best.set(assessment.matrixRowId, assessment);
      }
    });
    return best;
  }, [assessments]);

  const saveAssessments = useCallback(async ({
    studentId: saveStudentId,
    courseId: saveCourseId,
    lessonId,
    trainingRecordId,
    instructorId,
    assessments: assessmentRows,
  }: SaveAssessmentInput) => {
    const rowsToSave = assessmentRows
      .filter((assessment) => assessment.achievedStandard)
      .map((assessment) => ({
        student_id: saveStudentId,
        course_id: saveCourseId,
        lesson_id: lessonId ?? null,
        training_record_id: trainingRecordId ?? null,
        matrix_row_id: assessment.matrixRowId,
        achieved_standard: assessment.achievedStandard,
        comments: assessment.comments ?? '',
        instructor_id: instructorId ?? null,
        assessed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

    if (rowsToSave.length === 0) return;

    const { error } = await supabase
      .from('student_matrix_assessments')
      .upsert(rowsToSave, { onConflict: 'training_record_id,matrix_row_id' });

    if (error) throw error;
    await fetchMatrix();
  }, [fetchMatrix]);

  return {
    rows,
    requirements,
    assessments,
    requirementsByLesson,
    rowsById,
    bestAssessmentByRow,
    loading,
    error,
    refetch: fetchMatrix,
    saveAssessments,
  };
};

export const normaliseSyllabusLessonKey = normaliseLessonKey;
