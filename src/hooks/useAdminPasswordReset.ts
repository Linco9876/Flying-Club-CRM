import { useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { getSupabaseFunctionErrorMessage } from '../lib/supabaseFunctionErrors';

interface PasswordResetUser {
  id: string;
  name: string;
  email: string;
}

const getResetRedirectUrl = () => {
  const configuredOrigin = import.meta.env.VITE_AUTH_REDIRECT_ORIGIN?.trim();
  const origin = configuredOrigin || window.location.origin;
  return `${origin.replace(/\/$/, '')}/reset-password`;
};

export const useAdminPasswordReset = () => {
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);

  const sendPasswordReset = async (target: PasswordResetUser) => {
    const confirmed = window.confirm(
      `Send a password reset email to ${target.name} at ${target.email}? Their current password will continue working until they choose a new one.`,
    );
    if (!confirmed) return false;

    setResettingUserId(target.id);
    try {
      const { data, error } = await supabase.functions.invoke<{
        emailSent?: boolean;
        message?: string;
      }>('invite-user', {
        body: {
          action: 'send_password_reset',
          userId: target.id,
          redirectTo: getResetRedirectUrl(),
        },
      });

      if (error) {
        throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to send password reset email'));
      }
      if (!data?.emailSent) {
        throw new Error(data?.message || 'The password reset email was not sent');
      }

      toast.success(data.message || `Password reset email sent to ${target.email}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send password reset email';
      toast.error(message);
      return false;
    } finally {
      setResettingUserId(null);
    }
  };

  return {
    resettingUserId,
    sendPasswordReset,
  };
};
