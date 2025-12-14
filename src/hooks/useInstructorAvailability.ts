import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export interface WeeklySchedule {
  id: string;
  userId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
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
  isAvailable: boolean;
}

export const useInstructorAvailability = (instructorId?: string) => {
  const [weeklySchedules, setWeeklySchedules] = useState<WeeklySchedule[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [scheduleChanges, setScheduleChanges] = useState<ScheduleChange[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWeeklySchedules = async (userId?: string) => {
    try {
      let query = supabase.from('instructor_weekly_schedules').select('*');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.order('day_of_week');

      if (error) throw error;

      const schedules = (data || []).map(s => ({
        id: s.id,
        userId: s.user_id,
        dayOfWeek: s.day_of_week,
        startTime: s.start_time,
        endTime: s.end_time,
        isAvailable: s.is_available
      }));

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

      const absencesList = (data || []).map(a => ({
        id: a.id,
        userId: a.user_id,
        startDate: a.start_date,
        endDate: a.end_date,
        startTime: a.start_time,
        endTime: a.end_time,
        reason: a.reason
      }));

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

      const changes = (data || []).map(c => ({
        id: c.id,
        userId: c.user_id,
        effectiveFrom: c.effective_from,
        dayOfWeek: c.day_of_week,
        startTime: c.start_time,
        endTime: c.end_time,
        isAvailable: c.is_available
      }));

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
          day_of_week: schedule.dayOfWeek,
          start_time: schedule.startTime,
          end_time: schedule.endTime,
          is_available: schedule.isAvailable,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,day_of_week'
        });

      if (error) throw error;

      await fetchWeeklySchedules(instructorId);
      toast.success('Weekly schedule updated');
    } catch (error) {
      console.error('Error updating weekly schedule:', error);
      toast.error('Failed to update weekly schedule');
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

      await fetchWeeklySchedules(instructorId);
      toast.success('Schedule deleted');
    } catch (error) {
      console.error('Error deleting schedule:', error);
      toast.error('Failed to delete schedule');
      throw error;
    }
  };

  const addAbsence = async (absence: Omit<Absence, 'id'>) => {
    try {
      const { error } = await supabase
        .from('instructor_absences')
        .insert({
          user_id: absence.userId,
          start_date: absence.startDate,
          end_date: absence.endDate,
          start_time: absence.startTime || null,
          end_time: absence.endTime || null,
          reason: absence.reason
        });

      if (error) throw error;

      await fetchAbsences(instructorId);
      toast.success('Absence added');
    } catch (error) {
      console.error('Error adding absence:', error);
      toast.error('Failed to add absence');
      throw error;
    }
  };

  const updateAbsence = async (id: string, absence: Partial<Omit<Absence, 'id' | 'userId'>>) => {
    try {
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
      toast.success('Absence updated');
    } catch (error) {
      console.error('Error updating absence:', error);
      toast.error('Failed to update absence');
      throw error;
    }
  };

  const deleteAbsence = async (id: string) => {
    try {
      const { error } = await supabase
        .from('instructor_absences')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await fetchAbsences(instructorId);
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
          effective_from: change.effectiveFrom,
          day_of_week: change.dayOfWeek,
          start_time: change.startTime,
          end_time: change.endTime,
          is_available: change.isAvailable
        });

      if (error) throw error;

      await fetchScheduleChanges(instructorId);
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

      await fetchScheduleChanges(instructorId);
      toast.success('Schedule change deleted');
    } catch (error) {
      console.error('Error deleting schedule change:', error);
      toast.error('Failed to delete schedule change');
      throw error;
    }
  };

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      await Promise.all([
        fetchWeeklySchedules(instructorId),
        fetchAbsences(instructorId),
        fetchScheduleChanges(instructorId)
      ]);
      setLoading(false);
    };

    fetchAll();
  }, [instructorId]);

  return {
    weeklySchedules,
    absences,
    scheduleChanges,
    loading,
    upsertWeeklySchedule,
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
