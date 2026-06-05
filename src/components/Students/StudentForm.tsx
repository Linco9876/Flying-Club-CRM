import React, { useEffect, useState } from 'react';
import { X, User, Phone, Save, Loader2, Shield, FileText } from 'lucide-react';
import { Student, Endorsement } from '../../types';
import toast from 'react-hot-toast';
import { useAircraft } from '../../hooks/useAircraft';

interface StudentFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (student: Omit<Student, 'id'>) => Promise<void>;
  student?: Student;
  isEdit?: boolean;
  canEditEmail?: boolean;
}

const buildFormData = (student?: Student) => ({
  email: student?.email || '',
  name: student?.name || '',
  mobilePhone: student?.mobilePhone || student?.phone || '',
  homePhone: student?.homePhone || '',
  workPhone: student?.workPhone || '',
  address: student?.address || '',
  preferredAircraftId: student?.preferredAircraftId || '',
  raausId: student?.raausId || '',
  casaId: student?.casaId || '',
  dateOfBirth: student?.dateOfBirth?.toISOString().split('T')[0] || '',
  medicalType: student?.medicalType || '',
  medicalExpiry: student?.medicalExpiry?.toISOString().split('T')[0] || '',
  membershipExpiry: student?.licenceExpiry?.toISOString().split('T')[0] || '',
  lastFlightReview: student?.lastFlightReview?.toISOString().split('T')[0] || '',
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
  isEdit = false,
  canEditEmail = true
}) => {
  const [formData, setFormData] = useState(buildFormData(student));
  const { aircraft } = useAircraft();
  const [customEndorsements, setCustomEndorsements] = useState<string[]>([]);
  const [isAddingNewType, setIsAddingNewType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setFormData(buildFormData(student));
  }, [student, isOpen]);

  const [newEndorsement, setNewEndorsement] = useState({
    type: '',
    dateObtained: '',
    expiryDate: '',
    isActive: true
  });

  const defaultEndorsementTypes = [
    'Pilot Certificate',
    'Passenger Carrying',
    'Cross Country',
    'Radio Operator',
    'Manual Pitch Propeller',
    'Retractable Undercarriage',
    'Navigation',
    'Night Flying',
    'Formation Flying',
    'Aerobatics'
  ];

  const allEndorsementTypes = [...defaultEndorsementTypes, ...customEndorsements];

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;

    if (!formData.name || !formData.email) {
      toast.error('Name and email are required');
      return;
    }

    if (formData.email && !/\S+@\S+\.\S+/.test(formData.email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    const studentData: Omit<Student, 'id'> = {
      ...formData,
      role: 'student' as const,
      phone: formData.mobilePhone || undefined,
      mobilePhone: formData.mobilePhone || undefined,
      homePhone: formData.homePhone || undefined,
      workPhone: formData.workPhone || undefined,
      address: formData.address || undefined,
      preferredAircraftId: formData.preferredAircraftId || undefined,
      dateOfBirth: formData.dateOfBirth ? new Date(formData.dateOfBirth) : undefined,
      medicalExpiry: formData.medicalExpiry ? new Date(formData.medicalExpiry) : undefined,
      licenceExpiry: formData.membershipExpiry ? new Date(formData.membershipExpiry) : undefined,
      lastFlightReview: formData.lastFlightReview ? new Date(formData.lastFlightReview) : undefined,
      occupation: formData.occupation || undefined,
      alternatePhone: formData.alternatePhone || undefined,
      emergencyContact: formData.emergencyContact.name ? formData.emergencyContact : undefined
    };

    try {
      setIsSubmitting(true);
      await onSubmit(studentData);
      onClose();
    } catch (error) {
      console.error('Error saving student:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addCustomType = () => {
    if (!newTypeName.trim()) {
      toast.error('Please enter an endorsement name');
      return;
    }

    if (allEndorsementTypes.includes(newTypeName.trim())) {
      toast.error('This endorsement type already exists');
      return;
    }

    setCustomEndorsements(prev => [...prev, newTypeName.trim()]);
    setNewEndorsement(prev => ({ ...prev, type: newTypeName.trim() }));
    setNewTypeName('');
    setIsAddingNewType(false);
    toast.success('Endorsement type added');
  };

  const addEndorsement = () => {
    if (!newEndorsement.type.trim()) {
      toast.error('Please select or enter an endorsement type');
      return;
    }

    if (!newEndorsement.dateObtained) {
      toast.error('Please select a date for the endorsement');
      return;
    }

    const endorsement: Endorsement = {
      id: Date.now().toString(),
      type: newEndorsement.type,
      dateObtained: new Date(newEndorsement.dateObtained),
      expiryDate: newEndorsement.expiryDate ? new Date(newEndorsement.expiryDate) : undefined,
      instructorId: '',
      isActive: true
    };

    setFormData(prev => ({
      ...prev,
      endorsements: [...prev.endorsements, endorsement]
    }));

    setNewEndorsement({
      type: '',
      dateObtained: '',
      expiryDate: '',
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
          {/* Personal Details */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <User className="h-5 w-5 mr-2" />
              Personal Details
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
                  disabled={isEdit && !canEditEmail}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  required
                />
                {isEdit && canEditEmail && (
                  <p className="mt-1 text-xs text-amber-700">
                    Changing this sends a verification link. Login changes after the new email is verified.
                  </p>
                )}
                {isEdit && !canEditEmail && (
                  <p className="mt-1 text-xs text-gray-500">
                    Only admins can change a member's login email.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Birthdate
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
                  Preferred Aircraft
                </label>
                <select
                  value={formData.preferredAircraftId}
                  onChange={(e) => setFormData(prev => ({ ...prev, preferredAircraftId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Use first available aircraft</option>
                  {aircraft.map(a => (
                    <option key={a.id} value={a.id}>{a.registration} - {a.make} {a.model}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Contact Details */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <Phone className="h-5 w-5 mr-2" />
              Contact Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Mobile
                </label>
                <input
                  type="tel"
                  value={formData.mobilePhone}
                  onChange={(e) => setFormData(prev => ({ ...prev, mobilePhone: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="+61 400 123 456"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Home Number
                </label>
                <input
                  type="tel"
                  value={formData.homePhone}
                  onChange={(e) => setFormData(prev => ({ ...prev, homePhone: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Work Number
                </label>
                <input
                  type="tel"
                  value={formData.workPhone}
                  onChange={(e) => setFormData(prev => ({ ...prev, workPhone: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Address
              </label>
              <textarea
                value={formData.address}
                onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                rows={3}
                className="w-full resize-none px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Aviation Details */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              Aviation Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  RAAus Number
                </label>
                <input
                  type="text"
                  value={formData.raausId}
                  onChange={(e) => setFormData(prev => ({ ...prev, raausId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="RAAus membership number"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  RAAus Expiry
                </label>
                <input
                  type="date"
                  value={formData.membershipExpiry}
                  onChange={(e) => setFormData(prev => ({ ...prev, membershipExpiry: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  CASA Number
                </label>
                <input
                  type="text"
                  value={formData.casaId}
                  onChange={(e) => setFormData(prev => ({ ...prev, casaId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="CASA ARN"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Medical Expiry
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
              <Shield className="h-5 w-5 mr-2" />
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

          {/* Endorsements */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Endorsements
            </h3>
            
            {/* Add New Endorsement */}
            <div className="bg-gray-50 p-4 rounded-lg mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Add Endorsement</h4>

              {isAddingNewType ? (
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCustomType()}
                    placeholder="Enter endorsement name"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={addCustomType}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingNewType(false);
                      setNewTypeName('');
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Type</label>
                      <div className="flex gap-1">
                        <select
                          value={newEndorsement.type}
                          onChange={(e) => setNewEndorsement(prev => ({ ...prev, type: e.target.value }))}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select type</option>
                          {allEndorsementTypes.map(type => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setIsAddingNewType(true)}
                          className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors flex-shrink-0"
                          title="Add custom endorsement type"
                        >
                          +
                        </button>
                      </div>
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
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Expiry (Optional)</label>
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
              )}
            </div>

            {/* Current Endorsements */}
            {formData.endorsements.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700">Current Endorsements</h4>
                {formData.endorsements.map(endorsement => (
                  <div key={endorsement.id} className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div>
                      <span className="text-sm font-medium text-blue-900">
                        {endorsement.type}
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
              disabled={isSubmitting}
              className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{isEdit ? 'Updating...' : 'Adding...'}</span>
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <span>{isEdit ? 'Update User' : 'Add User'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
