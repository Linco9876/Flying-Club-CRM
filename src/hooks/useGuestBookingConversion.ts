import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';

const extractFunctionErrorMessage = async (error: unknown, fallback: string) => {
  const defaultMessage =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || fallback)
      : fallback;

  if (!error || typeof error !== 'object' || !('context' in error)) {
    return defaultMessage;
  }

  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || typeof (context as Response).text !== 'function') {
    return defaultMessage;
  }

  try {
    const response = context as Response;
    const bodyText = await response.clone().text();
    if (!bodyText) return defaultMessage;

    try {
      const parsed = JSON.parse(bodyText) as { error?: unknown; message?: unknown };
      const message = String(parsed.error || parsed.message || '').trim();
      return message || defaultMessage;
    } catch {
      return bodyText.trim() || defaultMessage;
    }
  } catch {
    return defaultMessage;
  }
};

export const useGuestBookingConversion = () => {
  const convertGuestBookingToMember = async ({
    bookingId,
    targetUserId,
    role = 'student',
    linkAll = true,
    sendInvitation = false,
  }: {
    bookingId: string;
    targetUserId?: string;
    role?: 'student' | 'pilot';
    linkAll?: boolean;
    sendInvitation?: boolean;
  }) => {
    try {
      const redirectTo = `${window.location.origin}/`;
      const { data, error } = await supabase.functions.invoke('convert-guest-booking-to-member', {
        body: {
          bookingId,
          targetUserId: targetUserId || null,
          role,
          linkAll,
          sendInvitation,
          redirectTo,
        },
      });

      if (error) {
        throw new Error(await extractFunctionErrorMessage(error, 'Failed to convert guest booking'));
      }

      toast.success(
        data?.action === 'created_profile'
          ? sendInvitation
            ? 'Portal profile created, history transferred and invitation sent'
            : 'Portal profile created without an invitation and history transferred'
          : 'Visitor history linked to the selected portal profile'
      );
      return data as {
        memberId: string;
        setupLink?: string | null;
        emailSent?: boolean;
        emailError?: string | null;
        transferred?: {
          bookingCount?: number;
          flightLogCount?: number;
          trainingRecordCount?: number;
          reviewCount?: number;
        };
      };
    } catch (error) {
      console.error('Error converting guest booking to member:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to convert guest booking');
      throw error;
    }
  };

  return {
    convertGuestBookingToMember,
  };
};
