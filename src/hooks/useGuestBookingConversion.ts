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
    casualContactId,
    email,
    targetUserId,
    role = 'student',
    linkAll = true,
    sendInvitation = false,
    reactivateProfile = false,
  }: {
    bookingId?: string;
    casualContactId?: string;
    email: string;
    targetUserId?: string;
    role?: 'student' | 'pilot';
    linkAll?: boolean;
    sendInvitation?: boolean;
    reactivateProfile?: boolean;
  }) => {
    try {
      if (!bookingId && !casualContactId) {
        throw new Error('A booking or past visitor is required');
      }
      const redirectTo = `${window.location.origin}/`;
      const { data, error } = await supabase.functions.invoke('convert-guest-booking-to-member', {
        body: {
          bookingId: bookingId || null,
          casualContactId: casualContactId || null,
          email: email.trim().toLowerCase(),
          targetUserId: targetUserId || null,
          role,
          linkAll,
          sendInvitation,
          reactivateProfile,
          redirectTo,
        },
      });

      if (error) {
        throw new Error(await extractFunctionErrorMessage(error, 'Failed to convert guest booking'));
      }

      toast.success(
        data?.action === 'reactivated_profile'
          ? 'Portal profile restored'
          : data?.action === 'profile_already_active'
            ? 'This visitor already has an active portal profile'
            : data?.action === 'created_profile'
          ? sendInvitation
            ? 'Portal profile created, history transferred and invitation sent'
            : 'Portal profile created without an invitation and history transferred'
          : data?.profileReactivated
            ? 'Visitor history linked and the portal profile restored'
            : 'Visitor history linked to the selected portal profile'
      );
      return data as {
        action?: 'linked_existing' | 'created_profile' | 'reactivated_profile' | 'profile_already_active';
        memberId: string;
        setupLink?: string | null;
        emailSent?: boolean;
        emailError?: string | null;
        profileReactivated?: boolean;
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
