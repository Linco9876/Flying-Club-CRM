import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserRole } from '../types';
import toast from 'react-hot-toast';

export interface Invitation {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  invitedBy: string;
  status: 'pending' | 'accepted' | 'expired';
  invitedAt: Date;
  acceptedAt?: Date;
  userId?: string;
}

export const useInvitations = () => {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInvitations = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('invitations')
        .select('*')
        .order('invited_at', { ascending: false });

      if (error) throw error;

      const mappedInvitations: Invitation[] = (data || []).map(inv => ({
        id: inv.id,
        email: inv.email,
        name: inv.name,
        phone: inv.phone,
        role: inv.role,
        invitedBy: inv.invited_by,
        status: inv.status,
        invitedAt: new Date(inv.invited_at),
        acceptedAt: inv.accepted_at ? new Date(inv.accepted_at) : undefined,
        userId: inv.user_id
      }));

      setInvitations(mappedInvitations);
    } catch (err) {
      console.error('Error fetching invitations:', err);
      toast.error('Failed to load invitations');
    } finally {
      setLoading(false);
    }
  };

  const inviteUser = async (data: {
    email: string;
    name: string;
    phone?: string;
    roles?: UserRole[];
  }) => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not authenticated');

      const { data: existingUser } = await supabase
        .from('users')
        .select('email')
        .eq('email', data.email)
        .maybeSingle();

      if (existingUser) {
        toast.error('A user with this email already exists');
        return;
      }

      const { data: existingInvite } = await supabase
        .from('invitations')
        .select('email')
        .eq('email', data.email)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingInvite) {
        toast.error('An invitation for this email is already pending');
        return;
      }

      const roles = data.roles && data.roles.length > 0 ? data.roles : ['student'];
      const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: tempPassword,
        options: {
          data: {
            name: data.name,
            phone: data.phone
          }
        }
      });

      if (authError) {
        console.error('Auth error:', authError);
        toast.error('Failed to create user account');
        return;
      }

      if (!authData.user) {
        toast.error('Failed to create user account');
        return;
      }

      for (const role of roles) {
        const { error: roleError } = await supabase
          .from('user_roles')
          .insert({
            user_id: authData.user.id,
            role: role
          });

        if (roleError) {
          console.error('Error assigning role:', roleError);
        }
      }

      const primaryRole = roles.includes('admin') ? 'admin'
        : roles.includes('instructor') ? 'instructor'
        : roles.includes('pilot') ? 'pilot'
        : 'student';

      const { error: inviteError } = await supabase
        .from('invitations')
        .insert({
          email: data.email,
          name: data.name,
          phone: data.phone,
          role: primaryRole,
          invited_by: currentUser.id,
          status: 'accepted',
          accepted_at: new Date().toISOString(),
          user_id: authData.user.id
        });

      if (inviteError) {
        console.error('Invitation error:', inviteError);
      }

      await fetchInvitations();
      toast.success(`User invited successfully. Temporary password: ${tempPassword}`);

      return tempPassword;
    } catch (err) {
      console.error('Error inviting user:', err);
      toast.error('Failed to invite user');
      throw err;
    }
  };

  useEffect(() => {
    fetchInvitations();
  }, []);

  return {
    invitations,
    loading,
    inviteUser,
    refetch: fetchInvitations
  };
};
