import React from 'react';

interface KioskCalendarShellProps {
  onExit: () => void | Promise<void>;
  children: React.ReactNode;
}

export const KioskCalendarShell: React.FC<KioskCalendarShellProps> = ({
  onExit,
  children,
}) => {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void onExit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExit]);

  return (
    <div className="kiosk-app-surface h-screen overflow-hidden bg-gray-100 text-gray-950 dark:bg-gray-100 dark:text-gray-950">
      <main className="h-full">
        {children}
      </main>
    </div>
  );
};
