import React, { useState } from 'react';
import { Monitor, Palette, Globe, Download, Upload } from 'lucide-react';

interface PortalTemplate {
  id: string;
  name: string;
  type: string;
  lastUpdated: Date;
}

interface PortalUxSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const PortalUxSettings: React.FC<PortalUxSettingsProps> = ({ canEdit, onFormChange }) => {
  const [formData, setFormData] = useState({
    theme: 'light',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: '24h',
    flightTimeDecimals: 1,
    currencyDecimals: 2,
    showInvoicesInPortal: true,
    showStudyTasksInPortal: true,
    showProgressTracking: true,
    allowSelfBooking: true,
    allowBookingCancellation: true,
    maxAdvanceBookingDays: 30
  });

  const [templates, setTemplates] = useState<PortalTemplate[]>([
    {
      id: '1',
      name: 'Training Record Template',
      type: 'training-record',
      lastUpdated: new Date('2024-01-15')
    },
    {
      id: '2',
      name: 'Invoice Template',
      type: 'invoice',
      lastUpdated: new Date('2024-01-10')
    },
    {
      id: '3',
      name: 'Safety Report Template',
      type: 'safety-report',
      lastUpdated: new Date('2024-01-08')
    }
  ]);

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const handleTemplateUpload = (templateType: string) => {
    // Mock template upload functionality
    console.log(`Uploading template for type: ${templateType}`);
    // In a real implementation, this would handle file upload
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Monitor className="h-5 w-5 mr-2" />
          Portal & UX
        </h2>
        <p className="text-gray-600">Configure student portal features and user experience settings</p>
      </div>

      {/* Theme & Display */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <Palette className="h-5 w-5 mr-2" />
            Theme & Display
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Theme</label>
              <select
                value={formData.theme}
                onChange={(e) => handleInputChange('theme', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="auto">Auto (System)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date Format</label>
              <select
                value={formData.dateFormat}
                onChange={(e) => handleInputChange('dateFormat', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="dd/MM/yyyy">DD/MM/YYYY</option>
                <option value="MM/dd/yyyy">MM/DD/YYYY</option>
                <option value="yyyy-MM-dd">YYYY-MM-DD</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Time Format</label>
              <select
                value={formData.timeFormat}
                onChange={(e) => handleInputChange('timeFormat', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="24h">24 Hour (14:30)</option>
                <option value="12h">12 Hour (2:30 PM)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Flight Time Decimals</label>
              <select
                value={formData.flightTimeDecimals}
                onChange={(e) => handleInputChange('flightTimeDecimals', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value={1}>1 decimal (1.5 hrs)</option>
                <option value={2}>2 decimals (1.50 hrs)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Student Portal Features */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <Globe className="h-5 w-5 mr-2" />
            Student Portal Features
          </h3>
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="showInvoicesInPortal"
                checked={formData.showInvoicesInPortal}
                onChange={(e) => handleInputChange('showInvoicesInPortal', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="showInvoicesInPortal" className="text-sm text-gray-700">
                Show invoices and billing history
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="showStudyTasksInPortal"
                checked={formData.showStudyTasksInPortal}
                onChange={(e) => handleInputChange('showStudyTasksInPortal', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="showStudyTasksInPortal" className="text-sm text-gray-700">
                Show study tasks and assignments
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="showProgressTracking"
                checked={formData.showProgressTracking}
                onChange={(e) => handleInputChange('showProgressTracking', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="showProgressTracking" className="text-sm text-gray-700">
                Show training progress tracking
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="allowSelfBooking"
                checked={formData.allowSelfBooking}
                onChange={(e) => handleInputChange('allowSelfBooking', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="allowSelfBooking" className="text-sm text-gray-700">
                Allow students to create their own bookings
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="allowBookingCancellation"
                checked={formData.allowBookingCancellation}
                onChange={(e) => handleInputChange('allowBookingCancellation', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="allowBookingCancellation" className="text-sm text-gray-700">
                Allow students to cancel their own bookings
              </label>
            </div>
          </div>
        </div>

        {/* Template Files */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Template Files</h3>
          <div className="space-y-3">
            {templates.map(template => (
              <div key={template.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">{template.name}</h4>
                  <p className="text-xs text-gray-600">
                    Last updated: {template.lastUpdated.toLocaleDateString()}
                  </p>
                </div>
                <div className="flex space-x-2">
                  <button className="flex items-center space-x-1 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors">
                    <Download className="h-4 w-4" />
                    <span>Download</span>
                  </button>
                  {canEdit && (
                    <button
                      onClick={() => handleTemplateUpload(template.type)}
                      className="flex items-center space-x-1 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    >
                      <Upload className="h-4 w-4" />
                      <span>Upload</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};