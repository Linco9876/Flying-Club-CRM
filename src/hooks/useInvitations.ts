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

export interface InviteUserResult {
  tempPassword?: string;
  emailSent?: boolean;
  message?: string;
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

  const getInviteRedirectUrl = () => {
    const authRedirectOrigin = import.meta.env.VITE_AUTH_REDIRECT_ORIGIN?.trim();
    const redirectOrigin = authRedirectOrigin || window.location.origin;
    const basePath = authRedirectOrigin ? '/' : import.meta.env.BASE_URL;
    return `${redirectOrigin.replace(/\/$/, '')}${basePath}reset-password`;
  };

  const inviteUser = async (data: {
    email: string;
    name: string;
    phone?: string;
    roles?: UserRole[];
  }): Promise<InviteUserResult | undefined> => {
    try {
      const roles = data.roles && data.roles.length > 0 ? data.roles : ['student'];
      if (roles.includes('student') && roles.length > 1) {
        toast.error('Student cannot be combined with any other role');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email: data.email,
          name: data.name,
          phone: data.phone,
          roles,
          redirectTo: getInviteRedirectUrl(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        const message = result.error || result.message || result.msg || 'Failed to invite user';
        toast.error(message);
        return;
      }

      await fetchInvitations();
      toast.success(result.emailSent ? 'Invitation email sent' : 'User invited successfully');

      return {
        tempPassword: result.tempPassword,
        emailSent: Boolean(result.emailSent),
        message: result.message,
      };
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
