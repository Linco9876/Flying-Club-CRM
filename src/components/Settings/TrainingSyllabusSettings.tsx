import React, { useEffect, useState } from 'react';
import { BookOpen, CheckCircle, GraduationCap, Loader2, Lock, MessageSquare } from 'lucide-react';
import { TrainingSyllabusSettingsData, useTrainingSettings } from '../../hooks/useTrainingSettings';

interface TrainingSyllabusSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

const toggleClass = 'h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50';
const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';

function SettingToggle({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4">
      <input
        id={id}
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className={`${toggleClass} mt-1`}
      />
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500 mt-1">{description}</span>
      </span>
    </label>
  );
}

export const TrainingSyllabusSettings: React.FC<TrainingSyllabusSettingsProps> = ({ canEdit, onFormChange }) => {
  const { settings, loading, updateSettings } = useTrainingSettings();
  const [formData, setFormData] = useState<TrainingSyllabusSettingsData>(settings);

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  useEffect(() => {
    (window as any).__trainingSettingsSave = async () => updateSettings(formData);
    (window as any).__trainingSettingsCancel = () => setFormData(settings);
    return () => {
      delete (window as any).__trainingSettingsSave;
      delete (window as any).__trainingSettingsCancel;
    };
  }, [formData, settings]);

  const setField = <K extends keyof TrainingSyllabusSettingsData>(field: K, value: TrainingSyllabusSettingsData[K]) => {
    setFormData(current => ({ ...current, [field]: value }));
    onFormChange();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <GraduationCap className="h-5 w-5 mr-2" />
          Training / Syllabus Settings
        </h2>
        <p className="text-gray-600">Control the defaults used by outstanding-record entry, student acknowledgement and course progress.</p>
      </div>

      <section className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <BookOpen className="h-5 w-5 mr-2 text-blue-600" />
          Lesson Record Defaults
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SettingToggle
            id="requireFlightComments"
            label="Require flight comments"
            description="Prevents submitting a record without an instructor narrative."
            checked={formData.requireFlightComments}
            disabled={!canEdit}
            onChange={value => setField('requireFlightComments', value)}
          />
          <SettingToggle
            id="defaultFormalBriefing"
            label="Start records with formal briefing selected"
            description="Useful when most lessons require a formal pre-flight briefing."
            checked={formData.defaultFormalBriefing}
            disabled={!canEdit}
            onChange={value => setField('defaultFormalBriefing', value)}
          />
          <SettingToggle
            id="requireBriefingCommentsWhenFormal"
            label="Require briefing comments when formal briefing is selected"
            description="Keeps the record meaningful whenever a briefing is marked complete."
            checked={formData.requireBriefingCommentsWhenFormal}
            disabled={!canEdit}
            onChange={value => setField('requireBriefingCommentsWhenFormal', value)}
          />
          <SettingToggle
            id="allowSubmittedRecordEditing"
            label="Allow staff to edit submitted records"
            description="When off, records can only be edited while still in draft."
            checked={formData.allowSubmittedRecordEditing}
            disabled={!canEdit}
            onChange={value => setField('allowSubmittedRecordEditing', value)}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <CheckCircle className="h-5 w-5 mr-2 text-blue-600" />
          Assessment Behaviour
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Default grading system for new criteria</label>
            <select
              disabled={!canEdit}
              value={formData.defaultGradingSystem}
              onChange={event => setField('defaultGradingSystem', event.target.value as any)}
              className={inputClass}
            >
              <option value="NC/S/C/-">NC / S / C / -</option>
              <option value="Pass or Fail">Pass or Fail</option>
              <option value="Out of 100">Out of 100</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Next lesson rule</label>
            <select
              disabled={!canEdit}
              value={formData.nextLessonRule}
              onChange={event => setField('nextLessonRule', event.target.value as any)}
              className={inputClass}
            >
              <option value="advance_on_pass">Advance only when lesson pass mark is met</option>
              <option value="always_advance">Always show the following lesson</option>
              <option value="manual">Leave next lesson blank for instructor choice</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Course completion rule</label>
            <select
              disabled={!canEdit}
              value={formData.courseCompletionRule}
              onChange={event => setField('courseCompletionRule', event.target.value as any)}
              className={inputClass}
            >
              <option value="all_required_criteria">All required criteria at final pass mark</option>
              <option value="all_lessons_attempted">All lessons attempted</option>
              <option value="criteria_or_lessons">Criteria complete or all lessons attempted</option>
            </select>
          </div>
          <SettingToggle
            id="prefillHighestGrades"
            label="Pre-fill each criterion with the student's best mark to date"
            description="Keeps instructors from accidentally downgrading historical progress unless they intentionally change the grade."
            checked={formData.prefillHighestGrades}
            disabled={!canEdit}
            onChange={value => setField('prefillHighestGrades', value)}
          />
          <SettingToggle
            id="showPassMarkGuidance"
            label="Show pass mark beside each criterion"
            description="Displays the required mark for the selected lesson while filling a record."
            checked={formData.showPassMarkGuidance}
            disabled={!canEdit}
            onChange={value => setField('showPassMarkGuidance', value)}
          />
          <SettingToggle
            id="showBestGradeGuidance"
            label="Show best grade to date beside each criterion"
            description="Helps instructors see current progress before selecting the new assessment."
            checked={formData.showBestGradeGuidance}
            disabled={!canEdit}
            onChange={value => setField('showBestGradeGuidance', value)}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <Lock className="h-5 w-5 mr-2 text-blue-600" />
          Sign-off and Student Portal
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SettingToggle
            id="requireStudentAcknowledgement"
            label="Require student acknowledgement"
            description="Students must acknowledge submitted records before they become fully complete."
            checked={formData.requireStudentAcknowledgement}
            disabled={!canEdit}
            onChange={value => setField('requireStudentAcknowledgement', value)}
          />
          <SettingToggle
            id="lockRecordAfterStudentAck"
            label="Lock records after student acknowledgement"
            description="Moves acknowledged records to locked status so they stop appearing as open sign-off work."
            checked={formData.lockRecordAfterStudentAck}
            disabled={!canEdit || !formData.requireStudentAcknowledgement}
            onChange={value => setField('lockRecordAfterStudentAck', value)}
          />
          <SettingToggle
            id="autoNotifyStudentOnSubmit"
            label="Notify student when a record is submitted"
            description="Creates the existing student notification asking them to review and sign off."
            checked={formData.autoNotifyStudentOnSubmit}
            disabled={!canEdit || !formData.requireStudentAcknowledgement}
            onChange={value => setField('autoNotifyStudentOnSubmit', value)}
          />
          <SettingToggle
            id="autoMarkFlightLogRecorded"
            label="Mark flight log as recorded after training record submission"
            description="Removes completed entries from Outstanding Records once the training record is saved."
            checked={formData.autoMarkFlightLogRecorded}
            disabled={!canEdit}
            onChange={value => setField('autoMarkFlightLogRecorded', value)}
          />
        </div>
      </section>

      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex gap-3">
          <MessageSquare className="h-5 w-5 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-blue-900">How this maps to training records</h3>
            <p className="text-sm text-blue-800 mt-1">
              Course content, lesson order and pass marks remain in Training Records. These settings control how instructors fill a record, how progression is suggested, and when students are asked to acknowledge the result.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
