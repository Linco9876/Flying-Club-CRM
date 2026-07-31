export const PASSWORD_SETUP_MARKER_KEY = 'bfc_password_setup_started_at';
export const PASSWORD_SETUP_MARKER_MAX_AGE_MS = 15 * 60 * 1000;

const getStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
};

export const markPasswordSetupStarted = (now = Date.now()) => {
  getStorage()?.setItem(PASSWORD_SETUP_MARKER_KEY, String(now));
};

export const hasRecentPasswordSetupMarker = (now = Date.now()) => {
  const stored = getStorage()?.getItem(PASSWORD_SETUP_MARKER_KEY);
  const startedAt = Number(stored);
  return Number.isFinite(startedAt) && startedAt > 0 && now - startedAt <= PASSWORD_SETUP_MARKER_MAX_AGE_MS;
};

export const clearPasswordSetupMarker = () => {
  getStorage()?.removeItem(PASSWORD_SETUP_MARKER_KEY);
};

export type PasswordSetupMode = 'invitation' | 'password-reset';

export const getPasswordSetupMode = (hash: string): PasswordSetupMode => {
  const mode = new URLSearchParams(hash.replace(/^#/, '')).get('mode');
  return mode === 'password-reset' ? 'password-reset' : 'invitation';
};

export const markPasswordSetupFromCurrentUrl = () => {
  if (typeof window === 'undefined') return false;

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(window.location.search);
  const linkType = hashParams.get('type') || searchParams.get('type');
  const hasAuthPayload = Boolean(
    hashParams.get('access_token') ||
    searchParams.get('access_token') ||
    hashParams.get('code') ||
    searchParams.get('code'),
  );
  const isPasswordSetupLink =
    window.location.pathname === '/reset-password' &&
    (linkType === 'invite' || linkType === 'recovery' || hasAuthPayload);

  if (isPasswordSetupLink) markPasswordSetupStarted();
  return isPasswordSetupLink;
};

export const getInvitationActionLink = (
  hash: string,
  expectedSupabaseUrl: string,
): string | null => {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const rawLink = params.get('setup');
  if (!rawLink) return null;

  try {
    const actionUrl = new URL(rawLink);
    const expectedUrl = new URL(expectedSupabaseUrl);
    const type = actionUrl.searchParams.get('type');

    if (actionUrl.protocol !== 'https:') return null;
    if (actionUrl.origin !== expectedUrl.origin) return null;
    if (actionUrl.pathname !== '/auth/v1/verify') return null;
    if (type !== 'invite' && type !== 'recovery') return null;
    if (!actionUrl.searchParams.has('token')) return null;

    return actionUrl.toString();
  } catch {
    return null;
  }
};
