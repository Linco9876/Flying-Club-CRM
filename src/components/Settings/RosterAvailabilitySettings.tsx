import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Plus, Trash2, AlertCircle, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useUsers } from '../../hooks/useUsers';
import { useInstructorAvailability, WeeklySchedule } from '../../hooks/useInstructorAvailability';
import { TimeSelect } from '../common/TimeSelect';

interface RosterAvailabilitySettingsProps {
  canEdit: boolean;
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' }
];

type DayDraft = Omit<WeeklySchedule, 'id' | 'userId'>;
type AbsenceDraft = {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  reason: string;
};

const EMPTY_ABSENCE_DRAFT: AbsenceDraft = {
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  reason: '',
};

const formatRosterDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString();

const formatRosterTime = (time: string) => time.slice(0, 5);

const getTodayDate = () => {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
};

export const RosterAvailabilitySettings: React.FC<RosterAvailabilitySettingsProps> = ({ canEdit }) => {
  const { user } = useAuth();
  const { getInstructors } = useUsers();
  const userRoles = user?.roles && user.roles.length > 0 ? user.roles : user?.role ? [user.role] : [];
  const isAdmin = userRoles.includes('admin');
  const isInstructorUser = userRoles.includes('instructor') || userRoles.includes('senior_instructor');
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>('');
  const [showAbsenceForm, setShowAbsenceForm] = useState(false);
  const [absenceDraft, setAbsenceDraft] = useState<AbsenceDraft>(EMPTY_ABSENCE_DRAFT);
  const [showScheduleChangeForm, setShowScheduleChangeForm] = useState(false);
  const [newScheduleEffectiveDate, setNewScheduleEffectiveDate] = useState('');
  const [newSchedule, setNewSchedule] = useState<{[key: number]: Omit<WeeklySchedule, 'id' | 'userId'>}>({});

  // Local draft state for weekly schedule — keyed by day of week
  const [drafts, setDrafts] = useState<{[day: number]: DayDraft}>({});
  const [savingDay, setSavingDay] = useState<number | null>(null);

  const {
    weeklySchedules,
    absences,
    scheduleChanges,
    loading,
    upsertWeeklySchedule,
    addAbsence,
    deleteAbsence,
    addScheduleChange,
    deleteScheduleChange
  } = useInstructorAvailability(selectedInstructorId);

  const instructors = getInstructors();

  useEffect(() => {
    if (isInstructorUser && !isAdmin && user?.id) {
      setSelectedInstructorId(user.id);
    } else if (instructors.length > 0 && !selectedInstructorId) {
      setSelectedInstructorId(instructors[0].id);
    }
  }, [isAdmin, isInstructorUser, user?.id, instructors, selectedInstructorId]);

  // Reset drafts when the loaded schedules change (e.g. instructor switch or after save)
  useEffect(() => {
    setDrafts({});
  }, [weeklySchedules, selectedInstructorId]);

  useEffect(() => {
    setShowAbsenceForm(false);
    setAbsenceDraft(EMPTY_ABSENCE_DRAFT);
  }, [selectedInstructorId]);

  const getScheduleForDay = (dayOfWeek: number) => {
    return weeklySchedules.find(s => s.dayOfWeek === dayOfWeek);
  };

  // Returns the draft for a day if one exists, otherwise the saved schedule values
  const getDraftForDay = (dayOfWeek: number): DayDraft => {
    if (drafts[dayOfWeek]) return drafts[dayOfWeek];
    const saved = getScheduleForDay(dayOfWeek);
    return {
      dayOfWeek,
      startTime: saved?.startTime || '09:00',
      endTime: saved?.endTime || '17:00',
      afternoonStartTime: saved?.afternoonStartTime,
      afternoonEndTime: saved?.afternoonEndTime,
      isAvailable: saved?.isAvailable ?? false,
    };
  };

  const isDirty = (dayOfWeek: number): boolean => {
    return !!drafts[dayOfWeek];
  };

  const handleDraftChange = (dayOfWeek: number, field: string, value: any) => {
    if (!canManageSelectedInstructor || !selectedInstructorId) return;
    const current = getDraftForDay(dayOfWeek);
    setDrafts(prev => ({
      ...prev,
      [dayOfWeek]: { ...current, [field]: value }
    }));
  };

  const handleSaveDay = async (dayOfWeek: number) => {
    if (!canManageSelectedInstructor || !selectedInstructorId) return;
    const draft = getDraftForDay(dayOfWeek);
    setSavingDay(dayOfWeek);
    try {
      await upsertWeeklySchedule({ userId: selectedInstructorId, ...draft });
      // Clear draft for this day — the effect on weeklySchedules will reset it
      setDrafts(prev => {
        const next = { ...prev };
        delete next[dayOfWeek];
        return next;
      });
    } finally {
      setSavingDay(null);
    }
  };

  const handleAddAbsence = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canManageSelectedInstructor || !selectedInstructorId) return;

    if (absenceDraft.startDate > absenceDraft.endDate) {
      toast.error('End date must be on or after the start date');
      return;
    }

    if (Boolean(absenceDraft.startTime) !== Boolean(absenceDraft.endTime)) {
      toast.error('Select both a start and end time, or leave both blank for a full-day absence');
      return;
    }

    if (absenceDraft.startTime && absenceDraft.endTime && absenceDraft.startTime >= absenceDraft.endTime) {
      toast.error('End time must be later than the start time');
      return;
    }

    await addAbsence({
      userId: selectedInstructorId,
      startDate: absenceDraft.startDate,
      endDate: absenceDraft.endDate,
      startTime: absenceDraft.startTime || undefined,
      endTime: absenceDraft.endTime || undefined,
      reason: absenceDraft.reason.trim() || undefined
    });

    setShowAbsenceForm(false);
    setAbsenceDraft(EMPTY_ABSENCE_DRAFT);
  };

  const handleStartNewSchedule = () => {
    const currentSchedule: {[key: number]: Omit<WeeklySchedule, 'id' | 'userId'>} = {};
    DAYS_OF_WEEK.forEach(day => {
      const existing = getScheduleForDay(day.value);
      currentSchedule[day.value] = {
        dayOfWeek: day.value,
        startTime: existing?.startTime || '09:00',
        endTime: existing?.endTime || '17:00',
        afternoonStartTime: existing?.afternoonStartTime,
        afternoonEndTime: existing?.afternoonEndTime,
        isAvailable: existing?.isAvailable ?? true
      };
    });
    setNewSchedule(currentSchedule);
    setNewScheduleEffectiveDate('');
    setShowScheduleChangeForm(true);
  };

  const handleNewScheduleChange = (dayOfWeek: number, field: string, value: any) => {
    setNewSchedule(prev => ({
      ...prev,
      [dayOfWeek]: {
        ...prev[dayOfWeek],
        [field]: value
      }
    }));
  };

  const handleSaveNewSchedule = async () => {
    if (!canManageSelectedInstructor || !selectedInstructorId || !newScheduleEffectiveDate) {
      toast.error('Please select an effective date');
      return;
    }

    try {
      for (const dayOfWeek in newSchedule) {
        const schedule = newSchedule[dayOfWeek];
        await addScheduleChange({
          userId: selectedInstructorId,
          effectiveFrom: newScheduleEffectiveDate,
          dayOfWeek: parseInt(dayOfWeek),
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          afternoonStartTime: schedule.afternoonStartTime,
          afternoonEndTime: schedule.afternoonEndTime,
          isAvailable: schedule.isAvailable
        });
      }
      toast.success('Schedule change saved for all days');
      setShowScheduleChangeForm(false);
      setNewSchedule({});
      setNewScheduleEffectiveDate('');
    } catch (error) {
      toast.error('Failed to save schedule changes');
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const canManageSelectedInstructor = canEdit && (isAdmin || (isInstructorUser && selectedInstructorId === user?.id));
  const futureAbsences = absences.filter(absence => absence.endDate >= getTodayDate());

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Calendar className="h-5 w-5 mr-2" />
          Roster & Availability
        </h2>
        <p className="text-gray-600">Manage instructor schedules, absences, and availability</p>
      </div>

      {isAdmin && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Instructor
          </label>
          <select
            value={selectedInstructorId}
            onChange={(e) => setSelectedInstructorId(e.target.value)}
            className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select an instructor...</option>
            {instructors.map(instructor => (
              <option key={instructor.id} value={instructor.id}>
                {instructor.name || instructor.email}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedInstructorId && (
        <>
          {/* Weekly Schedule */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Weekly Schedule</h3>
            <div className="space-y-3">
              {DAYS_OF_WEEK.map(day => {
                const draft = getDraftForDay(day.value);
                const dirty = isDirty(day.value);
                const saving = savingDay === day.value;

                return (
                  <div
                    key={day.value}
                    className={`p-4 rounded-lg border transition-colors ${
                      dirty ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 flex-1 flex-wrap">
                        <div className="w-28 shrink-0">
                          <span className="font-medium text-gray-900">{day.label}</span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={draft.isAvailable}
                            onChange={(e) => handleDraftChange(day.value, 'isAvailable', e.target.checked)}
                            disabled={!canManageSelectedInstructor}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                          />
                          <label className="text-sm text-gray-700">Available</label>
                        </div>

                        {draft.isAvailable && (
                          <div className="flex flex-col space-y-2 flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <Clock className="h-4 w-4 text-gray-400 shrink-0" />
                              <span className="text-xs text-gray-600 w-16 shrink-0">Morning:</span>
                              <TimeSelect
                                value={draft.startTime}
                                onChange={(value) => handleDraftChange(day.value, 'startTime', value)}
                                disabled={!canManageSelectedInstructor}
                              />
                              <span className="text-gray-500">to</span>
                              <TimeSelect
                                value={draft.endTime}
                                onChange={(value) => handleDraftChange(day.value, 'endTime', value)}
                                disabled={!canManageSelectedInstructor}
                              />
                            </div>
                            <div className="flex items-center space-x-2">
                              <Clock className="h-4 w-4 text-gray-400 shrink-0" />
                              <span className="text-xs text-gray-600 w-16 shrink-0">Afternoon:</span>
                              <TimeSelect
                                value={draft.afternoonStartTime || ''}
                                onChange={(value) => handleDraftChange(day.value, 'afternoonStartTime', value)}
                                disabled={!canManageSelectedInstructor}
                                placeholder="Optional"
                              />
                              <span className="text-gray-500">to</span>
                              <TimeSelect
                                value={draft.afternoonEndTime || ''}
                                onChange={(value) => handleDraftChange(day.value, 'afternoonEndTime', value)}
                                disabled={!canManageSelectedInstructor}
                                placeholder="Optional"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {canManageSelectedInstructor && dirty && (
                        <button
                          onClick={() => handleSaveDay(day.value)}
                          disabled={saving}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60 shrink-0"
                        >
                          <Save className="h-3.5 w-3.5" />
                          {saving ? 'Saving...' : 'Update'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Temporary Absences */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Temporary Absences</h3>
              {canManageSelectedInstructor && (
                <button
                  onClick={() => {
                    setShowAbsenceForm(!showAbsenceForm);
                    setAbsenceDraft(EMPTY_ABSENCE_DRAFT);
                  }}
                  className="flex items-center space-x-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add Absence</span>
                </button>
              )}
            </div>

            {showAbsenceForm && (
              <form onSubmit={handleAddAbsence} className="bg-blue-50 p-4 rounded-lg border border-blue-200 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={absenceDraft.startDate}
                      onChange={(e) => setAbsenceDraft(prev => ({ ...prev, startDate: e.target.value }))}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={absenceDraft.endDate}
                      onChange={(e) => setAbsenceDraft(prev => ({ ...prev, endDate: e.target.value }))}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Time (Optional)
                    </label>
                    <TimeSelect
                      value={absenceDraft.startTime}
                      onChange={(value) => setAbsenceDraft(prev => ({ ...prev, startTime: value }))}
                      placeholder="Select time"
                      className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">Leave blank for full day</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Time (Optional)
                    </label>
                    <TimeSelect
                      value={absenceDraft.endTime}
                      onChange={(value) => setAbsenceDraft(prev => ({ ...prev, endTime: value }))}
                      placeholder="Select time"
                      className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">Leave blank for full day</p>
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason (Optional)
                  </label>
                  <input
                    type="text"
                    value={absenceDraft.reason}
                    onChange={(e) => setAbsenceDraft(prev => ({ ...prev, reason: e.target.value }))}
                    placeholder="e.g., Vacation, Training, etc."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex space-x-2">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Add Absence
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAbsenceForm(false);
                      setAbsenceDraft(EMPTY_ABSENCE_DRAFT);
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {futureAbsences.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <AlertCircle className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                <p>No upcoming absences scheduled</p>
              </div>
            ) : (
              <div className="space-y-2">
                {futureAbsences.map(absence => (
                  <div key={absence.id} className="bg-amber-50 p-4 rounded-lg border border-amber-200 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-gray-900">
                        {formatRosterDate(absence.startDate)} - {formatRosterDate(absence.endDate)}
                        {absence.startTime && absence.endTime && (
                          <span className="ml-2 text-sm font-normal">
                            ({formatRosterTime(absence.startTime)} - {formatRosterTime(absence.endTime)})
                          </span>
                        )}
                      </div>
                      {absence.reason && (
                        <div className="text-sm text-gray-600">{absence.reason}</div>
                      )}
                      {!absence.startTime && !absence.endTime && (
                        <div className="text-xs text-gray-500 mt-1">Full day absence</div>
                      )}
                    </div>
                    {canManageSelectedInstructor && (
                      <button
                        onClick={() => deleteAbsence(absence.id)}
                        title="Delete absence"
                        aria-label="Delete absence"
                        className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Schedule Changes */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Future Schedule Changes</h3>
                <p className="text-sm text-gray-600">Set a complete new weekly schedule starting from a specific date</p>
              </div>
              {canManageSelectedInstructor && !showScheduleChangeForm && (
                <button
                  onClick={handleStartNewSchedule}
                  className="flex items-center space-x-2 px-3 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  <Plus className="h-4 w-4" />
                  <span>New Schedule</span>
                </button>
              )}
            </div>

            {showScheduleChangeForm && (
              <div className="bg-green-50 p-4 rounded-lg border border-green-200 mb-4">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Effective From Date
                  </label>
                  <input
                    type="date"
                    value={newScheduleEffectiveDate}
                    onChange={(e) => setNewScheduleEffectiveDate(e.target.value)}
                    required
                    className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">This schedule will replace the weekly schedule starting from this date</p>
                </div>

                <div className="space-y-3 mb-4">
                  {DAYS_OF_WEEK.map(day => {
                    const schedule = newSchedule[day.value];
                    if (!schedule) return null;

                    return (
                      <div key={day.value} className="bg-white p-4 rounded-lg border border-gray-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4 flex-1">
                            <div className="w-32">
                              <span className="font-medium text-gray-900">{day.label}</span>
                            </div>

                            <div className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={schedule.isAvailable ?? false}
                                onChange={(e) => handleNewScheduleChange(day.value, 'isAvailable', e.target.checked)}
                                className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                              />
                              <label className="text-sm text-gray-700">Available</label>
                            </div>

                            {schedule.isAvailable && (
                              <div className="flex flex-col space-y-2 flex-1">
                                <div className="flex items-center space-x-2">
                                  <Clock className="h-4 w-4 text-gray-400" />
                                  <span className="text-xs text-gray-600 w-16">Morning:</span>
                                  <TimeSelect
                                    value={schedule.startTime}
                                    onChange={(value) => handleNewScheduleChange(day.value, 'startTime', value)}
                                  />
                                  <span className="text-gray-500">to</span>
                                  <TimeSelect
                                    value={schedule.endTime}
                                    onChange={(value) => handleNewScheduleChange(day.value, 'endTime', value)}
                                  />
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Clock className="h-4 w-4 text-gray-400" />
                                  <span className="text-xs text-gray-600 w-16">Afternoon:</span>
                                  <TimeSelect
                                    value={schedule.afternoonStartTime || ''}
                                    onChange={(value) => handleNewScheduleChange(day.value, 'afternoonStartTime', value)}
                                    placeholder="Optional"
                                  />
                                  <span className="text-gray-500">to</span>
                                  <TimeSelect
                                    value={schedule.afternoonEndTime || ''}
                                    onChange={(value) => handleNewScheduleChange(day.value, 'afternoonEndTime', value)}
                                    placeholder="Optional"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={handleSaveNewSchedule}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                  >
                    Save Schedule Change
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowScheduleChangeForm(false);
                      setNewSchedule({});
                      setNewScheduleEffectiveDate('');
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {scheduleChanges.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Clock className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                <p>No future schedule changes</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(
                  scheduleChanges.reduce((acc, change) => {
                    if (!acc[change.effectiveFrom]) {
                      acc[change.effectiveFrom] = [];
                    }
                    acc[change.effectiveFrom].push(change);
                    return acc;
                  }, {} as {[key: string]: typeof scheduleChanges})
                ).map(([effectiveFrom, changes]) => (
                  <div key={effectiveFrom} className="bg-green-50 p-4 rounded-lg border border-green-200">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-semibold text-gray-900">
                          Starting {formatRosterDate(effectiveFrom)}
                        </h4>
                        <p className="text-xs text-gray-600">Weekly schedule effective from this date</p>
                      </div>
                      {canManageSelectedInstructor && (
                        <button
                          onClick={async () => {
                            for (const change of changes) {
                              await deleteScheduleChange(change.id);
                            }
                          }}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                          title="Delete entire schedule"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {DAYS_OF_WEEK.map(day => {
                        const change = changes.find(c => c.dayOfWeek === day.value);
                        if (!change) return null;
                        return (
                          <div key={day.value} className="bg-white p-2 rounded text-sm flex items-center justify-between">
                            <span className="font-medium text-gray-700 w-24">{day.label}</span>
                            {change.isAvailable ? (
                              <div className="flex-1 text-gray-600">
                                {formatRosterTime(change.startTime)} - {formatRosterTime(change.endTime)}
                                {change.afternoonStartTime && change.afternoonEndTime && (
                                  <span className="ml-2 text-gray-500">
                                    | {formatRosterTime(change.afternoonStartTime)} - {formatRosterTime(change.afternoonEndTime)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-red-600">Not Available</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
