(() => {
  try {
    let currentUserId = '';
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith('sb-') || !key.includes('-auth-token')) continue;
      try {
        const sessionValue = JSON.parse(localStorage.getItem(key) || '{}');
        currentUserId = sessionValue.user?.id || sessionValue.currentSession?.user?.id || '';
        if (currentUserId) break;
      } catch {
        // Ignore malformed stale session data.
      }
    }
    const userThemeKey = currentUserId ? `bfc.portal.theme.user.${currentUserId}` : '';
    let theme = (userThemeKey && localStorage.getItem(userThemeKey)) || 'auto';
    if (!/^(light|semi-dark|dark|day-night|auto)$/.test(theme)) theme = 'auto';
    const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
    const hour = new Date().getHours();
    const useDark = theme === 'dark'
      || theme === 'semi-dark'
      || (theme === 'day-night' && (hour < 6 || hour >= 18))
      || (theme === 'auto' && prefersDark);
    document.documentElement.dataset.portalTheme = useDark ? 'dark' : 'light';
    if (theme === 'semi-dark') document.documentElement.dataset.portalVariant = 'semi-dark';
  } catch {
    document.documentElement.dataset.portalTheme = 'light';
  }
})();
