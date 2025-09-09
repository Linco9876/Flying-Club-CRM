import React, { useState } from 'react';
import { UserCheck, Shield } from 'lucide-react';

interface RolesPermissionsSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

interface Permission {
  id: string;
  name: string;
  description: string;
  admin: boolean;
  instructor: boolean;
  student: boolean;
}

export const RolesPermissionsSettings: React.FC<RolesPermissionsSettingsProps> = ({ canEdit, onFormChange }) => {
  const [permissions, setPermissions] = useState<Permission[]>([
    {
      id: 'view-all-bookings',
      name: 'View All Bookings',
      description: 'Can view bookings for all students',
      admin: true,
      instructor: true,
      student: false
    },
    {
      id: 'create-bookings',
      name: 'Create Bookings',
      description: 'Can create new bookings',
      admin: true,
      instructor: true,
      student: true
    },
    {
      id: 'edit-bookings',
      name: 'Edit Bookings',
      description: 'Can modify existing bookings',
      admin: true,
      instructor: true,
      student: false
    },
    {
      id: 'delete-bookings',
      name: 'Delete Bookings',
      description: 'Can delete bookings',
      admin: true,
      instructor: false,
      student: false
    },
    {
      id: 'manage-students',
      name: 'Manage Students',
      description: 'Can add, edit, and view student records',
      admin: true,
      instructor: true,
      student: false
    },
    {
      id: 'manage-aircraft',
      name: 'Manage Aircraft',
      description: 'Can add, edit, and manage aircraft',
      admin: true,
      instructor: true,
      student: false
    },
    {
      id: 'submit-training-records',
      name: 'Submit Training Records',
      description: 'Can create and submit training records',
      admin: true,
      instructor: true,
      student: false
    },
    {
      id: 'view-billing',
      name: 'View Billing',
      description: 'Can access billing and financial data',
      admin: true,
      instructor: true,
      student: false
    },
    {
      id: 'manage-maintenance',
      name: 'Manage Maintenance',
      description: 'Can report defects and manage maintenance',
      admin: true,
      instructor: true,
      student: false
    },
    {
      id: 'view-reports',
      name: 'View Reports',
      description: 'Can access statistical reports',
      admin: true,
      instructor: true,
      student: false
    },
    {
      id: 'manage-safety',
      name: 'Manage Safety',
      description: 'Can access safety reports and compliance',
      admin: true,
      instructor: true,
      student: false
    },
    {
      id: 'system-settings',
      name: 'System Settings',
      description: 'Can modify system configuration',
      admin: true,
      instructor: false,
      student: false
    }
  ]);

  const handlePermissionChange = (permissionId: string, role: 'admin' | 'instructor' | 'student', value: boolean) => {
    setPermissions(prev => prev.map(permission =>
      permission.id === permissionId ? { ...permission, [role]: value } : permission
    ));
    onFormChange();
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'text-red-600';
      case 'instructor': return 'text-blue-600';
      case 'student': return 'text-green-600';
      default: return 'text-gray-600';
    }
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <UserCheck className="h-5 w-5 mr-2" />
          Roles & Permissions
        </h2>
        <p className="text-gray-600">Configure access control matrix for different user roles</p>
      </div>

      {/* Permissions Matrix */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Permission Matrix</h3>
          
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Permission
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-red-500 uppercase tracking-wider">
                      <Shield className="h-4 w-4 inline mr-1" />
                      Admin
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-blue-500 uppercase tracking-wider">
                      <UserCheck className="h-4 w-4 inline mr-1" />
                      Instructor
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-green-500 uppercase tracking-wider">
                      <UserCheck className="h-4 w-4 inline mr-1" />
                      Student
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {permissions.map(permission => (
                    <tr key={permission.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{permission.name}</div>
                          <div className="text-sm text-gray-500">{permission.description}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={permission.admin}
                          onChange={(e) => handlePermissionChange(permission.id, 'admin', e.target.checked)}
                          disabled={!canEdit}
                          className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded disabled:opacity-50"
                        />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={permission.instructor}
                          onChange={(e) => handlePermissionChange(permission.id, 'instructor', e.target.checked)}
                          disabled={!canEdit}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                        />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={permission.student}
                          onChange={(e) => handlePermissionChange(permission.id, 'student', e.target.checked)}
                          disabled={!canEdit}
                          className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded disabled:opacity-50"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Role Descriptions */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Role Descriptions</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-red-900 mb-2">Administrator</h4>
              <p className="text-xs text-red-800">
                Full system access including settings, billing, and user management. Can override all restrictions.
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-blue-900 mb-2">Instructor</h4>
              <p className="text-xs text-blue-800">
                Can manage students, aircraft, training records, and safety reports. Limited billing access.
              </p>
            </div>

            <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-green-900 mb-2">Student</h4>
              <p className="text-xs text-green-800">
                Can view own bookings, profile, and training progress. Can create bookings if enabled.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};