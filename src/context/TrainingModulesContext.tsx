import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { TrainingExam, TrainingLesson, TrainingModule } from '../types';

type TrainingModulesContextValue = {
  modules: TrainingModule[];
  loading: boolean;
  addModule: (module: TrainingModule) => Promise<TrainingModule>;
  createBlankModule: () => Promise<TrainingModule>;
  duplicateModule: (moduleId: string, overrides?: Partial<TrainingModule>) => Promise<TrainingModule | null>;
  updateModule: (moduleId: string, updater: (module: TrainingModule) => TrainingModule) => Promise<void>;
  reorderLessons: (moduleId: string, lessonIds: string[]) => Promise<void>;
  deleteModule: (moduleId: string) => Promise<void>;
};

const TrainingModulesContext = createContext<TrainingModulesContextValue | undefined>(undefined);

// ---- DB row → app type converters ----------------------------------------

function dbCourseToModule(row: Record<string, unknown>, lessons: TrainingLesson[]): TrainingModule {
  const rawExams = Array.isArray(row.exam_requirements) ? row.exam_requirements : [];
  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    description: (row.description as string) ?? '',
    category: (row.category as string) ?? 'Custom',
    version: (row.version as string) ?? '1.0',
    status: (row.status as 'draft' | 'published') ?? 'draft',
    estimatedDurationHours: (row.estimated_duration_hours as number) ?? 6,
    prerequisites: (row.prerequisites as string[]) ?? [],
    objectives: (row.objectives as string[]) ?? [],
    evaluationCriteria: (row.evaluation_criteria as string[]) ?? [],
    tags: (row.tags as string[]) ?? [],
    assessmentCriteria: (row.assessment_criteria as TrainingModule['assessmentCriteria']) ?? [],
    requiresStudentAcknowledgement: row.requires_student_acknowledgement === undefined || row.requires_student_acknowledgement === null
      ? true
      : Boolean(row.requires_student_acknowledgement),
    requiresFlyingDeclaration: Boolean(row.requires_flying_declaration),
    flyingDeclarationTitle: (row.flying_declaration_title as string) ?? 'Flying Declaration',
    flyingDeclarationText: (row.flying_declaration_text as string) ?? '',
    flyingDeclarationVersion: Number(row.flying_declaration_version ?? 1),
    completionEndorsementEnabled: Boolean(row.completion_endorsement_enabled),
    completionEndorsementType: (row.completion_endorsement_type as string) ?? '',
    completionEndorsementExpiryMonths: row.completion_endorsement_expiry_months === null || row.completion_endorsement_expiry_months === undefined
      ? null
      : Number(row.completion_endorsement_expiry_months),
    exams: rawExams.map((exam: any) => ({
      id: String(exam.id ?? `exam-${Date.now()}`),
      name: String(exam.name ?? ''),
      passMark: Number(exam.passMark ?? exam.pass_mark ?? 80),
    })).filter((exam: TrainingExam) => exam.name.trim()),
    createdBy: (row.created_by as string) ?? undefined,
    lessons,
    resources: [],
    lastUpdated: row.last_updated ? new Date(row.last_updated as string) : new Date(),
  };
}

function dbLessonToLesson(row: Record<string, unknown>): TrainingLesson {
  return {
    id: row.id as string,
    sequenceId: (row.sequence_id as string) ?? '',
    sequenceCode: (row.sequence_code as string) ?? '',
    sequenceTitle: (row.sequence_title as string) ?? '',
    stage: (row.stage as 'ground' | 'flight' | 'simulator') ?? 'flight',
    durationMinutes: (row.duration_minutes as number) ?? 60,
    minCompetency: (row.min_competency as 'Introduce' | 'Practice' | 'Assess') ?? 'Introduce',
    keyExercises: (row.key_exercises as string[]) ?? [],
    studentPreparation: (row.student_preparation as string) ?? '',
    instructorNotes: (row.instructor_notes as string) ?? '',
    name: (row.name as string) ?? '',
    objective: (row.objective as string) ?? '',
    flightExercises: (row.flight_exercises as string) ?? '',
    theory: (row.theory as string) ?? '',
    assessmentCriteria: (row.assessment_criteria as TrainingLesson['assessmentCriteria']) ?? [],
    passMarks: (row.pass_marks as Record<string, string>) ?? {},
    isFlightTest: Boolean(row.is_flight_test),
  };
}

function moduleToDbCourse(module: TrainingModule): Record<string, unknown> {
  return {
    title: module.title,
    description: module.description,
    category: module.category,
    version: module.version,
    status: module.status,
    estimated_duration_hours: module.estimatedDurationHours,
    prerequisites: module.prerequisites,
    objectives: module.objectives,
    evaluation_criteria: module.evaluationCriteria,
    tags: module.tags,
    assessment_criteria: module.assessmentCriteria,
    requires_student_acknowledgement: module.requiresStudentAcknowledgement ?? true,
    requires_flying_declaration: module.requiresFlyingDeclaration ?? false,
    flying_declaration_title: module.flyingDeclarationTitle || 'Flying Declaration',
    flying_declaration_text: module.flyingDeclarationText || '',
    flying_declaration_version: module.flyingDeclarationVersion ?? 1,
    completion_endorsement_enabled: module.completionEndorsementEnabled ?? false,
    completion_endorsement_type: module.completionEndorsementEnabled ? (module.completionEndorsementType || null) : null,
    completion_endorsement_expiry_months: module.completionEndorsementEnabled && module.completionEndorsementExpiryMonths
      ? module.completionEndorsementExpiryMonths
      : null,
    exam_requirements: module.exams ?? [],
    last_updated: module.lastUpdated.toISOString(),
  };
}

function lessonToDbRow(lesson: TrainingLesson, courseId: string, sortOrder: number): Record<string, unknown> {
  return {
    course_id: courseId,
    sort_order: sortOrder,
    name: lesson.name,
    objective: lesson.objective,
    flight_exercises: lesson.flightExercises,
    theory: lesson.theory,
    sequence_id: lesson.sequenceId,
    sequence_code: lesson.sequenceCode,
    sequence_title: lesson.sequenceTitle,
    stage: lesson.stage,
    duration_minutes: lesson.durationMinutes,
    min_competency: lesson.minCompetency,
    key_exercises: lesson.keyExercises,
    student_preparation: lesson.studentPreparation,
    instructor_notes: lesson.instructorNotes,
    assessment_criteria: lesson.assessmentCriteria,
    pass_marks: lesson.passMarks ?? {},
    is_flight_test: lesson.isFlightTest ?? false,
  };
}

// ---- Provider ---------------------------------------------------------------

export const TrainingModulesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchModules = useCallback(async () => {
    try {
      const { data: courses, error: coursesErr } = await supabase
        .from('training_courses')
        .select('*')
        .order('last_updated', { ascending: false });

      if (coursesErr) throw coursesErr;

      const { data: lessons, error: lessonsErr } = await supabase
        .from('training_lessons')
        .select('*')
        .order('sort_order', { ascending: true });

      if (lessonsErr) throw lessonsErr;

      const lessonsByCourse: Record<string, TrainingLesson[]> = {};
      for (const row of lessons ?? []) {
        const cid = row.course_id as string;
        if (!lessonsByCourse[cid]) lessonsByCourse[cid] = [];
        lessonsByCourse[cid].push(dbLessonToLesson(row as Record<string, unknown>));
      }

      const mapped: TrainingModule[] = (courses ?? []).map((c) =>
        dbCourseToModule(c as Record<string, unknown>, lessonsByCourse[c.id as string] ?? [])
      );
      setModules(mapped);
    } catch (err) {
      console.error('Error fetching training courses:', err);
      toast.error('Failed to load training courses');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModules();
  }, [fetchModules]);

  const addModule = useCallback(async (module: TrainingModule): Promise<TrainingModule> => {
    const { data: { user } } = await supabase.auth.getUser();
    const row = { ...moduleToDbCourse(module), created_by: user?.id ?? null };

    const { data, error } = await supabase
      .from('training_courses')
      .insert(row)
      .select()
      .single();

    if (error) {
      toast.error('Failed to save course');
      throw error;
    }

    const saved = dbCourseToModule(data as Record<string, unknown>, []);
    setModules((prev) => [saved, ...prev.filter((m) => m.id !== saved.id)]);
    return saved;
  }, []);

  const createBlankModule = useCallback(async (): Promise<TrainingModule> => {
    const blank: TrainingModule = {
      id: '',
      title: 'New Training Module',
      description: 'Describe the learning outcomes, delivery methods and scope of this module.',
      category: 'Custom',
      version: '1.0',
      status: 'draft',
      estimatedDurationHours: 6,
      prerequisites: [],
      objectives: [],
      evaluationCriteria: [],
      tags: ['draft'],
      assessmentCriteria: [],
      requiresStudentAcknowledgement: true,
      requiresFlyingDeclaration: false,
      flyingDeclarationTitle: 'Flying Declaration',
      flyingDeclarationText: '',
      flyingDeclarationVersion: 1,
      completionEndorsementEnabled: false,
      completionEndorsementType: '',
      completionEndorsementExpiryMonths: null,
      exams: [],
      lessons: [],
      resources: [],
      lastUpdated: new Date(),
    };
    return addModule(blank);
  }, [addModule]);

  const duplicateModule = useCallback(async (
    moduleId: string,
    overrides?: Partial<TrainingModule>
  ): Promise<TrainingModule | null> => {
    const source = modules.find((m) => m.id === moduleId);
    if (!source) return null;

    const duplicate: TrainingModule = {
      ...source,
      ...overrides,
      id: '',
      title: overrides?.title ?? `${source.title} (Copy)`,
      status: overrides?.status ?? 'draft',
      lastUpdated: new Date(),
    };

    const saved = await addModule(duplicate);

    if (source.lessons.length > 0) {
      const rows = source.lessons.map((l, i) => ({
        ...lessonToDbRow(l, saved.id, i),
        id: undefined,
      }));
      const { error } = await supabase.from('training_lessons').insert(rows);
      if (error) {
        toast.error('Course duplicated but lessons failed to copy');
      } else {
        await fetchModules();
      }
    }

    return saved;
  }, [modules, addModule, fetchModules]);

  const updateModule = useCallback(async (
    moduleId: string,
    updater: (module: TrainingModule) => TrainingModule
  ): Promise<void> => {
    const current = modules.find((m) => m.id === moduleId);
    if (!current) return;

    const updated = updater({ ...current, lastUpdated: new Date() });

    // Update course row
    const { error: courseErr } = await supabase
      .from('training_courses')
      .update(moduleToDbCourse(updated))
      .eq('id', moduleId);

    if (courseErr) {
      toast.error('Failed to save changes');
      throw courseErr;
    }

    // Sync lessons: delete all existing, re-insert in order
    const { error: deleteErr } = await supabase
      .from('training_lessons')
      .delete()
      .eq('course_id', moduleId);

    if (deleteErr) {
      toast.error('Failed to sync lessons');
      throw deleteErr;
    }

    if (updated.lessons.length > 0) {
      const rows = updated.lessons.map((l, i) => lessonToDbRow(l, moduleId, i));
      const { error: insertErr } = await supabase.from('training_lessons').insert(rows);
      if (insertErr) {
        toast.error('Failed to save lessons');
        throw insertErr;
      }
    }

    // Refresh from DB to get server-assigned IDs for new lessons
    const { data: freshLessons } = await supabase
      .from('training_lessons')
      .select('*')
      .eq('course_id', moduleId)
      .order('sort_order', { ascending: true });

    const mappedLessons = (freshLessons ?? []).map((r) => dbLessonToLesson(r as Record<string, unknown>));

    setModules((prev) =>
      prev.map((m) => (m.id === moduleId ? { ...updated, lessons: mappedLessons } : m))
    );
  }, [modules]);

  const reorderLessons = useCallback(async (moduleId: string, lessonIds: string[]): Promise<void> => {
    const current = modules.find((m) => m.id === moduleId);
    if (!current) return;

    const lessonById = new Map(current.lessons.map((lesson) => [lesson.id, lesson]));
    if (
      lessonIds.length !== current.lessons.length ||
      lessonIds.some((lessonId) => !lessonById.has(lessonId))
    ) {
      toast.error('Lesson order is out of date. Refresh and try again.');
      return;
    }

    const lastUpdated = new Date();
    const { error: courseErr } = await supabase
      .from('training_courses')
      .update({ last_updated: lastUpdated.toISOString() })
      .eq('id', moduleId);

    if (courseErr) {
      toast.error('Failed to save lesson order');
      throw courseErr;
    }

    const updates = lessonIds.map((lessonId, sortOrder) =>
      supabase
        .from('training_lessons')
        .update({ sort_order: sortOrder })
        .eq('id', lessonId)
        .eq('course_id', moduleId)
    );

    const results = await Promise.all(updates);
    const lessonErr = results.find((result) => result.error)?.error;
    if (lessonErr) {
      toast.error('Failed to save lesson order');
      throw lessonErr;
    }

    const reorderedLessons = lessonIds.map((lessonId) => lessonById.get(lessonId)!);
    setModules((prev) =>
      prev.map((module) =>
        module.id === moduleId
          ? { ...module, lessons: reorderedLessons, lastUpdated }
          : module
      )
    );
  }, [modules]);

  const deleteModule = useCallback(async (moduleId: string): Promise<void> => {
    const { error } = await supabase
      .from('training_courses')
      .delete()
      .eq('id', moduleId);

    if (error) {
      toast.error('Failed to delete course');
      throw error;
    }

    setModules((prev) => prev.filter((m) => m.id !== moduleId));
  }, []);

  const value = useMemo(
    () => ({ modules, loading, addModule, createBlankModule, duplicateModule, updateModule, reorderLessons, deleteModule }),
    [modules, loading, addModule, createBlankModule, duplicateModule, updateModule, reorderLessons, deleteModule]
  );

  return <TrainingModulesContext.Provider value={value}>{children}</TrainingModulesContext.Provider>;
};

export const useTrainingModules = () => {
  const context = useContext(TrainingModulesContext);
  if (!context) {
    throw new Error('useTrainingModules must be used within a TrainingModulesProvider');
  }
  return context;
};
