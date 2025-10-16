import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export interface BookingFieldSetting {
  id: string;
  fieldName: string;
  label: string;
  isRequired: boolean;
  isVisible: boolean;
  appliesToRoles: string[];
  displayOrder: number;
  helpText?: string;
}

export const useBookingFieldSettings = () => {
  const [settings, setSettings] = useState<BookingFieldSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('booking_field_settings')
        .select('*')
        .order('display_order');

      if (fetchError) throw fetchError;

      const mappedSettings: BookingFieldSetting[] = (data || []).map(s => ({
        id: s.id,
        fieldName: s.field_name,
        label: s.label,
        isRequired: s.is_required,
        isVisible: s.is_visible,
        appliesToRoles: s.applies_to_roles || [],
        displayOrder: s.display_order,
        helpText: s.help_text
      }));

      setSettings(mappedSettings);
      setError(null);
    } catch (err) {
      console.error('Error fetching booking field settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch settings');
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = async (id: string, updates: Partial<BookingFieldSetting>) => {
    try {
      const updateData: any = {};
      if (updates.isRequired !== undefined) updateData.is_required = updates.isRequired;
      if (updates.isVisible !== undefined) updateData.is_visible = updates.isVisible;
      if (updates.appliesToRoles !== undefined) updateData.applies_to_roles = updates.appliesToRoles;
      if (updates.displayOrder !== undefined) updateData.display_order = updates.displayOrder;
      if (updates.helpText !== undefined) updateData.help_text = updates.helpText;
      if (updates.label !== undefined) updateData.label = updates.label;

      const { error: updateError } = await supabase
        .from('booking_field_settings')
        .update(updateData)
        .eq('id', id);

      if (updateError) throw updateError;

      await fetchSettings();
      toast.success('Settings updated successfully');
    } catch (err) {
      console.error('Error updating setting:', err);
      toast.error('Failed to update settings');
      throw err;
    }
  };

  const isFieldRequired = (fieldName: string, userRole: string): boolean => {
    const setting = settings.find(s => s.fieldName === fieldName);
    if (!setting || !setting.isVisible) return false;
    if (!setting.appliesToRoles.includes(userRole)) return false;
    return setting.isRequired;
  };

  const isFieldVisible = (fieldName: string, userRole: string): boolean => {
    const setting = settings.find(s => s.fieldName === fieldName);
    if (!setting) return true;
    if (!setting.isVisible) return false;
    return setting.appliesToRoles.includes(userRole);
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return {
    settings,
    loading,
    error,
    updateSetting,
    isFieldRequired,
    isFieldVisible,
    refetch: fetchSettings
  };
};
