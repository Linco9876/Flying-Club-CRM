import React, { useState, useEffect } from 'react';
import { Wrench, Plus, Trash2, Loader2 } from 'lucide-react';
import { useMaintenanceSettings } from '../../hooks/useMaintenanceSettings';
import toast from 'react-hot-toast';

interface MaintenanceSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const MaintenanceSettings: React.FC<MaintenanceSettingsProps> = ({ canEdit, onFormChange }) => {
  const {
    templates,
    settings,
    loading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    updateSettings
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
    try {
      await updateTemplate(id, { [field]: value } as any);
    } catch (error) {
      console.error('Error updating template:', error);
    }
  };

  const [templateEditValues, setTemplateEditValues] = useState<Record<string, any>>({});

  const addMilestone = async () => {
    try {
      await createTemplate({
        name: 'New Milestone',
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
    try {
      await deleteTemplate(id);
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  const handleSaveSettings = async () => {
    try {
      if (
        formData.upcomingReminderHours < formData.urgentReminderHours ||
        formData.upcomingReminderDays < formData.urgentReminderDays
      ) {
        toast.error('Upcoming maintenance thresholds must be greater than or equal to urgent thresholds');
        return;
      }
      await updateSettings(formData);
      setHasChanges(false);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  const handleCancelSettings = () => {
    setFormData(settings);
    setHasChanges(false);
  };

  useEffect(() => {
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
                Automatic grounding period (hours)
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
                Existing bookings during this period move to the waiting list for an admin to resolve. They are never deleted.
              </p>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Maintenance Reminder (days)</label>
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={formData?.maintenanceReminderDays ?? 14}
                  onChange={(e) => handleInputChange('maintenanceReminderDays', parseInt(e.target.value))}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">Days before maintenance due to send reminder</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Default Defect View</label>
                <select
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
                </select>
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
            {templates.map(template => (
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
                    <select
                      value={templateEditValues[`${template.id}-type`] ?? template.type}
                      onChange={(e) => {
                        setTemplateEditValues(prev => ({ ...prev, [`${template.id}-type`]: e.target.value }));
                        handleMilestoneBlur(template.id, 'type', e.target.value);
                      }}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    >
                      <option value="hours">Hours</option>
                      <option value="calendar">Calendar</option>
                      <option value="both">Both</option>
                    </select>
                  </div>

                  {(template.type === 'hours' || template.type === 'both') && (
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

                  {(template.type === 'calendar' || template.type === 'both') && (
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
            ))}

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
