import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type InstructorComplianceCheckType = 'initial_issue' | 'sp_check' | 'renewal';
export type InstructorComplianceLevel = 'instructor' | 'senior_instructor';
export type InstructorComplianceOutcome = 'not_assessed' | 'satisfactory' | 'unsatisfactory';
export type InstructorComplianceItemResult = 'not_assessed' | 'satisfactory' | 'unsatisfactory';

export interface InstructorComplianceCourse {
  id: string;
  name: string;
  description: string;
  version: string;
  sourceDocuments: Array<{ name: string; purpose: string }>;
  isActive: boolean;
}

export interface InstructorComplianceCourseItem {
  id: string;
  courseId: string;
  section: string;
  code: string;
  title: string;
  guidance: string;
  sortOrder: number;
  required: boolean;
  applicableLevels: InstructorComplianceLevel[];
  applicableCheckTypes: InstructorComplianceCheckType[];
}

export interface InstructorComplianceChecklistResult {
  itemId: string;
  code: string;
  title: string;
  result: InstructorComplianceItemResult;
  notes: string;
}

export interface InstructorComplianceRecord {
  id: string;
  courseId: string;
  candidateInstructorId: string;
  examinerCfiId: string;
  bookingId?: string;
  flightLogId?: string;
  checkType: InstructorComplianceCheckType;
  instructorLevel: InstructorComplianceLevel;
  checkDate: string;
  status: 'draft' | 'completed' | 'remedial_required' | 'voided';
  outcome: InstructorComplianceOutcome;
  groundMinutes: number;
  flightMinutes: number;
  briefingLesson: string;
  emergencyControlPlanConfirmed: boolean;
  medicalSighted: boolean;
  checklist: InstructorComplianceChecklistResult[];
  strengths: string;
  deficiencies: string;
  developmentPlan: string;
  cfiComments: string;
  raausFormPath?: string;
  raausFormName?: string;
  completedAt?: string;
  nextSpCheckDue?: string;
  nextRenewalDue?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveInstructorComplianceRecord {
  courseId: string;
  candidateInstructorId: string;
  examinerCfiId: string;
  bookingId?: string;
  flightLogId?: string;
  checkType: InstructorComplianceCheckType;
  instructorLevel: InstructorComplianceLevel;
  checkDate: string;
  status: 'draft' | 'completed' | 'remedial_required';
  outcome: InstructorComplianceOutcome;
  groundMinutes: number;
  flightMinutes: number;
  briefingLesson: string;
  emergencyControlPlanConfirmed: boolean;
  medicalSighted: boolean;
  checklist: InstructorComplianceChecklistResult[];
  strengths: string;
  deficiencies: string;
  developmentPlan: string;
  cfiComments: string;
  raausFormPath?: string;
  raausFormName?: string;
}

const mapCourse = (value: unknown): InstructorComplianceCourse => {
  const row = value as Record<string, unknown>;
  return ({
  id: row.id,
  name: row.name,
  description: row.description || '',
  version: row.version || '1.0',
  sourceDocuments: Array.isArray(row.source_documents)
    ? row.source_documents as Array<{ name: string; purpose: string }>
    : [],
  isActive: row.is_active !== false,
  }) as InstructorComplianceCourse;
};

const mapItem = (value: unknown): InstructorComplianceCourseItem => {
  const row = value as Record<string, unknown>;
  return ({
  id: row.id,
  courseId: row.course_id,
  section: row.section,
  code: row.code,
  title: row.title,
  guidance: row.guidance || '',
  sortOrder: row.sort_order || 0,
  required: row.required !== false,
  applicableLevels: Array.isArray(row.applicable_levels) ? row.applicable_levels : [],
  applicableCheckTypes: Array.isArray(row.applicable_check_types) ? row.applicable_check_types : [],
  }) as InstructorComplianceCourseItem;
};

const mapRecord = (value: unknown): InstructorComplianceRecord => {
  const row = value as Record<string, unknown>;
  return ({
  id: row.id,
  courseId: row.course_id,
  candidateInstructorId: row.candidate_instructor_id,
  examinerCfiId: row.examiner_cfi_id,
  bookingId: row.booking_id || undefined,
  flightLogId: row.flight_log_id || undefined,
  checkType: row.check_type,
  instructorLevel: row.instructor_level,
  checkDate: row.check_date,
  status: row.status,
  outcome: row.outcome,
  groundMinutes: row.ground_minutes || 0,
  flightMinutes: row.flight_minutes || 0,
  briefingLesson: row.briefing_lesson || '',
  emergencyControlPlanConfirmed: row.emergency_control_plan_confirmed === true,
  medicalSighted: row.medical_sighted === true,
  checklist: Array.isArray(row.checklist) ? row.checklist : [],
  strengths: row.strengths || '',
  deficiencies: row.deficiencies || '',
  developmentPlan: row.development_plan || '',
  cfiComments: row.cfi_comments || '',
  raausFormPath: row.raaus_form_path || undefined,
  raausFormName: row.raaus_form_name || undefined,
  completedAt: row.completed_at || undefined,
  nextSpCheckDue: row.next_sp_check_due || undefined,
  nextRenewalDue: row.next_renewal_due || undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  }) as InstructorComplianceRecord;
};

export function useInstructorCompliance(enabled = true) {
  const [courses, setCourses] = useState<InstructorComplianceCourse[]>([]);
  const [items, setItems] = useState<InstructorComplianceCourseItem[]>([]);
  const [records, setRecords] = useState<InstructorComplianceRecord[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const fetchCompliance = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [courseResult, itemResult, recordResult] = await Promise.all([
        supabase.from('instructor_compliance_courses').select('*').eq('is_active', true).order('created_at'),
        supabase.from('instructor_compliance_course_items').select('*').order('sort_order'),
        supabase.from('instructor_compliance_records').select('*').is('voided_at', null).order('check_date', { ascending: false }),
      ]);

      if (courseResult.error) throw courseResult.error;
      if (itemResult.error) throw itemResult.error;
      if (recordResult.error) throw recordResult.error;

      setCourses((courseResult.data || []).map(mapCourse));
      setItems((itemResult.data || []).map(mapItem));
      setRecords((recordResult.data || []).map(mapRecord));
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load instructor compliance records';
      console.error('Error loading instructor compliance:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void fetchCompliance();
  }, [fetchCompliance]);

  const saveRecord = useCallback(async (input: SaveInstructorComplianceRecord) => {
    const row = {
      course_id: input.courseId,
      candidate_instructor_id: input.candidateInstructorId,
      examiner_cfi_id: input.examinerCfiId,
      booking_id: input.bookingId || null,
      flight_log_id: input.flightLogId || null,
      check_type: input.checkType,
      instructor_level: input.instructorLevel,
      check_date: input.checkDate,
      status: input.status,
      outcome: input.outcome,
      ground_minutes: input.groundMinutes,
      flight_minutes: input.flightMinutes,
      briefing_lesson: input.briefingLesson,
      emergency_control_plan_confirmed: input.emergencyControlPlanConfirmed,
      medical_sighted: input.medicalSighted,
      checklist: input.checklist,
      strengths: input.strengths,
      deficiencies: input.deficiencies,
      development_plan: input.developmentPlan,
      cfi_comments: input.cfiComments,
      raaus_form_path: input.raausFormPath || null,
      raaus_form_name: input.raausFormName || null,
    };

    const { data, error: saveError } = await supabase
      .from('instructor_compliance_records')
      .insert(row)
      .select('*')
      .single();

    if (saveError) throw saveError;
    const saved = mapRecord(data);
    setRecords(current => [saved, ...current]);
    return saved;
  }, []);

  const uploadRenewalForm = useCallback(async (candidateId: string, file: File) => {
    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const path = `${candidateId}/${uniqueName}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from('instructor-compliance-forms')
      .upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;
    return { path, name: file.name };
  }, []);

  const createFormUrl = useCallback(async (path: string) => {
    const { data, error: urlError } = await supabase.storage
      .from('instructor-compliance-forms')
      .createSignedUrl(path, 120);
    if (urlError) throw urlError;
    return data.signedUrl;
  }, []);

  return {
    courses,
    items,
    records,
    loading,
    error,
    refetch: fetchCompliance,
    saveRecord,
    uploadRenewalForm,
    createFormUrl,
  };
}
