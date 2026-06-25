import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { LessonGradingSystem } from '../types';
import toast from 'react-hot-toast';
import { DEFAULT_ENDORSEMENT_TYPES, DEFAULT_PILOT_STATUS_ENDORSEMENTS, normaliseEndorsementType, reconcileAllPilotStatuses, uniqueEndorsementTypes } from '../utils/pilotStatus';

export type NextLessonRule = 'advance_on_pass' | 'always_advance' | 'manual';
export type CourseCompletionRule = 'all_required_criteria' | 'all_lessons_attempted' | 'criteria_or_lessons';

export interface TrainingSyllabusSettingsData {
  id?: string;
  defaultGradingSystem: LessonGradingSystem;
  forceStudentAcknowledgementForAllCourses: boolean;
  requireStudentAcknowledgement: boolean;
  lockRecordAfterStudentAck: boolean;
  allowSubmittedRecordEditing: boolean;
  requireFlightComments: boolean;
  requireBriefingCommentsWhenFormal: boolean;
  defaultFormalBriefing: boolean;
  prefillHighestGrades: boolean;
  nextLessonRule: NextLessonRule;
  autoNotifyStudentOnSubmit: boolean;
  autoMarkFlightLogRecorded: boolean;
  courseCompletionRule: CourseCompletionRule;
  showPassMarkGuidance: boolean;
  showBestGradeGuidance: boolean;
  endorsementTypes: string[];
  pilotStatusEndorsementTypes: string[];
}

export const DEFAULT_TRAINING_SETTINGS: TrainingSyllabusSettingsData = {
  defaultGradingSystem: 'NC/S/C/-',
  forceStudentAcknowledgementForAllCourses: false,
  requireStudentAcknowledgement: true,
  lockRecordAfterStudentAck: true,
  allowSubmittedRecordEditing: false,
  requireFlightComments: true,
  requireBriefingCommentsWhenFormal: true,
  defaultFormalBriefing: false,
  prefillHighestGrades: true,
  nextLessonRule: 'advance_on_pass',
  autoNotifyStudentOnSubmit: true,
  autoMarkFlightLogRecorded: true,
  courseCompletionRule: 'all_required_criteria',
  showPassMarkGuidance: true,
  showBestGradeGuidance: true,
  endorsementTypes: DEFAULT_ENDORSEMENT_TYPES,
  pilotStatusEndorsementTypes: DEFAULT_PILOT_STATUS_ENDORSEMENTS,
};

const TRAINING_SETTINGS_UPDATED_EVENT = 'training-syllabus-settings-updated';

const mapRow = (row: any): TrainingSyllabusSettingsData => ({
  ...DEFAULT_TRAINING_SETTINGS,
  id: row.id,
  defaultGradingSystem: row.default_grading_system ?? DEFAULT_TRAINING_SETTINGS.defaultGradingSystem,
  forceStudentAcknowledgementForAllCourses: row.force_student_acknowledgement_for_all_courses
    ?? row.require_student_acknowledgement
    ?? DEFAULT_TRAINING_SETTINGS.forceStudentAcknowledgementForAllCourses,
  requireStudentAcknowledgement: row.require_student_acknowledgement ?? DEFAULT_TRAINING_SETTINGS.requireStudentAcknowledgement,
  lockRecordAfterStudentAck: row.lock_record_after_student_ack ?? DEFAULT_TRAINING_SETTINGS.lockRecordAfterStudentAck,
  allowSubmittedRecordEditing: row.allow_submitted_record_editing ?? DEFAULT_TRAINING_SETTINGS.allowSubmittedRecordEditing,
  requireFlightComments: row.require_flight_comments ?? DEFAULT_TRAINING_SETTINGS.requireFlightComments,
  requireBriefingCommentsWhenFormal: row.require_briefing_comments_when_formal ?? DEFAULT_TRAINING_SETTINGS.requireBriefingCommentsWhenFormal,
  defaultFormalBriefing: row.default_formal_briefing ?? DEFAULT_TRAINING_SETTINGS.defaultFormalBriefing,
  prefillHighestGrades: row.prefill_highest_grades ?? DEFAULT_TRAINING_SETTINGS.prefillHighestGrades,
  nextLessonRule: row.next_lesson_rule ?? DEFAULT_TRAINING_SETTINGS.nextLessonRule,
  autoNotifyStudentOnSubmit: row.auto_notify_student_on_submit ?? DEFAULT_TRAINING_SETTINGS.autoNotifyStudentOnSubmit,
  autoMarkFlightLogRecorded: row.auto_mark_flight_log_recorded ?? DEFAULT_TRAINING_SETTINGS.autoMarkFlightLogRecorded,
  courseCompletionRule: row.course_completion_rule ?? DEFAULT_TRAINING_SETTINGS.courseCompletionRule,
  showPassMarkGuidance: row.show_pass_mark_guidance ?? DEFAULT_TRAINING_SETTINGS.showPassMarkGuidance,
  showBestGradeGuidance: row.show_best_grade_guidance ?? DEFAULT_TRAINING_SETTINGS.showBestGradeGuidance,
  endorsementTypes: uniqueEndorsementTypes([
    ...(row.endorsement_types || DEFAULT_TRAINING_SETTINGS.endorsementTypes),
    ...(row.pilot_status_endorsement_types || []),
  ]),
  pilotStatusEndorsementTypes: uniqueEndorsementTypes(row.pilot_status_endorsement_types || DEFAULT_TRAINING_SETTINGS.pilotStatusEndorsementTypes),
});

const toRow = (settings: TrainingSyllabusSettingsData) => ({
  endorsement_types: uniqueEndorsementTypes([
    ...settings.endorsementTypes,
    ...settings.pilotStatusEndorsementTypes,
  ]),
  default_grading_system: settings.defaultGradingSystem,
  force_student_acknowledgement_for_all_courses: settings.forceStudentAcknowledgementForAllCourses,
  require_student_acknowledgement: settings.requireStudentAcknowledgement,
  lock_record_after_student_ack: settings.lockRecordAfterStudentAck,
  allow_submitted_record_editing: settings.allowSubmittedRecordEditing,
  require_flight_comments: settings.requireFlightComments,
  require_briefing_comments_when_formal: settings.requireBriefingCommentsWhenFormal,
  default_formal_briefing: settings.defaultFormalBriefing,
  prefill_highest_grades: settings.prefillHighestGrades,
  next_lesson_rule: settings.nextLessonRule,
  auto_notify_student_on_submit: settings.autoNotifyStudentOnSubmit,
  auto_mark_flight_log_recorded: settings.autoMarkFlightLogRecorded,
  course_completion_rule: settings.courseCompletionRule,
  show_pass_mark_guidance: settings.showPassMarkGuidance,
  show_best_grade_guidance: settings.showBestGradeGuidance,
  pilot_status_endorsement_types: uniqueEndorsementTypes(settings.pilotStatusEndorsementTypes),
});

export function useTrainingSettings() {
  const [settings, setSettings] = useState<TrainingSyllabusSettingsData>(DEFAULT_TRAINING_SETTINGS);
  const [loading, setLoading] = useState(true);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('training_syllabus_settings')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      setSettings(data ? mapRow(data) : DEFAULT_TRAINING_SETTINGS);
    } catch (error) {
      console.error('Error loading training settings:', error);
      toast.error('Failed to load training settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    const handleUpdated = () => fetchSettings();
    window.addEventListener(TRAINING_SETTINGS_UPDATED_EVENT, handleUpdated);
    return () => window.removeEventListener(TRAINING_SETTINGS_UPDATED_EVENT, handleUpdated);
  }, []);

  const updateSettings = async (updates: Partial<TrainingSyllabusSettingsData>) => {
    const next = { ...settings, ...updates };
    const shouldReconcilePilotStatus = updates.pilotStatusEndorsementTypes !== undefined;
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      ...toRow(next),
      updated_at: new Date().toISOString(),
      updated_by: userData.user?.id,
    };

    const result = settings.id
      ? await supabase.from('training_syllabus_settings').update(payload).eq('id', settings.id)
      : await supabase.from('training_syllabus_settings').insert(payload);

    if (result.error) {
      toast.error('Failed to save training settings');
      throw result.error;
    }

    if (shouldReconcilePilotStatus) {
      try {
        const changedCount = await reconcileAllPilotStatuses(uniqueEndorsementTypes(next.pilotStatusEndorsementTypes));
        if (changedCount > 0) {
          toast.success(`${changedCount} member${changedCount === 1 ? '' : 's'} updated from Pilot status endorsement rules`);
        }
      } catch (error) {
        console.error('Failed to reconcile pilot statuses from endorsement settings:', error);
        toast.error('Settings saved, but existing Pilot statuses could not be updated');
      }
    }

    await fetchSettings();
    window.dispatchEvent(new Event(TRAINING_SETTINGS_UPDATED_EVENT));
    toast.success('Training settings saved');
  };

  const renameEndorsementReferences = async (renames: Array<{ from: string; to: string }>) => {
    const cleanRenames = renames
      .map(rename => ({ from: rename.from.trim(), to: rename.to.trim() }))
      .filter(rename => rename.from && rename.to && normaliseEndorsementType(rename.from) !== normaliseEndorsementType(rename.to));

    for (const rename of cleanRenames) {
      const [
        endorsementsResult,
        coursesResult,
        aircraftResult,
      ] = await Promise.all([
        supabase.from('endorsements').update({ type: rename.to }).eq('type', rename.from),
        supabase.from('training_courses').update({ completion_endorsement_type: rename.to }).eq('completion_endorsement_type', rename.from),
        supabase.rpc('rename_aircraft_endorsement_requirement', { old_value: rename.from, new_value: rename.to }),
      ]);

      if (endorsementsResult.error) throw endorsementsResult.error;
      if (coursesResult.error) throw coursesResult.error;
      if (aircraftResult.error) throw aircraftResult.error;
    }
  };

  return { settings, loading, updateSettings, renameEndorsementReferences, refetch: fetchSettings };
}
