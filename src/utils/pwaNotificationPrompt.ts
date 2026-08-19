import type { PwaPushState } from './pushNotifications';

export const PWA_NOTIFICATION_PROMPT_STORAGE_KEY = 'bfc:pwa-notification-permission-prompt:v1';

export const shouldShowPwaNotificationPrompt = ({
  authenticated,
  installed,
  pushState,
  previouslyPrompted,
}: {
  authenticated: boolean;
  installed: boolean;
  pushState: PwaPushState;
  previouslyPrompted: boolean;
}) => authenticated && installed && pushState === 'prompt' && !previouslyPrompted;

export const pwaNotificationPromptWasShown = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PWA_NOTIFICATION_PROMPT_STORAGE_KEY) === 'shown'
      || window.sessionStorage.getItem(PWA_NOTIFICATION_PROMPT_STORAGE_KEY) === 'shown';
  } catch {
    return false;
  }
};

export const rememberPwaNotificationPrompt = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PWA_NOTIFICATION_PROMPT_STORAGE_KEY, 'shown');
  } catch {
    try {
      window.sessionStorage.setItem(PWA_NOTIFICATION_PROMPT_STORAGE_KEY, 'shown');
    } catch {
      // The in-memory component state still prevents another prompt this session.
    }
  }
};
