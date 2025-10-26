import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '../types';
import toast from 'react-hot-toast';

export const useUsers = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .order('name');

      if (fetchError) throw fetchError;

      const mappedUsers: User[] = (data || []).map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        phone: u.phone,
        avatar: u.avatar_url
      }));

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
    return users.filter(u => u.role === 'instructor' || u.role === 'admin');
  };

  const getPilots = () => {
    return users;
  };

  const updateUser = async (userId: string, updates: Partial<User>) => {
    try {
      const updateData: any = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.email !== undefined) updateData.email = updates.email;
      if (updates.role !== undefined) updateData.role = updates.role;
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
    refetch: fetchUsers
  };
};
