import React, { useEffect, useState } from 'react';
import { Award, BookOpen, CheckCircle, GraduationCap, Loader2, Lock, MessageSquare, Plus, X } from 'lucide-react';
import { TrainingSyllabusSettingsData, useTrainingSettings } from '../../hooks/useTrainingSettings';
import { uniqueEndorsementTypes } from '../../utils/pilotStatus';

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
  const [endorsementInput, setEndorsementInput] = useState('');

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

  const setEndorsementState = (endorsementTypes: string[], pilotStatusEndorsementTypes: string[]) => {
    setFormData(current => ({
      ...current,
      endorsementTypes: uniqueEndorsementTypes(endorsementTypes),
      pilotStatusEndorsementTypes: uniqueEndorsementTypes(pilotStatusEndorsementTypes)
        .filter(type => endorsementTypes.some(item => item.trim().toLowerCase() === type.trim().toLowerCase())),
    }));
    onFormChange();
  };

  const addEndorsement = () => {
    const next = uniqueEndorsementTypes([...formData.endorsementTypes, endorsementInput]);
    if (next.length === formData.endorsementTypes.length) return;
    setEndorsementState(next, formData.pilotStatusEndorsementTypes);
    setEndorsementInput('');
  };

  const removeEndorsement = (type: string) => {
    const keep = (item: string) => item.trim().toLowerCase() !== type.trim().toLowerCase();
    setEndorsementState(
      formData.endorsementTypes.filter(keep),
      formData.pilotStatusEndorsementTypes.filter(keep)
    );
  };

  const togglePilotStatusEndorsement = (type: string, checked: boolean) => {
    const nextPilotTypes = checked
      ? uniqueEndorsementTypes([...formData.pilotStatusEndorsementTypes, type])
      : formData.pilotStatusEndorsementTypes.filter(item => item.trim().toLowerCase() !== type.trim().toLowerCase());
    setEndorsementState(formData.endorsementTypes, nextPilotTypes);
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
            label="Force student acknowledgement for all courses"
            description="Overrides course settings so every submitted lesson record must be acknowledged by the student."
            checked={formData.forceStudentAcknowledgementForAllCourses}
            disabled={!canEdit}
            onChange={value => {
              setFormData(current => ({
                ...current,
                forceStudentAcknowledgementForAllCourses: value,
                requireStudentAcknowledgement: value,
              }));
              onFormChange();
            }}
          />
          <SettingToggle
            id="lockRecordAfterStudentAck"
            label="Lock records after student acknowledgement"
            description="Moves acknowledged records to locked status so they stop appearing as open sign-off work."
            checked={formData.lockRecordAfterStudentAck}
            disabled={!canEdit}
            onChange={value => setField('lockRecordAfterStudentAck', value)}
          />
          <SettingToggle
            id="autoNotifyStudentOnSubmit"
            label="Notify student when a record is submitted"
            description="Creates the existing student notification asking them to review and sign off."
            checked={formData.autoNotifyStudentOnSubmit}
            disabled={!canEdit}
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

      <section className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <Award className="h-5 w-5 mr-2 text-blue-600" />
          Endorsements
        </h3>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">
            This is the organisation endorsement list used by courses and member profiles. Tick Pilot status for endorsements that should automatically turn a student into a Pilot when they hold an active, unexpired copy.
          </p>

          <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
            <div className="grid grid-cols-[minmax(0,1fr)_120px_44px] gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <span>Endorsement</span>
              <span className="text-center">Pilot status</span>
              <span />
            </div>
            {formData.endorsementTypes.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {formData.endorsementTypes.map(type => {
                  const grantsPilot = formData.pilotStatusEndorsementTypes.some(item => item.trim().toLowerCase() === type.trim().toLowerCase());
                  return (
                    <div key={type} className="grid grid-cols-[minmax(0,1fr)_120px_44px] items-center gap-3 px-3 py-3">
                      <div>
                        <p className="truncate text-sm font-medium text-gray-900">{type}</p>
                        {grantsPilot && (
                          <p className="text-xs text-orange-700">Active endorsement grants Pilot status</p>
                        )}
                      </div>
                      <label className="flex justify-center">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={grantsPilot}
                          onChange={event => togglePilotStatusEndorsement(type, event.target.checked)}
                          className={toggleClass}
                          aria-label={`${type} grants Pilot status`}
                        />
                      </label>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => removeEndorsement(type)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Remove ${type}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-6 text-center text-sm text-gray-500">No endorsements have been added yet.</div>
            )}
          </div>

          {canEdit && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={endorsementInput}
                onChange={event => setEndorsementInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addEndorsement();
                  }
                }}
                placeholder="Endorsement name, e.g. Passenger Carrying"
                className={inputClass}
              />
              <button
                type="button"
                onClick={addEndorsement}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Add endorsement
              </button>
            </div>
          )}

          {formData.pilotStatusEndorsementTypes.length > 0 && (
            <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-800">Currently grants Pilot status</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {formData.pilotStatusEndorsementTypes.map(type => (
                  <span key={type} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-orange-900 ring-1 ring-orange-200">
                    {type}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex gap-3">
          <MessageSquare className="h-5 w-5 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-blue-900">How this maps to training records</h3>
            <p className="text-sm text-blue-800 mt-1">
              Course content, lesson order, course-level acknowledgement and pass marks remain in Training Records. These settings control how instructors fill a record, how progression is suggested, and whether course acknowledgement rules are overridden for every course.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
