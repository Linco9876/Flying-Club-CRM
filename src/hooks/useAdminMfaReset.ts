import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { getSupabaseFunctionErrorMessage } from '../lib/supabaseFunctionErrors';

interface MfaResetUser {
  id: string;
  name: string;
  email: string;
}

export interface AdminMfaStatus {
  checked: boolean;
  hasMfa: boolean;
  factorCount: number;
  verifiedFactorCount: number;
}

const emptyStatus: AdminMfaStatus = {
  checked: false,
  hasMfa: false,
  factorCount: 0,
  verifiedFactorCount: 0,
};

export const useAdminMfaReset = () => {
  const [statusByUserId, setStatusByUserId] = useState<Record<string, AdminMfaStatus>>({});
  const [statusLoadingUserId, setStatusLoadingUserId] = useState<string | null>(null);
  const [resettingMfaUserId, setResettingMfaUserId] = useState<string | null>(null);

  const loadMfaStatus = useCallback(async (target: MfaResetUser) => {
    setStatusLoadingUserId(target.id);
    try {
      const { data, error } = await supabase.functions.invoke<{
        hasMfa?: boolean;
        factorCount?: number;
        verifiedFactorCount?: number;
      }>('invite-user', {
        body: {
          action: 'get_mfa_status',
          userId: target.id,
        },
      });

      if (error) {
        throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to check 2FA status'));
      }

      const factorCount = Number(data?.factorCount || 0);
      const verifiedFactorCount = Number(data?.verifiedFactorCount || 0);
      setStatusByUserId(prev => ({
        ...prev,
        [target.id]: {
          checked: true,
          hasMfa: Boolean(data?.hasMfa || factorCount > 0),
          factorCount,
          verifiedFactorCount,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check 2FA status';
      setStatusByUserId(prev => ({
        ...prev,
        [target.id]: { ...emptyStatus, checked: true },
      }));
      toast.error(message);
    } finally {
      setStatusLoadingUserId(current => current === target.id ? null : current);
    }
  }, []);

  const resetMfa = useCallback(async (target: MfaResetUser) => {
    const status = statusByUserId[target.id];
    const factorText = status?.factorCount === 1 ? '1 authenticator factor' : `${status?.factorCount || 'their'} authenticator factors`;
    const confirmed = window.confirm(
      `Reset 2FA for ${target.name} (${target.email})?\n\nThis removes ${factorText}. They will need to enrol a new authenticator next time the portal asks for 2FA.`,
    );
    if (!confirmed) return false;

    setResettingMfaUserId(target.id);
    try {
      const { data, error } = await supabase.functions.invoke<{
        factorsRemoved?: number;
        message?: string;
      }>('invite-user', {
        body: {
          action: 'reset_mfa',
          userId: target.id,
        },
      });

      if (error) {
        throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to reset 2FA'));
      }

      setStatusByUserId(prev => ({
        ...prev,
        [target.id]: {
          checked: true,
          hasMfa: false,
          factorCount: 0,
          verifiedFactorCount: 0,
        },
      }));
      toast.success(data?.message || `2FA reset for ${target.email}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset 2FA';
      toast.error(message);
      return false;
    } finally {
      setResettingMfaUserId(null);
    }
  }, [statusByUserId]);

  return {
    statusByUserId,
    statusLoadingUserId,
    resettingMfaUserId,
    loadMfaStatus,
    resetMfa,
  };
};
