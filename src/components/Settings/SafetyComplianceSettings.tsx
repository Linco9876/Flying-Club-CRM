import React, { useEffect, useState } from 'react';
import { Shield, Users, Plus, Trash2, Loader2 } from 'lucide-react';
import { SafetyReportCategory, useSafetySettings } from '../../hooks/useSafetySettings';
import { useTrainingSettings } from '../../hooks/useTrainingSettings';

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
  const { settings: trainingSettings } = useTrainingSettings();
  const [formData, setFormData] = useState(settings);

  const handleInputChange = (field: string, value: string | number | boolean | string[]) => {
    setFormData(current => ({ ...current, [field]: value }));
    onFormChange();
  };

  const toggleFlightReviewEndorsement = (endorsementType: string, enabled: boolean) => {
    const existing = formData.flightReviewEndorsementTypes || [];
    const next = enabled
      ? Array.from(new Set([...existing, endorsementType]))
      : existing.filter(type => type !== endorsementType);
    handleInputChange('flightReviewEndorsementTypes', next);
  };

  const handleCategoryChange = (id: string, field: string, value: string) => {
    const updates: Partial<SafetyReportCategory> = field === 'name'
      ? { name: value }
      : { defaultAssignee: value };
    updateCategory(id, updates);
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
    const settingsWindow = window as Window & {
      __safetySettingsSave?: () => Promise<void>;
      __safetySettingsCancel?: () => void;
    };
    settingsWindow.__safetySettingsSave = async () => updateSettings(formData);
    settingsWindow.__safetySettingsCancel = () => setFormData(settings);
    return () => {
      delete settingsWindow.__safetySettingsSave;
      delete settingsWindow.__safetySettingsCancel;
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
            <p className="mt-1 text-xs leading-5">CFI-only protected records use a 90-day interval for Instructors, 12 months for Senior Instructors and a two-year rating renewal cycle.</p>
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

          <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-blue-950">Endorsements that reset flight review</h4>
                <p className="mt-1 text-sm leading-5 text-blue-900">
                  When one of these active/current endorsements is added to a member, the endorsement date becomes their latest flight review date. Their next flight review will then be due two years after that date.
                </p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-blue-700">
                {formData.flightReviewEndorsementTypes?.length || 0} selected
              </span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(trainingSettings.endorsementTypes || []).map(endorsementType => (
                <label key={endorsementType} className="flex items-start gap-2 rounded-lg border border-blue-100 bg-white p-3 text-sm text-slate-800 shadow-sm">
                  <input
                    type="checkbox"
                    checked={(formData.flightReviewEndorsementTypes || []).includes(endorsementType)}
                    onChange={(event) => toggleFlightReviewEndorsement(endorsementType, event.target.checked)}
                    disabled={!canEdit}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <span className="font-medium">{endorsementType}</span>
                </label>
              ))}
              {(trainingSettings.endorsementTypes || []).length === 0 && (
                <p className="rounded-lg border border-blue-100 bg-white p-3 text-sm text-blue-900">
                  Add endorsement types in Training / Syllabus Settings first.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Instructor Checks */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Instructor Compliance Cadence</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-cyan-100 bg-cyan-50 p-4">
              <p className="text-sm font-semibold text-cyan-950">Instructor S&amp;P</p>
              <p className="mt-2 text-2xl font-bold text-cyan-900">90 days</p>
              <p className="mt-1 text-xs leading-5 text-cyan-800">Recorded by a CFI before instructional duties begin and at each recurring check.</p>
            </div>
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
              <p className="text-sm font-semibold text-blue-950">Senior Instructor S&amp;P</p>
              <p className="mt-2 text-2xl font-bold text-blue-900">12 months</p>
              <p className="mt-1 text-xs leading-5 text-blue-800">Includes the higher-level BFR, solo-authorisation and endorsement-training standards.</p>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
              <p className="text-sm font-semibold text-indigo-950">Rating renewal</p>
              <p className="mt-2 text-2xl font-bold text-indigo-900">2 years</p>
              <p className="mt-1 text-xs leading-5 text-indigo-800">The completed RAAus renewal form must be attached before the protected record can be finalised.</p>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Login safety warning title</label>
                <input
                  type="text"
                  value={formData.safetyLoginWarningTitle}
                  onChange={(e) => handleInputChange('safetyLoginWarningTitle', e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">Shown as the heading on the login safety popup.</p>
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Recency warning when no logged flight is found</label>
                <textarea
                  rows={3}
                  value={formData.recencyNoFlightMessage}
                  onChange={(e) => handleInputChange('recencyNoFlightMessage', e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">Use {'{subject}'} for “you” or the member name, and {'{possessive}'} if needed.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Recency warning when a last flight is found</label>
                <textarea
                  rows={3}
                  value={formData.recencyLastFlightMessage}
                  onChange={(e) => handleInputChange('recencyLastFlightMessage', e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">Use {'{possessive}'}, {'{subject}'}, {'{name}'} and {'{days}'} placeholders.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
