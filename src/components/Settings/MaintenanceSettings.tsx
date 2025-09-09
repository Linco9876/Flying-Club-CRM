import React, { useState } from 'react';
import { Wrench, Plus, Trash2 } from 'lucide-react';

interface MaintenanceSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

interface MaintenanceMilestone {
  id: string;
  name: string;
  intervalHours: number;
  intervalMonths: number;
  type: 'hours' | 'calendar' | 'both';
  description: string;
}

export const MaintenanceSettings: React.FC<MaintenanceSettingsProps> = ({ canEdit, onFormChange }) => {
  const [formData, setFormData] = useState({
    autoGroundOnMajorDefect: true,
    requireMaintenanceApproval: true,
    maintenanceReminderDays: 14,
    defectPhotoRequired: false
  });

  const [milestoneTemplates, setMilestoneTemplates] = useState<MaintenanceMilestone[]>([
    {
      id: '1',
      name: '50 Hour Check',
      intervalHours: 50,
      intervalMonths: 0,
      type: 'hours',
      description: 'Basic inspection and oil change'
    },
    {
      id: '2',
      name: '100 Hour Check',
      intervalHours: 100,
      intervalMonths: 0,
      type: 'hours',
      description: 'Comprehensive inspection'
    },
    {
      id: '3',
      name: 'Annual Inspection',
      intervalHours: 0,
      intervalMonths: 12,
      type: 'calendar',
      description: 'Annual airworthiness inspection'
    },
    {
      id: '4',
      name: 'Hose Replacement',
      intervalHours: 0,
      intervalMonths: 24,
      type: 'calendar',
      description: 'Replace fuel and oil hoses'
    }
  ]);

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const handleMilestoneChange = (id: string, field: string, value: string | number) => {
    setMilestoneTemplates(prev => prev.map(milestone =>
      milestone.id === id ? { ...milestone, [field]: value } : milestone
    ));
    onFormChange();
  };

  const addMilestone = () => {
    const newMilestone: MaintenanceMilestone = {
      id: (milestoneTemplates.length + 1).toString(),
      name: 'New Milestone',
      intervalHours: 50,
      intervalMonths: 0,
      type: 'hours',
      description: ''
    };
    setMilestoneTemplates(prev => [...prev, newMilestone]);
    onFormChange();
  };

  const removeMilestone = (id: string) => {
    setMilestoneTemplates(prev => prev.filter(m => m.id !== id));
    onFormChange();
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Wrench className="h-5 w-5 mr-2" />
          Maintenance Settings
        </h2>
        <p className="text-gray-600">Configure maintenance schedules and defect management</p>
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
                checked={formData.autoGroundOnMajorDefect}
                onChange={(e) => handleInputChange('autoGroundOnMajorDefect', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="autoGroundOnMajorDefect" className="text-sm text-gray-700">
                Auto-ground aircraft on Major/Critical defects
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="requireMaintenanceApproval"
                checked={formData.requireMaintenanceApproval}
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
                checked={formData.defectPhotoRequired}
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
                  value={formData.maintenanceReminderDays}
                  onChange={(e) => handleInputChange('maintenanceReminderDays', parseInt(e.target.value))}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">Days before maintenance due to send reminder</p>
              </div>
            </div>
          </div>
        </div>

        {/* Milestone Templates */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Default Milestone Templates</h3>
          <div className="space-y-3">
            {milestoneTemplates.map(milestone => (
              <div key={milestone.id} className="p-4 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
                    <input
                      type="text"
                      value={milestone.name}
                      onChange={(e) => handleMilestoneChange(milestone.id, 'name', e.target.value)}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                    <select
                      value={milestone.type}
                      onChange={(e) => handleMilestoneChange(milestone.id, 'type', e.target.value)}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    >
                      <option value="hours">Hours</option>
                      <option value="calendar">Calendar</option>
                      <option value="both">Both</option>
                    </select>
                  </div>

                  {(milestone.type === 'hours' || milestone.type === 'both') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Hours</label>
                      <input
                        type="number"
                        min="1"
                        value={milestone.intervalHours}
                        onChange={(e) => handleMilestoneChange(milestone.id, 'intervalHours', parseInt(e.target.value))}
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                      />
                    </div>
                  )}

                  {(milestone.type === 'calendar' || milestone.type === 'both') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Months</label>
                      <input
                        type="number"
                        min="1"
                        value={milestone.intervalMonths}
                        onChange={(e) => handleMilestoneChange(milestone.id, 'intervalMonths', parseInt(e.target.value))}
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                      />
                    </div>
                  )}

                  {canEdit && (
                    <div>
                      <button
                        onClick={() => removeMilestone(milestone.id)}
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
                    value={milestone.description}
                    onChange={(e) => handleMilestoneChange(milestone.id, 'description', e.target.value)}
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