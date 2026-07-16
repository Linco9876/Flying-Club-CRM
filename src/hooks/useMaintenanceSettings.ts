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
  urgentReminderHours: number;
  upcomingReminderHours: number;
  urgentReminderDays: number;
  upcomingReminderDays: number;
  defaultDefectFilter: 'all' | 'open' | 'mel' | 'fixed' | 'deferred';
  autoGroundDurationHours: number;
}

const MAINTENANCE_SETTINGS_UPDATED_EVENT = 'maintenance-settings-updated';

const DEFAULT_SETTINGS: MaintenanceSettingsData = {
  autoGroundOnMajorDefect: true,
  requireMaintenanceApproval: true,
  maintenanceReminderDays: 14,
  defectPhotoRequired: false,
  urgentReminderHours: 10,
  upcomingReminderHours: 25,
  urgentReminderDays: 7,
  upcomingReminderDays: 30,
  defaultDefectFilter: 'open',
  autoGroundDurationHours: 24
};

export const useMaintenanceSettings = () => {
  const [templates, setTemplates] = useState<MaintenanceMilestoneTemplate[]>([]);
  const [settings, setSettings] = useState<MaintenanceSettingsData>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const handleUpdated = () => fetchData();
    window.addEventListener(MAINTENANCE_SETTINGS_UPDATED_EVENT, handleUpdated);
    return () => window.removeEventListener(MAINTENANCE_SETTINGS_UPDATED_EVENT, handleUpdated);
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
          name: t.name || t.title,
          type: t.type,
          intervalHours: parseFloat(t.interval_hours || 0),
          intervalMonths: parseInt(t.interval_months || 0),
          description: t.description,
          isDefault: t.is_default
        })));
      }

      if (settingsResult.data) {
        const savedSettings = settingsResult.data.settings || {};
        setSettings({
          ...DEFAULT_SETTINGS,
          ...savedSettings,
          id: settingsResult.data.id,
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
          title: template.name,
          due_condition: template.type,
          due_value: template.type === 'calendar'
            ? String(template.intervalMonths)
            : String(template.intervalHours),
          name: template.name,
          type: template.type,
          interval_hours: template.intervalHours,
          interval_months: template.intervalMonths,
          description: template.description,
          is_default: template.isDefault
        });

      if (error) throw error;

      await fetchData();
      window.dispatchEvent(new Event(MAINTENANCE_SETTINGS_UPDATED_EVENT));
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
      if (updates.name !== undefined) {
        updateData.name = updates.name;
        updateData.title = updates.name;
      }
      if (updates.type !== undefined) {
        updateData.type = updates.type;
        updateData.due_condition = updates.type;
      }
      if (updates.intervalHours !== undefined) {
        updateData.interval_hours = updates.intervalHours;
        updateData.due_value = String(updates.intervalHours);
      }
      if (updates.intervalMonths !== undefined) {
        updateData.interval_months = updates.intervalMonths;
        updateData.due_value = String(updates.intervalMonths);
      }
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.isDefault !== undefined) updateData.is_default = updates.isDefault;

      const { error } = await supabase
        .from('maintenance_milestone_templates')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      await fetchData();
      window.dispatchEvent(new Event(MAINTENANCE_SETTINGS_UPDATED_EVENT));
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
      window.dispatchEvent(new Event(MAINTENANCE_SETTINGS_UPDATED_EVENT));
      toast.success('Template deleted');
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
      throw error;
    }
  };

  const updateSettings = async (newSettings: Partial<MaintenanceSettingsData>) => {
    try {
      const settingsPayload = { ...settings, ...newSettings };
      delete settingsPayload.id;
      const updateData = {
        settings: settingsPayload,
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
      window.dispatchEvent(new Event(MAINTENANCE_SETTINGS_UPDATED_EVENT));
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
