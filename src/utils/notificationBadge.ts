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
