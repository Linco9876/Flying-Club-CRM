import React, { useEffect, useState } from 'react';
import { X, User, Mail, Phone, Calendar, FileText, AlertTriangle, Save } from 'lucide-react';
import { Student, Endorsement } from '../../types';
import toast from 'react-hot-toast';

interface StudentFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (student: Omit<Student, 'id'>) => void;
  student?: Student;
  isEdit?: boolean;
}

const buildFormData = (student?: Student) => ({
  email: student?.email || '',
  name: student?.name || '',
  phone: student?.phone || '',
  raausId: student?.raausId || '',
  casaId: student?.casaId || '',
  dateOfBirth: student?.dateOfBirth?.toISOString().split('T')[0] || '',
  medicalType: student?.medicalType || '',
  medicalExpiry: student?.medicalExpiry?.toISOString().split('T')[0] || '',
  membershipExpiry: student?.licenceExpiry?.toISOString().split('T')[0] || '',
  occupation: student?.occupation || '',
  alternatePhone: student?.alternatePhone || '',
  prepaidBalance: student?.prepaidBalance || 0,
  emergencyContact: {
    name: student?.emergencyContact?.name || '',
    phone: student?.emergencyContact?.phone || '',
    relationship: student?.emergencyContact?.relationship || ''
  },
  endorsements: student?.endorsements || []
});

export const StudentForm: React.FC<StudentFormProps> = ({
  isOpen,
  onClose,
  onSubmit,
  student,
  isEdit = false
}) => {
  const [formData, setFormData] = useState(buildFormData(student));

  useEffect(() => {
    if (!isOpen) return;
    setFormData(buildFormData(student));
  }, [student, isOpen]);

  const [newEndorsement, setNewEndorsement] = useState({
    type: 'PC' as const,
    dateObtained: '',
    expiryDate: '',
    instructorId: '2', // Default to CFI
    isActive: true
  });

  const endorsementTypes = [
    { value: 'PC', label: 'Pilot Certificate' },
    { value: 'passenger', label: 'Passenger Carrying' },
    { value: 'cross-country', label: 'Cross Country' },
    { value: 'radio', label: 'Radio Operator' },
    { value: 'manual-pitch-prop', label: 'Manual Pitch Propeller' },
    { value: 'retractable-gear', label: 'Retractable Undercarriage' },
    { value: 'navigation', label: 'Navigation' }
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!formData.name || !formData.email) {
      toast.error('Name and email are required');
      return;
    }

    // Conditional validation for RAAus membership expiry
    if (formData.raausId && !formData.membershipExpiry) {
      toast.error('Membership expiry is required when RAAus ID is provided');
      return;
    }

    if (formData.email && !/\S+@\S+\.\S+/.test(formData.email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    const studentData: Omit<Student, 'id'> = {
      ...formData,
      role: 'student' as const,
      dateOfBirth: formData.dateOfBirth ? new Date(formData.dateOfBirth) : undefined,
      medicalExpiry: formData.medicalExpiry ? new Date(formData.medicalExpiry) : undefined,
      licenceExpiry: formData.membershipExpiry ? new Date(formData.membershipExpiry) : undefined,
      occupation: formData.occupation || undefined,
      alternatePhone: formData.alternatePhone || undefined,
      emergencyContact: formData.emergencyContact.name ? formData.emergencyContact : undefined
    };

    onSubmit(studentData);
    toast.success(isEdit ? 'Student updated successfully!' : 'Student added successfully!');
    onClose();
  };

  const addEndorsement = () => {
    if (!newEndorsement.dateObtained) {
      toast.error('Please select a date for the endorsement');
      return;
    }

    const endorsement: Endorsement = {
      id: Date.now().toString(),
      ...newEndorsement,
      dateObtained: new Date(newEndorsement.dateObtained),
      expiryDate: newEndorsement.expiryDate ? new Date(newEndorsement.expiryDate) : undefined
    };

    setFormData(prev => ({
      ...prev,
      endorsements: [...prev.endorsements, endorsement]
    }));

    setNewEndorsement({
      type: 'PC',
      dateObtained: '',
      expiryDate: '',
      instructorId: '2',
      isActive: true
    });

    toast.success('Endorsement added');
  };

  const removeEndorsement = (endorsementId: string) => {
    setFormData(prev => ({
      ...prev,
      endorsements: prev.endorsements.filter(e => e.id !== endorsementId)
    }));
    toast.success('Endorsement removed');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEdit ? 'Edit Student' : 'Add New Student'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {/* Personal Information */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <User className="h-5 w-5 mr-2" />
              Personal Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="+61 400 123 456"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Alternate Contact Number
                </label>
                <input
                  type="tel"
                  value={formData.alternatePhone}
                  onChange={(e) => setFormData(prev => ({ ...prev, alternatePhone: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="+61 400 123 456"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={(e) => setFormData(prev => ({ ...prev, dateOfBirth: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Occupation
                </label>
                <input
                  type="text"
                  value={formData.occupation}
                  onChange={(e) => setFormData(prev => ({ ...prev, occupation: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Engineer, Teacher"
                />
              </div>
            </div>
          </div>

          {/* Aviation Credentials */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              Aviation Credentials
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  RAAus ID
                </label>
                <input
                  type="text"
                  value={formData.raausId}
                  onChange={(e) => setFormData(prev => ({ ...prev, raausId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="RA12345"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Membership Expiry
                </label>
                <input
                  type="date"
                  value={formData.membershipExpiry}
                  onChange={(e) => setFormData(prev => ({ ...prev, membershipExpiry: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={!!formData.raausId}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  CASA ID
                </label>
                <input
                  type="text"
                  value={formData.casaId}
                  onChange={(e) => setFormData(prev => ({ ...prev, casaId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="CASA123456"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Medical Certificate Type
                </label>
                <select
                  value={formData.medicalType}
                  onChange={(e) => setFormData(prev => ({ ...prev, medicalType: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select medical type</option>
                  <option value="Class 1">Class 1</option>
                  <option value="Class 2">Class 2</option>
                  <option value="Basic Class 2">Basic Class 2</option>
                  <option value="Recreational">Recreational</option>
                  <option value="Student Pilot">Student Pilot</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Medical Certificate Expiry
                </label>
                <input
                  type="date"
                  value={formData.medicalExpiry}
                  onChange={(e) => setFormData(prev => ({ ...prev, medicalExpiry: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Emergency Contact */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Emergency Contact
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contact Name
                </label>
                <input
                  type="text"
                  value={formData.emergencyContact.name}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    emergencyContact: { ...prev.emergencyContact, name: e.target.value }
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contact Phone
                </label>
                <input
                  type="tel"
                  value={formData.emergencyContact.phone}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    emergencyContact: { ...prev.emergencyContact, phone: e.target.value }
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Relationship
                </label>
                <select
                  value={formData.emergencyContact.relationship}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    emergencyContact: { ...prev.emergencyContact, relationship: e.target.value }
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select relationship</option>
                  <option value="Spouse">Spouse</option>
                  <option value="Parent">Parent</option>
                  <option value="Child">Child</option>
                  <option value="Sibling">Sibling</option>
                  <option value="Friend">Friend</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* Financial Information */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Financial Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Initial Prepaid Balance
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.prepaidBalance}
                    onChange={(e) => setFormData(prev => ({ ...prev, prepaidBalance: parseFloat(e.target.value) || 0 }))}
                    className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Endorsements */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Endorsements
            </h3>
            
            {/* Add New Endorsement */}
            <div className="bg-gray-50 p-4 rounded-lg mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Add Endorsement</h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Type</label>
                  <select
                    value={newEndorsement.type}
                    onChange={(e) => setNewEndorsement(prev => ({ ...prev, type: e.target.value as any }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {endorsementTypes.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Obtained</label>
                  <input
                    type="date"
                    value={newEndorsement.dateObtained}
                    onChange={(e) => setNewEndorsement(prev => ({ ...prev, dateObtained: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Expiry</label>
                  <input
                    type="date"
                    value={newEndorsement.expiryDate}
                    onChange={(e) => setNewEndorsement(prev => ({ ...prev, expiryDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={addEndorsement}
                    className="w-full px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Current Endorsements */}
            {formData.endorsements.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700">Current Endorsements</h4>
                {formData.endorsements.map(endorsement => (
                  <div key={endorsement.id} className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div>
                      <span className="text-sm font-medium text-blue-900">
                        {endorsementTypes.find(t => t.value === endorsement.type)?.label}
                      </span>
                      <span className="text-xs text-blue-700 ml-2">
                        Obtained: {endorsement.dateObtained.toLocaleDateString()}
                        {endorsement.expiryDate && ` | Expires: ${endorsement.expiryDate.toLocaleDateString()}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeEndorsement(endorsement.id)}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
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
              <span>{isEdit ? 'Update Student' : 'Add Student'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};