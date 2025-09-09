import React, { useState } from 'react';
import { Plane, Building, Plus, Trash2 } from 'lucide-react';

interface ResourcesSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

interface RequiredField {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select';
  required: boolean;
  options?: string[];
}

export const ResourcesSettings: React.FC<ResourcesSettingsProps> = ({ canEdit, onFormChange }) => {
  const [aircraftFields, setAircraftFields] = useState<RequiredField[]>([
    { id: '1', name: 'Registration', type: 'text', required: true },
    { id: '2', name: 'Make', type: 'text', required: true },
    { id: '3', name: 'Model', type: 'text', required: true },
    { id: '4', name: 'Aircraft Type', type: 'select', required: true, options: ['Single Engine', 'Multi Engine', 'Helicopter'] },
    { id: '5', name: 'Tach Start', type: 'number', required: false },
    { id: '6', name: 'Fuel Capacity', type: 'number', required: false },
    { id: '7', name: 'Empty Weight', type: 'number', required: false },
    { id: '8', name: 'Max Weight', type: 'number', required: false }
  ]);

  const [documentTypes, setDocumentTypes] = useState([
    { id: '1', name: 'Pilot Operating Handbook (POH)', required: true },
    { id: '2', name: 'Insurance Certificate', required: true },
    { id: '3', name: 'Certificate of Airworthiness', required: true },
    { id: '4', name: 'Weight & Balance Sheet', required: false },
    { id: '5', name: 'Maintenance Log', required: false }
  ]);

  const [instructorSettings, setInstructorSettings] = useState({
    defaultDutyHours: '08:00-18:00',
    requiredBreakMinutes: 30,
    maxDailyHours: 8,
    publicAvailabilityVisible: true
  });

  const handleFieldChange = (id: string, field: string, value: any) => {
    setAircraftFields(prev => prev.map(f =>
      f.id === id ? { ...f, [field]: value } : f
    ));
    onFormChange();
  };

  const handleDocumentChange = (id: string, field: string, value: any) => {
    setDocumentTypes(prev => prev.map(doc =>
      doc.id === id ? { ...doc, [field]: value } : doc
    ));
    onFormChange();
  };

  const handleInstructorSettingChange = (field: string, value: string | number | boolean) => {
    setInstructorSettings(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const addField = () => {
    const newField: RequiredField = {
      id: (aircraftFields.length + 1).toString(),
      name: 'New Field',
      type: 'text',
      required: false
    };
    setAircraftFields(prev => [...prev, newField]);
    onFormChange();
  };

  const removeField = (id: string) => {
    setAircraftFields(prev => prev.filter(f => f.id !== id));
    onFormChange();
  };

  const addDocumentType = () => {
    const newDoc = {
      id: (documentTypes.length + 1).toString(),
      name: 'New Document Type',
      required: false
    };
    setDocumentTypes(prev => [...prev, newDoc]);
    onFormChange();
  };

  const removeDocumentType = (id: string) => {
    setDocumentTypes(prev => prev.filter(doc => doc.id !== id));
    onFormChange();
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Plane className="h-5 w-5 mr-2" />
          Resources (Aircraft & Rooms)
        </h2>
        <p className="text-gray-600">Configure default fields and requirements for aircraft and facility resources</p>
      </div>

      {/* Aircraft Default Fields */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Aircraft Required Fields</h3>
          <div className="space-y-3">
            {aircraftFields.map(field => (
              <div key={field.id} className="p-4 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Field Name</label>
                    <input
                      type="text"
                      value={field.name}
                      onChange={(e) => handleFieldChange(field.id, 'name', e.target.value)}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                    <select
                      value={field.type}
                      onChange={(e) => handleFieldChange(field.id, 'type', e.target.value)}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="select">Select</option>
                    </select>
                  </div>

                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      id={`required-${field.id}`}
                      checked={field.required}
                      onChange={(e) => handleFieldChange(field.id, 'required', e.target.checked)}
                      disabled={!canEdit}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                    />
                    <label htmlFor={`required-${field.id}`} className="text-sm text-gray-700">
                      Required
                    </label>
                  </div>

                  {canEdit && (
                    <div>
                      <button
                        onClick={() => removeField(field.id)}
                        className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {canEdit && (
              <button
                onClick={addField}
                className="w-full p-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 hover:text-gray-800 transition-colors flex items-center justify-center space-x-2"
              >
                <Plus className="h-4 w-4" />
                <span>Add Field</span>
              </button>
            )}
          </div>
        </div>

        {/* Document Requirements */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Required Document Types</h3>
          <div className="space-y-3">
            {documentTypes.map(docType => (
              <div key={docType.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <input
                    type="text"
                    value={docType.name}
                    onChange={(e) => handleDocumentChange(docType.id, 'name', e.target.value)}
                    disabled={!canEdit}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                </div>
                <div className="flex items-center space-x-3 ml-4">
                  <input
                    type="checkbox"
                    id={`doc-required-${docType.id}`}
                    checked={docType.required}
                    onChange={(e) => handleDocumentChange(docType.id, 'required', e.target.checked)}
                    disabled={!canEdit}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                  />
                  <label htmlFor={`doc-required-${docType.id}`} className="text-sm text-gray-700">
                    Required
                  </label>
                  {canEdit && (
                    <button
                      onClick={() => removeDocumentType(docType.id)}
                      className="p-1 text-red-600 hover:text-red-800"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {canEdit && (
              <button
                onClick={addDocumentType}
                className="w-full p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 hover:text-gray-800 transition-colors"
              >
                + Add Document Type
              </button>
            )}
          </div>
        </div>

        {/* Instructor Roster Settings */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Instructor Roster</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Default Duty Hours</label>
              <input
                type="text"
                value={instructorSettings.defaultDutyHours}
                onChange={(e) => handleInstructorSettingChange('defaultDutyHours', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                placeholder="08:00-18:00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Required Break (minutes)</label>
              <input
                type="number"
                min="0"
                max="120"
                value={instructorSettings.requiredBreakMinutes}
                onChange={(e) => handleInstructorSettingChange('requiredBreakMinutes', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Max Daily Hours</label>
              <input
                type="number"
                min="1"
                max="12"
                step="0.5"
                value={instructorSettings.maxDailyHours}
                onChange={(e) => handleInstructorSettingChange('maxDailyHours', parseFloat(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div className="flex items-center space-x-3 pt-8">
              <input
                type="checkbox"
                id="publicAvailabilityVisible"
                checked={instructorSettings.publicAvailabilityVisible}
                onChange={(e) => handleInstructorSettingChange('publicAvailabilityVisible', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="publicAvailabilityVisible" className="text-sm text-gray-700">
                Show instructor availability publicly
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};