import React, { useState, useEffect } from 'react';
import { UserCheck, Shield, Users } from 'lucide-react';
import { useUsers } from '../../hooks/useUsers';
import toast from 'react-hot-toast';

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
  pilot: boolean;
  student: boolean;
}

export const RolesPermissionsSettings: React.FC<RolesPermissionsSettingsProps> = ({ canEdit, onFormChange }) => {
  const { users, loading, addRole, removeRole, updateUser, refetch } = useUsers();
  const [permissions, setPermissions] = useState<Permission[]>([
    {
      id: 'view-all-bookings',
      name: 'View All Bookings',
      description: 'Can view bookings for all students',
      admin: true,
      instructor: true,
      pilot: false,
      student: false
    },
    {
      id: 'create-bookings',
      name: 'Create Bookings',
      description: 'Can create new bookings',
      admin: true,
      instructor: true,
      pilot: true,
      student: true
    },
    {
      id: 'edit-bookings',
      name: 'Edit Bookings',
      description: 'Can modify existing bookings',
      admin: true,
      instructor: true,
      pilot: true,
      student: false
    },
    {
      id: 'delete-bookings',
      name: 'Delete Bookings',
      description: 'Can delete bookings',
      admin: true,
      instructor: false,
      pilot: false,
      student: false
    },
    {
      id: 'manage-students',
      name: 'Manage Students',
      description: 'Can add, edit, and view student records',
      admin: true,
      instructor: true,
      pilot: false,
      student: false
    },
    {
      id: 'manage-aircraft',
      name: 'Manage Aircraft',
      description: 'Can add, edit, and manage aircraft',
      admin: true,
      instructor: true,
      pilot: false,
      student: false
    },
    {
      id: 'submit-training-records',
      name: 'Submit Training Records',
      description: 'Can create and submit training records',
      admin: true,
      instructor: true,
      pilot: false,
      student: false
    },
    {
      id: 'view-billing',
      name: 'View Billing',
      description: 'Can access billing and financial data',
      admin: true,
      instructor: true,
      pilot: false,
      student: false
    },
    {
      id: 'manage-maintenance',
      name: 'Manage Maintenance',
      description: 'Can report defects and manage maintenance',
      admin: true,
      instructor: true,
      pilot: false,
      student: false
    },
    {
      id: 'view-reports',
      name: 'View Reports',
      description: 'Can access statistical reports',
      admin: true,
      instructor: true,
      pilot: false,
      student: false
    },
    {
      id: 'manage-safety',
      name: 'Manage Safety',
      description: 'Can access safety reports and compliance',
      admin: true,
      instructor: true,
      pilot: false,
      student: false
    },
    {
      id: 'system-settings',
      name: 'System Settings',
      description: 'Can modify system configuration',
      admin: true,
      instructor: false,
      pilot: false,
      student: false
    }
  ]);

  const handlePermissionChange = (permissionId: string, role: 'admin' | 'instructor' | 'pilot' | 'student', value: boolean) => {
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

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-800';
      case 'instructor': return 'bg-blue-100 text-blue-800';
      case 'pilot': return 'bg-orange-100 text-orange-800';
      case 'student': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const handleRoleToggle = async (userId: string, role: 'admin' | 'instructor' | 'pilot' | 'student', isChecked: boolean) => {
    try {
      if (isChecked) {
        await addRole(userId, role);
      } else {
        await removeRole(userId, role);
      }
    } catch (error) {
      console.error('Error toggling role:', error);
    }
  };

  useEffect(() => {
    refetch();
  }, []);

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <UserCheck className="h-5 w-5 mr-2" />
          Roles & Permissions
        </h2>
        <p className="text-gray-600">Configure access control matrix for different user roles</p>
      </div>

      {/* User Management */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <Users className="h-5 w-5 mr-2" />
            User Management
          </h3>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-6 text-center text-gray-500">Loading users...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        User
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Current Roles
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-red-500 uppercase tracking-wider">
                        Admin
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-blue-500 uppercase tracking-wider">
                        Instructor
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-indigo-500 uppercase tracking-wider">
                        Senior Instr.
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-orange-500 uppercase tracking-wider">
                        Pilot
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-green-500 uppercase tracking-wider">
                        Student
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{user.name}</div>
                          {user.phone && <div className="text-sm text-gray-500">{user.phone}</div>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{user.email}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {(user.roles || [user.role]).map(role => (
                              <span key={role} className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRoleBadgeColor(role)}`}>
                                {role.charAt(0).toUpperCase() + role.slice(1)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={(user.roles || [user.role]).includes('admin')}
                            onChange={(e) => handleRoleToggle(user.id, 'admin', e.target.checked)}
                            disabled={!canEdit}
                            className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded disabled:opacity-50"
                          />
                        </td>
                        <td className="px-6 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={(user.roles || [user.role]).includes('instructor')}
                            onChange={(e) => handleRoleToggle(user.id, 'instructor', e.target.checked)}
                            disabled={!canEdit}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                          />
                        </td>
                        <td className="px-6 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={user.isSeniorInstructor || false}
                            onChange={(e) => updateUser(user.id, { isSeniorInstructor: e.target.checked })}
                            disabled={!canEdit || !(user.roles || [user.role]).includes('instructor')}
                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded disabled:opacity-50"
                            title="Must have instructor role"
                          />
                        </td>
                        <td className="px-6 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={(user.roles || [user.role]).includes('pilot')}
                            onChange={(e) => handleRoleToggle(user.id, 'pilot', e.target.checked)}
                            disabled={!canEdit}
                            className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded disabled:opacity-50"
                          />
                        </td>
                        <td className="px-6 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={(user.roles || [user.role]).includes('student')}
                            onChange={(e) => handleRoleToggle(user.id, 'student', e.target.checked)}
                            disabled={!canEdit}
                            className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded disabled:opacity-50"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
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
                    <th className="px-6 py-3 text-center text-xs font-medium text-orange-500 uppercase tracking-wider">
                      <UserCheck className="h-4 w-4 inline mr-1" />
                      Pilot
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
                          checked={permission.pilot}
                          onChange={(e) => handlePermissionChange(permission.id, 'pilot', e.target.checked)}
                          disabled={!canEdit}
                          className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded disabled:opacity-50"
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

            <div className="bg-orange-50 border border-orange-200 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-orange-900 mb-2">Pilot</h4>
              <p className="text-xs text-orange-800">
                Can create and manage own bookings. Has access to flight operations without student restrictions.
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