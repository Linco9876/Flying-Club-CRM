import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Shield, UserCheck, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useUsers } from '../../hooks/useUsers';
import { Action, Resource, rolePermissions } from '../../utils/rbac';
import { UserRole } from '../../types';

interface RolesPermissionsSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

interface PermissionRow {
  action: Action;
  name: string;
  description: string;
}

const editableRoles: UserRole[] = ['admin', 'senior_instructor', 'instructor', 'pilot', 'student'];
const matrixRoles: UserRole[] = ['admin', 'senior_instructor', 'instructor', 'pilot', 'student'];

const permissionRows: PermissionRow[] = [
  { action: 'view-dashboard', name: 'Dashboard', description: 'Can open the main dashboard.' },
  { action: 'view-calendar', name: 'Calendar', description: 'Can view the club calendar.' },
  { action: 'view-bookings', name: 'Bookings', description: 'Can view booking records according to role scope.' },
  { action: 'view-students', name: 'Students/Pilots', description: 'Can view student and pilot records.' },
  { action: 'view-aircraft', name: 'Aircraft', description: 'Can view aircraft records and availability.' },
  { action: 'view-maintenance', name: 'Maintenance', description: 'Can view aircraft maintenance and defect workflows.' },
  { action: 'view-training', name: 'Training Records', description: 'Can view training records and student progress.' },
  { action: 'view-outstanding-records', name: 'Outstanding Records', description: 'Can view unlogged or incomplete training and flight records.' },
  { action: 'view-billing', name: 'Billing', description: 'Can view billing according to role scope.' },
  { action: 'view-reports', name: 'Reports', description: 'Can view statistical reports.' },
  { action: 'view-safety', name: 'Safety', description: 'Can view safety module content according to role scope.' },
  { action: 'view-pilot-currency', name: 'Pilot Currency', description: 'Can view pilot currency information according to role scope.' },
  { action: 'view-instructor-approvals', name: 'Instructor Approvals', description: 'Can view instructor approval workflows.' },
  { action: 'view-safety-reports', name: 'Safety Reports', description: 'Can view safety reports according to role scope.' },
  { action: 'view-checklists-docs', name: 'Checklists / Docs', description: 'Can view safety checklists and documents.' },
  { action: 'view-settings', name: 'Settings', description: 'Can open settings according to role scope.' },
  { action: 'edit-settings', name: 'Edit System Settings', description: 'Can edit admin-only system settings.' },
  { action: 'edit-personal-settings', name: 'Personal Preferences', description: 'Can edit own personal preferences.' },
];

const roleLabels: Record<UserRole, string> = {
  admin: 'Admin',
  senior_instructor: 'Senior Instructor',
  instructor: 'Instructor',
  pilot: 'Pilot',
  student: 'Student',
};

const roleBadgeClass: Record<UserRole, string> = {
  admin: 'bg-red-100 text-red-800',
  senior_instructor: 'bg-indigo-100 text-indigo-800',
  instructor: 'bg-blue-100 text-blue-800',
  pilot: 'bg-orange-100 text-orange-800',
  student: 'bg-green-100 text-green-800',
};

const scopeLabel = (resource?: Resource) => {
  if (resource === 'all') return 'All';
  if (resource === 'own') return 'Own';
  return '';
};

const getPermissionScope = (role: UserRole, action: Action): Resource | undefined => {
  return rolePermissions[role]?.find(permission => permission.action === action)?.resource;
};

export const RolesPermissionsSettings: React.FC<RolesPermissionsSettingsProps> = ({ canEdit }) => {
  const { user: currentUser } = useAuth();
  const { users, loading, error, addRole, removeRole, updateUser, refetch } = useUsers();
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    refetch();
  }, []);

  const filteredUsers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return users;
    return users.filter(user =>
      user.name.toLowerCase().includes(query)
      || user.email.toLowerCase().includes(query)
      || (user.roles || [user.role]).some(role => roleLabels[role]?.toLowerCase().includes(query))
    );
  }, [searchTerm, users]);

  const handleRoleToggle = async (userId: string, role: UserRole, isChecked: boolean) => {
    const target = users.find(item => item.id === userId);
    if (!target) return;

    const targetRoles = target.roles || [target.role];
    let nextRoles = isChecked
      ? Array.from(new Set([...targetRoles, role]))
      : targetRoles.filter(existingRole => existingRole !== role);

    if (role === 'senior_instructor' && isChecked && !nextRoles.includes('instructor')) {
      nextRoles = [...nextRoles, 'instructor'];
    }

    if (!isChecked && nextRoles.length === 0) {
      toast.error('Each user must keep at least one role.');
      return;
    }

    if (nextRoles.includes('student') && nextRoles.length > 1) {
      toast.error('Student cannot be combined with any other role.');
      return;
    }

    if (!isChecked && userId === currentUser?.id && role === 'admin' && !nextRoles.includes('admin')) {
      toast.error('You cannot remove your own admin access.');
      return;
    }

    try {
      setUpdatingUserId(userId);

      if (role === 'senior_instructor' && isChecked && !targetRoles.includes('instructor')) {
        await addRole(userId, 'instructor');
      }

      if (role === 'senior_instructor') {
        await updateUser(userId, { isSeniorInstructor: isChecked });
      }

      if (isChecked) {
        await addRole(userId, role);
      } else {
        await removeRole(userId, role);
      }
    } catch (err) {
      console.error('Error changing user role:', err);
    } finally {
      setUpdatingUserId(null);
    }
  };

  const roleCount = (role: UserRole) => users.filter(user => (user.roles || [user.role]).includes(role)).length;

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <UserCheck className="h-5 w-5 mr-2" />
          Roles & Permissions
        </h2>
        <p className="text-gray-600">Manage user roles and review the access model currently enforced by the CRM.</p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {matrixRoles.map(role => (
          <div key={role} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{roleLabels[role]}</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{roleCount(role)}</p>
            <p className="mt-1 text-xs text-gray-500">assigned users</p>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Users className="h-5 w-5 mr-2 text-blue-600" />
              User Role Assignment
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Role changes save immediately. Student is standalone; mixed-role users log in as their highest rank: admin, instructor, pilot, then student.
            </p>
          </div>
          <input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            className="w-full lg:w-72 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search users or roles..."
          />
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 flex items-center justify-center text-gray-500">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Loading users...
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-red-600">{error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Roles</th>
                    {editableRoles.map(role => (
                      <th key={role} className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {roleLabels[role]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredUsers.map(user => {
                    const userRoles = user.roles || [user.role];
                    const isUpdating = updatingUserId === user.id;
                    return (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{user.name}</div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                          {user.phone && <div className="text-xs text-gray-400">{user.phone}</div>}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-1">
                            {userRoles.map(role => (
                              <span key={role} className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${roleBadgeClass[role]}`}>
                                {roleLabels[role]}
                              </span>
                            ))}
                          </div>
                        </td>
                        {editableRoles.map(role => {
                          const checked = userRoles.includes(role) || (role === 'senior_instructor' && Boolean(user.isSeniorInstructor));
                          const wouldConflictWithStudent =
                            !checked &&
                            ((role === 'student' && userRoles.some(existingRole => existingRole !== 'student'))
                              || (role !== 'student' && userRoles.includes('student')));
                          const disabled = !canEdit
                            || isUpdating
                            || (!checked && role === 'senior_instructor' && !userRoles.includes('instructor'))
                            || wouldConflictWithStudent
                            || (user.id === currentUser?.id && role === 'admin' && checked);
                          const title = wouldConflictWithStudent
                            ? 'Student cannot be combined with any other role'
                            : role === 'senior_instructor' && !userRoles.includes('instructor')
                              ? 'Assign Instructor before Senior Instructor'
                              : undefined;

                          return (
                            <td key={role} className="px-4 py-4 text-center">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={event => handleRoleToggle(user.id, role, event.target.checked)}
                                disabled={disabled}
                                title={title}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={editableRoles.length + 2} className="px-4 py-8 text-center text-sm text-gray-500">
                        No users match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <Shield className="h-5 w-5 mr-2 text-blue-600" />
            Permission Matrix
          </h3>
          <p className="text-sm text-gray-500 mt-1">This matrix is read-only because these rules are enforced in code and database policies, not saved from this screen.</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Permission</th>
                  {matrixRoles.map(role => (
                    <th key={role} className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {roleLabels[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {permissionRows.map(permission => (
                  <tr key={permission.action} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <div className="text-sm font-medium text-gray-900">{permission.name}</div>
                      <div className="text-sm text-gray-500">{permission.description}</div>
                    </td>
                    {matrixRoles.map(role => {
                      const scope = getPermissionScope(role, permission.action);
                      return (
                        <td key={role} className="px-4 py-4 text-center">
                          {scope ? (
                            <span className="inline-flex min-w-14 items-center justify-center gap-1 rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
                              <Check className="h-3.5 w-3.5" />
                              {scopeLabel(scope)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-400">
                              <X className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Role Notes</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-red-900 mb-2">Admin</h4>
            <p className="text-xs text-red-800">Full system access including settings, billing, user management and override workflows.</p>
          </div>
          <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-indigo-900 mb-2">Senior Instructor</h4>
            <p className="text-xs text-indigo-800">Instructor-level access plus senior approval and oversight workflows where enabled.</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-blue-900 mb-2">Instructor</h4>
            <p className="text-xs text-blue-800">Can manage bookings, students, aircraft, training records, safety and maintenance workflows.</p>
          </div>
          <div className="bg-orange-50 border border-orange-200 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-orange-900 mb-2">Pilot</h4>
            <p className="text-xs text-orange-800">Can book and view own operational records without being treated as a student-only user.</p>
          </div>
          <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-green-900 mb-2">Student</h4>
            <p className="text-xs text-green-800">Can access own bookings, billing, safety records, profile and training-related information.</p>
          </div>
        </div>
      </section>
    </div>
  );
};
