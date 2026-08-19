import React, { useEffect, useState } from 'react';
import { BellRing, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { usePwaPushNotifications } from '../../hooks/usePwaPushNotifications';
import {
  pwaNotificationPromptWasShown,
  rememberPwaNotificationPrompt,
  shouldShowPwaNotificationPrompt,
} from '../../utils/pwaNotificationPrompt';

export const PwaNotificationPermissionPrompt: React.FC<{
  authenticated: boolean;
}> = ({ authenticated }) => {
  const phoneNotifications = usePwaPushNotifications('portal');
  const [visible, setVisible] = useState(false);
  const [handledThisSession, setHandledThisSession] = useState(false);

  useEffect(() => {
    if (handledThisSession || visible) return;
    if (!shouldShowPwaNotificationPrompt({
      authenticated,
      installed: phoneNotifications.installed,
      pushState: phoneNotifications.state,
      previouslyPrompted: pwaNotificationPromptWasShown(),
    })) return;

    const timer = window.setTimeout(() => {
      rememberPwaNotificationPrompt();
      setHandledThisSession(true);
      setVisible(true);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [authenticated, handledThisSession, phoneNotifications.installed, phoneNotifications.state, visible]);

  useEffect(() => {
    if (!visible) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !phoneNotifications.working) setVisible(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [phoneNotifications.working, visible]);

  if (!visible) return null;

  const enable = async () => {
    try {
      await phoneNotifications.enable();
      setVisible(false);
      toast.success('Phone notifications enabled on this device');
    } catch (error) {
      setVisible(false);
      toast.error(error instanceof Error ? error.message : 'Phone notifications could not be enabled');
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:items-center sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-notification-prompt-title"
        aria-describedby="pwa-notification-prompt-description"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-white/20 bg-white shadow-2xl"
      >
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-sky-500 px-6 pb-6 pt-7 text-white">
          <button
            type="button"
            onClick={() => setVisible(false)}
            disabled={phoneNotifications.working}
            aria-label="Not now"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <BellRing className="h-7 w-7" />
          </div>
          <h2 id="pwa-notification-prompt-title" className="mt-5 text-2xl font-bold tracking-tight">
            Stay up to date
          </h2>
          <p id="pwa-notification-prompt-description" className="mt-2 text-sm leading-6 text-blue-50">
            Allow the BFC Portal to show booking updates, lesson records, approvals and important club notifications on this device.
          </p>
        </div>

        <div className="space-y-5 px-6 py-6">
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="flex items-start gap-3">
              <span className="mt-0.5 rounded-full bg-emerald-100 p-1 text-emerald-700"><Check className="h-3.5 w-3.5" /></span>
              Notifications open the relevant portal page when tapped.
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 rounded-full bg-blue-100 p-1 text-blue-700"><ShieldCheck className="h-3.5 w-3.5" /></span>
              You can disable or test them later in Notification Preferences.
            </li>
          </ul>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setVisible(false)}
              disabled={phoneNotifications.working}
              className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Not now
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => void enable()}
              disabled={phoneNotifications.working}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-800 disabled:opacity-60"
            >
              {phoneNotifications.working ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
              Allow notifications
            </button>
          </div>
          <p className="text-center text-xs leading-5 text-slate-500">
            This welcome prompt appears once for this installed app. Your choice can be changed in Settings.
          </p>
        </div>
      </section>
    </div>
  );
};
