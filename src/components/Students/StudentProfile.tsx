import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { mockStudents, mockTrainingRecords } from '../../data/mockData';
import { 
  User, 
  Phone, 
  Mail, 
  Calendar, 
  Award,
  Clock,
  FileText,
  Edit,
  Save,
  X
} from 'lucide-react';

export const StudentProfile: React.FC = () => {
  const { user } = useAuth();
  const [editMode, setEditMode] = useState(false);
  
  const student = mockStudents.find(s => s.id === user?.id);
  const trainingRecords = mockTrainingRecords.filter(r => r.studentId === user?.id);

  if (!student) {
    return <div className="p-6">Student profile not found</div>;
  }

  const totalFlightTime = trainingRecords.reduce((sum, record) => sum + record.soloTime + record.dualTime, 0);
  const soloTime = trainingRecords.reduce((sum, record) => sum + record.soloTime, 0);
  const dualTime = trainingRecords.reduce((sum, record) => sum + record.dualTime, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <button
          onClick={() => setEditMode(!editMode)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {editMode ? <X className="h-4 w-4" /> : <Edit className="h-4 w-4" />}
          <span>{editMode ? 'Cancel' : 'Edit Profile'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Personal Information */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Personal Information</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <User className="h-4 w-4 inline mr-2" />
                Full Name
              </label>
              <input
                type="text"
                value={student.name}
                disabled={!editMode}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Mail className="h-4 w-4 inline mr-2" />
                Email
              </label>
              <input
                type="email"
                value={student.email}
                disabled={!editMode}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Phone className="h-4 w-4 inline mr-2" />
                Phone
              </label>
              <input
                type="tel"
                value={student.phone || ''}
                disabled={!editMode}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="h-4 w-4 inline mr-2" />
                Date of Birth
              </label>
              <input
                type="date"
                value={student.dateOfBirth?.toISOString().split('T')[0] || ''}
                disabled={!editMode}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">RAAus ID</label>
              <input
                type="text"
                value={student.raausId || ''}
                disabled={!editMode}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">CASA ID</label>
              <input
                type="text"
                value={student.casaId || ''}
                disabled={!editMode}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>
          </div>

          {editMode && (
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setEditMode(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  toast.success('Profile updated successfully!');
                  setEditMode(false);
                }}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Save className="h-4 w-4" />
                <span>Save Changes</span>
              </button>
            </div>
          )}
        </div>

        {/* Flight Statistics */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Flight Statistics</h2>
          
          <div className="space-y-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-blue-900">Total Hours</span>
                <span className="text-lg font-bold text-blue-600">{totalFlightTime.toFixed(1)}</span>
              </div>
            </div>

            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-green-900">Solo Time</span>
                <span className="text-lg font-bold text-green-600">{soloTime.toFixed(1)}</span>
              </div>
            </div>

            <div className="bg-orange-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-orange-900">Dual Time</span>
                <span className="text-lg font-bold text-orange-600">{dualTime.toFixed(1)}</span>
              </div>
            </div>

            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-purple-900">Prepaid Balance</span>
                <span className="text-lg font-bold text-purple-600">${student.prepaidBalance.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Currency Status */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Currency & Endorsements</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-green-900">Medical Certificate</span>
              <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Valid</span>
            </div>
            <p className="text-xs text-green-700 mt-1">
              Expires: {student.medicalExpiry?.toLocaleDateString()}
            </p>
          </div>

          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-green-900">RPL Licence</span>
              <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Valid</span>
            </div>
            <p className="text-xs text-green-700 mt-1">
              Expires: {student.licenceExpiry?.toLocaleDateString()}
            </p>
          </div>
        </div>

        <div>
          <h3 className="text-md font-medium text-gray-900 mb-3">Active Endorsements</h3>
          <div className="space-y-2">
            {student.endorsements.filter(e => e.isActive).map(endorsement => (
              <div key={endorsement.id} className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Award className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">
                    {endorsement.type.toUpperCase()} Endorsement
                  </span>
                </div>
                <span className="text-xs text-blue-700">
                  Obtained: {endorsement.dateObtained?.toLocaleDateString() || 'N/A'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Training Records */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Training Records</h2>
        
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
      </div>
    </div>
  );
};