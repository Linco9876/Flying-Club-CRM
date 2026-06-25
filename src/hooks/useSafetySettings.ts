import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export interface SafetyComplianceSettings {
  id?: string;
  settingsJson?: Record<string, unknown>;
  recencyDays: number;
  medicalWarningDays: number;
  licenceWarningDays: number;
  bfrWarningDays: number;
  instructorSopCheckMonths: number;
  seniorInstructorSopCheckMonths: number;
  defaultSafetyOfficer: string;
  autoAssignIncidents: boolean;
  autoBlockExpiredMedical: boolean;
  autoBlockExpiredLicence: boolean;
  requireBfrForSolo: boolean;
  recencyWarningMessage: string;
  safetyLoginWarningMessage: string;
}

export interface SafetyReportCategory {
  id: string;
  name: string;
  defaultAssignee: string;
  displayOrder: number;
}

const SAFETY_SETTINGS_UPDATED_EVENT = 'safety-settings-updated';

export const DEFAULT_SAFETY_SETTINGS: SafetyComplianceSettings = {
  recencyDays: 90,
  medicalWarningDays: 60,
  licenceWarningDays: 60,
  bfrWarningDays: 60,
  instructorSopCheckMonths: 3,
  seniorInstructorSopCheckMonths: 12,
  defaultSafetyOfficer: 'Safety Officer',
  autoAssignIncidents: true,
  autoBlockExpiredMedical: true,
  autoBlockExpiredLicence: true,
  requireBfrForSolo: true,
  recencyWarningMessage: 'You may not be current for solo aircraft hire. If you have less than 50 pilot in command hours and are outside the recency period, book a check flight with an instructor. If you have more than 50 pilot in command hours, complete 3 take-offs and landings before carrying passengers. If you have flown elsewhere, acknowledge this warning and make sure your records are updated.',
  safetyLoginWarningMessage: 'Your safety and compliance record needs attention. Please review any medical, membership, BFR or currency items before flying.'
};

const mapSettings = (data: any): SafetyComplianceSettings => ({
  ...DEFAULT_SAFETY_SETTINGS,
  id: data.id,
  settingsJson: data.settings ?? {},
  recencyDays: data.recency_days ?? DEFAULT_SAFETY_SETTINGS.recencyDays,
  medicalWarningDays: data.medical_warning_days ?? DEFAULT_SAFETY_SETTINGS.medicalWarningDays,
  licenceWarningDays: data.licence_warning_days ?? DEFAULT_SAFETY_SETTINGS.licenceWarningDays,
  bfrWarningDays: data.bfr_warning_days ?? DEFAULT_SAFETY_SETTINGS.bfrWarningDays,
  instructorSopCheckMonths: data.instructor_sop_check_months ?? DEFAULT_SAFETY_SETTINGS.instructorSopCheckMonths,
  seniorInstructorSopCheckMonths: data.senior_instructor_sop_check_months ?? DEFAULT_SAFETY_SETTINGS.seniorInstructorSopCheckMonths,
  defaultSafetyOfficer: data.default_safety_officer ?? DEFAULT_SAFETY_SETTINGS.defaultSafetyOfficer,
  autoAssignIncidents: data.auto_assign_incidents ?? DEFAULT_SAFETY_SETTINGS.autoAssignIncidents,
  autoBlockExpiredMedical: data.auto_block_expired_medical ?? DEFAULT_SAFETY_SETTINGS.autoBlockExpiredMedical,
  autoBlockExpiredLicence: data.auto_block_expired_licence ?? DEFAULT_SAFETY_SETTINGS.autoBlockExpiredLicence,
  requireBfrForSolo: data.require_bfr_for_solo ?? DEFAULT_SAFETY_SETTINGS.requireBfrForSolo,
  recencyWarningMessage: data.settings?.recency_warning_message ?? DEFAULT_SAFETY_SETTINGS.recencyWarningMessage,
  safetyLoginWarningMessage: data.settings?.safety_login_warning_message ?? DEFAULT_SAFETY_SETTINGS.safetyLoginWarningMessage
});

export const useSafetySettings = () => {
  const [settings, setSettings] = useState<SafetyComplianceSettings>(DEFAULT_SAFETY_SETTINGS);
  const [categories, setCategories] = useState<SafetyReportCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [settingsResult, categoriesResult] = await Promise.all([
        supabase.from('safety_compliance_settings').select('*').maybeSingle(),
        supabase.from('safety_report_categories').select('*').order('display_order')
      ]);

      if (settingsResult.error) throw settingsResult.error;
      if (categoriesResult.error) throw categoriesResult.error;

      setSettings(settingsResult.data ? mapSettings(settingsResult.data) : DEFAULT_SAFETY_SETTINGS);
      setCategories((categoriesResult.data || []).map(category => ({
        id: category.id,
        name: category.name,
        defaultAssignee: category.default_assignee || '',
        displayOrder: category.display_order || 0
      })));
    } catch (error) {
      console.error('Error fetching safety settings:', error);
      toast.error('Failed to load safety settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const handleUpdated = () => fetchData();
    window.addEventListener(SAFETY_SETTINGS_UPDATED_EVENT, handleUpdated);
    return () => window.removeEventListener(SAFETY_SETTINGS_UPDATED_EVENT, handleUpdated);
  }, []);

  const updateSettings = async (updates: Partial<SafetyComplianceSettings>) => {
    const nextSettings = { ...settings, ...updates };
    const payload = {
      recency_days: nextSettings.recencyDays,
      medical_warning_days: nextSettings.medicalWarningDays,
      licence_warning_days: nextSettings.licenceWarningDays,
      bfr_warning_days: nextSettings.bfrWarningDays,
      instructor_sop_check_months: nextSettings.instructorSopCheckMonths,
      senior_instructor_sop_check_months: nextSettings.seniorInstructorSopCheckMonths,
      default_safety_officer: nextSettings.defaultSafetyOfficer,
      auto_assign_incidents: nextSettings.autoAssignIncidents,
      auto_block_expired_medical: nextSettings.autoBlockExpiredMedical,
      auto_block_expired_licence: nextSettings.autoBlockExpiredLicence,
      require_bfr_for_solo: nextSettings.requireBfrForSolo,
      settings: {
        ...(settings.settingsJson ?? {}),
        recency_warning_message: nextSettings.recencyWarningMessage,
        safety_login_warning_message: nextSettings.safetyLoginWarningMessage
      },
      updated_at: new Date().toISOString()
    };

    try {
      const result = settings.id
        ? await supabase.from('safety_compliance_settings').update(payload).eq('id', settings.id)
        : await supabase.from('safety_compliance_settings').insert(payload);

      if (result.error) throw result.error;
      await fetchData();
      window.dispatchEvent(new Event(SAFETY_SETTINGS_UPDATED_EVENT));
      toast.success('Safety settings updated');
    } catch (error) {
      console.error('Error updating safety settings:', error);
      toast.error('Failed to update safety settings');
      throw error;
    }
  };

  const addCategory = async (name: string, defaultAssignee: string) => {
    const { error } = await supabase.from('safety_report_categories').insert({
      name,
      default_assignee: defaultAssignee,
      display_order: categories.length
    });
    if (error) {
      toast.error('Failed to add category');
      throw error;
    }
    await fetchData();
    toast.success('Category added');
  };

  const updateCategory = async (id: string, updates: Partial<SafetyReportCategory>) => {
    const { error } = await supabase.from('safety_report_categories').update({
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.defaultAssignee !== undefined ? { default_assignee: updates.defaultAssignee } : {}),
      ...(updates.displayOrder !== undefined ? { display_order: updates.displayOrder } : {})
    }).eq('id', id);
    if (error) {
      toast.error('Failed to update category');
      throw error;
    }
    setCategories(current => current.map(category => category.id === id ? { ...category, ...updates } : category));
  };

  const deleteCategory = async (id: string) => {
    const { error } = await supabase.from('safety_report_categories').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete category');
      throw error;
    }
    setCategories(current => current.filter(category => category.id !== id));
    toast.success('Category deleted');
  };

  return { settings, categories, loading, updateSettings, addCategory, updateCategory, deleteCategory, refetch: fetchData };
};
