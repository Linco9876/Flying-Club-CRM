import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { hasAnyRole } from '../utils/rbac';

export type LearningProgramStatus = 'draft' | 'published' | 'archived';
export type LearningScheduleType = 'self_paced' | 'scheduled';
export type LearningSelfPacedLimitType = 'none' | 'duration_days' | 'fixed_end';
export type LearningPriceType = 'free' | 'paid';
export type LearningVisibility = 'public' | 'private' | 'secret';
export type LearningStepOrderMode = 'any_order' | 'in_order';
export type LearningStepType = 'article' | 'video' | 'quiz';
export type LearningEnrolmentStatus = 'invited' | 'pending_approval' | 'active' | 'completed' | 'cancelled';
export type LearningPaymentStatus = 'not_required' | 'unpaid' | 'paid' | 'waived';
export type LearningProgressStatus = 'not_started' | 'in_progress' | 'completed';

export type LearningContentBlockType =
  | 'rich_text'
  | 'divider'
  | 'button'
  | 'table'
  | 'video'
  | 'image'
  | 'gallery'
  | 'gif'
  | 'file'
  | 'audio';

export interface LearningContentBlock {
  id: string;
  type: LearningContentBlockType;
  title?: string;
  text?: string;
  url?: string;
  label?: string;
  rows?: string[][];
  files?: Array<{ name: string; url: string }>;
}

export type LearningQuestionType =
  | 'short_answer'
  | 'long_answer'
  | 'number'
  | 'single_choice'
  | 'multiple_choice'
  | 'image_choice'
  | 'file_upload'
  | 'heading'
  | 'text';

export interface LearningQuestion {
  id: string;
  type: LearningQuestionType;
  prompt: string;
  options?: Array<{ id: string; label: string; imageUrl?: string }>;
  correctAnswer?: string | string[] | number;
  hint?: string;
  additionalInfo?: string;
  incorrectExplanation?: string;
  successMessage?: string;
  required?: boolean;
}

export interface LearningProgram {
  id: string;
  name: string;
  category: string;
  description: string;
  coverPhotoUrl?: string | null;
  status: LearningProgramStatus;
  scheduleType: LearningScheduleType;
  selfPacedLimitType: LearningSelfPacedLimitType;
  durationDays?: number | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  priceType: LearningPriceType;
  priceCents: number;
  paymentNotes?: string | null;
  visibility: LearningVisibility;
  participantLimit?: number | null;
  stepOrderMode: LearningStepOrderMode;
  futureStepsVisible: boolean;
  videoWatchRequired: boolean;
  videoRequiredPercent: number;
  autoplayNextVideo: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  sections: LearningSection[];
  steps: LearningStep[];
  enrolments: LearningEnrolment[];
  lessonLinks: LearningLessonLink[];
}

export interface LearningSection {
  id: string;
  programId: string;
  title: string;
  description: string;
  sortOrder: number;
}

export interface LearningStep {
  id: string;
  programId: string;
  sectionId?: string | null;
  stepType: LearningStepType;
  title: string;
  description: string;
  contentBlocks: LearningContentBlock[];
  videoUrl?: string | null;
  videoStoragePath?: string | null;
  videoDurationSeconds?: number | null;
  quizQuestions: LearningQuestion[];
  passingScorePercent?: number | null;
  sortOrder: number;
  isRequired: boolean;
}

export interface LearningEnrolment {
  id: string;
  programId: string;
  userId?: string | null;
  invitedEmail?: string | null;
  status: LearningEnrolmentStatus;
  paymentStatus: LearningPaymentStatus;
  approvedBy?: string | null;
  approvedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  dueAt?: string | null;
}

export interface LearningStepProgress {
  id: string;
  programId: string;
  stepId: string;
  userId: string;
  status: LearningProgressStatus;
  videoWatchPercent: number;
  quizScorePercent?: number | null;
  quizAnswers: Record<string, unknown>;
  completedAt?: string | null;
}

export interface LearningLessonLink {
  id: string;
  programId: string;
  trainingCourseId: string;
  trainingLessonId?: string | null;
  visibilityTiming: 'always' | 'at_or_before_lesson' | 'after_lesson';
}

export const createLearningId = (prefix = 'lc') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const mapProgram = (row: any): LearningProgram => ({
  id: row.id,
  name: row.name ?? '',
  category: row.category ?? 'General',
  description: row.description ?? '',
  coverPhotoUrl: row.cover_photo_url,
  status: row.status ?? 'draft',
  scheduleType: row.schedule_type ?? 'self_paced',
  selfPacedLimitType: row.self_paced_limit_type ?? 'none',
  durationDays: row.duration_days,
  scheduledStartAt: row.scheduled_start_at,
  scheduledEndAt: row.scheduled_end_at,
  priceType: row.price_type ?? 'free',
  priceCents: Number(row.price_cents ?? 0),
  paymentNotes: row.payment_notes,
  visibility: row.visibility ?? 'private',
  participantLimit: row.participant_limit,
  stepOrderMode: row.step_order_mode ?? 'in_order',
  futureStepsVisible: row.future_steps_visible ?? true,
  videoWatchRequired: row.video_watch_required ?? false,
  videoRequiredPercent: Number(row.video_required_percent ?? 90),
  autoplayNextVideo: row.autoplay_next_video ?? false,
  createdBy: row.created_by,
  updatedBy: row.updated_by,
  publishedAt: row.published_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sections: [],
  steps: [],
  enrolments: [],
  lessonLinks: [],
});

const mapSection = (row: any): LearningSection => ({
  id: row.id,
  programId: row.program_id,
  title: row.title ?? '',
  description: row.description ?? '',
  sortOrder: Number(row.sort_order ?? 0),
});

const mapStep = (row: any): LearningStep => ({
  id: row.id,
  programId: row.program_id,
  sectionId: row.section_id,
  stepType: row.step_type,
  title: row.title ?? '',
  description: row.description ?? '',
  contentBlocks: Array.isArray(row.content_blocks) ? row.content_blocks : [],
  videoUrl: row.video_url,
  videoStoragePath: row.video_storage_path,
  videoDurationSeconds: row.video_duration_seconds,
  quizQuestions: Array.isArray(row.quiz_questions) ? row.quiz_questions : [],
  passingScorePercent: row.passing_score_percent,
  sortOrder: Number(row.sort_order ?? 0),
  isRequired: row.is_required ?? true,
});

const mapEnrolment = (row: any): LearningEnrolment => ({
  id: row.id,
  programId: row.program_id,
  userId: row.user_id,
  invitedEmail: row.invited_email,
  status: row.status ?? 'active',
  paymentStatus: row.payment_status ?? 'not_required',
  approvedBy: row.approved_by,
  approvedAt: row.approved_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  dueAt: row.due_at,
});

const mapProgress = (row: any): LearningStepProgress => ({
  id: row.id,
  programId: row.program_id,
  stepId: row.step_id,
  userId: row.user_id,
  status: row.status ?? 'not_started',
  videoWatchPercent: Number(row.video_watch_percent ?? 0),
  quizScorePercent: row.quiz_score_percent,
  quizAnswers: row.quiz_answers ?? {},
  completedAt: row.completed_at,
});

const mapLessonLink = (row: any): LearningLessonLink => ({
  id: row.id,
  programId: row.program_id,
  trainingCourseId: row.training_course_id,
  trainingLessonId: row.training_lesson_id,
  visibilityTiming: row.visibility_timing ?? 'at_or_before_lesson',
});

const programToDb = (program: Partial<LearningProgram>, userId?: string) => ({
  name: program.name,
  category: program.category,
  description: program.description,
  cover_photo_url: program.coverPhotoUrl || null,
  status: program.status,
  schedule_type: program.scheduleType,
  self_paced_limit_type: program.selfPacedLimitType,
  duration_days: program.selfPacedLimitType === 'duration_days' ? program.durationDays || null : null,
  scheduled_start_at: program.scheduleType === 'scheduled' ? program.scheduledStartAt || null : null,
  scheduled_end_at: program.scheduleType === 'scheduled' || program.selfPacedLimitType === 'fixed_end' ? program.scheduledEndAt || null : null,
  price_type: program.priceType,
  price_cents: program.priceType === 'paid' ? Math.max(0, Number(program.priceCents || 0)) : 0,
  payment_notes: program.paymentNotes || null,
  visibility: program.visibility,
  participant_limit: program.participantLimit || null,
  step_order_mode: program.stepOrderMode,
  future_steps_visible: program.futureStepsVisible,
  video_watch_required: program.videoWatchRequired,
  video_required_percent: program.videoRequiredPercent,
  autoplay_next_video: program.autoplayNextVideo,
  updated_by: userId || null,
  published_at: program.status === 'published' ? new Date().toISOString() : null,
  updated_at: new Date().toISOString(),
});

export const createBlankLearningProgram = (): Partial<LearningProgram> => ({
  name: 'New Online Program',
  category: 'General',
  description: 'Describe who this program is for and what participants will be able to do after completing it.',
  coverPhotoUrl: '',
  status: 'draft',
  scheduleType: 'self_paced',
  selfPacedLimitType: 'none',
  durationDays: 30,
  scheduledStartAt: '',
  scheduledEndAt: '',
  priceType: 'free',
  priceCents: 0,
  paymentNotes: '',
  visibility: 'private',
  participantLimit: null,
  stepOrderMode: 'in_order',
  futureStepsVisible: true,
  videoWatchRequired: false,
  videoRequiredPercent: 90,
  autoplayNextVideo: false,
});

export const useLearningCentre = () => {
  const { user } = useAuth();
  const [programs, setPrograms] = useState<LearningProgram[]>([]);
  const [progress, setProgress] = useState<LearningStepProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const isStaff = hasAnyRole(user, ['admin', 'senior_instructor', 'instructor']);

  const fetchPrograms = useCallback(async () => {
    if (!user) {
      setPrograms([]);
      setProgress([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [programResult, sectionResult, stepResult, enrolmentResult, progressResult, linkResult] = await Promise.all([
        supabase.from('learning_programs').select('*').order('updated_at', { ascending: false }),
        supabase.from('learning_program_sections').select('*').order('sort_order', { ascending: true }),
        supabase.from('learning_program_steps').select('*').order('sort_order', { ascending: true }),
        supabase.from('learning_program_enrolments').select('*').order('created_at', { ascending: false }),
        supabase.from('learning_step_progress').select('*').eq('user_id', user.id),
        supabase.from('learning_program_lesson_links').select('*'),
      ]);

      const firstError = [programResult, sectionResult, stepResult, enrolmentResult, progressResult, linkResult].find(result => result.error)?.error;
      if (firstError) throw firstError;

      const mappedPrograms = (programResult.data || []).map(mapProgram);
      const sectionsByProgram = new Map<string, LearningSection[]>();
      const stepsByProgram = new Map<string, LearningStep[]>();
      const enrolmentsByProgram = new Map<string, LearningEnrolment[]>();
      const linksByProgram = new Map<string, LearningLessonLink[]>();

      (sectionResult.data || []).map(mapSection).forEach(section => {
        sectionsByProgram.set(section.programId, [...(sectionsByProgram.get(section.programId) || []), section]);
      });
      (stepResult.data || []).map(mapStep).forEach(step => {
        stepsByProgram.set(step.programId, [...(stepsByProgram.get(step.programId) || []), step]);
      });
      (enrolmentResult.data || []).map(mapEnrolment).forEach(enrolment => {
        enrolmentsByProgram.set(enrolment.programId, [...(enrolmentsByProgram.get(enrolment.programId) || []), enrolment]);
      });
      (linkResult.data || []).map(mapLessonLink).forEach(link => {
        linksByProgram.set(link.programId, [...(linksByProgram.get(link.programId) || []), link]);
      });

      setPrograms(mappedPrograms.map(program => ({
        ...program,
        sections: sectionsByProgram.get(program.id) || [],
        steps: stepsByProgram.get(program.id) || [],
        enrolments: enrolmentsByProgram.get(program.id) || [],
        lessonLinks: linksByProgram.get(program.id) || [],
      })));
      setProgress((progressResult.data || []).map(mapProgress));
    } catch (error) {
      console.error('Error loading Learning Centre:', error);
      toast.error('Failed to load Learning Centre');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchPrograms();
  }, [fetchPrograms]);

  const saveProgram = useCallback(async (program: Partial<LearningProgram>) => {
    if (!user) throw new Error('Not signed in');
    const payload = programToDb(program, user.id);
    if (!program.id) {
      const { data, error } = await supabase
        .from('learning_programs')
        .insert({ ...payload, created_by: user.id })
        .select()
        .single();
      if (error) throw error;
      await fetchPrograms();
      toast.success('Program created');
      return mapProgram(data);
    }

    const { error } = await supabase
      .from('learning_programs')
      .update(payload)
      .eq('id', program.id);
    if (error) throw error;
    await fetchPrograms();
    toast.success('Program saved');
    return programs.find(item => item.id === program.id) || null;
  }, [fetchPrograms, programs, user?.id]);

  const saveSections = useCallback(async (programId: string, sections: LearningSection[]) => {
    const current = programs.find(program => program.id === programId);
    const existingIds = new Set(current?.sections.map(section => section.id) || []);
    const nextIds = new Set(sections.filter(section => existingIds.has(section.id)).map(section => section.id));
    const removedIds = [...existingIds].filter(id => !nextIds.has(id));

    if (removedIds.length > 0) {
      const { error } = await supabase.from('learning_program_sections').delete().in('id', removedIds);
      if (error) throw error;
    }

    for (const [index, section] of sections.entries()) {
      const payload = {
        program_id: programId,
        title: section.title,
        description: section.description,
        sort_order: index,
        updated_at: new Date().toISOString(),
      };
      if (existingIds.has(section.id)) {
        const { error } = await supabase.from('learning_program_sections').update(payload).eq('id', section.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('learning_program_sections').insert(payload);
        if (error) throw error;
      }
    }
    await fetchPrograms();
  }, [fetchPrograms, programs]);

  const saveSteps = useCallback(async (programId: string, steps: LearningStep[]) => {
    const current = programs.find(program => program.id === programId);
    const existingIds = new Set(current?.steps.map(step => step.id) || []);
    const nextIds = new Set(steps.filter(step => existingIds.has(step.id)).map(step => step.id));
    const removedIds = [...existingIds].filter(id => !nextIds.has(id));

    if (removedIds.length > 0) {
      const { error } = await supabase.from('learning_program_steps').delete().in('id', removedIds);
      if (error) throw error;
    }

    for (const [index, step] of steps.entries()) {
      const payload = {
        program_id: programId,
        section_id: step.sectionId || null,
        step_type: step.stepType,
        title: step.title,
        description: step.description,
        content_blocks: step.contentBlocks || [],
        video_url: step.videoUrl || null,
        video_storage_path: step.videoStoragePath || null,
        video_duration_seconds: step.videoDurationSeconds || null,
        quiz_questions: step.quizQuestions || [],
        passing_score_percent: step.stepType === 'quiz' ? step.passingScorePercent || 80 : null,
        sort_order: index,
        is_required: step.isRequired,
        updated_at: new Date().toISOString(),
      };
      if (existingIds.has(step.id)) {
        const { error } = await supabase.from('learning_program_steps').update(payload).eq('id', step.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('learning_program_steps').insert(payload);
        if (error) throw error;
      }
    }
    await fetchPrograms();
  }, [fetchPrograms, programs]);

  const saveLessonLinks = useCallback(async (programId: string, links: LearningLessonLink[]) => {
    await supabase.from('learning_program_lesson_links').delete().eq('program_id', programId);
    if (links.length > 0) {
      const { error } = await supabase.from('learning_program_lesson_links').insert(links.map(link => ({
        program_id: programId,
        training_course_id: link.trainingCourseId,
        training_lesson_id: link.trainingLessonId || null,
        visibility_timing: link.visibilityTiming,
      })));
      if (error) throw error;
    }
    await fetchPrograms();
  }, [fetchPrograms]);

  const enrolInProgram = useCallback(async (program: LearningProgram) => {
    if (!user) throw new Error('Not signed in');
    const status: LearningEnrolmentStatus = program.visibility === 'private' ? 'pending_approval' : 'active';
    const dueAt = program.selfPacedLimitType === 'duration_days' && program.durationDays
      ? new Date(Date.now() + program.durationDays * 24 * 60 * 60 * 1000).toISOString()
      : program.scheduledEndAt || null;
    const { error } = await supabase.from('learning_program_enrolments').insert({
      program_id: program.id,
      user_id: user.id,
      status,
      payment_status: program.priceType === 'paid' ? 'unpaid' : 'not_required',
      started_at: status === 'active' ? new Date().toISOString() : null,
      due_at: dueAt,
    });
    if (error) throw error;
    await fetchPrograms();
    toast.success(status === 'active' ? 'Joined program' : 'Enrolment request sent');
  }, [fetchPrograms, user?.id]);

  const updateStepProgress = useCallback(async (
    programId: string,
    stepId: string,
    update: Partial<LearningStepProgress>
  ) => {
    if (!user) throw new Error('Not signed in');
    const payload = {
      program_id: programId,
      step_id: stepId,
      user_id: user.id,
      status: update.status ?? 'completed',
      video_watch_percent: update.videoWatchPercent ?? 100,
      quiz_score_percent: update.quizScorePercent ?? null,
      quiz_answers: update.quizAnswers ?? {},
      completed_at: update.status === 'completed' || update.status === undefined ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('learning_step_progress')
      .upsert(payload, { onConflict: 'step_id,user_id' });
    if (error) throw error;
    await fetchPrograms();
  }, [fetchPrograms, user?.id]);

  const approveEnrolment = useCallback(async (enrolmentId: string) => {
    if (!user) throw new Error('Not signed in');
    const { error } = await supabase
      .from('learning_program_enrolments')
      .update({
        status: 'active',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', enrolmentId);
    if (error) throw error;
    await fetchPrograms();
  }, [fetchPrograms, user?.id]);

  const programProgress = useMemo(() => {
    const byProgram = new Map<string, { completed: number; total: number; percent: number }>();
    programs.forEach(program => {
      const requiredSteps = program.steps.filter(step => step.isRequired);
      const completed = requiredSteps.filter(step =>
        progress.some(item => item.stepId === step.id && item.status === 'completed')
      ).length;
      byProgram.set(program.id, {
        completed,
        total: requiredSteps.length,
        percent: requiredSteps.length === 0 ? 0 : Math.round((completed / requiredSteps.length) * 100),
      });
    });
    return byProgram;
  }, [programs, progress]);

  return {
    programs,
    progress,
    programProgress,
    loading,
    isStaff,
    refetch: fetchPrograms,
    saveProgram,
    saveSections,
    saveSteps,
    saveLessonLinks,
    enrolInProgram,
    updateStepProgress,
    approveEnrolment,
  };
};
