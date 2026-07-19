import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { DutyBreak, DutyPeriod } from '../types';

export interface DutyPeriodInput {
  id?: string;
  instructorId: string;
  dutyDate: string;
  plannedStart?: Date;
  plannedEnd?: Date;
  actualStart?: Date;
  actualEnd?: Date;
  location: string;
  status: DutyPeriod['status'];
  isExternal: boolean;
  externalOrganisation?: string;
  flightMinutes: number;
  notes?: string;
  amendmentReason?: string;
  breaks: Array<Omit<DutyBreak, 'id' | 'dutyPeriodId'>>;
  declaration?: {
    fitForDuty: boolean;
    externalDutyDeclared: boolean;
    sleepOpportunityConfirmed?: boolean;
    kssScore?: number;
    privateNote?: string;
  };
}

type DutyBreakRow = { id: string; duty_period_id: string; break_start: string; break_end: string; break_type: DutyBreak['breakType']; free_of_duty: boolean; affects_calculation: boolean; facility?: string | null; notes?: string | null };

const mapBreak = (row: DutyBreakRow): DutyBreak => ({
  id: row.id,
  dutyPeriodId: row.duty_period_id,
  breakStart: new Date(row.break_start),
  breakEnd: new Date(row.break_end),
  breakType: row.break_type,
  freeOfDuty: Boolean(row.free_of_duty),
  affectsCalculation: Boolean(row.affects_calculation),
  facility: row.facility || undefined,
  notes: row.notes || undefined,
});

export const useDuty = (selectedInstructorId?: string) => {
  const { user } = useAuth();
  const roles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const isAdmin = roles.includes('admin');
  const targetInstructorId = isAdmin ? selectedInstructorId : user?.id;
  const [periods, setPeriods] = useState<DutyPeriod[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPeriods = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      let query = supabase
        .from('duty_periods')
        .select('*')
        .order('duty_date', { ascending: false })
        .order('actual_start', { ascending: false })
        .limit(180);
      if (targetInstructorId) query = query.eq('instructor_id', targetInstructorId);

      const { data, error } = await query;
      if (error) throw error;
      const ids = (data || []).map(row => row.id);
      const { data: breakRows, error: breakError } = ids.length
        ? await supabase.from('duty_breaks').select('*').in('duty_period_id', ids).order('break_start')
        : { data: [], error: null };
      if (breakError) throw breakError;
      const breaksByPeriod = new Map<string, DutyBreak[]>();
      (breakRows || []).forEach(row => {
        const list = breaksByPeriod.get(row.duty_period_id) || [];
        list.push(mapBreak(row));
        breaksByPeriod.set(row.duty_period_id, list);
      });

      const instructorIds = Array.from(new Set((data || []).map(row => row.instructor_id)));
      const { data: users } = instructorIds.length
        ? await supabase.from('users').select('id,name').in('id', instructorIds)
        : { data: [] as Array<{ id: string; name: string }> };
      const names = new Map((users || []).map(row => [row.id, row.name]));

      setPeriods((data || []).map(row => ({
        id: row.id,
        instructorId: row.instructor_id,
        instructorName: names.get(row.instructor_id),
        dutyDate: row.duty_date,
        plannedStart: row.planned_start ? new Date(row.planned_start) : undefined,
        plannedEnd: row.planned_end ? new Date(row.planned_end) : undefined,
        actualStart: row.actual_start ? new Date(row.actual_start) : undefined,
        actualEnd: row.actual_end ? new Date(row.actual_end) : undefined,
        location: row.location,
        status: row.status,
        isExternal: Boolean(row.is_external),
        externalOrganisation: row.external_organisation || undefined,
        flightMinutes: Number(row.flight_minutes || 0),
        notes: row.notes || undefined,
        amendmentReason: row.amendment_reason || undefined,
        entrySource: row.entry_source || 'manual',
        autoStartedForBookingId: row.auto_started_for_booking_id || undefined,
        autoClosedAtLimit: Boolean(row.auto_closed_at_limit),
        breaks: breaksByPeriod.get(row.id) || [],
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      })));
    } catch (error) {
      console.error('Failed to load duty records', error);
      toast.error('Duty records could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [targetInstructorId, user?.id]);

  useEffect(() => {
    void fetchPeriods();
    const channel = supabase
      .channel(`duty-periods-${targetInstructorId || 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duty_periods' }, () => void fetchPeriods())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duty_breaks' }, () => void fetchPeriods())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [fetchPeriods, targetInstructorId]);

  const savePeriod = async (input: DutyPeriodInput) => {
    if (!user?.id) throw new Error('You must be signed in');
    if (input.status === 'completed' && !input.actualEnd) throw new Error('Completed duty requires an end time');
    if (input.actualStart && input.actualEnd && input.actualEnd <= input.actualStart) throw new Error('Duty end must be after duty start');
    if (input.status === 'active' && input.declaration?.fitForDuty === false) throw new Error('A person marked not fit for duty cannot start duty');
    const existing = input.id ? periods.find(period => period.id === input.id) : undefined;
    if (existing?.status === 'completed' && !input.amendmentReason?.trim()) {
      throw new Error('An amendment reason is required when changing a completed duty record');
    }

    const row = {
      instructor_id: input.instructorId,
      duty_date: input.dutyDate,
      planned_start: input.plannedStart?.toISOString() || null,
      planned_end: input.plannedEnd?.toISOString() || null,
      actual_start: input.actualStart?.toISOString() || null,
      actual_end: input.actualEnd?.toISOString() || null,
      location: input.location.trim() || 'Bendigo',
      status: input.status,
      is_external: input.isExternal,
      external_organisation: input.isExternal ? input.externalOrganisation?.trim() || null : null,
      flight_minutes: Math.max(0, Math.round(input.flightMinutes || 0)),
      notes: input.notes?.trim() || null,
      amendment_reason: input.amendmentReason?.trim() || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
      completed_at: input.status === 'completed' ? new Date().toISOString() : null,
      ...(!input.id ? { created_by: user.id } : {}),
    };

    const response = input.id
      ? await supabase.from('duty_periods').update(row).eq('id', input.id).select('id').single()
      : await supabase.from('duty_periods').insert(row).select('id').single();
    if (response.error) throw response.error;
    const dutyPeriodId = response.data.id;

    if (input.id) {
      const { error } = await supabase.from('duty_breaks').delete().eq('duty_period_id', dutyPeriodId);
      if (error) throw error;
    }
    if (input.breaks.length) {
      const { error } = await supabase.from('duty_breaks').insert(input.breaks.map(item => ({
        duty_period_id: dutyPeriodId,
        break_start: item.breakStart.toISOString(),
        break_end: item.breakEnd.toISOString(),
        break_type: item.breakType,
        free_of_duty: item.freeOfDuty,
        affects_calculation: item.affectsCalculation,
        facility: item.facility?.trim() || null,
        notes: item.notes?.trim() || null,
        created_by: user.id,
      })));
      if (error) throw error;
    }

    if (input.declaration) {
      const { error } = await supabase.from('fatigue_declarations').insert({
        instructor_id: input.instructorId,
        duty_period_id: dutyPeriodId,
        fit_for_duty: input.declaration.fitForDuty,
        external_duty_declared: input.declaration.externalDutyDeclared,
        sleep_opportunity_confirmed: input.declaration.sleepOpportunityConfirmed ?? null,
        kss_score: input.declaration.kssScore || null,
        private_note: input.declaration.privateNote?.trim() || null,
        created_by: user.id,
      });
      if (error) throw error;
    }
    await fetchPeriods();
    toast.success(input.id ? 'Duty record updated' : input.status === 'active' ? 'Duty started' : 'Duty record added');
    return dutyPeriodId;
  };

  const endDuty = async (period: DutyPeriod, endTime = new Date()) => {
    const { data: summaryData, error: summaryError } = await supabase.rpc('get_logged_instructor_flight_summary', {
      p_instructor_id: period.instructorId,
      p_duty_date: period.dutyDate,
    });
    if (summaryError) throw summaryError;
    const summary = Array.isArray(summaryData) ? summaryData[0] : summaryData;
    await savePeriod({
      ...period,
      actualEnd: endTime,
      status: 'completed',
      flightMinutes: Number(summary?.flight_minutes || 0),
      breaks: period.breaks.map(item => ({
        breakStart: item.breakStart,
        breakEnd: item.breakEnd,
        breakType: item.breakType,
        freeOfDuty: item.freeOfDuty,
        affectsCalculation: item.affectsCalculation,
        facility: item.facility,
        notes: item.notes,
      })),
    });
  };

  return { periods, loading, isAdmin, targetInstructorId, savePeriod, endDuty, refetch: fetchPeriods };
};
