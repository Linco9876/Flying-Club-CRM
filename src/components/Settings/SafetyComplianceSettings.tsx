import React, { useState } from 'react';
import { Shield, AlertTriangle, Clock, Users } from 'lucide-react';

interface SafetyComplianceSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const SafetyComplianceSettings: React.FC<SafetyComplianceSettingsProps> = ({ canEdit, onFormChange }) => {
  const [formData, setFormData] = useState({
    // Pilot Currency Thresholds
    recencyDays: 90,
    medicalWarningDays: 60,
    licenceWarningDays: 60,
    bfrWarningDays: 30,
    
    // Instructor Checks
    standardsCheckIntervalMonths: 24,
    proficiencyCheckIntervalMonths: 12,
    
    // Safety Reports
    defaultSafetyOfficer: 'safety@flyingclub.com',
    autoAssignIncidents: true,
    requirePhotosForDefects: false,
    
    // Compliance Automation
    autoGroundOnMajorDefect: true,
    autoBlockExpiredMedical: true,
    autoBlockExpiredLicence: true,
    requireBfrForSolo: true
  });

  const [reportCategories, setReportCategories] = useState([
    { id: '1', name: 'Aircraft Incident', assignee: 'Chief Flying Instructor' },
    { id: '2', name: 'Ground Incident', assignee: 'Safety Officer' },
    { id: '3', name: 'Weather Related', assignee: 'Safety Officer' },
    { id: '4', name: 'Human Factors', assignee: 'Chief Flying Instructor' },
    { id: '5', name: 'Maintenance Related', assignee: 'Maintenance Officer' }
  ]);

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const handleCategoryChange = (id: string, field: string, value: string) => {
    setReportCategories(prev => prev.map(cat =>
      cat.id === id ? { ...cat, [field]: value } : cat
    ));
    onFormChange();
  };

  const addCategory = () => {
    const newCategory = {
      id: (reportCategories.length + 1).toString(),
      name: 'New Category',
      assignee: 'Safety Officer'
    };
    setReportCategories(prev => [...prev, newCategory]);
    onFormChange();
  };

  const removeCategory = (id: string) => {
    setReportCategories(prev => prev.filter(cat => cat.id !== id));
    onFormChange();
  };

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
                value={formData.recencyDays}
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
                value={formData.medicalWarningDays}
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
                value={formData.licenceWarningDays}
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
                value={formData.bfrWarningDays}
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
              <label className="block text-sm font-medium text-gray-700 mb-2">Standards Check (months)</label>
              <input
                type="number"
                min="12"
                max="36"
                value={formData.standardsCheckIntervalMonths}
                onChange={(e) => handleInputChange('standardsCheckIntervalMonths', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Proficiency Check (months)</label>
              <input
                type="number"
                min="6"
                max="24"
                value={formData.proficiencyCheckIntervalMonths}
                onChange={(e) => handleInputChange('proficiencyCheckIntervalMonths', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>
          </div>
        </div>

        {/* Safety Report Categories */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Safety Report Categories</h3>
          <div className="space-y-3">
            {reportCategories.map(category => (
              <div key={category.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                <input
                  type="text"
                  value={category.name}
                  onChange={(e) => handleCategoryChange(category.id, 'name', e.target.value)}
                  disabled={!canEdit}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
                <input
                  type="text"
                  value={category.assignee}
                  onChange={(e) => handleCategoryChange(category.id, 'assignee', e.target.value)}
                  disabled={!canEdit}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  placeholder="Default assignee"
                />
                {canEdit && (
                  <button
                    onClick={() => removeCategory(category.id)}
                    className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <button
                onClick={addCategory}
                className="w-full p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 hover:text-gray-800 transition-colors"
              >
                + Add Category
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
                id="autoBlockExpiredMedical"
                checked={formData.autoBlockExpiredMedical}
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
                checked={formData.autoBlockExpiredLicence}
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
                checked={formData.requireBfrForSolo}
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