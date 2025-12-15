import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export interface MaintenanceMilestoneTemplate {
  id: string;
  name: string;
  type: 'hours' | 'calendar' | 'both';
  intervalHours: number;
  intervalMonths: number;
  description?: string;
  isDefault: boolean;
}

export interface MaintenanceSettingsData {
  id?: string;
  autoGroundOnMajorDefect: boolean;
  requireMaintenanceApproval: boolean;
  maintenanceReminderDays: number;
  defectPhotoRequired: boolean;
}

export const useMaintenanceSettings = () => {
  const [templates, setTemplates] = useState<MaintenanceMilestoneTemplate[]>([]);
  const [settings, setSettings] = useState<MaintenanceSettingsData>({
    autoGroundOnMajorDefect: true,
    requireMaintenanceApproval: true,
    maintenanceReminderDays: 14,
    defectPhotoRequired: false
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      const [templatesResult, settingsResult] = await Promise.all([
        supabase.from('maintenance_milestone_templates').select('*').order('name'),
        supabase.from('maintenance_settings').select('*').maybeSingle()
      ]);

      if (templatesResult.error) throw templatesResult.error;
      if (settingsResult.error) throw settingsResult.error;

      if (templatesResult.data) {
        setTemplates(templatesResult.data.map(t => ({
          id: t.id,
          name: t.name,
          type: t.type,
          intervalHours: parseFloat(t.interval_hours || 0),
          intervalMonths: parseInt(t.interval_months || 0),
          description: t.description,
          isDefault: t.is_default
        })));
      }

      if (settingsResult.data) {
        setSettings({
          id: settingsResult.data.id,
          autoGroundOnMajorDefect: settingsResult.data.auto_ground_on_major_defect,
          requireMaintenanceApproval: settingsResult.data.require_maintenance_approval,
          maintenanceReminderDays: settingsResult.data.maintenance_reminder_days,
          defectPhotoRequired: settingsResult.data.defect_photo_required
        });
      }
    } catch (error) {
      console.error('Error fetching maintenance settings:', error);
      toast.error('Failed to load maintenance settings');
    } finally {
      setLoading(false);
    }
  };

  const createTemplate = async (template: Omit<MaintenanceMilestoneTemplate, 'id'>) => {
    try {
      const { error } = await supabase
        .from('maintenance_milestone_templates')
        .insert({
          name: template.name,
          type: template.type,
          interval_hours: template.intervalHours,
          interval_months: template.intervalMonths,
          description: template.description,
          is_default: template.isDefault
        });

      if (error) throw error;

      await fetchData();
      toast.success('Template created');
    } catch (error) {
      console.error('Error creating template:', error);
      toast.error('Failed to create template');
      throw error;
    }
  };

  const updateTemplate = async (id: string, updates: Partial<MaintenanceMilestoneTemplate>) => {
    try {
      const updateData: any = { updated_at: new Date().toISOString() };
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.type !== undefined) updateData.type = updates.type;
      if (updates.intervalHours !== undefined) updateData.interval_hours = updates.intervalHours;
      if (updates.intervalMonths !== undefined) updateData.interval_months = updates.intervalMonths;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.isDefault !== undefined) updateData.is_default = updates.isDefault;

      const { error } = await supabase
        .from('maintenance_milestone_templates')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      await fetchData();
      toast.success('Template updated');
    } catch (error) {
      console.error('Error updating template:', error);
      toast.error('Failed to update template');
      throw error;
    }
  };

  const deleteTemplate = async (id: string) => {
    try {
      const { error } = await supabase
        .from('maintenance_milestone_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await fetchData();
      toast.success('Template deleted');
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
      throw error;
    }
  };

  const updateSettings = async (newSettings: Partial<MaintenanceSettingsData>) => {
    try {
      const updateData = {
        auto_ground_on_major_defect: newSettings.autoGroundOnMajorDefect ?? settings.autoGroundOnMajorDefect,
        require_maintenance_approval: newSettings.requireMaintenanceApproval ?? settings.requireMaintenanceApproval,
        maintenance_reminder_days: newSettings.maintenanceReminderDays ?? settings.maintenanceReminderDays,
        defect_photo_required: newSettings.defectPhotoRequired ?? settings.defectPhotoRequired,
        updated_at: new Date().toISOString()
      };

      if (settings.id) {
        const { error } = await supabase
          .from('maintenance_settings')
          .update(updateData)
          .eq('id', settings.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('maintenance_settings')
          .insert(updateData);

        if (error) throw error;
      }

      await fetchData();
      toast.success('Settings updated');
    } catch (error) {
      console.error('Error updating settings:', error);
      toast.error('Failed to update settings');
      throw error;
    }
  };

  return {
    templates,
    settings,
    loading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    updateSettings,
    refetch: fetchData
  };
};
