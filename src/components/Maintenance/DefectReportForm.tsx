import React, { useState } from 'react';
import { X, AlertTriangle, Camera, Upload, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAircraft } from '../../hooks/useAircraft';
import { Defect } from '../../types';
import toast from 'react-hot-toast';

interface DefectReportFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (defectData: Omit<Defect, 'id'>) => Promise<void>;
  preSelectedAircraftId?: string;
}

export const DefectReportForm: React.FC<DefectReportFormProps> = ({
  isOpen,
  onClose,
  onSubmit,
  preSelectedAircraftId
}) => {
  const { user } = useAuth();
  const { aircraft, loading } = useAircraft();
  const [formData, setFormData] = useState({
    aircraftId: preSelectedAircraftId || '',
    discoveredDateTime: new Date().toISOString().slice(0, 16), // YYYY-MM-DDTHH:mm format
    reporter: user?.name || '',
    location: '',
    defectSummary: '',
    detailedDescription: '',
    severity: 'Minor' as 'Minor' | 'Major' | 'Critical',
    melNotes: '',
    groundAircraft: false,
    tachHours: '',
    hobbsHours: ''
  });

  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!formData.aircraftId || !formData.defectSummary || !formData.detailedDescription) {
      toast.error('Aircraft, defect summary, and detailed description are required');
      return;
    }

    const parseOptionalNumber = (value: string) => {
      if (!value) return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const defectData: Omit<Defect, 'id'> = {
      aircraftId: formData.aircraftId,
      reportedBy: formData.reporter,
      dateReported: new Date(formData.discoveredDateTime),
      description: formData.detailedDescription,
      status: 'open',
      photos: uploadedFiles.map(file => file.name), // In real app, would upload files first
      melNotes: formData.melNotes || undefined,
      severity: formData.severity,
      location: formData.location.trim() || undefined,
      tachHours: parseOptionalNumber(formData.tachHours),
      hobbsHours: parseOptionalNumber(formData.hobbsHours)
    };

    try {
      await onSubmit(defectData);
    } catch (error) {
      console.error('Error submitting defect report:', error);
      toast.error('Failed to create defect report');
      return;
    }

    if (formData.groundAircraft) {
      toast.success('Defect reported and aircraft grounded successfully!');
    } else {
      toast.success('Defect reported successfully!');
    }
    
    onClose();

    // Reset form
    setFormData({
      aircraftId: preSelectedAircraftId || '',
      discoveredDateTime: new Date().toISOString().slice(0, 16),
      reporter: user?.name || '',
      location: '',
      defectSummary: '',
      detailedDescription: '',
      severity: 'Minor',
      melNotes: '',
      groundAircraft: false,
      tachHours: '',
      hobbsHours: ''
    });
    setUploadedFiles([]);
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
      case 'Critical':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'Major':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'Minor':
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
                value={formData.reporter}
                onChange={(e) => setFormData(prev => ({ ...prev, reporter: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Location (Optional)
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Hangar 2, Ramp, Runway"
              />
            </div>
          </div>

          {/* Defect Summary */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Defect Summary *
            </label>
            <input
              type="text"
              value={formData.defectSummary}
              onChange={(e) => setFormData(prev => ({ ...prev, defectSummary: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Brief description of the defect"
              required
            />
          </div>

          {/* Detailed Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Detailed Description *
            </label>
            <textarea
              value={formData.detailedDescription}
              onChange={(e) => setFormData(prev => ({ ...prev, detailedDescription: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
              placeholder="Detailed description of the defect, circumstances, and any relevant information"
              required
            />
          </div>

          {/* Severity and Ground Aircraft */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Severity *
              </label>
              <select
                value={formData.severity}
                onChange={(e) => setFormData(prev => ({ ...prev, severity: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Minor">Minor</option>
                <option value="Major">Major</option>
                <option value="Critical">Critical</option>
              </select>
              <div className="mt-2">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full border ${getSeverityColor(formData.severity)}`}>
                  {formData.severity}
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
                <label htmlFor="groundAircraft" className="text-sm text-gray-700">
                  Ground aircraft (mark as unserviceable)
                </label>
              </div>
              {formData.groundAircraft && (
                <p className="text-xs text-red-600 mt-1">
                  ⚠️ Aircraft will be marked unserviceable and bookings will be blocked
                </p>
              )}
            </div>
          </div>

          {/* Tach/Hobbs Hours */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tach Hours (Optional)
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.tachHours}
                onChange={(e) => setFormData(prev => ({ ...prev, tachHours: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Hobbs Hours (Optional)
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.hobbsHours}
                onChange={(e) => setFormData(prev => ({ ...prev, hobbsHours: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.0"
              />
            </div>
          </div>

          {/* MEL Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              MEL/Notes (Optional)
            </label>
            <textarea
              value={formData.melNotes}
              onChange={(e) => setFormData(prev => ({ ...prev, melNotes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Minimum Equipment List notes or additional information"
            />
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
              className="flex items-center space-x-2 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <Save className="h-4 w-4" />
              <span>Report Defect</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};