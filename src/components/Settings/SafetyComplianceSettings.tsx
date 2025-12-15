import React, { useEffect } from 'react';
import { Shield, AlertTriangle, Clock, Users, Plus, Trash2 } from 'lucide-react';
import { useSafetySettings } from '../../hooks/useSafetySettings';

interface SafetyComplianceSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const SafetyComplianceSettings: React.FC<SafetyComplianceSettingsProps> = ({ canEdit, onFormChange }) => {
  const {
    settings,
    categories,
    loading,
    updateSettings,
    addCategory,
    updateCategory,
    deleteCategory
  } = useSafetySettings();

  const handleInputChange = (field: string, value: string | number | boolean) => {
    if (!settings) return;
    updateSettings({ [field]: value } as any);
    onFormChange();
  };

  const handleCategoryChange = (id: string, field: string, value: string) => {
    updateCategory(id, { [field]: value } as any);
    onFormChange();
  };

  const handleAddCategory = () => {
    addCategory('New Category', 'Safety Officer');
    onFormChange();
  };

  const handleRemoveCategory = (id: string) => {
    deleteCategory(id);
    onFormChange();
  };

  if (loading || !settings) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Shield className="h-5 w-5 mr-2" />
          Safety & Compliance
        </h2>
        <p className="text-gray-600">Configure safety thresholds and compliance automation</p>
      </div>

      {/* Pilot Currency Thresholds */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <Users className="h-5 w-5 mr-2" />
            Pilot Currency Thresholds
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Recency Period (days)</label>
              <input
                type="number"
                min="30"
                max="365"
                value={settings.recencyDays}
                onChange={(e) => handleInputChange('recencyDays', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">Days since last flight to be considered current</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Medical Warning (days)</label>
              <input
                type="number"
                min="7"
                max="180"
                value={settings.medicalWarningDays}
                onChange={(e) => handleInputChange('medicalWarningDays', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">Days before medical expiry to show warning</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Licence Warning (days)</label>
              <input
                type="number"
                min="7"
                max="180"
                value={settings.licenceWarningDays}
                onChange={(e) => handleInputChange('licenceWarningDays', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">BFR Warning (days)</label>
              <input
                type="number"
                min="7"
                max="90"
                value={settings.bfrWarningDays}
                onChange={(e) => handleInputChange('bfrWarningDays', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>
          </div>
        </div>

        {/* Instructor Checks */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Instructor Check Intervals</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Instructor SOP Check (months)</label>
              <input
                type="number"
                min="6"
                max="36"
                value={settings.instructorSopCheckMonths}
                onChange={(e) => handleInputChange('instructorSopCheckMonths', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">Regular instructor standards check interval</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Senior Instructor SOP Check (months)</label>
              <input
                type="number"
                min="12"
                max="48"
                value={settings.seniorInstructorSopCheckMonths}
                onChange={(e) => handleInputChange('seniorInstructorSopCheckMonths', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">Senior instructor standards check interval</p>
            </div>
          </div>
        </div>

        {/* Safety Report Categories */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Safety Report Categories</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 px-3 pb-2">
              <div className="text-sm font-medium text-gray-600">Category Name</div>
              <div className="text-sm font-medium text-gray-600">Default Assignee</div>
            </div>
            {categories.map(category => (
              <div key={category.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                <input
                  type="text"
                  value={category.name}
                  onChange={(e) => handleCategoryChange(category.id, 'name', e.target.value)}
                  disabled={!canEdit}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  placeholder="Category name"
                />
                <input
                  type="text"
                  value={category.defaultAssignee}
                  onChange={(e) => handleCategoryChange(category.id, 'defaultAssignee', e.target.value)}
                  disabled={!canEdit}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  placeholder="Default assignee"
                />
                {canEdit && (
                  <button
                    onClick={() => handleRemoveCategory(category.id)}
                    className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <button
                onClick={handleAddCategory}
                className="w-full p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 hover:text-gray-800 transition-colors flex items-center justify-center space-x-2"
              >
                <Plus className="h-4 w-4" />
                <span>Add Category</span>
              </button>
            )}
          </div>
        </div>

        {/* Compliance Automation */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Compliance Automation</h3>
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="autoGroundOnMajorDefect"
                checked={settings.autoGroundOnMajorDefect}
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
                id="autoBlockExpiredMedical"
                checked={settings.autoBlockExpiredMedical}
                onChange={(e) => handleInputChange('autoBlockExpiredMedical', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="autoBlockExpiredMedical" className="text-sm text-gray-700">
                Block bookings for expired medical certificates
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="autoBlockExpiredLicence"
                checked={settings.autoBlockExpiredLicence}
                onChange={(e) => handleInputChange('autoBlockExpiredLicence', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="autoBlockExpiredLicence" className="text-sm text-gray-700">
                Block bookings for expired licences
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="requireBfrForSolo"
                checked={settings.requireBfrForSolo}
                onChange={(e) => handleInputChange('requireBfrForSolo', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="requireBfrForSolo" className="text-sm text-gray-700">
                Require current BFR for solo flights
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};