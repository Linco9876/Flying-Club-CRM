import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export interface OrganisationSettings {
  id: string;
  club_name: string;
  address: string;
  timezone: string;
  currency: string;
  contact_email: string;
  contact_phone: string;
  website: string;
  student_portal_url: string;
  booking_day_start: string;
  booking_day_end: string;
  default_slot_length: number;
  logo_url?: string;
}

export interface CalendarSettings {
  id: string;
  default_view: string;
  show_current_time_indicator: boolean;
  snap_duration: number;
  double_height_slots: boolean;
  resource_display_order: string;
  conflict_rules: string;
  week_starts_on: string;
}

export interface BookingRulesSettings {
  id: string;
  min_booking_notice_hours: number;
  max_booking_advance_days: number;
  allow_double_booking: boolean;
  require_instructor_approval: boolean;
  cancellation_notice_hours: number;
  enforce_min_notice: boolean;
  enforce_max_advance: boolean;
  enforce_cancellation_notice: boolean;
}

export interface NotificationSettings {
  id: string;
  booking_confirmation_enabled: boolean;
  booking_reminder_24h_enabled: boolean;
  booking_reminder_2h_enabled: boolean;
  cancellation_notification_enabled: boolean;
  maintenance_alert_enabled: boolean;
  currency_expiry_alert_days: number;
}

export interface UserPreferences {
  id?: string;
  user_id: string;
  email_notifications: boolean;
  sms_notifications: boolean;
  booking_reminders: boolean;
  currency_alerts: boolean;
  maintenance_alerts: boolean;
  timezone: string;
  date_format: string;
  time_format: string;
  default_calendar_view: string;
  theme: string;
  show_progress_dashboard: boolean;
  show_upcoming_bookings: boolean;
  show_recent_activity: boolean;
  compact_view: boolean;
}

export const useOrganisationSettings = () => {
  const [settings, setSettings] = useState<OrganisationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('organisation_settings')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      setSettings(data);
    } catch (err: any) {
      setError(err.message);
      toast.error('Failed to load organisation settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const updateSettings = async (updates: Partial<OrganisationSettings>) => {
    if (!settings) return;

    try {
      const { data: userData } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('organisation_settings')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
          updated_by: userData.user?.id
        })
        .eq('id', settings.id);

      if (error) throw error;

      await fetchSettings();
      toast.success('Organisation settings updated successfully');
    } catch (err: any) {
      toast.error('Failed to update organisation settings');
      throw err;
    }
  };

  return { settings, loading, error, updateSettings, refetch: fetchSettings };
};

export const useCalendarSettings = () => {
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('calendar_settings')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      setSettings(data);
    } catch (err: any) {
      setError(err.message);
      toast.error('Failed to load calendar settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const updateSettings = async (updates: Partial<CalendarSettings>) => {
    if (!settings) return;

    try {
      const { data: userData } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('calendar_settings')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
          updated_by: userData.user?.id
        })
        .eq('id', settings.id);

      if (error) throw error;

      await fetchSettings();
      toast.success('Calendar settings updated successfully');
    } catch (err: any) {
      toast.error('Failed to update calendar settings');
      throw err;
    }
  };

  return { settings, loading, error, updateSettings, refetch: fetchSettings };
};

export const useBookingRulesSettings = () => {
  const [settings, setSettings] = useState<BookingRulesSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('booking_rules_settings')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      setSettings(data);
    } catch (err: any) {
      setError(err.message);
      toast.error('Failed to load booking rules settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const updateSettings = async (updates: Partial<BookingRulesSettings>) => {
    if (!settings) return;

    try {
      const { data: userData } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('booking_rules_settings')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
          updated_by: userData.user?.id
        })
        .eq('id', settings.id);

      if (error) throw error;

      await fetchSettings();
      toast.success('Booking rules settings updated successfully');
    } catch (err: any) {
      toast.error('Failed to update booking rules settings');
      throw err;
    }
  };

  return { settings, loading, error, updateSettings, refetch: fetchSettings };
};

export const useNotificationSettings = () => {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('notification_settings')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      setSettings(data);
    } catch (err: any) {
      setError(err.message);
      toast.error('Failed to load notification settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const updateSettings = async (updates: Partial<NotificationSettings>) => {
    if (!settings) return;

    try {
      const { data: userData } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('notification_settings')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
          updated_by: userData.user?.id
        })
        .eq('id', settings.id);

      if (error) throw error;

      await fetchSettings();
      toast.success('Notification settings updated successfully');
    } catch (err: any) {
      toast.error('Failed to update notification settings');
      throw err;
    }
  };

  return { settings, loading, error, updateSettings, refetch: fetchSettings };
};

export const useUserPreferences = (userId: string) => {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPreferences = async () => {
    try {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        const defaultPreferences: Omit<UserPreferences, 'id'> = {
          user_id: userId,
          email_notifications: true,
          sms_notifications: false,
          booking_reminders: true,
          currency_alerts: true,
          maintenance_alerts: true,
          timezone: 'Australia/Melbourne',
          date_format: 'dd/MM/yyyy',
          time_format: '24h',
          default_calendar_view: 'day',
          theme: 'light',
          show_progress_dashboard: true,
          show_upcoming_bookings: true,
          show_recent_activity: true,
          compact_view: false
        };

        const { data: newData, error: insertError } = await supabase
          .from('user_preferences')
          .insert(defaultPreferences)
          .select()
          .single();

        if (insertError) throw insertError;
        setPreferences(newData);
      } else {
        setPreferences(data);
      }
    } catch (err: any) {
      setError(err.message);
      toast.error('Failed to load user preferences');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      fetchPreferences();
    }
  }, [userId]);

  const updatePreferences = async (updates: Partial<UserPreferences>) => {
    if (!preferences) return;

    try {
      const { error } = await supabase
        .from('user_preferences')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (error) throw error;

      await fetchPreferences();
      toast.success('Preferences updated successfully');
    } catch (err: any) {
      toast.error('Failed to update preferences');
      throw err;
    }
  };

  return { preferences, loading, error, updatePreferences, refetch: fetchPreferences };
};
