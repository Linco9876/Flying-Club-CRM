import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { hasAnyRole } from '../utils/rbac';

const AVAILABILITY_UPDATED_EVENT = 'instructor-availability-updated';

const normalizeTime = (time?: string | null) => time ? time.slice(0, 5) : undefined;

let weeklySchedulesCache: WeeklySchedule[] | null = null;
let absencesCache: Absence[] | null = null;
let scheduleChangesCache: ScheduleChange[] | null = null;

export interface WeeklySchedule {
  id: string;
  userId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  afternoonStartTime?: string;
  afternoonEndTime?: string;
  isAvailable: boolean;
}

export interface Absence {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
}

export interface ScheduleChange {
  id: string;
  userId: string;
  effectiveFrom: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  afternoonStartTime?: string;
  afternoonEndTime?: string;
  isAvailable: boolean;
}

const mapWeeklyScheduleRow = (s: any): WeeklySchedule => ({
  id: s.id,
  userId: s.user_id || s.instructor_id,
  dayOfWeek: s.day_of_week,
  startTime: normalizeTime(s.start_time) || '09:00',
  endTime: normalizeTime(s.end_time) || '17:00',
  afternoonStartTime: normalizeTime(s.afternoon_start_time || s.start_time_2),
  afternoonEndTime: normalizeTime(s.afternoon_end_time || s.end_time_2),
  isAvailable: s.is_available
});

const mapAbsenceRow = (a: any): Absence => ({
  id: a.id,
  userId: a.user_id || a.instructor_id,
  startDate: a.start_date,
  endDate: a.end_date,
  startTime: normalizeTime(a.start_time),
  endTime: normalizeTime(a.end_time),
  reason: a.reason
});

const mapScheduleChangeRow = (c: any): ScheduleChange => ({
  id: c.id,
  userId: c.user_id || c.instructor_id,
  effectiveFrom: c.effective_from || c.change_date,
  dayOfWeek: c.day_of_week,
  startTime: normalizeTime(c.start_time) || '09:00',
  endTime: normalizeTime(c.end_time) || '17:00',
  afternoonStartTime: normalizeTime(c.afternoon_start_time || c.start_time_2),
  afternoonEndTime: normalizeTime(c.afternoon_end_time || c.end_time_2),
  isAvailable: c.is_available
});

export const useInstructorAvailability = (instructorId?: string) => {
  const { user } = useAuth();
  const [weeklySchedules, setWeeklySchedules] = useState<WeeklySchedule[]>(() => weeklySchedulesCache || []);
  const [absences, setAbsences] = useState<Absence[]>(() => absencesCache || []);
  const [scheduleChanges, setScheduleChanges] = useState<ScheduleChange[]>(() => scheduleChangesCache || []);
  const [loading, setLoading] = useState(() => !weeklySchedulesCache || !absencesCache || !scheduleChangesCache);

  const isAdmin = hasAnyRole(user, ['admin']);
  const canManageAbsenceFor = (targetUserId?: string | null) =>
    Boolean(targetUserId && user?.id && (isAdmin || targetUserId === user.id));

  const requireAbsencePermission = (targetUserId?: string | null) => {
    if (canManageAbsenceFor(targetUserId)) return;
    const message = isAdmin
      ? 'Select an instructor before saving the absence'
      : 'Instructors can only manage temporary absences for themselves';
    toast.error(message);
    throw new Error(message);
  };

  const getAbsenceOwner = async (id: string) => {
    const existing = absences.find(item => item.id === id);
    if (existing) return existing.userId;

    const { data, error } = await supabase
      .from('instructor_absences')
      .select('user_id, instructor_id')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data?.user_id || data?.instructor_id;
  };

  const notifyAvailabilityUpdated = () => {
    window.dispatchEvent(new Event(AVAILABILITY_UPDATED_EVENT));
  };

  const removeWeeklyScheduleFromState = (id: string) => {
    setWeeklySchedules(prev => {
      const next = prev.filter(schedule => schedule.id !== id);
      if (!instructorId) weeklySchedulesCache = next;
      return next;
    });
  };

  const removeAbsenceFromState = (id: string) => {
    setAbsences(prev => {
      const next = prev.filter(absence => absence.id !== id);
      if (!instructorId) absencesCache = next;
      return next;
    });
  };

  const removeScheduleChangeFromState = (id: string) => {
    setScheduleChanges(prev => {
      const next = prev.filter(change => change.id !== id);
      if (!instructorId) scheduleChangesCache = next;
      return next;
    });
  };

  const fetchWeeklySchedules = async (userId?: string) => {
    try {
      let query = supabase.from('instructor_weekly_schedules').select('*');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.order('day_of_week');

      if (error) throw error;

      const schedules = (data || []).map(mapWeeklyScheduleRow);

      if (!userId) {
        weeklySchedulesCache = schedules;
      }
      setWeeklySchedules(schedules);
    } catch (error) {
      console.error('Error fetching weekly schedules:', error);
      toast.error('Failed to fetch weekly schedules');
    }
  };

  const fetchAbsences = async (userId?: string) => {
    try {
      let query = supabase.from('instructor_absences').select('*');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.order('start_date', { ascending: false });

      if (error) throw error;

      const absencesList = (data || []).map(mapAbsenceRow);

      if (!userId) {
        absencesCache = absencesList;
      }
      setAbsences(absencesList);
    } catch (error) {
      console.error('Error fetching absences:', error);
      toast.error('Failed to fetch absences');
    }
  };

  const fetchScheduleChanges = async (userId?: string) => {
    try {
      let query = supabase.from('instructor_schedule_changes').select('*');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.order('effective_from', { ascending: false });

      if (error) throw error;

      const changes = (data || []).map(mapScheduleChangeRow);

      if (!userId) {
        scheduleChangesCache = changes;
      }
      setScheduleChanges(changes);
    } catch (error) {
      console.error('Error fetching schedule changes:', error);
      toast.error('Failed to fetch schedule changes');
    }
  };

  const upsertWeeklySchedule = async (schedule: Omit<WeeklySchedule, 'id'>) => {
    try {
      const { error } = await supabase
        .from('instructor_weekly_schedules')
        .upsert({
          user_id: schedule.userId,
          instructor_id: schedule.userId,
          day_of_week: schedule.dayOfWeek,
          start_time: schedule.startTime,
          end_time: schedule.endTime,
          start_time_2: schedule.afternoonStartTime || null,
          end_time_2: schedule.afternoonEndTime || null,
          afternoon_start_time: schedule.afternoonStartTime || null,
          afternoon_end_time: schedule.afternoonEndTime || null,
          is_available: schedule.isAvailable,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'instructor_id,day_of_week'
        });

      if (error) throw error;

      await fetchWeeklySchedules(instructorId);
      notifyAvailabilityUpdated();
      toast.success('Weekly schedule updated');
    } catch (error) {
      console.error('Error updating weekly schedule:', error);
      toast.error('Failed to update weekly schedule');
      throw error;
    }
  };

  const upsertWeeklySchedules = async (schedules: Omit<WeeklySchedule, 'id'>[]) => {
    if (schedules.length === 0) return;

    try {
      const rows = schedules.map(schedule => ({
        user_id: schedule.userId,
        instructor_id: schedule.userId,
        day_of_week: schedule.dayOfWeek,
        start_time: schedule.startTime,
        end_time: schedule.endTime,
        start_time_2: schedule.afternoonStartTime || null,
        end_time_2: schedule.afternoonEndTime || null,
        afternoon_start_time: schedule.afternoonStartTime || null,
        afternoon_end_time: schedule.afternoonEndTime || null,
        is_available: schedule.isAvailable,
        updated_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('instructor_weekly_schedules')
        .upsert(rows, { onConflict: 'instructor_id,day_of_week' });

      if (error) throw error;

      await fetchWeeklySchedules(instructorId);
      notifyAvailabilityUpdated();
      toast.success('Weekly availability saved');
    } catch (error) {
      console.error('Error updating weekly schedules:', error);
      toast.error('Failed to update weekly availability');
      throw error;
    }
  };

  const deleteWeeklySchedule = async (id: string) => {
    try {
      const { error } = await supabase
        .from('instructor_weekly_schedules')
        .delete()
        .eq('id', id);

      if (error) throw error;

      removeWeeklyScheduleFromState(id);
      await fetchWeeklySchedules(instructorId);
      notifyAvailabilityUpdated();
      toast.success('Schedule deleted');
    } catch (error) {
      console.error('Error deleting schedule:', error);
      toast.error('Failed to delete schedule');
      throw error;
    }
  };

  const addAbsence = async (absence: Omit<Absence, 'id'>) => {
    try {
      requireAbsencePermission(absence.userId);

      const { error } = await supabase
        .from('instructor_absences')
        .insert({
          user_id: absence.userId,
          instructor_id: absence.userId,
          start_date: absence.startDate,
          end_date: absence.endDate,
          start_time: absence.startTime || null,
          end_time: absence.endTime || null,
          reason: absence.reason
        });

      if (error) throw error;

      await fetchAbsences(instructorId);
      notifyAvailabilityUpdated();
      toast.success('Absence added');
    } catch (error) {
      console.error('Error adding absence:', error);
      toast.error('Failed to add absence');
      throw error;
    }
  };

  const updateAbsence = async (id: string, absence: Partial<Omit<Absence, 'id' | 'userId'>>) => {
    try {
      const ownerId = await getAbsenceOwner(id);
      requireAbsencePermission(ownerId);

      const updateData: any = { updated_at: new Date().toISOString() };

      if (absence.startDate) updateData.start_date = absence.startDate;
      if (absence.endDate) updateData.end_date = absence.endDate;
      if (absence.startTime !== undefined) updateData.start_time = absence.startTime || null;
      if (absence.endTime !== undefined) updateData.end_time = absence.endTime || null;
      if (absence.reason !== undefined) updateData.reason = absence.reason;

      const { error } = await supabase
        .from('instructor_absences')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      await fetchAbsences(instructorId);
      notifyAvailabilityUpdated();
      toast.success('Absence updated');
    } catch (error) {
      console.error('Error updating absence:', error);
      toast.error('Failed to update absence');
      throw error;
    }
  };

  const deleteAbsence = async (id: string) => {
    try {
      const ownerId = await getAbsenceOwner(id);
      requireAbsencePermission(ownerId);

      const { error } = await supabase
        .from('instructor_absences')
        .delete()
        .eq('id', id);

      if (error) throw error;

      removeAbsenceFromState(id);
      await fetchAbsences(instructorId);
      notifyAvailabilityUpdated();
      toast.success('Absence deleted');
    } catch (error) {
      console.error('Error deleting absence:', error);
      toast.error('Failed to delete absence');
      throw error;
    }
  };

  const addScheduleChange = async (change: Omit<ScheduleChange, 'id'>) => {
    try {
      const { error } = await supabase
        .from('instructor_schedule_changes')
        .insert({
          user_id: change.userId,
          instructor_id: change.userId,
          change_date: change.effectiveFrom,
          effective_from: change.effectiveFrom,
          day_of_week: change.dayOfWeek,
          start_time: change.startTime,
          end_time: change.endTime,
          start_time_2: change.afternoonStartTime || null,
          end_time_2: change.afternoonEndTime || null,
          afternoon_start_time: change.afternoonStartTime || null,
          afternoon_end_time: change.afternoonEndTime || null,
          is_available: change.isAvailable
        });

      if (error) throw error;

      await fetchScheduleChanges(instructorId);
      notifyAvailabilityUpdated();
      toast.success('Schedule change added');
    } catch (error) {
      console.error('Error adding schedule change:', error);
      toast.error('Failed to add schedule change');
      throw error;
    }
  };

  const deleteScheduleChange = async (id: string) => {
    try {
      const { error } = await supabase
        .from('instructor_schedule_changes')
        .delete()
        .eq('id', id);

      if (error) throw error;

      removeScheduleChangeFromState(id);
      await fetchScheduleChanges(instructorId);
      notifyAvailabilityUpdated();
      toast.success('Schedule change deleted');
    } catch (error) {
      console.error('Error deleting schedule change:', error);
      toast.error('Failed to delete schedule change');
      throw error;
    }
  };

  useEffect(() => {
    const fetchAll = async () => {
      if (!weeklySchedulesCache || !absencesCache || !scheduleChangesCache) {
        setLoading(true);
      }
      await Promise.all([
        fetchWeeklySchedules(instructorId),
        fetchAbsences(instructorId),
        fetchScheduleChanges(instructorId)
      ]);
      setLoading(false);
    };

    fetchAll();
  }, [instructorId]);

  useEffect(() => {
    const refreshAvailability = () => {
      fetchWeeklySchedules(instructorId);
      fetchAbsences(instructorId);
      fetchScheduleChanges(instructorId);
    };

    window.addEventListener(AVAILABILITY_UPDATED_EVENT, refreshAvailability);
    return () => window.removeEventListener(AVAILABILITY_UPDATED_EVENT, refreshAvailability);
  }, [instructorId]);

  useEffect(() => {
    const rowMatchesInstructor = (row: any) => {
      if (!instructorId) return true;
      return (row?.user_id || row?.instructor_id) === instructorId;
    };

    const channel = supabase
      .channel(`instructor_availability_${instructorId || 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'instructor_weekly_schedules' },
        (payload) => {
          const row = (payload.new || payload.old) as any;

          if (payload.eventType === 'DELETE') {
            if (row?.id) {
              removeWeeklyScheduleFromState(row.id);
            } else {
              void fetchWeeklySchedules(instructorId);
            }
            return;
          }

          if (!row?.id) return;

          if (!rowMatchesInstructor(row)) {
            removeWeeklyScheduleFromState(row.id);
            return;
          }

          const schedule = mapWeeklyScheduleRow(row);
          setWeeklySchedules(prev => {
            const next = prev.some(existing => existing.id === schedule.id)
              ? prev.map(existing => existing.id === schedule.id ? schedule : existing)
              : [...prev, schedule];
            const sorted = next.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
            if (!instructorId) weeklySchedulesCache = sorted;
            return sorted;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'instructor_absences' },
        (payload) => {
          const row = (payload.new || payload.old) as any;

          if (payload.eventType === 'DELETE') {
            if (row?.id) {
              removeAbsenceFromState(row.id);
            } else {
              void fetchAbsences(instructorId);
            }
            return;
          }

          if (!row?.id) return;

          if (!rowMatchesInstructor(row)) {
            removeAbsenceFromState(row.id);
            return;
          }

          const absence = mapAbsenceRow(row);
          setAbsences(prev => {
            const next = prev.some(existing => existing.id === absence.id)
              ? prev.map(existing => existing.id === absence.id ? absence : existing)
              : [...prev, absence];
            const sorted = next.sort((a, b) => b.startDate.localeCompare(a.startDate));
            if (!instructorId) absencesCache = sorted;
            return sorted;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'instructor_schedule_changes' },
        (payload) => {
          const row = (payload.new || payload.old) as any;

          if (payload.eventType === 'DELETE') {
            if (row?.id) {
              removeScheduleChangeFromState(row.id);
            } else {
              void fetchScheduleChanges(instructorId);
            }
            return;
          }

          if (!row?.id) return;

          if (!rowMatchesInstructor(row)) {
            removeScheduleChangeFromState(row.id);
            return;
          }

          const change = mapScheduleChangeRow(row);
          setScheduleChanges(prev => {
            const next = prev.some(existing => existing.id === change.id)
              ? prev.map(existing => existing.id === change.id ? change : existing)
              : [...prev, change];
            const sorted = next.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
            if (!instructorId) scheduleChangesCache = sorted;
            return sorted;
          });
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [instructorId]);

  return {
    weeklySchedules,
    absences,
    scheduleChanges,
    loading,
    upsertWeeklySchedule,
    upsertWeeklySchedules,
    deleteWeeklySchedule,
    addAbsence,
    updateAbsence,
    deleteAbsence,
    addScheduleChange,
    deleteScheduleChange,
    refetch: () => {
      fetchWeeklySchedules(instructorId);
      fetchAbsences(instructorId);
      fetchScheduleChanges(instructorId);
    }
  };
};
