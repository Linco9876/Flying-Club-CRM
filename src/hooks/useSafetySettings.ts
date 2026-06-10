import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export interface SafetyComplianceSettings {
  id: string;
  recencyDays: number;
  medicalWarningDays: number;
  licenceWarningDays: number;
  bfrWarningDays: number;
  instructorSopCheckMonths: number;
  seniorInstructorSopCheckMonths: number;
  defaultSafetyOfficer: string;
  autoAssignIncidents: boolean;
  requirePhotosForDefects: boolean;
  autoGroundOnMajorDefect: boolean;
  autoBlockExpiredMedical: boolean;
  autoBlockExpiredLicence: boolean;
  requireBfrForSolo: boolean;
}

export interface SafetyReportCategory {
  id: string;
  name: string;
  defaultAssignee: string;
  displayOrder: number;
}

export const useSafetySettings = () => {
  const [settings, setSettings] = useState<SafetyComplianceSettings | null>(null);
  const [categories, setCategories] = useState<SafetyReportCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
    fetchCategories();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('safety_compliance_settings')
        .select('*')
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings({
          id: data.id,
          recencyDays: data.recency_days,
          medicalWarningDays: data.medical_warning_days,
          licenceWarningDays: data.licence_warning_days,
          bfrWarningDays: data.bfr_warning_days,
          instructorSopCheckMonths: data.instructor_sop_check_months,
          seniorInstructorSopCheckMonths: data.senior_instructor_sop_check_months,
          defaultSafetyOfficer: data.default_safety_officer,
          autoAssignIncidents: data.auto_assign_incidents,
          requirePhotosForDefects: data.require_photos_for_defects,
          autoGroundOnMajorDefect: data.auto_ground_on_major_defect,
          autoBlockExpiredMedical: data.auto_block_expired_medical,
          autoBlockExpiredLicence: data.auto_block_expired_licence,
          requireBfrForSolo: data.require_bfr_for_solo
        });
      }
    } catch (error) {
      console.error('Error fetching safety settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('safety_report_categories')
        .select('*')
        .order('display_order');

      if (error) throw error;

      if (data) {
        setCategories(data.map(c => ({
          id: c.id,
          name: c.name,
          defaultAssignee: c.default_assignee,
          displayOrder: c.display_order
        })));
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const updateSettings = async (updates: Partial<SafetyComplianceSettings>) => {
    if (!settings) return;

    try {
      const dbUpdates: any = {};
      if (updates.recencyDays !== undefined) dbUpdates.recency_days = updates.recencyDays;
      if (updates.medicalWarningDays !== undefined) dbUpdates.medical_warning_days = updates.medicalWarningDays;
      if (updates.licenceWarningDays !== undefined) dbUpdates.licence_warning_days = updates.licenceWarningDays;
      if (updates.bfrWarningDays !== undefined) dbUpdates.bfr_warning_days = updates.bfrWarningDays;
      if (updates.instructorSopCheckMonths !== undefined) dbUpdates.instructor_sop_check_months = updates.instructorSopCheckMonths;
      if (updates.seniorInstructorSopCheckMonths !== undefined) dbUpdates.senior_instructor_sop_check_months = updates.seniorInstructorSopCheckMonths;
      if (updates.defaultSafetyOfficer !== undefined) dbUpdates.default_safety_officer = updates.defaultSafetyOfficer;
      if (updates.autoAssignIncidents !== undefined) dbUpdates.auto_assign_incidents = updates.autoAssignIncidents;
      if (updates.requirePhotosForDefects !== undefined) dbUpdates.require_photos_for_defects = updates.requirePhotosForDefects;
      if (updates.autoGroundOnMajorDefect !== undefined) dbUpdates.auto_ground_on_major_defect = updates.autoGroundOnMajorDefect;
      if (updates.autoBlockExpiredMedical !== undefined) dbUpdates.auto_block_expired_medical = updates.autoBlockExpiredMedical;
      if (updates.autoBlockExpiredLicence !== undefined) dbUpdates.auto_block_expired_licence = updates.autoBlockExpiredLicence;
      if (updates.requireBfrForSolo !== undefined) dbUpdates.require_bfr_for_solo = updates.requireBfrForSolo;

      dbUpdates.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('safety_compliance_settings')
        .update(dbUpdates)
        .eq('id', settings.id);

      if (error) throw error;

      setSettings({ ...settings, ...updates });
      toast.success('Settings updated successfully');
    } catch (error) {
      console.error('Error updating settings:', error);
      toast.error('Failed to update settings');
    }
  };

  const addCategory = async (name: string, defaultAssignee: string) => {
    try {
      const { data, error } = await supabase
        .from('safety_report_categories')
        .insert({
          name,
          default_assignee: defaultAssignee,
          display_order: categories.length
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setCategories([...categories, {
          id: data.id,
          name: data.name,
          defaultAssignee: data.default_assignee,
          displayOrder: data.display_order
        }]);
        toast.success('Category added');
      }
    } catch (error) {
      console.error('Error adding category:', error);
      toast.error('Failed to add category');
    }
  };

  const updateCategory = async (id: string, updates: Partial<SafetyReportCategory>) => {
    try {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.defaultAssignee !== undefined) dbUpdates.default_assignee = updates.defaultAssignee;
      if (updates.displayOrder !== undefined) dbUpdates.display_order = updates.displayOrder;

      const { error } = await supabase
        .from('safety_report_categories')
        .update(dbUpdates)
        .eq('id', id);

      if (error) throw error;

      setCategories(categories.map(c =>
        c.id === id ? { ...c, ...updates } : c
      ));
    } catch (error) {
      console.error('Error updating category:', error);
      toast.error('Failed to update category');
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      const { error } = await supabase
        .from('safety_report_categories')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setCategories(categories.filter(c => c.id !== id));
      toast.success('Category deleted');
    } catch (error) {
      console.error('Error deleting category:', error);
      toast.error('Failed to delete category');
    }
  };

  return {
    settings,
    categories,
    loading,
    updateSettings,
    addCategory,
    updateCategory,
    deleteCategory
  };
};
