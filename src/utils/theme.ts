export type PortalThemePreference = 'light' | 'semi-dark' | 'dark' | 'auto';

export const PORTAL_THEME_STORAGE_KEY = 'bfc.portal.theme';
export const PORTAL_THEME_USER_STORAGE_PREFIX = `${PORTAL_THEME_STORAGE_KEY}.user.`;

const isPortalThemePreference = (value: unknown): value is PortalThemePreference =>
  value === 'light' || value === 'semi-dark' || value === 'dark' || value === 'auto';

export const normalizePortalTheme = (theme: unknown): PortalThemePreference =>
  isPortalThemePreference(theme) ? theme : 'auto';

const getThemeStorageKey = (userId?: string) =>
  userId ? `${PORTAL_THEME_USER_STORAGE_PREFIX}${userId}` : PORTAL_THEME_STORAGE_KEY;

export const getStoredPortalTheme = (userId?: string): PortalThemePreference | null => {
  if (typeof window === 'undefined') return null;
  try {
    const storedTheme = window.localStorage.getItem(getThemeStorageKey(userId));
    return isPortalThemePreference(storedTheme) ? storedTheme : null;
  } catch {
    return null;
  }
};

export const storePortalTheme = (theme: unknown, userId?: string) => {
  if (typeof window === 'undefined') return;
  try {
    const normalizedTheme = normalizePortalTheme(theme);
    window.localStorage.setItem(getThemeStorageKey(userId), normalizedTheme);
    window.localStorage.setItem(PORTAL_THEME_STORAGE_KEY, normalizedTheme);
  } catch {
    // Best-effort only. The database preference remains the source of truth.
  }
};

export const applyPortalTheme = (theme: unknown, media?: MediaQueryList) => {
  if (typeof document === 'undefined') return;

  const normalizedTheme = normalizePortalTheme(theme);
  const darkMedia = media ?? (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
  );
  const useDarkTheme =
    normalizedTheme === 'dark' ||
    normalizedTheme === 'semi-dark' ||
    (normalizedTheme === 'auto' && Boolean(darkMedia?.matches));

  document.documentElement.dataset.portalTheme = useDarkTheme ? 'dark' : 'light';
  if (normalizedTheme === 'semi-dark') {
    document.documentElement.dataset.portalVariant = 'semi-dark';
  } else {
    delete document.documentElement.dataset.portalVariant;
  }
};
