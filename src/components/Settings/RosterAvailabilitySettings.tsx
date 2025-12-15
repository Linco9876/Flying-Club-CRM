import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Plus, Trash2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useUsers } from '../../hooks/useUsers';
import { useInstructorAvailability, WeeklySchedule } from '../../hooks/useInstructorAvailability';

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

export const RosterAvailabilitySettings: React.FC<RosterAvailabilitySettingsProps> = ({ canEdit }) => {
  const { user } = useAuth();
  const { users } = useUsers();
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>('');
  const [showAbsenceForm, setShowAbsenceForm] = useState(false);
  const [showScheduleChangeForm, setShowScheduleChangeForm] = useState(false);
  const [newScheduleEffectiveDate, setNewScheduleEffectiveDate] = useState('');
  const [newSchedule, setNewSchedule] = useState<{[key: number]: Omit<WeeklySchedule, 'id' | 'userId'>}>({});

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

  const instructors = users.filter(u =>
    u.roles?.includes('instructor') || u.roles?.includes('admin')
  );

  useEffect(() => {
    if (user?.role === 'instructor' && !user.roles?.includes('admin')) {
      setSelectedInstructorId(user.id);
    } else if (instructors.length > 0 && !selectedInstructorId) {
      setSelectedInstructorId(instructors[0].id);
    }
  }, [user, instructors, selectedInstructorId]);

  const getScheduleForDay = (dayOfWeek: number) => {
    return weeklySchedules.find(s => s.dayOfWeek === dayOfWeek);
  };

  const handleWeeklyScheduleChange = async (dayOfWeek: number, field: string, value: any) => {
    if (!canEdit || !selectedInstructorId) return;

    const existingSchedule = getScheduleForDay(dayOfWeek);
    const scheduleData = {
      userId: selectedInstructorId,
      dayOfWeek,
      startTime: existingSchedule?.startTime || '09:00',
      endTime: existingSchedule?.endTime || '17:00',
      afternoonStartTime: existingSchedule?.afternoonStartTime,
      afternoonEndTime: existingSchedule?.afternoonEndTime,
      isAvailable: existingSchedule?.isAvailable ?? true,
      [field]: value
    };

    await upsertWeeklySchedule(scheduleData);
  };

  const handleAddAbsence = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canEdit || !selectedInstructorId) return;

    const formData = new FormData(e.currentTarget);
    const startTime = formData.get('startTime') as string;
    const endTime = formData.get('endTime') as string;

    await addAbsence({
      userId: selectedInstructorId,
      startDate: formData.get('startDate') as string,
      endDate: formData.get('endDate') as string,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      reason: formData.get('reason') as string || undefined
    });

    setShowAbsenceForm(false);
    e.currentTarget.reset();
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
    if (!canEdit || !selectedInstructorId || !newScheduleEffectiveDate) {
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

  const isAdmin = user?.roles?.includes('admin');

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
                const schedule = getScheduleForDay(day.value);
                return (
                  <div key={day.value} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4 flex-1">
                        <div className="w-32">
                          <span className="font-medium text-gray-900">{day.label}</span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={schedule?.isAvailable ?? false}
                            onChange={(e) => handleWeeklyScheduleChange(day.value, 'isAvailable', e.target.checked)}
                            disabled={!canEdit}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                          />
                          <label className="text-sm text-gray-700">Available</label>
                        </div>

                        {schedule?.isAvailable && (
                          <div className="flex flex-col space-y-2 flex-1">
                            <div className="flex items-center space-x-2">
                              <Clock className="h-4 w-4 text-gray-400" />
                              <span className="text-xs text-gray-600 w-16">Morning:</span>
                              <input
                                type="time"
                                value={schedule.startTime}
                                onChange={(e) => handleWeeklyScheduleChange(day.value, 'startTime', e.target.value)}
                                disabled={!canEdit}
                                className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                              />
                              <span className="text-gray-500">to</span>
                              <input
                                type="time"
                                value={schedule.endTime}
                                onChange={(e) => handleWeeklyScheduleChange(day.value, 'endTime', e.target.value)}
                                disabled={!canEdit}
                                className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                              />
                            </div>
                            <div className="flex items-center space-x-2">
                              <Clock className="h-4 w-4 text-gray-400" />
                              <span className="text-xs text-gray-600 w-16">Afternoon:</span>
                              <input
                                type="time"
                                value={schedule.afternoonStartTime || ''}
                                onChange={(e) => handleWeeklyScheduleChange(day.value, 'afternoonStartTime', e.target.value)}
                                disabled={!canEdit}
                                placeholder="Optional"
                                className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                              />
                              <span className="text-gray-500">to</span>
                              <input
                                type="time"
                                value={schedule.afternoonEndTime || ''}
                                onChange={(e) => handleWeeklyScheduleChange(day.value, 'afternoonEndTime', e.target.value)}
                                disabled={!canEdit}
                                placeholder="Optional"
                                className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
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
          </div>

          {/* Temporary Absences */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Temporary Absences</h3>
              {canEdit && (
                <button
                  onClick={() => setShowAbsenceForm(!showAbsenceForm)}
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
                      name="startDate"
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
                      name="endDate"
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
                    <input
                      type="time"
                      name="startTime"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Leave blank for full day</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Time (Optional)
                    </label>
                    <input
                      type="time"
                      name="endTime"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    name="reason"
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
                    onClick={() => setShowAbsenceForm(false)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {absences.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <AlertCircle className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                <p>No absences scheduled</p>
              </div>
            ) : (
              <div className="space-y-2">
                {absences.map(absence => (
                  <div key={absence.id} className="bg-amber-50 p-4 rounded-lg border border-amber-200 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-gray-900">
                        {new Date(absence.startDate).toLocaleDateString()} - {new Date(absence.endDate).toLocaleDateString()}
                        {absence.startTime && absence.endTime && (
                          <span className="ml-2 text-sm font-normal">
                            ({absence.startTime} - {absence.endTime})
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
                    {canEdit && (
                      <button
                        onClick={() => deleteAbsence(absence.id)}
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
              {canEdit && !showScheduleChangeForm && (
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
                                  <input
                                    type="time"
                                    value={schedule.startTime}
                                    onChange={(e) => handleNewScheduleChange(day.value, 'startTime', e.target.value)}
                                    className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                                  />
                                  <span className="text-gray-500">to</span>
                                  <input
                                    type="time"
                                    value={schedule.endTime}
                                    onChange={(e) => handleNewScheduleChange(day.value, 'endTime', e.target.value)}
                                    className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                                  />
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Clock className="h-4 w-4 text-gray-400" />
                                  <span className="text-xs text-gray-600 w-16">Afternoon:</span>
                                  <input
                                    type="time"
                                    value={schedule.afternoonStartTime || ''}
                                    onChange={(e) => handleNewScheduleChange(day.value, 'afternoonStartTime', e.target.value)}
                                    placeholder="Optional"
                                    className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                                  />
                                  <span className="text-gray-500">to</span>
                                  <input
                                    type="time"
                                    value={schedule.afternoonEndTime || ''}
                                    onChange={(e) => handleNewScheduleChange(day.value, 'afternoonEndTime', e.target.value)}
                                    placeholder="Optional"
                                    className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
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
                          Starting {new Date(effectiveFrom).toLocaleDateString()}
                        </h4>
                        <p className="text-xs text-gray-600">Weekly schedule effective from this date</p>
                      </div>
                      {canEdit && (
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
                                {change.startTime} - {change.endTime}
                                {change.afternoonStartTime && change.afternoonEndTime && (
                                  <span className="ml-2 text-gray-500">
                                    | {change.afternoonStartTime} - {change.afternoonEndTime}
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
