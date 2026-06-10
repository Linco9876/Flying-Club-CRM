import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

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

export const useMaintenanceMilestones = () => {
  const [milestones, setMilestones] = useState<MaintenanceMilestone[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMilestones();
  }, []);

  const fetchMilestones = async () => {
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
          dueValue: m.due_value
        })));
      }
    } catch (error) {
      console.error('Error fetching maintenance milestones:', error);
      toast.error('Failed to load maintenance milestones');
    } finally {
      setLoading(false);
    }
  };

  const createMilestone = async (milestone: Omit<MaintenanceMilestone, 'id'>) => {
    try {
      const { error } = await supabase
        .from('maintenance_milestones')
        .insert({
          aircraft_id: milestone.aircraftId,
          title: milestone.title,
          type: milestone.type,
          interval_hours: milestone.intervalHours,
          interval_months: milestone.intervalMonths,
          next_due_hours: milestone.nextDueHours,
          next_due_date: milestone.nextDueDate,
          description: milestone.description,
          due_condition: milestone.dueCondition || 'hours',
          due_value: milestone.dueValue || '0'
        });

      if (error) throw error;

      await fetchMilestones();
      toast.success('Maintenance milestone created');
    } catch (error) {
      console.error('Error creating milestone:', error);
      toast.error('Failed to create milestone');
      throw error;
    }
  };

  const updateMilestone = async (id: string, updates: Partial<MaintenanceMilestone>) => {
    try {
      const updateData: any = {};
      if (updates.title !== undefined) updateData.title = updates.title;
      if (updates.type !== undefined) updateData.type = updates.type;
      if (updates.intervalHours !== undefined) updateData.interval_hours = updates.intervalHours;
      if (updates.intervalMonths !== undefined) updateData.interval_months = updates.intervalMonths;
      if (updates.lastCompletedDate !== undefined) updateData.last_completed_date = updates.lastCompletedDate;
      if (updates.lastCompletedTach !== undefined) updateData.last_completed_tach = updates.lastCompletedTach;
      if (updates.nextDueHours !== undefined) updateData.next_due_hours = updates.nextDueHours;
      if (updates.nextDueDate !== undefined) updateData.next_due_date = updates.nextDueDate;
      if (updates.description !== undefined) updateData.description = updates.description;

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
      const { error: completionError } = await supabase
        .from('maintenance_completions')
        .insert({
          milestone_id: completion.milestoneId,
          aircraft_id: completion.aircraftId,
          completed_date: completion.completedDate,
          completed_tach: completion.completedTach,
          completed_by: completion.completedBy,
          next_due_hours: completion.nextDueHours,
          next_due_date: completion.nextDueDate,
          notes: completion.notes
        });

      if (completionError) throw completionError;

      const { error: updateError } = await supabase
        .from('maintenance_milestones')
        .update({
          last_completed_date: completion.completedDate,
          last_completed_tach: completion.completedTach,
          next_due_hours: completion.nextDueHours,
          next_due_date: completion.nextDueDate,
          updated_at: new Date().toISOString()
        })
        .eq('id', completion.milestoneId);

      if (updateError) throw updateError;

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
    createMilestone,
    updateMilestone,
    deleteMilestone,
    completeMaintenance,
    refetch: fetchMilestones
  };
};
