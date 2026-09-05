import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Notification } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLatestEffect } from './useLatestEffect';
import {
  getUnreadNotificationCount,
  syncAppNotificationBadge,
} from '../utils/notificationBadge';

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const unreadCount = useMemo(
    () => getUnreadNotificationCount(notifications),
    [notifications],
  );

  useEffect(() => {
    // The initial empty array is only a loading placeholder. Wait for the
    // authoritative database result before clearing delivered OS notifications.
    if (loading) return;
    void syncAppNotificationBadge(unreadCount).catch(() => undefined);
  }, [loading, unreadCount]);

  const fetchNotifications = async () => {
    if (!user?.id) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const notificationsList: Notification[] = (data || []).map(n => ({
        id: n.id,
        userId: n.user_id,
        type: n.type,
        title: n.title,
        message: n.message,
        bookingId: n.booking_id,
        metadata: n.metadata ?? undefined,
        isRead: n.is_read,
        createdAt: new Date(n.created_at)
      }));

      setNotifications(notificationsList);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev =>
        prev.map(n => (n.id === notificationId ? { ...n, isRead: true } : n))
      );
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (error) throw error;

      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (err) {
      console.error('Error marking all notifications as read:', err);
    }
  };

  const clearAllNotifications = async () => {
    if (!user?.id) return false;

    try {
      // Mark first so the unread badge clears even if a later delete is
      // interrupted. Deletion then removes the cleared items from the tray.
      const { error: readError } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (readError) throw readError;
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));

      const { error: deleteError } = await supabase
        .from('notifications')
        .delete()
        .eq('user_id', user.id);

      if (deleteError) throw deleteError;
      setNotifications([]);
      return true;
    } catch (err) {
      console.error('Error clearing notifications:', err);
      await fetchNotifications();
      return false;
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      // Publish a read transition before deleting so every open portal window
      // receives a filterable UPDATE event and can reconcile its app badge.
      const { error: readError } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId)
        .eq('is_read', false);

      if (readError) throw readError;

      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev => prev.filter(n => n.id !== notificationId));
    } catch (err) {
      console.error('Error deleting notification:', err);
    }
  };

  useLatestEffect(() => {
    fetchNotifications();

    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user?.id}`
        },
        () => {
          fetchNotifications();
        }
      )
      .subscribe();

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void fetchNotifications();
    };
    const refreshOnFocus = () => void fetchNotifications();
    window.addEventListener('focus', refreshOnFocus);
    window.addEventListener('pageshow', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('focus', refreshOnFocus);
      window.removeEventListener('pageshow', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [user?.id]);

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    clearAllNotifications,
    deleteNotification,
    refetch: fetchNotifications
  };
};
