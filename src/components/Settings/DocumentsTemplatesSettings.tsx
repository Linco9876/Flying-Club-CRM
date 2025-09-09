import React, { useState } from 'react';
import { FileText, Upload, Download, Palette } from 'lucide-react';

interface DocumentsTemplatesSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const DocumentsTemplatesSettings: React.FC<DocumentsTemplatesSettingsProps> = ({ canEdit, onFormChange }) => {
  const [formData, setFormData] = useState({
    headerText: 'AeroClub Pro - Flight Training',
    footerText: 'Confidential Training Record',
    primaryColor: '#2563eb',
    secondaryColor: '#64748b',
    logoPosition: 'top-left',
    includeWatermark: false,
    watermarkText: 'TRAINING RECORD'
  });

  const [templates, setTemplates] = useState([
    { id: '1', name: 'Training Record PDF', type: 'training-record', lastUpdated: new Date('2024-01-15') },
    { id: '2', name: 'Invoice Template', type: 'invoice', lastUpdated: new Date('2024-01-10') },
    { id: '3', name: 'Safety Report Template', type: 'safety-report', lastUpdated: new Date('2024-01-05') },
    { id: '4', name: 'Student Certificate', type: 'certificate', lastUpdated: new Date('2023-12-20') }
  ]);

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const handleTemplateUpload = (templateType: string) => {
    // Mock template upload
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.docx,.html';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        setTemplates(prev => prev.map(template =>
          template.type === templateType
            ? { ...template, lastUpdated: new Date() }
            : template
        ));
        onFormChange();
      }
    };
    input.click();
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <FileText className="h-5 w-5 mr-2" />
          Documents & Templates
        </h2>
        <p className="text-gray-600">Configure document templates and branding</p>
      </div>

      {/* Branding */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <Palette className="h-5 w-5 mr-2" />
            Document Branding
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Header Text</label>
              <input
                type="text"
                value={formData.headerText}
                onChange={(e) => handleInputChange('headerText', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Footer Text</label>
              <input
                type="text"
                value={formData.footerText}
                onChange={(e) => handleInputChange('footerText', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Primary Color</label>
              <div className="flex space-x-2">
                <input
                  type="color"
                  value={formData.primaryColor}
                  onChange={(e) => handleInputChange('primaryColor', e.target.value)}
                  disabled={!canEdit}
                  className="w-12 h-10 border border-gray-300 rounded-md disabled:opacity-50"
                />
                <input
                  type="text"
                  value={formData.primaryColor}
                  onChange={(e) => handleInputChange('primaryColor', e.target.value)}
                  disabled={!canEdit}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Secondary Color</label>
              <div className="flex space-x-2">
                <input
                  type="color"
                  value={formData.secondaryColor}
                  onChange={(e) => handleInputChange('secondaryColor', e.target.value)}
                  disabled={!canEdit}
                  className="w-12 h-10 border border-gray-300 rounded-md disabled:opacity-50"
                />
                <input
                  type="text"
                  value={formData.secondaryColor}
                  onChange={(e) => handleInputChange('secondaryColor', e.target.value)}
                  disabled={!canEdit}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Logo Position</label>
              <select
                value={formData.logoPosition}
                onChange={(e) => handleInputChange('logoPosition', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="top-left">Top Left</option>
                <option value="top-center">Top Center</option>
                <option value="top-right">Top Right</option>
              </select>
            </div>

            <div className="flex items-center space-x-3 pt-8">
              <input
                type="checkbox"
                id="includeWatermark"
                checked={formData.includeWatermark}
                onChange={(e) => handleInputChange('includeWatermark', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="includeWatermark" className="text-sm text-gray-700">
                Include watermark on documents
              </label>
            </div>

            {formData.includeWatermark && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Watermark Text</label>
                <input
                  type="text"
                  value={formData.watermarkText}
                  onChange={(e) => handleInputChange('watermarkText', e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              </div>
            )}
          </div>
        </div>

        {/* Template Management */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Template Management</h3>
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