import { SearchableSelect } from '../common/SearchableSelect';
import React, { useState, useEffect } from 'react';
import { Wrench, Plus, Trash2, Loader2 } from 'lucide-react';
import { useMaintenanceSettings } from '../../hooks/useMaintenanceSettings';
import toast from 'react-hot-toast';
import { validateMaintenanceThresholds } from '../../utils/maintenanceRules';
import { useLatestEffect } from '../../hooks/useLatestEffect';
import { SettingsLoadError } from './SettingsLoadError';

interface MaintenanceSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const MaintenanceSettings: React.FC<MaintenanceSettingsProps> = ({ canEdit, onFormChange }) => {
  const {
    templates,
    settings,
    loading,
    error,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    updateSettings,
    refetch,
  } = useMaintenanceSettings();

  const [formData, setFormData] = useState(settings);
  const [, setHasChanges] = useState(false);
  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
    onFormChange();
  };

  const handleMilestoneBlur = async (id: string, field: string, value: string | number) => {
    const current = templates.find(template => template.id === id);
    if (!current) return;
    if (field === 'name') {
      const name = String(value).trim();
      if (!name) {
        toast.error('Milestone template names cannot be blank.');
        setTemplateEditValues(previous => {
          const next = { ...previous };
          delete next[`${id}-${field}`];
          return next;
        });
        return;
      }
      if (templates.some(template => template.id !== id && template.name.trim().toLowerCase() === name.toLowerCase())) {
        toast.error('Milestone template names must be unique.');
        setTemplateEditValues(previous => {
          const next = { ...previous };
          delete next[`${id}-${field}`];
          return next;
        });
        return;
      }
      value = name;
    }
    if ((field === 'intervalHours' || field === 'intervalMonths') && (!Number.isFinite(Number(value)) || Number(value) <= 0)) {
      toast.error('Maintenance intervals must be greater than zero.');
      setTemplateEditValues(previous => {
        const next = { ...previous };
        delete next[`${id}-${field}`];
        return next;
      });
      return;
    }
    try {
      await updateTemplate(id, { [field]: value } as any);
      setTemplateEditValues(previous => {
        const next = { ...previous };
        delete next[`${id}-${field}`];
        return next;
      });
    } catch (error) {
      console.error('Error updating template:', error);
      setTemplateEditValues(previous => {
        const next = { ...previous };
        delete next[`${id}-${field}`];
        return next;
      });
    }
  };

  const [templateEditValues, setTemplateEditValues] = useState<Record<string, any>>({});
  const getTemplateType = (id: string, fallback: string) =>
    templateEditValues[`${id}-type`] ?? fallback;

  const handleMilestoneTypeChange = async (
    id: string,
    type: 'hours' | 'calendar' | 'both'
  ) => {
    const template = templates.find(item => item.id === id);
    if (!template) return;
    setTemplateEditValues(previous => ({ ...previous, [`${id}-type`]: type }));
    try {
      await updateTemplate(id, {
        type,
        intervalHours: type === 'hours' || type === 'both'
          ? Math.max(template.intervalHours, 50)
          : 0,
        intervalMonths: type === 'calendar' || type === 'both'
          ? Math.max(template.intervalMonths, 12)
          : 0
      });
    } catch (error) {
      console.error('Error changing maintenance template type:', error);
    } finally {
      setTemplateEditValues(previous => {
        const next = { ...previous };
        delete next[`${id}-type`];
        return next;
      });
    }
  };

  const addMilestone = async () => {
    try {
      const usedNames = new Set(templates.map(template => template.name.trim().toLowerCase()));
      let sequence = 1;
      let name = 'New Milestone';
      while (usedNames.has(name.toLowerCase())) {
        sequence += 1;
        name = `New Milestone ${sequence}`;
      }
      await createTemplate({
        name,
        type: 'hours',
        intervalHours: 50,
        intervalMonths: 0,
        description: '',
        isDefault: false
      });
    } catch (error) {
      console.error('Error creating template:', error);
    }
  };

  const removeMilestone = async (id: string) => {
    const template = templates.find(item => item.id === id);
    if (!window.confirm(`Delete the “${template?.name || 'maintenance'}” template? Existing aircraft milestones and history will remain.`)) {
      return;
    }
    try {
      await deleteTemplate(id);
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const validationError = validateMaintenanceThresholds({
        urgentHours: formData.urgentReminderHours,
        upcomingHours: formData.upcomingReminderHours,
        urgentDays: formData.urgentReminderDays,
        upcomingDays: formData.upcomingReminderDays
      });
      if (validationError) {
        toast.error(validationError);
        throw new Error(validationError);
      }
      await updateSettings(formData);
      setHasChanges(false);
    } catch (error) {
      console.error('Error saving settings:', error);
      throw error;
    }
  };

  const handleCancelSettings = () => {
    setFormData(settings);
    setHasChanges(false);
  };

  useLatestEffect(() => {
    (window as any).__maintenanceSettingsSave = handleSaveSettings;
    (window as any).__maintenanceSettingsCancel = handleCancelSettings;
    return () => {
      delete (window as any).__maintenanceSettingsSave;
      delete (window as any).__maintenanceSettingsCancel;
    };
  }, [formData, settings]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return <SettingsLoadError section="Maintenance" error={error} onRetry={refetch} />;
  }

  return (
    <div className="p-6 space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
            <Wrench className="h-5 w-5 mr-2" />
            Maintenance Settings
          </h2>
          <p className="text-gray-600">Configure maintenance schedules and defect management</p>
        </div>
      </div>

      {/* General Settings */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">General Settings</h3>
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="autoGroundOnMajorDefect"
                checked={formData?.autoGroundOnMajorDefect ?? true}
                onChange={(e) => handleInputChange('autoGroundOnMajorDefect', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="autoGroundOnMajorDefect" className="text-sm text-gray-700">
                Auto-ground aircraft on Major/Critical defects
              </label>
            </div>

            <div className="max-w-md">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Grounding review reminder (hours)
              </label>
              <input
                type="number"
                min="1"
                max="336"
                value={formData?.autoGroundDurationHours ?? 24}
                onChange={(e) => handleInputChange('autoGroundDurationHours', Math.max(1, parseInt(e.target.value) || 1))}
                disabled={!canEdit || !formData?.autoGroundOnMajorDefect}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">
                Staff are reminded after this time. An unresolved grounding defect never returns an aircraft to service automatically.
              </p>
            </div>

            <div className="flex items-start space-x-3">
              <input
                type="checkbox"
                id="autoGroundOnOverdueMaintenance"
                checked={formData?.autoGroundOnOverdueMaintenance ?? true}
                onChange={(e) => handleInputChange('autoGroundOnOverdueMaintenance', e.target.checked)}
                disabled={!canEdit}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <div>
                <label htmlFor="autoGroundOnOverdueMaintenance" className="text-sm text-gray-700">
                  Ground aircraft when a maintenance deadline is overdue
                </label>
                <p className="mt-1 text-xs text-gray-500">
                  The aircraft stays unavailable until the maintenance is completed or the deadline is corrected.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="requireMaintenanceApproval"
                checked={formData?.requireMaintenanceApproval ?? true}
                onChange={(e) => handleInputChange('requireMaintenanceApproval', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="requireMaintenanceApproval" className="text-sm text-gray-700">
                Require approval to return aircraft to service
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="defectPhotoRequired"
                checked={formData?.defectPhotoRequired ?? false}
                onChange={(e) => handleInputChange('defectPhotoRequired', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="defectPhotoRequired" className="text-sm text-gray-700">
                Require photos for defect reports
              </label>
            </div>

            <div className="max-w-md">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Default Defect View</label>
                <SearchableSelect
                  value={formData?.defaultDefectFilter ?? 'open'}
                  onChange={(e) => handleInputChange('defaultDefectFilter', e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                >
                  <option value="open">Open defects</option>
                  <option value="all">All defects</option>
                  <option value="mel">MEL defects</option>
                  <option value="deferred">Deferred defects</option>
                  <option value="fixed">Fixed defects</option>
                </SearchableSelect>
                <p className="text-xs text-gray-500 mt-1">Initial filter shown on the maintenance board</p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Maintenance Alert Thresholds</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Urgent Warning (hours remaining)</label>
              <input
                type="number"
                min="1"
                value={formData?.urgentReminderHours ?? 10}
                onChange={(e) => handleInputChange('urgentReminderHours', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Upcoming Warning (hours remaining)</label>
              <input
                type="number"
                min="1"
                value={formData?.upcomingReminderHours ?? 25}
                onChange={(e) => handleInputChange('upcomingReminderHours', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Urgent Warning (days remaining)</label>
              <input
                type="number"
                min="1"
                value={formData?.urgentReminderDays ?? 7}
                onChange={(e) => handleInputChange('urgentReminderDays', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Upcoming Warning (days remaining)</label>
              <input
                type="number"
                min="1"
                value={formData?.upcomingReminderDays ?? 30}
                onChange={(e) => handleInputChange('upcomingReminderDays', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">Upcoming thresholds should be greater than urgent thresholds.</p>
        </div>

        {/* Milestone Templates */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Default Milestone Templates</h3>
          <div className="space-y-3">
            {templates.map(template => {
              const selectedType = getTemplateType(template.id, template.type);
              return (
              <div key={template.id} className="p-4 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
                    <input
                      type="text"
                      value={templateEditValues[`${template.id}-name`] ?? template.name}
                      onChange={(e) => setTemplateEditValues(prev => ({ ...prev, [`${template.id}-name`]: e.target.value }))}
                      onBlur={(e) => handleMilestoneBlur(template.id, 'name', e.target.value)}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                    <SearchableSelect
                      value={templateEditValues[`${template.id}-type`] ?? template.type}
                      onChange={(e) => {
                        void handleMilestoneTypeChange(
                          template.id,
                          e.target.value as 'hours' | 'calendar' | 'both'
                        );
                      }}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    >
                      <option value="hours">Hours</option>
                      <option value="calendar">Calendar</option>
                      <option value="both">Both</option>
                    </SearchableSelect>
                  </div>

                  {(selectedType === 'hours' || selectedType === 'both') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Hours</label>
                      <input
                        type="number"
                        min="1"
                        value={templateEditValues[`${template.id}-intervalHours`] ?? template.intervalHours}
                        onChange={(e) => setTemplateEditValues(prev => ({ ...prev, [`${template.id}-intervalHours`]: e.target.value }))}
                        onBlur={(e) => handleMilestoneBlur(template.id, 'intervalHours', parseInt(e.target.value))}
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                      />
                    </div>
                  )}

                  {(selectedType === 'calendar' || selectedType === 'both') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Months</label>
                      <input
                        type="number"
                        min="1"
                        value={templateEditValues[`${template.id}-intervalMonths`] ?? template.intervalMonths}
                        onChange={(e) => setTemplateEditValues(prev => ({ ...prev, [`${template.id}-intervalMonths`]: e.target.value }))}
                        onBlur={(e) => handleMilestoneBlur(template.id, 'intervalMonths', parseInt(e.target.value))}
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                      />
                    </div>
                  )}

                  {canEdit && (
                    <div>
                      <button
                        onClick={() => removeMilestone(template.id)}
                        aria-label={`Delete ${template.name} template`}
                        className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <input
                    type="text"
                    value={templateEditValues[`${template.id}-description`] ?? (template.description || '')}
                    onChange={(e) => setTemplateEditValues(prev => ({ ...prev, [`${template.id}-description`]: e.target.value }))}
                    onBlur={(e) => handleMilestoneBlur(template.id, 'description', e.target.value)}
                    disabled={!canEdit}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    placeholder="Brief description of maintenance task"
                  />
                </div>
              </div>
              );
            })}

            {canEdit && (
              <button
                onClick={addMilestone}
                className="w-full p-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 hover:text-gray-800 transition-colors flex items-center justify-center space-x-2"
              >
                <Plus className="h-4 w-4" />
                <span>Add Milestone Template</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
