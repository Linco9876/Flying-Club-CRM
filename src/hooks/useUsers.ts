import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { User, UserRole } from '../types';
import toast from 'react-hot-toast';

const getPrimaryRoleFromRoles = (roles: UserRole[]): UserRole =>
  roles.includes('admin') ? 'admin'
    : roles.includes('senior_instructor') ? 'senior_instructor'
    : roles.includes('instructor') ? 'instructor'
    : roles.includes('pilot') ? 'pilot'
    : 'student';

const hasStudentRoleConflict = (roles: UserRole[]) =>
  roles.includes('student') && roles.length > 1;

const mergeUserRoles = (roles: UserRole[], rowRole?: UserRole, isSeniorInstructor?: boolean) => {
  const mergedRoles = Array.from(new Set([
    ...roles,
    ...(rowRole ? [rowRole] : []),
    ...(isSeniorInstructor ? ['senior_instructor' as UserRole] : []),
  ]));
  return mergedRoles.length > 0 ? mergedRoles : ['student' as UserRole];
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

let usersCache: User[] | null = null;

export const useUsers = () => {
  const [users, setUsers] = useState<User[]>(() => usersCache || []);
  const [loading, setLoading] = useState(() => !usersCache);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      if (!usersCache) {
        setLoading(true);
      }
      const { data: usersData, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .order('name');

      if (fetchError) throw fetchError;

      const { data: rolesData, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (rolesError) {
        console.warn('Could not load user role assignments; falling back to primary user roles.', rolesError);
      }

      const rolesMap = new Map<string, UserRole[]>();
      (rolesData || []).forEach((r: any) => {
        if (!rolesMap.has(r.user_id)) {
          rolesMap.set(r.user_id, []);
        }
        rolesMap.get(r.user_id)!.push(r.role);
      });

      const mappedUsers: User[] = (usersData || [])
        .filter((u: any) => (u.portal_access_scope || 'full') !== 'guest_placeholder')
        .map(u => {
        const roleFromUserRow = u.role as UserRole | undefined;
        const userRoles = mergeUserRoles(rolesMap.get(u.id) || [], roleFromUserRow, u.is_senior_instructor);
        const primaryRole = getPrimaryRoleFromRoles(userRoles);

        return {
          id: u.id,
          email: u.email,
          name: u.name,
          role: primaryRole as UserRole,
          roles: userRoles,
          phone: u.phone,
          mobilePhone: u.mobile_phone,
          homePhone: u.home_phone,
          workPhone: u.work_phone,
          address: u.address,
          dateOfBirth: u.date_of_birth ? new Date(u.date_of_birth) : undefined,
          emergencyContact: u.emergency_contact_name ? {
            name: u.emergency_contact_name,
            phone: u.emergency_contact_phone || '',
            relationship: u.emergency_contact_relationship || ''
          } : undefined,
          preferredAircraftId: u.preferred_aircraft_id,
          avatar: u.avatar_url,
          coverPhoto: u.cover_url,
          isActive: u.is_active ?? true,
          portalAccessScope: u.portal_access_scope || 'full',
          isSeniorInstructor: u.is_senior_instructor || false,
          xeroContactId: u.xero_contact_id || undefined,
          xeroContactName: u.xero_contact_name || undefined,
          xeroContactEmail: u.xero_contact_email || undefined,
          xeroContactSyncStatus: u.xero_contact_sync_status || 'not_linked',
          xeroContactSyncError: u.xero_contact_sync_error || null,
          xeroContactLastSyncedAt: u.xero_contact_last_synced_at || null,
        };
      });

      usersCache = mappedUsers;
      setUsers(mappedUsers);
      setError(null);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const getInstructors = () => {
    return users.filter(u => u.roles?.includes('instructor') || u.roles?.includes('senior_instructor'));
  };

  const getPilots = () => {
    return users;
  };

  const updateUser = async (userId: string, updates: Partial<User>) => {
    try {
      const updateData: any = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.email !== undefined) updateData.email = updates.email;
      if (updates.phone !== undefined) updateData.phone = updates.phone;
      if (updates.mobilePhone !== undefined) updateData.mobile_phone = updates.mobilePhone;
      if (updates.homePhone !== undefined) updateData.home_phone = updates.homePhone;
      if (updates.workPhone !== undefined) updateData.work_phone = updates.workPhone;
      if (updates.address !== undefined) updateData.address = updates.address;
      if (updates.dateOfBirth !== undefined) updateData.date_of_birth = updates.dateOfBirth;
      if (updates.emergencyContact !== undefined) {
        updateData.emergency_contact_name = updates.emergencyContact?.name;
        updateData.emergency_contact_phone = updates.emergencyContact?.phone;
        updateData.emergency_contact_relationship = updates.emergencyContact?.relationship;
      }
      if (updates.preferredAircraftId !== undefined) updateData.preferred_aircraft_id = updates.preferredAircraftId;
      if (updates.avatar !== undefined) updateData.avatar_url = updates.avatar;
      if (updates.coverPhoto !== undefined) updateData.cover_url = updates.coverPhoto;
      if (updates.isActive !== undefined) updateData.is_active = updates.isActive;
      if (updates.portalAccessScope !== undefined) updateData.portal_access_scope = updates.portalAccessScope;
      if (updates.isSeniorInstructor !== undefined) updateData.is_senior_instructor = updates.isSeniorInstructor;

      const { data: updatedUsers, error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select('id');

      if (updateError) throw updateError;
      if (!updatedUsers || updatedUsers.length === 0) {
        throw new Error('You do not have permission to update this user.');
      }

      await fetchUsers();
      toast.success('User updated successfully');
    } catch (err) {
      console.error('Error updating user:', err);
      toast.error(`Failed to update user: ${getErrorMessage(err, 'Unknown error')}`);
      throw err;
    }
  };

  const addRole = async (userId: string, role: UserRole) => {
    try {
      const existingRoles = users.find(u => u.id === userId)?.roles || [];
      if (existingRoles.includes(role)) return;
      const nextRoles = Array.from(new Set([...existingRoles, role]));

      if (hasStudentRoleConflict(nextRoles)) {
        toast.error('Student cannot be combined with any other role');
        return;
      }

      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role });

      if (error) throw error;

      const { error: updateError } = await supabase
        .from('users')
        .update({ role: getPrimaryRoleFromRoles(nextRoles) })
        .eq('id', userId);

      if (updateError) throw updateError;

      await fetchUsers();
      toast.success(`${role} role added successfully`);
    } catch (err) {
      console.error('Error adding role:', err);
      toast.error('Failed to add role');
      throw err;
    }
  };

  const removeRole = async (userId: string, role: UserRole) => {
    try {
      const user = users.find(u => u.id === userId);
      if (!user) return;
      if (user && user.roles && user.roles.length === 1) {
        toast.error('Cannot remove the last role from a user');
        return;
      }
      const nextRoles = (user.roles || [user.role]).filter(existingRole => existingRole !== role);

      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', role);

      if (error) throw error;

      const { error: updateError } = await supabase
        .from('users')
        .update({ role: getPrimaryRoleFromRoles(nextRoles) })
        .eq('id', userId);

      if (updateError) throw updateError;

      await fetchUsers();
      toast.success(`${role} role removed successfully`);
    } catch (err) {
      console.error('Error removing role:', err);
      toast.error('Failed to remove role');
      throw err;
    }
  };

  const setUserRoles = async (userId: string, roles: UserRole[]) => {
    try {
      if (roles.length === 0) {
        toast.error('User must have at least one role');
        return;
      }

      const uniqueRoles = Array.from(new Set(roles));
      if (hasStudentRoleConflict(uniqueRoles)) {
        toast.error('Student cannot be combined with any other role');
        return;
      }

      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

      const rolesToInsert = uniqueRoles.map(role => ({ user_id: userId, role }));
      const { error } = await supabase
        .from('user_roles')
        .insert(rolesToInsert);

      if (error) throw error;

      const { error: updateError } = await supabase
        .from('users')
        .update({ role: getPrimaryRoleFromRoles(uniqueRoles) })
        .eq('id', userId);

      if (updateError) throw updateError;

      await fetchUsers();
      toast.success('User roles updated successfully');
    } catch (err) {
      console.error('Error setting user roles:', err);
      toast.error('Failed to update user roles');
      throw err;
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  return {
    users,
    loading,
    error,
    getInstructors,
    getPilots,
    updateUser,
    addRole,
    removeRole,
    setUserRoles,
    refetch: fetchUsers
  };
};
