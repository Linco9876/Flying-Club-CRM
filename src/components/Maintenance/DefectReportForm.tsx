import React, { useState } from 'react';
import { X, AlertTriangle, Camera, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAircraft } from '../../hooks/useAircraft';
import { useDefectReports, DefectReport } from '../../hooks/useDefectReports';
import toast from 'react-hot-toast';

interface DefectReportFormProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  preSelectedAircraftId?: string;
}

export const DefectReportForm: React.FC<DefectReportFormProps> = ({
  isOpen,
  onClose,
  onRefresh,
  preSelectedAircraftId
}) => {
  const { user } = useAuth();
  const { aircraft, loading } = useAircraft();
  const { createDefectReport } = useDefectReports();
  const isAdmin = user?.role === 'admin';
  const [formData, setFormData] = useState({
    aircraftId: preSelectedAircraftId || '',
    discoveredDateTime: new Date().toISOString().slice(0, 16),
    reporterId: user?.id || '',
    location: '',
    briefSummary: '',
    detailedSummary: '',
    severity: 'minor' as 'minor' | 'major' | 'critical',
    groundAircraft: false,
    engineHours: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.aircraftId || !formData.location || !formData.briefSummary || !formData.detailedSummary) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (formData.briefSummary.length > 50) {
      toast.error('Brief summary must be 50 characters or less');
      return;
    }

    if (formData.detailedSummary.length > 500) {
      toast.error('Detailed summary must be 500 characters or less');
      return;
    }

    if (uploadedFiles.some(f => f.size > 10485760)) {
      toast.error('File size must not exceed 10MB');
      return;
    }

    if (formData.groundAircraft) {
      const confirmed = window.confirm(
        'Are you sure you want to ground this aircraft? This will:\n' +
        '- Mark the aircraft as unserviceable\n' +
        '- Block all future bookings\n' +
        '- Notify affected pilots and instructors\n\n' +
        'This action requires approval to reverse.'
      );
      if (!confirmed) return;
    }

    try {
      setIsSubmitting(true);
      await createDefectReport({
        aircraftId: formData.aircraftId,
        reporterId: formData.reporterId,
        discoveryDate: new Date(formData.discoveredDateTime),
        location: formData.location,
        briefSummary: formData.briefSummary,
        detailedSummary: formData.detailedSummary,
        severity: formData.severity,
        isUnserviceable: formData.groundAircraft,
        engineHours: formData.engineHours ? parseFloat(formData.engineHours) : undefined,
        status: 'open'
      });

      if (formData.groundAircraft) {
        toast.success('Defect reported and aircraft grounded successfully');
      } else {
        toast.success('Defect reported successfully');
      }

      onRefresh?.();
      onClose();

      setFormData({
        aircraftId: preSelectedAircraftId || '',
        discoveredDateTime: new Date().toISOString().slice(0, 16),
        reporterId: user?.id || '',
        location: '',
        briefSummary: '',
        detailedSummary: '',
        severity: 'minor',
        groundAircraft: false,
        engineHours: ''
      });
      setUploadedFiles([]);
    } catch (error) {
      console.error('Error submitting defect report:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadedFiles(prev => [...prev, ...files]);
    toast.success(`${files.length} file(s) uploaded`);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'major':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'minor':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (!isOpen) return null;

  const selectedAircraft = aircraft.find(a => a.id === formData.aircraftId);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2 text-red-600" />
            Report Defect
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Aircraft Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Aircraft *
              </label>
              <select
                value={formData.aircraftId}
                onChange={(e) => setFormData(prev => ({ ...prev, aircraftId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                disabled={!!preSelectedAircraftId || loading}
              >
                <option value="">
                  {loading ? 'Loading aircraft...' : aircraft.length === 0 ? 'No aircraft available' : 'Select aircraft'}
                </option>
                {aircraft.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.registration} - {a.make} {a.model}
                  </option>
                ))}
              </select>
              {aircraft.length === 0 && !loading && (
                <p className="text-xs text-red-600 mt-1">
                  No aircraft found. Please add aircraft first.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Discovered Date/Time *
              </label>
              <input
                type="datetime-local"
                value={formData.discoveredDateTime}
                onChange={(e) => setFormData(prev => ({ ...prev, discoveredDateTime: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {/* Reporter and Location */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reporter *
              </label>
              <input
                type="text"
                value={user?.name || ''}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={!isAdmin}
                readOnly={!isAdmin}
                required
              />
              {!isAdmin && (
                <p className="text-xs text-gray-500 mt-1">
                  Only admins can modify the reporter field
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Location of Discovery *
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Hangar 2, Ramp, Runway"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Brief Summary * <span className="text-gray-500 text-xs">(max 50 characters)</span>
            </label>
            <input
              type="text"
              value={formData.briefSummary}
              onChange={(e) => setFormData(prev => ({ ...prev, briefSummary: e.target.value }))}
              maxLength={50}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Brief description of the defect"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              {formData.briefSummary.length}/50 characters
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Detailed Summary * <span className="text-gray-500 text-xs">(max 500 characters)</span>
            </label>
            <textarea
              value={formData.detailedSummary}
              onChange={(e) => setFormData(prev => ({ ...prev, detailedSummary: e.target.value }))}
              maxLength={500}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
              placeholder="Detailed description of the defect, circumstances, and any relevant information"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              {formData.detailedSummary.length}/500 characters
            </p>
          </div>

          {/* Severity and Ground Aircraft */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Severity *
              </label>
              <div className="space-y-2">
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    value="minor"
                    checked={formData.severity === 'minor'}
                    onChange={(e) => setFormData(prev => ({ ...prev, severity: e.target.value as any }))}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm">Minor</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    value="major"
                    checked={formData.severity === 'major'}
                    onChange={(e) => setFormData(prev => ({ ...prev, severity: e.target.value as any }))}
                    className="h-4 w-4 text-orange-600 focus:ring-orange-500"
                  />
                  <span className="text-sm">Major</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    value="critical"
                    checked={formData.severity === 'critical'}
                    onChange={(e) => setFormData(prev => ({ ...prev, severity: e.target.value as any }))}
                    className="h-4 w-4 text-red-600 focus:ring-red-500"
                  />
                  <span className="text-sm">Critical</span>
                </label>
              </div>
              <div className="mt-2">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full border ${getSeverityColor(formData.severity)}`}>
                  {formData.severity.charAt(0).toUpperCase() + formData.severity.slice(1)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Aircraft Status
              </label>
              <div className="flex items-center space-x-3 mt-3">
                <input
                  type="checkbox"
                  id="groundAircraft"
                  checked={formData.groundAircraft}
                  onChange={(e) => setFormData(prev => ({ ...prev, groundAircraft: e.target.checked }))}
                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                />
                <label htmlFor="groundAircraft" className="text-sm font-medium text-gray-700">
                  Mark as Unserviceable (Ground Aircraft)
                </label>
              </div>
              {formData.groundAircraft && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-xs text-red-700 font-medium">
                    Warning: This will immediately:
                  </p>
                  <ul className="text-xs text-red-600 mt-1 ml-4 list-disc space-y-1">
                    <li>Remove aircraft from calendar</li>
                    <li>Block all future bookings</li>
                    <li>Create conflicts for existing bookings</li>
                    <li>Send notifications to affected users</li>
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Engine Hours at Discovery
            </label>
            <input
              type="number"
              step="0.1"
              value={formData.engineHours}
              onChange={(e) => setFormData(prev => ({ ...prev, engineHours: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0.0"
            />
            <p className="text-xs text-gray-500 mt-1">
              Record the engine hours (tach or hobbs) when defect was discovered
            </p>
          </div>

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Attach Photos/Files
            </label>
            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Camera className="w-8 h-8 mb-4 text-gray-500" />
                  <p className="mb-2 text-sm text-gray-500">
                    <span className="font-semibold">Click to upload</span> photos or documents
                  </p>
                  <p className="text-xs text-gray-500">JPG, PNG, PDF (MAX. 10MB each)</p>
                </div>
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Uploaded Files */}
            {uploadedFiles.length > 0 && (
              <div className="mt-4 space-y-2">
                <h4 className="text-sm font-medium text-gray-700">Uploaded Files</h4>
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-700">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="text-red-600 hover:text-red-800 p-1"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit Buttons */}
          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center space-x-2 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4" />
              <span>{isSubmitting ? 'Submitting...' : 'Report Defect'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};