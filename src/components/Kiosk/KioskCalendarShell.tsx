import React from 'react';
import { LogOut } from 'lucide-react';
import { isDaylightThemeTime } from '../../utils/theme';

interface KioskCalendarShellProps {
  onExit: () => void | Promise<void>;
  children: React.ReactNode;
  themePreference?: 'light' | 'dark' | 'day-night' | 'auto';
}

const getKioskTheme = (themePreference: KioskCalendarShellProps['themePreference']) => {
  if (themePreference === 'light' || themePreference === 'dark') {
    return themePreference;
  }

  if (themePreference === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return isDaylightThemeTime() ? 'light' : 'dark';
};

export const KioskCalendarShell: React.FC<KioskCalendarShellProps> = ({
  onExit,
  children,
  themePreference = 'day-night',
}) => {
  const [kioskTheme, setKioskTheme] = React.useState<'light' | 'dark'>(() => getKioskTheme(themePreference));

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void onExit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExit]);

  React.useEffect(() => {
    const refreshTheme = () => setKioskTheme(getKioskTheme(themePreference));
    refreshTheme();
    const intervalId = window.setInterval(refreshTheme, 60_000);
    return () => window.clearInterval(intervalId);
  }, [themePreference]);

  React.useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-portal-theme');
    const previousVariant = root.getAttribute('data-portal-variant');

    root.setAttribute('data-portal-theme', kioskTheme);
    root.removeAttribute('data-portal-variant');

    return () => {
      if (previousTheme) {
        root.setAttribute('data-portal-theme', previousTheme);
      } else {
        root.removeAttribute('data-portal-theme');
      }

      if (previousVariant) {
        root.setAttribute('data-portal-variant', previousVariant);
      } else {
        root.removeAttribute('data-portal-variant');
      }
    };
  }, [kioskTheme]);

  return (
    <div
      className="kiosk-app-surface h-screen overflow-y-auto overflow-x-hidden bg-slate-100 text-gray-950"
      data-kiosk-theme={kioskTheme}
    >
      <button
        type="button"
        onClick={() => void onExit()}
        className="fixed bottom-3 right-3 z-50 inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white/90 px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm backdrop-blur transition hover:bg-white"
        title="Logout of kiosk mode"
      >
        <LogOut className="h-3.5 w-3.5" />
        Logout
      </button>
      <main className="min-h-full">
        {children}
      </main>
    </div>
  );
};
