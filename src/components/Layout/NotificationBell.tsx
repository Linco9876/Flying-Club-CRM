import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X, AlertCircle, Info, Calendar, ClipboardList, Check, XCircle, Clock3, Trash2 } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import { useBookings } from '../../hooks/useBookings';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { getNotificationDestination } from '../../utils/notificationDestination';
import { getNotificationBadgeLabel } from '../../utils/notificationBadge';
import { isOutstandingRecordNotification, openOutstandingRecordPopup } from '../../utils/outstandingRecordPopup';

export const NotificationBell: React.FC = () => {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearAllNotifications,
    deleteNotification,
  } = useNotifications();
  const { approveBooking, rejectBooking } = useBookings(false);
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const navigate = useNavigate();
  const badgeLabel = getNotificationBadgeLabel(unreadCount);

  React.useEffect(() => {
    if (!isOpen) return undefined;
    const originalOverflow = document.body.style.overflow;
    if (window.matchMedia('(max-width: 639px)').matches) document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const getIcon = (type: string) => {
    switch (type) {
      case 'conflict':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      case 'reminder':
        return <Calendar className="h-5 w-5 text-blue-500" />;
      case 'training_record':
        return <ClipboardList className="h-5 w-5 text-amber-500" />;
      case 'outstanding_record':
        return <AlertCircle className="h-5 w-5 text-amber-600" />;
      case 'booking_approval':
        return <Calendar className="h-5 w-5 text-amber-500" />;
      case 'licence_verification':
        return <ClipboardList className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />;
      case 'duty_auto_started':
        return <Clock3 className="h-5 w-5 text-blue-500" />;
      case 'duty_auto_closed':
        return <Clock3 className="h-5 w-5 text-amber-500" />;
      case 'duty_break_reminder':
        return <Clock3 className="h-5 w-5 text-amber-500" />;
      default:
        return <Info className="h-5 w-5 text-gray-500" />;
    }
  };

  const handleNotificationClick = (notification: {
    id: string;
    type: string;
    bookingId?: string;
    metadata?: Record<string, string>;
  }) => {
    const destination = getNotificationDestination(notification, {
      id: user?.id,
      role: user?.role,
    });

    void markAsRead(notification.id);
    setIsOpen(false);
    if (isOutstandingRecordNotification(notification)) {
      openOutstandingRecordPopup({
        flightLogId: notification.metadata?.outstanding_flight_log_id,
      });
      return;
    }
    if (destination) navigate(destination);
  };

  const handleApprove = async (notification: { id: string; metadata?: Record<string, string> }) => {
    const bookingId = notification.metadata?.booking_id;
    if (!bookingId) return;
    setProcessingId(notification.id);
    try {
      await approveBooking(bookingId);
      await markAsRead(notification.id);
      toast.success('Booking approved');
    } catch {
      // error already toasted by approveBooking
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (notification: { id: string; metadata?: Record<string, string> }) => {
    const bookingId = notification.metadata?.booking_id;
    if (!bookingId) return;
    setProcessingId(notification.id);
    try {
      await rejectBooking(bookingId);
      await markAsRead(notification.id);
      toast.success('Booking denied');
    } catch {
      // error already toasted by rejectBooking
    } finally {
      setProcessingId(null);
    }
  };

  const handleClearAll = async () => {
    if (clearingAll || notifications.length === 0) return;
    setClearingAll(true);
    try {
      const cleared = await clearAllNotifications();
      if (cleared) toast.success('All notifications cleared');
      else toast.error('Notifications could not be cleared. Please try again.');
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      >
        <Bell className="h-5 w-5" />
        {badgeLabel && (
          <span aria-hidden="true" className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-semibold text-white ring-2 ring-white">
            {badgeLabel}
          </span>
        )}
      </button>

      {isOpen && createPortal(
        <>
          <div
            className="fixed inset-0 z-[90]"
            onClick={() => setIsOpen(false)}
          />
          <div className="notification-mobile-panel fixed inset-x-0 bottom-0 z-[100] flex h-[min(82dvh,44rem)] flex-col rounded-t-3xl border border-gray-200 bg-white shadow-2xl dark:border-[#363b45] dark:bg-[#171a21] sm:bottom-auto sm:left-auto sm:right-6 sm:top-20 sm:h-auto sm:max-h-[32rem] sm:w-96 sm:rounded-xl lg:right-8" role="dialog" aria-modal="true" aria-label="Notifications">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-[#2c2f36]">
              <h3 className="min-w-0 flex-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
              <div className="flex w-full items-center justify-end gap-1 min-[380px]:w-auto">
                {unreadCount > 0 && (
                  <button
                    onClick={() => void markAllAsRead()}
                    className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-300 dark:hover:bg-blue-950/30 dark:hover:text-blue-200"
                  >
                    <Check className="h-4 w-4" />
                    <span>Read all</span>
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleClearAll()}
                    disabled={clearingAll}
                    className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-600 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/30 dark:hover:text-red-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {clearingAll ? 'Clearing…' : 'Clear all'}
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-[#262b33] dark:hover:text-gray-200"
                  aria-label="Close notifications"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  <Bell className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                  <p>No notifications</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-[#2c2f36]">
                  {notifications.map((notification) => {
                    const destination = getNotificationDestination(notification, {
                      id: user?.id,
                      role: user?.role,
                    });

                    return (
                      <div
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={`cursor-pointer p-4 transition-colors ${
                          !notification.isRead ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-gray-50 dark:hover:bg-[#1f242c]'
                        } ${destination ? 'hover:bg-blue-50/70 dark:hover:bg-blue-950/20' : ''}`}
                      >
                        <div className="flex items-start space-x-3">
                          <div className="flex-shrink-0 mt-1">
                            {getIcon(notification.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleNotificationClick(notification);
                                }}
                                className="min-w-0 flex-1 rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#171a21]"
                                aria-label={destination
                                  ? `Open: ${notification.title}`
                                  : `Mark as read: ${notification.title}`}
                              >
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {notification.title}
                                </p>
                                <p className="text-sm text-gray-600 mt-1 dark:text-gray-300">
                                  {notification.message}
                                </p>
                                <p className="text-xs text-gray-400 mt-1 dark:text-gray-500">
                                  {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                                </p>
                              </button>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void deleteNotification(notification.id);
                                }}
                                className="-mr-2 ml-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-[#262b33] dark:hover:text-gray-200"
                                aria-label="Delete notification"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>

                            {notification.type === 'booking_approval' && !notification.isRead && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleApprove(notification);
                                  }}
                                  disabled={processingId === notification.id}
                                  className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Approve
                                </button>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleReject(notification);
                                  }}
                                  disabled={processingId === notification.id}
                                  className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:bg-[#11141a] dark:hover:bg-red-950/30"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  Deny
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};
