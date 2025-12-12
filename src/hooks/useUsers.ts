import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { User, UserRole } from '../types';
import toast from 'react-hot-toast';

export const useUsers = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const { data: usersData, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .order('name');

      if (fetchError) throw fetchError;

      const { data: rolesData, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (rolesError) throw rolesError;

      const rolesMap = new Map<string, UserRole[]>();
      (rolesData || []).forEach((r: any) => {
        if (!rolesMap.has(r.user_id)) {
          rolesMap.set(r.user_id, []);
        }
        rolesMap.get(r.user_id)!.push(r.role);
      });

      const mappedUsers: User[] = (usersData || []).map(u => {
        const userRoles = rolesMap.get(u.id) || ['student'];
        const primaryRole = userRoles.includes('admin') ? 'admin'
                          : userRoles.includes('instructor') ? 'instructor'
                          : userRoles.includes('pilot') ? 'pilot'
                          : 'student';

        return {
          id: u.id,
          email: u.email,
          name: u.name,
          role: primaryRole as UserRole,
          roles: userRoles,
          phone: u.phone,
          avatar: u.avatar_url
        };
      });

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
    return users.filter(u =>
      u.roles?.includes('instructor') ||
      u.roles?.includes('admin') ||
      u.role === 'instructor' ||
      u.role === 'admin'
    );
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
      if (updates.avatar !== undefined) updateData.avatar_url = updates.avatar;

      const { error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId);

      if (updateError) throw updateError;

      await fetchUsers();
    } catch (err) {
      console.error('Error updating user:', err);
      throw err;
    }
  };

  const addRole = async (userId: string, role: UserRole) => {
    try {
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role });

      if (error) throw error;

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
      if (user && user.roles && user.roles.length === 1) {
        toast.error('Cannot remove the last role from a user');
        return;
      }

      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', role);

      if (error) throw error;

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

      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

      const rolesToInsert = roles.map(role => ({ user_id: userId, role }));
      const { error } = await supabase
        .from('user_roles')
        .insert(rolesToInsert);

      if (error) throw error;

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
