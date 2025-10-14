import React, { useState, useEffect } from 'react';
import { X, Plane, Save, Upload, Plus, Trash2 } from 'lucide-react';
import { Aircraft } from '../../types';
import toast from 'react-hot-toast';

interface AircraftFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (aircraft: any) => void;
  aircraft?: Aircraft;
  isEdit?: boolean;
}

interface MaintenanceMilestone {
  id: string;
  title: string;
  dueCondition: 'hours' | 'date';
  dueValue: string;
}

interface CostStructure {
  prepaid: number;
  payg: number;
  account: number;
}

export const AircraftForm: React.FC<AircraftFormProps> = ({ 
  isOpen, 
  onClose, 
  onSubmit, 
  aircraft, 
  isEdit = false 
}) => {
  const [formData, setFormData] = useState({
    registration: aircraft?.registration || '',
    make: aircraft?.make || '',
    model: aircraft?.model || '',
    type: aircraft?.type || 'single-engine' as const,
    tachStart: aircraft?.totalHours || 0,
    fuelCapacity: 0,
    emptyWeight: 0,
    maxWeight: 0,
    seatCapacity: 2,
    status: aircraft?.status || 'serviceable' as const,
    totalHours: aircraft?.totalHours || 0
  });

  const [costStructure, setCostStructure] = useState<{
    aircraft: CostStructure;
    instructor: CostStructure;
  }>({
    aircraft: {
      prepaid: aircraft?.hourlyRate || 0,
      payg: aircraft?.hourlyRate ? parseFloat((aircraft.hourlyRate * 1.1).toFixed(2)) : 0,
      account: aircraft?.hourlyRate || 0
    },
    instructor: {
      prepaid: 85,
      payg: 95,
      account: 85
    }
  });

  const [maintenanceMilestones, setMaintenanceMilestones] = useState<MaintenanceMilestone[]>([]);
  const [newMilestone, setNewMilestone] = useState({
    title: '',
    dueCondition: 'hours' as const,
    dueValue: ''
  });

  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  useEffect(() => {
    if (aircraft && isEdit) {
      setFormData({
        registration: aircraft.registration,
        make: aircraft.make,
        model: aircraft.model,
        type: aircraft.type,
        tachStart: aircraft.tachStart || aircraft.totalHours || 0,
        fuelCapacity: aircraft.fuelCapacity || 0,
        emptyWeight: aircraft.emptyWeight || 0,
        maxWeight: aircraft.maxWeight || 0,
        seatCapacity: aircraft.seatCapacity || 2,
        status: aircraft.status,
        totalHours: aircraft.totalHours || 0
      });
      setCostStructure({
        aircraft: {
          prepaid: aircraft.hourlyRate || 0,
          payg: aircraft.hourlyRate ? parseFloat((aircraft.hourlyRate * 1.1).toFixed(2)) : 0,
          account: aircraft.hourlyRate || 0
        },
        instructor: {
          prepaid: 85,
          payg: 95,
          account: 85
        }
      });
    }
  }, [aircraft, isEdit]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!formData.registration || !formData.make || !formData.model) {
      toast.error('Registration, Make, and Model are required');
      return;
    }

    // Validate registration format
    const registrationRegex = /^[A-Z0-9-]{3,10}$/;
    if (!registrationRegex.test(formData.registration)) {
      toast.error('Registration must be 3-10 characters using letters, numbers, and hyphens');
      return;
    }

    const aircraftData = {
      registration: formData.registration,
      make: formData.make,
      model: formData.model,
      type: formData.type,
      status: formData.status,
      totalHours: formData.totalHours,
      hourlyRate: costStructure.aircraft.prepaid,
      seatCapacity: formData.seatCapacity,
      fuelCapacity: formData.fuelCapacity,
      emptyWeight: formData.emptyWeight,
      maxWeight: formData.maxWeight,
      tachStart: formData.tachStart,
      lastMaintenance: aircraft?.lastMaintenance,
      nextMaintenance: aircraft?.nextMaintenance,
      aircraftRates: {
        prepaid: costStructure.aircraft.prepaid,
        payg: costStructure.aircraft.payg,
        account: costStructure.aircraft.account
      },
      instructorRates: {
        prepaid: costStructure.instructor.prepaid,
        payg: costStructure.instructor.payg,
        account: costStructure.instructor.account
      },
      milestones: maintenanceMilestones.map(m => ({
        title: m.title,
        dueCondition: m.dueCondition,
        dueValue: m.dueValue
      })),
      documents: uploadedFiles.map(f => ({
        name: f.name,
        type: f.type,
        size: f.size
      }))
    };

    onSubmit(aircraftData);
    toast.success(isEdit ? 'Aircraft updated successfully!' : 'Aircraft added successfully!');
    onClose();
  };

  const addMilestone = () => {
    if (!newMilestone.title || !newMilestone.dueValue) {
      toast.error('Please fill in milestone title and due value');
      return;
    }

    const milestone: MaintenanceMilestone = {
      id: Date.now().toString(),
      ...newMilestone
    };

    setMaintenanceMilestones(prev => [...prev, milestone]);
    setNewMilestone({ title: '', dueCondition: 'hours', dueValue: '' });
    toast.success('Maintenance milestone added');
  };

  const removeMilestone = (milestoneId: string) => {
    setMaintenanceMilestones(prev => prev.filter(m => m.id !== milestoneId));
    toast.success('Maintenance milestone removed');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadedFiles(prev => [...prev, ...files]);
    toast.success(`${files.length} file(s) uploaded`);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEdit ? 'Edit Aircraft' : 'Add New Aircraft'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {/* Basic Information */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <Plane className="h-5 w-5 mr-2" />
              Basic Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Registration *
                </label>
                <div className="space-y-1">
                <input
                  type="text"
                  value={formData.registration}
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase();
                    setFormData(prev => ({ ...prev, registration: value }));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="VH-ABC or 24-4851"
                  pattern="[A-Z0-9-]{3,10}"
                  required
                />
                  <p className="text-xs text-gray-500">
                    Format: VH-ABC (Australian) or 24-4851 (Competition number)
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Make *
                </label>
                <input
                  type="text"
                  value={formData.make}
                  onChange={(e) => setFormData(prev => ({ ...prev, make: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Cessna"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Model *
                </label>
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="172"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Aircraft Type
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as any }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="single-engine">Single Engine</option>
                  <option value="multi-engine">Multi Engine</option>
                  <option value="helicopter">Helicopter</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tach Start
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.tachStart}
                  onChange={(e) => setFormData(prev => ({ ...prev, tachStart: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Seat Capacity
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={formData.seatCapacity}
                  onChange={(e) => setFormData(prev => ({ ...prev, seatCapacity: parseInt(e.target.value) || 2 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Specifications */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Specifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Fuel Capacity (L)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.fuelCapacity}
                  onChange={(e) => setFormData(prev => ({ ...prev, fuelCapacity: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Empty Weight (kg)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.emptyWeight}
                  onChange={(e) => setFormData(prev => ({ ...prev, emptyWeight: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Weight (kg)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.maxWeight}
                  onChange={(e) => setFormData(prev => ({ ...prev, maxWeight: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Cost Structure */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Cost Structure</h3>
            <div className="space-y-4">
              <div>
                <h4 className="text-md font-medium text-gray-800 mb-3">Aircraft Hourly Rates</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Prepaid ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={costStructure.aircraft.prepaid}
                      onChange={(e) => setCostStructure(prev => ({
                        ...prev,
                        aircraft: { ...prev.aircraft, prepaid: parseFloat(e.target.value) || 0 }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Pay As You Go ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={costStructure.aircraft.payg}
                      onChange={(e) => setCostStructure(prev => ({
                        ...prev,
                        aircraft: { ...prev.aircraft, payg: parseFloat(e.target.value) || 0 }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Account ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={costStructure.aircraft.account}
                      onChange={(e) => setCostStructure(prev => ({
                        ...prev,
                        aircraft: { ...prev.aircraft, account: parseFloat(e.target.value) || 0 }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-md font-medium text-gray-800 mb-3">Instructor Hourly Rates</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Prepaid ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={costStructure.instructor.prepaid}
                      onChange={(e) => setCostStructure(prev => ({
                        ...prev,
                        instructor: { ...prev.instructor, prepaid: parseFloat(e.target.value) || 0 }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Pay As You Go ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={costStructure.instructor.payg}
                      onChange={(e) => setCostStructure(prev => ({
                        ...prev,
                        instructor: { ...prev.instructor, payg: parseFloat(e.target.value) || 0 }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Account ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={costStructure.instructor.account}
                      onChange={(e) => setCostStructure(prev => ({
                        ...prev,
                        instructor: { ...prev.instructor, account: parseFloat(e.target.value) || 0 }
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Maintenance Milestones */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Maintenance Milestones</h3>
            
            {/* Add New Milestone */}
            <div className="bg-gray-50 p-4 rounded-lg mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Add Milestone</h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <input
                    type="text"
                    value={newMilestone.title}
                    onChange={(e) => setNewMilestone(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Milestone title (e.g., 100 hourly, hose replacement)"
                  />
                </div>
                <div>
                  <select
                    value={newMilestone.dueCondition}
                    onChange={(e) => setNewMilestone(prev => ({ ...prev, dueCondition: e.target.value as any }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="hours">Hours</option>
                    <option value="date">Date</option>
                  </select>
                </div>
                <div className="flex space-x-2">
                  <input
                    type={newMilestone.dueCondition === 'date' ? 'date' : 'number'}
                    value={newMilestone.dueValue}
                    onChange={(e) => setNewMilestone(prev => ({ ...prev, dueValue: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={newMilestone.dueCondition === 'hours' ? 'Hours' : ''}
                  />
                  <button
                    type="button"
                    onClick={addMilestone}
                    className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Current Milestones */}
            {maintenanceMilestones.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700">Current Milestones</h4>
                {maintenanceMilestones.map(milestone => (
                  <div key={milestone.id} className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div>
                      <span className="text-sm font-medium text-blue-900">{milestone.title}</span>
                      <span className="text-xs text-blue-700 ml-2">
                        Due: {milestone.dueCondition === 'hours' ? `${milestone.dueValue} hours` : milestone.dueValue}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMilestone(milestone.id)}
                      className="text-red-600 hover:text-red-800 p-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Document Upload */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Documents</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Upload Documents (POH, Insurance, Maintenance Logs, etc.)
                </label>
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-8 h-8 mb-4 text-gray-500" />
                      <p className="mb-2 text-sm text-gray-500">
                        <span className="font-semibold">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-gray-500">PDF, DOC, DOCX, JPG, PNG (MAX. 10MB)</p>
                    </div>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Uploaded Files */}
              {uploadedFiles.length > 0 && (
                <div className="space-y-2">
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
          </div>

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
              className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Save className="h-4 w-4" />
              <span>{isEdit ? 'Update Aircraft' : 'Add Aircraft'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};