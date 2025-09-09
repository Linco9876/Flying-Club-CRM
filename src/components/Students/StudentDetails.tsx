import React from 'react';
import { X, User, Mail, Phone, Calendar, FileText, AlertTriangle, Award, Clock } from 'lucide-react';
import { Student } from '../../types';
import { mockTrainingRecords } from '../../data/mockData';

interface StudentDetailsProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student;
}

export const StudentDetails: React.FC<StudentDetailsProps> = ({ isOpen, onClose, student }) => {
  if (!isOpen) return null;

  const trainingRecords = mockTrainingRecords.filter(r => r.studentId === student.id);
  const totalFlightTime = trainingRecords.reduce((sum, record) => sum + record.soloTime + record.dualTime, 0);
  const soloTime = trainingRecords.reduce((sum, record) => sum + record.soloTime, 0);
  const dualTime = trainingRecords.reduce((sum, record) => sum + record.dualTime, 0);

  const endorsementTypes = [
    { value: 'PC', label: 'Pilot Certificate' },
    { value: 'passenger', label: 'Passenger Carrying' },
    { value: 'cross-country', label: 'Cross Country' },
    { value: 'radio', label: 'Radio Operator' },
    { value: 'manual-pitch-prop', label: 'Manual Pitch Propeller' },
    { value: 'retractable-gear', label: 'Retractable Undercarriage' },
    { value: 'navigation', label: 'Navigation' }
  ];

  const getEndorsementLabel = (type: string) => {
    return endorsementTypes.find(e => e.value === type)?.label || type;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Student Details</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* Personal Information */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <User className="h-5 w-5 mr-2" />
              Personal Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{student.name}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{student.email}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{student.phone || 'Not provided'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">
                  {student.dateOfBirth?.toLocaleDateString() || 'Not provided'}
                </p>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">RAAus ID</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{student.raausId || 'Not provided'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Licence Expiry</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">
                  {student.licenceExpiry?.toLocaleDateString() || 'Not provided'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CASA ID</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{student.casaId || 'Not provided'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Medical Certificate Type</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{student.medicalType || 'Not provided'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Medical Certificate Expiry</label>
                <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">
                  {student.medicalExpiry?.toLocaleDateString() || 'Not provided'}
                </p>
              </div>
            </div>
          </div>

          {/* Emergency Contact */}
          {student.emergencyContact && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2" />
                Emergency Contact
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{student.emergencyContact.name}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{student.emergencyContact.phone}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Relationship</label>
                  <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{student.emergencyContact.relationship}</p>
                </div>
              </div>
            </div>
          )}

          {/* Flight Statistics */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <Clock className="h-5 w-5 mr-2" />
              Flight Statistics
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm font-medium text-blue-900">Total Hours</p>
                <p className="text-2xl font-bold text-blue-600">{totalFlightTime.toFixed(1)}</p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-sm font-medium text-green-900">Solo Time</p>
                <p className="text-2xl font-bold text-green-600">{soloTime.toFixed(1)}</p>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <p className="text-sm font-medium text-orange-900">Dual Time</p>
                <p className="text-2xl font-bold text-orange-600">{dualTime.toFixed(1)}</p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <p className="text-sm font-medium text-purple-900">Prepaid Balance</p>
                <p className="text-2xl font-bold text-purple-600">${student.prepaidBalance.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Endorsements */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <Award className="h-5 w-5 mr-2" />
              Active Endorsements
            </h3>
            {student.endorsements.filter(e => e.isActive).length > 0 ? (
              <div className="space-y-2">
                {student.endorsements.filter(e => e.isActive).map(endorsement => (
                  <div key={endorsement.id} className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div>
                      <span className="text-sm font-medium text-blue-900">
                        {getEndorsementLabel(endorsement.type)}
                      </span>
                      <span className="text-xs text-blue-700 ml-2">
                        Obtained: {endorsement.dateObtained ? endorsement.dateObtained.toLocaleDateString() : 'N/A'}
                        {endorsement.expiryDate ? ` | Expires: ${endorsement.expiryDate.toLocaleDateString()}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No active endorsements</p>
            )}
          </div>

          {/* Recent Training Records */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Training Records</h3>
            {trainingRecords.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Lesson
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Grade
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Comments
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {trainingRecords.slice(0, 5).map(record => (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {record.lessonNumber}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {record.lessonDate.toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {record.soloTime > 0 ? `${record.soloTime}h Solo` : `${record.dualTime}h Dual`}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            record.grade === 'C' ? 'bg-green-100 text-green-800' :
                            record.grade === 'S' ? 'bg-yellow-100 text-yellow-800' :
                            record.grade === 'NC' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {record.grade}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                          {record.comments}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No training records found</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};