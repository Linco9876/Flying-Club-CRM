import { useState } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { formatLocalDateInput } from '../utils/maintenanceRules';
import { useLatestEffect } from './useLatestEffect';

export interface MaintenanceMilestone {
  id: string;
  aircraftId: string;
  title: string;
  type: 'hours' | 'calendar' | 'both';
  intervalHours: number;
  intervalMonths: number;
  lastCompletedDate?: Date;
  lastCompletedTach?: number;
  nextDueHours?: number;
  nextDueDate?: Date;
  description?: string;
  dueCondition?: string;
  dueValue?: string;
  isOneTime?: boolean;
  status?: 'upcoming' | 'due' | 'overdue' | 'completed';
}

export interface MaintenanceCompletion {
  id: string;
  milestoneId: string;
  aircraftId: string;
  completedDate: Date;
  completedTach?: number;
  completedBy?: string;
  nextDueHours?: number;
  nextDueDate?: Date;
  notes?: string;
}

interface UseMaintenanceMilestonesOptions {
  enabled?: boolean;
}

export const useMaintenanceMilestones = (options?: UseMaintenanceMilestonesOptions) => {
  const enabled = options?.enabled ?? true;
  const [milestones, setMilestones] = useState<MaintenanceMilestone[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useLatestEffect(() => {
    if (enabled) {
      fetchMilestones();
      return;
    }

    setMilestones([]);
    setLoading(false);
  }, [enabled]);

  const fetchMilestones = async () => {
    if (!enabled) {
      setMilestones([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('maintenance_milestones')
        .select('*')
        .order('title');

      if (error) throw error;

      if (data) {
        setMilestones(data.map(m => ({
          id: m.id,
          aircraftId: m.aircraft_id,
          title: m.title,
          type: m.type || 'hours',
          intervalHours: parseFloat(m.interval_hours || 0),
          intervalMonths: parseInt(m.interval_months || 0),
          lastCompletedDate: m.last_completed_date ? new Date(m.last_completed_date) : undefined,
          lastCompletedTach: m.last_completed_tach ? parseFloat(m.last_completed_tach) : undefined,
          nextDueHours: m.next_due_hours ? parseFloat(m.next_due_hours) : undefined,
          nextDueDate: m.next_due_date ? new Date(m.next_due_date) : undefined,
          description: m.description,
          dueCondition: m.due_condition,
          dueValue: m.due_value,
          isOneTime: m.is_one_time || false,
          status: m.status || 'upcoming'
        })));
      }
      setError(null);
    } catch (error) {
      console.error('Error fetching maintenance milestones:', error);
      setError(error instanceof Error ? error.message : 'Failed to load maintenance milestones');
      toast.error('Failed to load maintenance milestones');
    } finally {
      setLoading(false);
    }
  };

  const createMilestone = async (milestone: Omit<MaintenanceMilestone, 'id'>, notify = true) => {
    try {
      const { error } = await supabase
        .from('maintenance_milestones')
        .upsert({
          aircraft_id: milestone.aircraftId,
          title: milestone.title,
          type: milestone.type,
          interval_hours: milestone.intervalHours,
          interval_months: milestone.intervalMonths,
          next_due_hours: milestone.nextDueHours,
          next_due_date: milestone.nextDueDate ? formatLocalDateInput(milestone.nextDueDate) : null,
          description: milestone.description,
          is_one_time: milestone.isOneTime || false,
          status: milestone.status || 'upcoming',
          due_condition: milestone.dueCondition || (milestone.type === 'calendar' ? 'date' : 'hours'),
          due_value: milestone.dueValue || (
            milestone.type === 'calendar'
              ? String(milestone.nextDueDate ? formatLocalDateInput(milestone.nextDueDate) : '')
              : String(milestone.nextDueHours || 0)
          )
        }, {
          onConflict: 'aircraft_id,title',
          ignoreDuplicates: true
        });

      if (error) throw error;

      await fetchMilestones();
      if (notify) toast.success('Maintenance milestone created');
    } catch (error) {
      console.error('Error creating milestone:', error);
      if (notify) toast.error('Failed to create milestone');
      throw error;
    }
  };

  const updateMilestone = async (id: string, updates: Partial<MaintenanceMilestone>) => {
    try {
      const updateData: any = {};
      if (updates.title !== undefined) updateData.title = updates.title;
      if (updates.type !== undefined) {
        updateData.type = updates.type;
        updateData.due_condition = updates.type;
      }
      if (updates.intervalHours !== undefined) updateData.interval_hours = updates.intervalHours;
      if (updates.intervalMonths !== undefined) updateData.interval_months = updates.intervalMonths;
      if (updates.lastCompletedDate !== undefined) updateData.last_completed_date = updates.lastCompletedDate;
      if (updates.lastCompletedTach !== undefined) updateData.last_completed_tach = updates.lastCompletedTach;
      if (updates.nextDueHours !== undefined) {
        updateData.next_due_hours = updates.nextDueHours;
        updateData.due_value = String(updates.nextDueHours);
      }
      if (updates.nextDueDate !== undefined) {
        updateData.next_due_date = formatLocalDateInput(updates.nextDueDate);
        updateData.due_value = formatLocalDateInput(updates.nextDueDate);
      }
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.status !== undefined) updateData.status = updates.status;

      updateData.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('maintenance_milestones')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      await fetchMilestones();
      toast.success('Milestone updated');
    } catch (error) {
      console.error('Error updating milestone:', error);
      toast.error('Failed to update milestone');
      throw error;
    }
  };

  const deleteMilestone = async (id: string) => {
    try {
      const { error } = await supabase
        .from('maintenance_milestones')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await fetchMilestones();
      toast.success('Milestone deleted');
    } catch (error) {
      console.error('Error deleting milestone:', error);
      toast.error('Failed to delete milestone');
      throw error;
    }
  };

  const completeMaintenance = async (completion: Omit<MaintenanceCompletion, 'id'>) => {
    try {
      const { error } = await supabase.rpc('complete_maintenance_milestone', {
        p_milestone_id: completion.milestoneId,
        p_completed_date: formatLocalDateInput(completion.completedDate),
        p_completed_tach: completion.completedTach,
        p_next_due_hours: completion.nextDueHours ?? null,
        p_next_due_date: completion.nextDueDate ? formatLocalDateInput(completion.nextDueDate) : null,
        p_notes: completion.notes ?? null,
        p_operation_id: crypto.randomUUID()
      });

      if (error) throw error;

      await fetchMilestones();
      toast.success('Maintenance completed');
    } catch (error) {
      console.error('Error completing maintenance:', error);
      toast.error('Failed to complete maintenance');
      throw error;
    }
  };

  return {
    milestones,
    loading,
    error,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    completeMaintenance,
    refetch: fetchMilestones
  };
};
