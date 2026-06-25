import React, { useEffect, useState } from 'react';
import { Shield, Users, Plus, Trash2, Loader2 } from 'lucide-react';
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
  const [formData, setFormData] = useState(settings);

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData(current => ({ ...current, [field]: value }));
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

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  useEffect(() => {
    (window as any).__safetySettingsSave = async () => updateSettings(formData);
    (window as any).__safetySettingsCancel = () => setFormData(settings);
    return () => {
      delete (window as any).__safetySettingsSave;
      delete (window as any).__safetySettingsCancel;
    };
  }, [formData, settings]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
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

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Compliance scope</h3>
        <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
          <div className="rounded-lg border border-white bg-white p-3 shadow-sm">
            <p className="font-semibold text-slate-950">Fatigue management</p>
            <p className="mt-1 text-xs leading-5">Booking fatigue controls are configured in Bookings & Rules and reference CASA CAO 48.1 Appendix 6 flight training. The CRM applies the local rule set to instructor bookings it knows about; outside flying and actual fitness for duty must still be managed operationally.</p>
          </div>
          <div className="rounded-lg border border-white bg-white p-3 shadow-sm">
            <p className="font-semibold text-slate-950">Flight tests and reviews</p>
            <p className="mt-1 text-xs leading-5">Flight tests are course-defined lessons. When logged through training records, the record keeps the test outcome, evidence, signatures and acknowledgement history.</p>
          </div>
          <div className="rounded-lg border border-white bg-white p-3 shadow-sm">
            <p className="font-semibold text-slate-950">Instructor S&amp;P checks</p>
            <p className="mt-1 text-xs leading-5">The Instructor Approvals tab uses the S&amp;P intervals below. Overdue or missing checks are flagged as requiring senior instructor supervision.</p>
          </div>
        </div>
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
          <h3 className="text-lg font-medium text-gray-900 mb-4">Instructor S&amp;P Check Intervals</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Instructor S&amp;P Check (months)</label>
              <input
                type="number"
                min="1"
                max="36"
                value={formData.instructorSopCheckMonths}
                onChange={(e) => handleInputChange('instructorSopCheckMonths', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">Regular instructor standards and proficiency check interval. Default: 3 months.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Senior Instructor S&amp;P Check (months)</label>
              <input
                type="number"
                min="1"
                max="48"
                value={formData.seniorInstructorSopCheckMonths}
                onChange={(e) => handleInputChange('seniorInstructorSopCheckMonths', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">Senior instructor standards and proficiency check interval. Default: 12 months.</p>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Default Safety Officer</label>
                <input
                  type="text"
                  value={formData.defaultSafetyOfficer}
                  onChange={(e) => handleInputChange('defaultSafetyOfficer', e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="autoAssignIncidents"
                checked={formData.autoAssignIncidents}
                onChange={(e) => handleInputChange('autoAssignIncidents', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="autoAssignIncidents" className="text-sm text-gray-700">
                Automatically assign new safety reports
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

            <div className="grid grid-cols-1 gap-4 pt-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Booking recency acknowledgement wording</label>
                <textarea
                  rows={5}
                  value={formData.recencyWarningMessage}
                  onChange={(e) => handleInputChange('recencyWarningMessage', e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">Shown when a non-student books outside the recency period. Keep the PIC-hour guidance here if your club requires it.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Login safety warning wording</label>
                <textarea
                  rows={3}
                  value={formData.safetyLoginWarningMessage}
                  onChange={(e) => handleInputChange('safetyLoginWarningMessage', e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">Shown on login when medical, membership, BFR or currency items need attention.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
