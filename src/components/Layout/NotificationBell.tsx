import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X, AlertCircle, Info, Calendar, ClipboardList, Check, XCircle } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import { useBookings } from '../../hooks/useBookings';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';

export const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification } = useNotifications();
  const { approveBooking, rejectBooking } = useBookings(false);
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const navigate = useNavigate();

  const getIcon = (type: string) => {
    switch (type) {
      case 'conflict':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      case 'reminder':
        return <Calendar className="h-5 w-5 text-blue-500" />;
      case 'training_record':
        return <ClipboardList className="h-5 w-5 text-amber-500" />;
      case 'booking_approval':
        return <Calendar className="h-5 w-5 text-amber-500" />;
      default:
        return <Info className="h-5 w-5 text-gray-500" />;
    }
  };

  const handleNotificationClick = (notification: { id: string; type: string; metadata?: Record<string, string> }) => {
    markAsRead(notification.id);
    setIsOpen(false);
    if (notification.type === 'training_record' && notification.metadata?.student_id) {
      const isOwnStudentRecord =
        (user?.role === 'student' || user?.role === 'pilot') &&
        notification.metadata.student_id === user.id;

      navigate(isOwnStudentRecord
        ? '/profile?tab=training'
        : `/students/${notification.metadata.student_id}?tab=training`
      );
    }
    if (notification.type === 'booking_approval' && notification.metadata?.booking_id) {
      navigate('/calendar?view=list');
    }
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

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative rounded-full p-2.5 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-semibold text-white ring-2 ring-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && createPortal(
        <>
          <div
            className="fixed inset-0 z-[90]"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed left-3 right-3 top-24 z-[100] flex max-h-[calc(100vh-7rem)] flex-col rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-[#363b45] dark:bg-[#171a21] sm:left-auto sm:right-6 sm:top-20 sm:w-96 sm:max-h-[32rem] lg:right-8">
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-[#2c2f36]">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
              <div className="flex items-center space-x-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
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
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 transition-colors ${
                        !notification.isRead ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-gray-50 dark:hover:bg-[#1f242c]'
                      }`}
                    >
                      <div className="flex items-start space-x-3">
                        <div className="flex-shrink-0 mt-1">
                          {getIcon(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between">
                            <p
                              className="text-sm font-medium text-gray-900 cursor-pointer dark:text-gray-100"
                              onClick={() => handleNotificationClick(notification)}
                            >
                              {notification.title}
                            </p>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteNotification(notification.id);
                              }}
                              className="ml-2 text-gray-400 hover:text-gray-600 flex-shrink-0 dark:hover:text-gray-200"
                              aria-label="Delete notification"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <p
                            className="text-sm text-gray-600 mt-1 cursor-pointer dark:text-gray-300"
                            onClick={() => handleNotificationClick(notification)}
                          >
                            {notification.message}
                          </p>
                          <p className="text-xs text-gray-400 mt-1 dark:text-gray-500">
                            {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                          </p>

                          {notification.type === 'booking_approval' && !notification.isRead && (
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() => handleApprove(notification)}
                                disabled={processingId === notification.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                              >
                                <Check className="h-3.5 w-3.5" />
                                Approve
                              </button>
                              <button
                                onClick={() => handleReject(notification)}
                                disabled={processingId === notification.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors dark:bg-[#11141a] dark:hover:bg-red-950/30"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                Deny
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
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
