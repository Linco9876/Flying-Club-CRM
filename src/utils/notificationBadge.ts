export interface NotificationReadState {
  isRead: boolean;
}

export const getUnreadNotificationCount = (
  notifications: NotificationReadState[],
) => notifications.reduce((count, notification) => (
  notification.isRead ? count : count + 1
), 0);

export const getNotificationBadgeLabel = (unreadCount: number) => {
  if (unreadCount <= 0) return null;
  return unreadCount > 9 ? '9+' : String(unreadCount);
};

type BadgeNavigator = {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

type BadgeServiceWorker = {
  postMessage: (message: { type: string; unreadCount: number }) => void;
};

type BadgeServiceWorkerContainer = {
  controller?: BadgeServiceWorker | null;
  getRegistration?: (scope?: string) => Promise<{
    active?: BadgeServiceWorker | null;
  } | undefined>;
};

export interface AppBadgeEnvironment {
  navigator?: BadgeNavigator;
  serviceWorker?: BadgeServiceWorkerContainer;
}

const browserBadgeEnvironment = (): AppBadgeEnvironment => {
  if (typeof navigator === 'undefined') return {};
  return {
    navigator: navigator as BadgeNavigator,
    serviceWorker: 'serviceWorker' in navigator
      ? navigator.serviceWorker as unknown as BadgeServiceWorkerContainer
      : undefined,
  };
};

/**
 * Reconciles the installed app badge in both the open page and service worker.
 * Sending zero also asks the worker to dismiss delivered notifications, because
 * some desktop shells derive their taskbar marker from those notifications.
 */
export const syncAppNotificationBadge = async (
  unreadCount: number,
  environment: AppBadgeEnvironment = browserBadgeEnvironment(),
) => {
  const count = Math.max(0, Math.floor(Number.isFinite(unreadCount) ? unreadCount : 0));
  const badgeNavigator = environment.navigator;
  const badgeTasks: Promise<void>[] = [];

  if (count > 0 && badgeNavigator?.setAppBadge) {
    badgeTasks.push(badgeNavigator.setAppBadge(count));
  } else if (count === 0) {
    // Both forms are standards-compliant. Calling both makes clearing reliable
    // across Chromium/Windows versions where only one may update the taskbar.
    if (badgeNavigator?.clearAppBadge) badgeTasks.push(badgeNavigator.clearAppBadge());
    if (badgeNavigator?.setAppBadge) badgeTasks.push(badgeNavigator.setAppBadge(0));
  }

  const serviceWorker = environment.serviceWorker;
  let worker = serviceWorker?.controller;
  if (!worker && serviceWorker?.getRegistration) {
    worker = (await serviceWorker.getRegistration('/'))?.active;
  }
  worker?.postMessage({ type: 'SYNC_NOTIFICATION_BADGE', unreadCount: count });

  await Promise.allSettled(badgeTasks);
};
