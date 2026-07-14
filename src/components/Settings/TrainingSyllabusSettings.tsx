import React, { useEffect, useState } from 'react';
import { Award, BookOpen, Check, CheckCircle, GraduationCap, Loader2, Lock, MessageSquare, Pencil, Plus, X } from 'lucide-react';
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
  const { settings, loading, updateSettings, renameEndorsementReferences, renameLicenceReferences } = useTrainingSettings();
  const [formData, setFormData] = useState<TrainingSyllabusSettingsData>(settings);
  const [endorsementInput, setEndorsementInput] = useState('');
  const [editingEndorsement, setEditingEndorsement] = useState<string | null>(null);
  const [editingEndorsementName, setEditingEndorsementName] = useState('');
  const [endorsementRenames, setEndorsementRenames] = useState<Record<string, string>>({});
  const [licenceInput, setLicenceInput] = useState('');
  const [editingLicence, setEditingLicence] = useState<string | null>(null);
  const [editingLicenceName, setEditingLicenceName] = useState('');
  const [licenceRenames, setLicenceRenames] = useState<Record<string, string>>({});

  useEffect(() => {
    setFormData(settings);
    setEditingEndorsement(null);
    setEditingEndorsementName('');
    setEndorsementRenames({});
    setEditingLicence(null);
    setEditingLicenceName('');
    setLicenceRenames({});
  }, [settings]);

  useEffect(() => {
    (window as any).__trainingSettingsSave = async () => {
      await renameEndorsementReferences(
        Object.entries(endorsementRenames).map(([from, to]) => ({ from, to }))
      );
      await renameLicenceReferences(
        Object.entries(licenceRenames).map(([from, to]) => ({ from, to }))
      );
      await updateSettings(formData);
      setEndorsementRenames({});
      setLicenceRenames({});
    };
    (window as any).__trainingSettingsCancel = () => {
      setFormData(settings);
      setEditingEndorsement(null);
      setEditingEndorsementName('');
      setEndorsementRenames({});
      setEditingLicence(null);
      setEditingLicenceName('');
      setLicenceRenames({});
    };
    return () => {
      delete (window as any).__trainingSettingsSave;
      delete (window as any).__trainingSettingsCancel;
    };
  }, [endorsementRenames, formData, licenceRenames, renameEndorsementReferences, renameLicenceReferences, settings, updateSettings]);

  const setField = <K extends keyof TrainingSyllabusSettingsData>(field: K, value: TrainingSyllabusSettingsData[K]) => {
    setFormData(current => ({ ...current, [field]: value }));
    onFormChange();
  };

  const setEndorsementState = (endorsementTypes: string[]) => {
    setFormData(current => ({
      ...current,
      endorsementTypes: uniqueEndorsementTypes(endorsementTypes),
    }));
    onFormChange();
  };

  const addEndorsement = () => {
    const next = uniqueEndorsementTypes([...formData.endorsementTypes, endorsementInput]);
    if (next.length === formData.endorsementTypes.length) return;
    setEndorsementState(next);
    setEndorsementInput('');
  };

  const removeEndorsement = (type: string) => {
    const keep = (item: string) => item.trim().toLowerCase() !== type.trim().toLowerCase();
    setEndorsementState(formData.endorsementTypes.filter(keep));
  };

  const startEditingEndorsement = (type: string) => {
    setEditingEndorsement(type);
    setEditingEndorsementName(type);
  };

  const cancelEditingEndorsement = () => {
    setEditingEndorsement(null);
    setEditingEndorsementName('');
  };

  const saveEndorsementRename = (oldType: string) => {
    const nextName = editingEndorsementName.trim();
    if (!nextName) return;
    const oldKey = oldType.trim().toLowerCase();
    const nextKey = nextName.trim().toLowerCase();
    if (oldKey === nextKey) {
      cancelEditingEndorsement();
      return;
    }
    const duplicate = formData.endorsementTypes.some(type =>
      type.trim().toLowerCase() === nextKey && type.trim().toLowerCase() !== oldKey
    );
    if (duplicate) return;

    setEndorsementState(formData.endorsementTypes.map(type => type.trim().toLowerCase() === oldKey ? nextName : type));
    setEndorsementRenames(current => ({ ...current, [oldType]: nextName }));
    cancelEditingEndorsement();
  };

  const addLicence = () => {
    const next = uniqueEndorsementTypes([...formData.licenceTypes, licenceInput]);
    if (next.length === formData.licenceTypes.length) return;
    setField('licenceTypes', next);
    setLicenceInput('');
  };

  const removeLicence = (type: string) => {
    setField('licenceTypes', formData.licenceTypes.filter(item => item.trim().toLowerCase() !== type.trim().toLowerCase()));
  };

  const saveLicenceRename = (oldType: string) => {
    const nextName = editingLicenceName.trim();
    if (!nextName) return;
    const oldKey = oldType.trim().toLowerCase();
    const nextKey = nextName.toLowerCase();
    if (formData.licenceTypes.some(type => type.trim().toLowerCase() === nextKey && type.trim().toLowerCase() !== oldKey)) return;
    setField('licenceTypes', formData.licenceTypes.map(type => type.trim().toLowerCase() === oldKey ? nextName : type));
    setLicenceRenames(current => ({ ...current, [oldType]: nextName }));
    setEditingLicence(null);
    setEditingLicenceName('');
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
            Endorsements are additional privileges or aircraft qualifications. They never change a member into a pilot account.
          </p>

          <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
            <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_96px] gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <span>Endorsement</span>
              <span className="text-right">Actions</span>
            </div>
            {formData.endorsementTypes.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {formData.endorsementTypes.map(type => {
                  const isEditing = editingEndorsement === type;
                  const editDuplicate = isEditing && formData.endorsementTypes.some(item =>
                    item.trim().toLowerCase() === editingEndorsementName.trim().toLowerCase() &&
                    item.trim().toLowerCase() !== type.trim().toLowerCase()
                  );
                  return (
                    <div key={type} className="grid grid-cols-1 gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_96px] sm:items-center">
                      <div className="min-w-0">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={editingEndorsementName}
                              onChange={event => setEditingEndorsementName(event.target.value)}
                              onKeyDown={event => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  saveEndorsementRename(type);
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelEditingEndorsement();
                                }
                              }}
                              className={inputClass}
                              autoFocus
                            />
                            {editDuplicate && (
                              <p className="text-xs text-red-600">An endorsement with this name already exists.</p>
                            )}
                          </div>
                        ) : (
                          <>
                            <p className="truncate text-sm font-medium text-gray-900">{type}</p>
                            {endorsementRenames[type] && (
                              <p className="text-xs text-blue-700">Rename will update member, course, and aircraft records on save.</p>
                            )}
                          </>
                        )}
                      </div>
                      {canEdit ? (
                        <div className="flex justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveEndorsementRename(type)}
                                disabled={!editingEndorsementName.trim() || editDuplicate}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label={`Save ${type} rename`}
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditingEndorsement}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                                aria-label={`Cancel ${type} rename`}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startEditingEndorsement(type)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-blue-50 hover:text-blue-700"
                                aria-label={`Rename ${type}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeEndorsement(type)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                                aria-label={`Remove ${type}`}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
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

        </div>
      </section>

      <section className="space-y-4">
        <h3 className="flex items-center text-lg font-medium text-gray-900">
          <GraduationCap className="mr-2 h-5 w-5 text-emerald-600" />
          Pilot Licences
        </h3>
        <div className="rounded-lg border border-emerald-200 bg-white p-4">
          <p className="text-sm text-gray-600">
            Holding any active, unexpired licence makes a member a Pilot. Staff must verify and add licences to a member file; endorsements do not grant Pilot status.
          </p>
          <div className="mt-4 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
            {formData.licenceTypes.map(type => {
              const isEditing = editingLicence === type;
              return (
                <div key={type} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  {isEditing ? (
                    <input
                      value={editingLicenceName}
                      onChange={event => setEditingLicenceName(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') { event.preventDefault(); saveLicenceRename(type); }
                        if (event.key === 'Escape') { setEditingLicence(null); setEditingLicenceName(''); }
                      }}
                      className={inputClass}
                      autoFocus
                    />
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-gray-900">{type}</p>
                      {licenceRenames[type] && <p className="text-xs text-blue-700">Rename will update member, course, and aircraft records on save.</p>}
                    </div>
                  )}
                  {canEdit && (
                    <div className="flex justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button type="button" onClick={() => saveLicenceRename(type)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-50" aria-label={`Save ${type} rename`}><Check className="h-4 w-4" /></button>
                          <button type="button" onClick={() => { setEditingLicence(null); setEditingLicenceName(''); }} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100" aria-label={`Cancel ${type} rename`}><X className="h-4 w-4" /></button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => { setEditingLicence(type); setEditingLicenceName(type); }} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-blue-50 hover:text-blue-700" aria-label={`Rename ${type}`}><Pencil className="h-4 w-4" /></button>
                          <button type="button" onClick={() => removeLicence(type)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${type}`}><X className="h-4 w-4" /></button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {canEdit && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input value={licenceInput} onChange={event => setLicenceInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addLicence(); } }} placeholder="Licence name, e.g. CASA Private Pilot Licence (PPL)" className={inputClass} />
              <button type="button" onClick={addLicence} className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><Plus className="h-4 w-4" />Add licence</button>
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
