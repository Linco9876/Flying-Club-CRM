import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { storePortalTheme } from '../utils/theme';

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
  show_weekends: boolean;
  highlight_unlogged_bookings: boolean;
  hidden_resources: string[];
  resource_order: { id: string; type: 'aircraft' | 'instructor' }[];
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
  prevent_past_bookings: boolean;
  enforce_max_duration: boolean;
  max_booking_duration_hours: number;
  fatigue_rules_enabled: boolean;
  fatigue_late_finish_time: string;
  fatigue_early_start_time: string;
  fatigue_min_rest_hours: number;
  fatigue_max_duty_hours_per_day: number;
  fatigue_max_flight_hours_per_day: number;
  fatigue_max_late_finishes_7_days: number;
  fatigue_include_supervision: boolean;
  fatigue_block_on_breach: boolean;
}

export interface NotificationSettings {
  id: string;
  email_notifications_enabled: boolean;
  sms_notifications_enabled: boolean;
  in_app_notifications_enabled: boolean;
  booking_confirmation_enabled: boolean;
  booking_reminder_24h_enabled: boolean;
  booking_reminder_2h_enabled: boolean;
  booking_change_notification_enabled: boolean;
  cancellation_notification_enabled: boolean;
  waitlist_notification_enabled: boolean;
  instructor_absence_notification_enabled: boolean;
  maintenance_alert_enabled: boolean;
  maintenance_due_alert_days: number;
  maintenance_due_alert_hours: number;
  defect_report_notification_enabled: boolean;
  safety_report_notification_enabled: boolean;
  approval_request_notification_enabled: boolean;
  currency_expiry_alert_days: number;
  overdue_flight_record_alert_hours: number;
  daily_ops_digest_enabled: boolean;
  daily_ops_digest_time: string;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

export interface UserPreferences {
  id?: string;
  user_id: string;
  preferences?: Record<string, unknown>;
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
  background_color: string;
  background_image_url: string;
  background_filter_color: string;
  background_filter_opacity: number;
}

export const defaultUserPreferences = (userId: string): Omit<UserPreferences, 'id'> => ({
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
  theme: 'auto',
  show_progress_dashboard: true,
  show_upcoming_bookings: true,
  show_recent_activity: true,
  compact_view: false,
  background_color: '#f3f4f6',
  background_image_url: '',
  background_filter_color: '#0f172a',
  background_filter_opacity: 72,
  preferences: {},
});

export interface PortalUxSettings {
  id: string;
  theme: 'light' | 'semi-dark' | 'dark' | 'auto';
  date_format: string;
  time_format: '24h' | '12h';
  flight_time_decimals: number;
  currency_decimals: number;
  show_invoices_in_portal: boolean;
  show_study_tasks_in_portal: boolean;
  show_progress_tracking: boolean;
  allow_self_booking: boolean;
  allow_booking_cancellation: boolean;
  max_advance_booking_days: number;
}

export const defaultPortalUxSettings: Omit<PortalUxSettings, 'id'> = {
  theme: 'auto',
  date_format: 'dd/MM/yyyy',
  time_format: '24h',
  flight_time_decimals: 1,
  currency_decimals: 2,
  show_invoices_in_portal: true,
  show_study_tasks_in_portal: true,
  show_progress_tracking: true,
  allow_self_booking: true,
  allow_booking_cancellation: true,
  max_advance_booking_days: 30,
};

export const usePortalUxSettings = () => {
  const [settings, setSettings] = useState<PortalUxSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const resolvedSettings = useMemo(
    () => settings ?? ({ id: '', ...defaultPortalUxSettings } as PortalUxSettings),
    [settings]
  );

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('portal_ux_settings')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      setSettings(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    const handleUpdated = () => fetchSettings();
    window.addEventListener('portal-ux-settings-updated', handleUpdated);
    return () => window.removeEventListener('portal-ux-settings-updated', handleUpdated);
  }, []);

  const updateSettings = async (updates: Partial<PortalUxSettings>) => {
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      ...defaultPortalUxSettings,
      ...(settings ?? {}),
      ...updates,
      updated_at: new Date().toISOString(),
      updated_by: userData.user?.id,
    };

    const query = settings?.id
      ? supabase.from('portal_ux_settings').update(payload).eq('id', settings.id)
      : supabase.from('portal_ux_settings').insert(payload);
    const { error } = await query;

    if (error) {
      toast.error('Failed to save Portal & UX settings');
      throw error;
    }

    await fetchSettings();
    window.dispatchEvent(new Event('portal-ux-settings-updated'));
    toast.success('Portal & UX settings saved');
  };

  return {
    settings: resolvedSettings,
    loading,
    error,
    updateSettings,
    refetch: fetchSettings,
  };
};

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

    const handleSettingsUpdated = () => {
      fetchSettings();
    };

    window.addEventListener('organisation-settings-updated', handleSettingsUpdated);
    return () => {
      window.removeEventListener('organisation-settings-updated', handleSettingsUpdated);
    };
  }, []);

  const uploadLogo = async (file: File): Promise<string | null> => {
    const ext = file.name.split('.').pop();
    const path = `logo.${ext}`;
    const { error } = await supabase.storage
      .from('org-logos')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    const { data } = supabase.storage.from('org-logos').getPublicUrl(path);
    // Bust the browser cache by appending a timestamp
    return `${data.publicUrl}?t=${Date.now()}`;
  };

  const updateSettings = async (updates: Partial<OrganisationSettings>, logoFile?: File | null) => {
    try {
      const { data: userData } = await supabase.auth.getUser();

      let logoUrl = updates.logo_url;
      if (logoFile) {
        logoUrl = await uploadLogo(logoFile) ?? undefined;
      }

      const payload = {
        club_name: updates.club_name ?? settings?.club_name ?? '',
        address: updates.address ?? settings?.address ?? '',
        timezone: updates.timezone ?? settings?.timezone ?? 'Australia/Melbourne',
        currency: updates.currency ?? settings?.currency ?? 'AUD',
        contact_email: updates.contact_email ?? settings?.contact_email ?? '',
        contact_phone: updates.contact_phone ?? settings?.contact_phone ?? '',
        website: updates.website ?? settings?.website ?? '',
        student_portal_url: updates.student_portal_url ?? settings?.student_portal_url ?? '',
        booking_day_start: updates.booking_day_start ?? settings?.booking_day_start ?? '06:00',
        booking_day_end: updates.booking_day_end ?? settings?.booking_day_end ?? '22:00',
        default_slot_length: updates.default_slot_length ?? settings?.default_slot_length ?? 30,
        ...(logoUrl !== undefined ? { logo_url: logoUrl } : {}),
        updated_at: new Date().toISOString(),
        updated_by: userData.user?.id,
      };

      const query = settings?.id
        ? supabase.from('organisation_settings').update(payload).eq('id', settings.id)
        : supabase.from('organisation_settings').insert(payload);
      const { error } = await query;

      if (error) throw error;

      await fetchSettings();
      window.dispatchEvent(new Event('organisation-settings-updated'));
      toast.success('Organisation settings saved');
    } catch (err: any) {
      toast.error('Failed to save organisation settings');
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
    const handleUpdated = () => fetchSettings();
    window.addEventListener('calendar-settings-updated', handleUpdated);
    return () => window.removeEventListener('calendar-settings-updated', handleUpdated);
  }, []);

  const updateSettings = async (updates: Partial<CalendarSettings>) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        default_view: updates.default_view ?? settings?.default_view ?? 'day',
        show_current_time_indicator: updates.show_current_time_indicator ?? settings?.show_current_time_indicator ?? true,
        snap_duration: updates.snap_duration ?? settings?.snap_duration ?? 15,
        double_height_slots: updates.double_height_slots ?? settings?.double_height_slots ?? false,
        resource_display_order: updates.resource_display_order ?? settings?.resource_display_order ?? 'aircraft-first',
        conflict_rules: updates.conflict_rules ?? settings?.conflict_rules ?? 'waitlist',
        week_starts_on: updates.week_starts_on ?? settings?.week_starts_on ?? 'monday',
        show_weekends: updates.show_weekends ?? settings?.show_weekends ?? true,
        highlight_unlogged_bookings: updates.highlight_unlogged_bookings ?? settings?.highlight_unlogged_bookings ?? false,
        hidden_resources: updates.hidden_resources ?? settings?.hidden_resources ?? [],
        resource_order: updates.resource_order ?? settings?.resource_order ?? [],
        updated_at: new Date().toISOString(),
        updated_by: userData.user?.id
      };

      const query = settings?.id
        ? supabase.from('calendar_settings').update(payload).eq('id', settings.id)
        : supabase.from('calendar_settings').insert(payload);
      const { error } = await query;

      if (error) throw error;

      await fetchSettings();
      window.dispatchEvent(new Event('calendar-settings-updated'));
      toast.success('Calendar settings updated successfully');
    } catch (err: any) {
      toast.error('Failed to update calendar settings');
      throw err;
    }
  };

  const updateSettingsSilent = async (updates: Partial<CalendarSettings>) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        default_view: updates.default_view ?? settings?.default_view ?? 'day',
        show_current_time_indicator: updates.show_current_time_indicator ?? settings?.show_current_time_indicator ?? true,
        snap_duration: updates.snap_duration ?? settings?.snap_duration ?? 15,
        double_height_slots: updates.double_height_slots ?? settings?.double_height_slots ?? false,
        resource_display_order: updates.resource_display_order ?? settings?.resource_display_order ?? 'aircraft-first',
        conflict_rules: updates.conflict_rules ?? settings?.conflict_rules ?? 'waitlist',
        week_starts_on: updates.week_starts_on ?? settings?.week_starts_on ?? 'monday',
        show_weekends: updates.show_weekends ?? settings?.show_weekends ?? true,
        highlight_unlogged_bookings: updates.highlight_unlogged_bookings ?? settings?.highlight_unlogged_bookings ?? false,
        hidden_resources: updates.hidden_resources ?? settings?.hidden_resources ?? [],
        resource_order: updates.resource_order ?? settings?.resource_order ?? [],
        updated_at: new Date().toISOString(),
        updated_by: userData.user?.id
      };

      const query = settings?.id
        ? supabase.from('calendar_settings').update(payload).eq('id', settings.id)
        : supabase.from('calendar_settings').insert(payload);
      const { error } = await query;

      if (error) throw error;

      setSettings(prev => prev ? { ...prev, ...updates } : { id: '', ...payload } as CalendarSettings);
    } catch (err: any) {
      // silent
    }
  };

  return { settings, loading, error, updateSettings, updateSettingsSilent, refetch: fetchSettings };
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
    const handleUpdated = () => fetchSettings();
    window.addEventListener('booking-rules-settings-updated', handleUpdated);
    return () => window.removeEventListener('booking-rules-settings-updated', handleUpdated);
  }, []);

  const updateSettings = async (updates: Partial<BookingRulesSettings>) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        min_booking_notice_hours: updates.min_booking_notice_hours ?? settings?.min_booking_notice_hours ?? 0,
        max_booking_advance_days: updates.max_booking_advance_days ?? settings?.max_booking_advance_days ?? 365,
        allow_double_booking: updates.allow_double_booking ?? settings?.allow_double_booking ?? false,
        require_instructor_approval: updates.require_instructor_approval ?? settings?.require_instructor_approval ?? false,
        cancellation_notice_hours: updates.cancellation_notice_hours ?? settings?.cancellation_notice_hours ?? 0,
        enforce_min_notice: updates.enforce_min_notice ?? settings?.enforce_min_notice ?? false,
        enforce_max_advance: updates.enforce_max_advance ?? settings?.enforce_max_advance ?? false,
        enforce_cancellation_notice: updates.enforce_cancellation_notice ?? settings?.enforce_cancellation_notice ?? false,
        prevent_past_bookings: updates.prevent_past_bookings ?? settings?.prevent_past_bookings ?? false,
        enforce_max_duration: updates.enforce_max_duration ?? settings?.enforce_max_duration ?? false,
        max_booking_duration_hours: updates.max_booking_duration_hours ?? settings?.max_booking_duration_hours ?? 8,
        fatigue_rules_enabled: updates.fatigue_rules_enabled ?? settings?.fatigue_rules_enabled ?? true,
        fatigue_late_finish_time: updates.fatigue_late_finish_time ?? settings?.fatigue_late_finish_time ?? '22:00',
        fatigue_early_start_time: updates.fatigue_early_start_time ?? settings?.fatigue_early_start_time ?? '07:00',
        fatigue_min_rest_hours: updates.fatigue_min_rest_hours ?? settings?.fatigue_min_rest_hours ?? 12,
        fatigue_max_duty_hours_per_day: updates.fatigue_max_duty_hours_per_day ?? settings?.fatigue_max_duty_hours_per_day ?? 11,
        fatigue_max_flight_hours_per_day: updates.fatigue_max_flight_hours_per_day ?? settings?.fatigue_max_flight_hours_per_day ?? 7,
        fatigue_max_late_finishes_7_days: updates.fatigue_max_late_finishes_7_days ?? settings?.fatigue_max_late_finishes_7_days ?? 3,
        fatigue_include_supervision: updates.fatigue_include_supervision ?? settings?.fatigue_include_supervision ?? true,
        fatigue_block_on_breach: updates.fatigue_block_on_breach ?? settings?.fatigue_block_on_breach ?? true,
        updated_at: new Date().toISOString(),
        updated_by: userData.user?.id
      };

      const query = settings?.id
        ? supabase.from('booking_rules_settings').update(payload).eq('id', settings.id)
        : supabase.from('booking_rules_settings').insert(payload);
      const { error } = await query;

      if (error) throw error;

      await fetchSettings();
      window.dispatchEvent(new Event('booking-rules-settings-updated'));
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

  const defaultNotificationSettings: Omit<NotificationSettings, 'id'> = {
    email_notifications_enabled: true,
    sms_notifications_enabled: false,
    in_app_notifications_enabled: true,
    booking_confirmation_enabled: true,
    booking_reminder_24h_enabled: true,
    booking_reminder_2h_enabled: true,
    booking_change_notification_enabled: true,
    cancellation_notification_enabled: true,
    waitlist_notification_enabled: true,
    instructor_absence_notification_enabled: true,
    maintenance_alert_enabled: true,
    maintenance_due_alert_days: 14,
    maintenance_due_alert_hours: 10,
    defect_report_notification_enabled: true,
    safety_report_notification_enabled: true,
    approval_request_notification_enabled: true,
    currency_expiry_alert_days: 30,
    overdue_flight_record_alert_hours: 24,
    daily_ops_digest_enabled: false,
    daily_ops_digest_time: '07:00',
    quiet_hours_enabled: false,
    quiet_hours_start: '20:00',
    quiet_hours_end: '07:00',
  };

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('notification_settings')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      setSettings(data ? { ...defaultNotificationSettings, ...data } : null);
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
    try {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        ...defaultNotificationSettings,
        ...updates,
        updated_at: new Date().toISOString(),
        updated_by: userData.user?.id
      };

      if (!settings?.id) {
        const { error: insertError } = await supabase
          .from('notification_settings')
          .insert(payload);

        if (insertError) throw insertError;
      } else {
        const { error } = await supabase
          .from('notification_settings')
          .update(payload)
          .eq('id', settings.id);

        if (error) throw error;
      }

      await fetchSettings();
      window.dispatchEvent(new Event('notification-settings-updated'));
      toast.success('Notification settings updated successfully');
    } catch (err: any) {
      console.error('Failed to update notification settings:', err);
      toast.error(`Failed to update notification settings: ${err.message || 'Unknown error'}`);
      throw err;
    }
  };

  return {
    settings: settings ?? ({ id: '', ...defaultNotificationSettings } as NotificationSettings),
    loading,
    error,
    updateSettings,
    refetch: fetchSettings
  };
};

export const useUserPreferences = (userId: string) => {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const buildPreferencesPayload = (nextPreferences: Omit<UserPreferences, 'id'> & { id?: string }) => ({
    user_id: nextPreferences.user_id,
    email_notifications: nextPreferences.email_notifications,
    sms_notifications: nextPreferences.sms_notifications,
    booking_reminders: nextPreferences.booking_reminders,
    currency_alerts: nextPreferences.currency_alerts,
    maintenance_alerts: nextPreferences.maintenance_alerts,
    timezone: nextPreferences.timezone,
    date_format: nextPreferences.date_format,
    time_format: nextPreferences.time_format,
    default_calendar_view: nextPreferences.default_calendar_view,
    theme: nextPreferences.theme,
    show_progress_dashboard: nextPreferences.show_progress_dashboard,
    show_upcoming_bookings: nextPreferences.show_upcoming_bookings,
    show_recent_activity: nextPreferences.show_recent_activity,
    compact_view: nextPreferences.compact_view,
    background_color: nextPreferences.background_color,
    preferences: {
      ...((nextPreferences.preferences as Record<string, unknown>) || {}),
      email_notifications: nextPreferences.email_notifications,
      sms_notifications: nextPreferences.sms_notifications,
      booking_reminders: nextPreferences.booking_reminders,
      currency_alerts: nextPreferences.currency_alerts,
      maintenance_alerts: nextPreferences.maintenance_alerts,
      timezone: nextPreferences.timezone,
      date_format: nextPreferences.date_format,
      time_format: nextPreferences.time_format,
      default_calendar_view: nextPreferences.default_calendar_view,
      theme: nextPreferences.theme,
      show_progress_dashboard: nextPreferences.show_progress_dashboard,
      show_upcoming_bookings: nextPreferences.show_upcoming_bookings,
      show_recent_activity: nextPreferences.show_recent_activity,
      compact_view: nextPreferences.compact_view,
      background_color: nextPreferences.background_color,
    },
    updated_at: new Date().toISOString(),
  });

  const normalizePreferences = (data: any): UserPreferences => {
    const jsonPreferences = data?.preferences && typeof data.preferences === 'object' ? data.preferences : {};
    const defaults = defaultUserPreferences(data?.user_id || userId);

    return {
      ...defaults,
      ...jsonPreferences,
      ...data,
      email_notifications: data?.email_notifications ?? jsonPreferences.email_notifications ?? defaults.email_notifications,
      sms_notifications: data?.sms_notifications ?? jsonPreferences.sms_notifications ?? defaults.sms_notifications,
      booking_reminders: data?.booking_reminders ?? jsonPreferences.booking_reminders ?? defaults.booking_reminders,
      currency_alerts: data?.currency_alerts ?? jsonPreferences.currency_alerts ?? defaults.currency_alerts,
      maintenance_alerts: data?.maintenance_alerts ?? jsonPreferences.maintenance_alerts ?? defaults.maintenance_alerts,
      timezone: data?.timezone ?? jsonPreferences.timezone ?? defaults.timezone,
      date_format: data?.date_format ?? jsonPreferences.date_format ?? defaults.date_format,
      time_format: data?.time_format ?? jsonPreferences.time_format ?? defaults.time_format,
      default_calendar_view: data?.default_calendar_view ?? jsonPreferences.default_calendar_view ?? defaults.default_calendar_view,
      theme: data?.theme ?? jsonPreferences.theme ?? defaults.theme,
      show_progress_dashboard: data?.show_progress_dashboard ?? jsonPreferences.show_progress_dashboard ?? defaults.show_progress_dashboard,
      show_upcoming_bookings: data?.show_upcoming_bookings ?? jsonPreferences.show_upcoming_bookings ?? defaults.show_upcoming_bookings,
      show_recent_activity: data?.show_recent_activity ?? jsonPreferences.show_recent_activity ?? defaults.show_recent_activity,
      compact_view: data?.compact_view ?? jsonPreferences.compact_view ?? defaults.compact_view,
      background_color: data?.background_color ?? jsonPreferences.background_color ?? defaults.background_color,
      background_image_url: data?.background_image_url ?? jsonPreferences.background_image_url ?? defaults.background_image_url,
      background_filter_color: data?.background_filter_color ?? jsonPreferences.background_filter_color ?? defaults.background_filter_color,
      background_filter_opacity: Number(data?.background_filter_opacity ?? jsonPreferences.background_filter_opacity ?? defaults.background_filter_opacity),
      preferences: jsonPreferences,
    };
  };

  const fetchPreferences = async () => {
    if (!userId) {
      setPreferences(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        const defaultPreferences = defaultUserPreferences(userId);

        const { data: newData, error: insertError } = await supabase
          .from('user_preferences')
          .upsert(defaultPreferences, { onConflict: 'user_id' })
          .select()
          .single();

        if (insertError) throw insertError;
        const normalizedPreferences = normalizePreferences(newData);
        setPreferences(normalizedPreferences);
        storePortalTheme(normalizedPreferences.theme, userId);
      } else {
        const normalizedPreferences = normalizePreferences(data);
        setPreferences(normalizedPreferences);
        storePortalTheme(normalizedPreferences.theme, userId);
      }
      setError(null);
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

  useEffect(() => {
    if (!userId) return;

    const handlePreferencesUpdated = () => {
      fetchPreferences();
    };

    window.addEventListener('user-preferences-updated', handlePreferencesUpdated);
    return () => window.removeEventListener('user-preferences-updated', handlePreferencesUpdated);
  }, [userId]);

  const updatePreferences = async (updates: Partial<UserPreferences>) => {
    if (!userId) return;

    try {
      const nextPreferences = {
        ...defaultUserPreferences(userId),
        ...(preferences || {}),
        ...updates,
        preferences: {
          ...((preferences?.preferences as Record<string, unknown>) || {}),
          ...((updates.preferences as Record<string, unknown>) || {}),
        },
      };
      delete (nextPreferences as any).id;

      const { error } = await supabase
        .from('user_preferences')
        .upsert(buildPreferencesPayload(nextPreferences), { onConflict: 'user_id' });

      if (error) throw error;

      storePortalTheme(nextPreferences.theme, userId);
      await fetchPreferences();
      window.dispatchEvent(new Event('user-preferences-updated'));
      toast.success('Preferences updated successfully');
    } catch (err: any) {
      console.error('Failed to update preferences:', err);
      toast.error(`Failed to update preferences: ${err.message || 'Unknown error'}`);
      throw err;
    }
  };

  const updatePreferencesSilent = async (updates: Partial<UserPreferences>) => {
    if (!userId) return;

    const nextPreferences = {
      ...defaultUserPreferences(userId),
      ...(preferences || {}),
      ...updates,
      preferences: {
        ...((preferences?.preferences as Record<string, unknown>) || {}),
        ...((updates.preferences as Record<string, unknown>) || {}),
      },
    };
    delete (nextPreferences as any).id;

    const { error } = await supabase
      .from('user_preferences')
      .upsert(buildPreferencesPayload(nextPreferences), { onConflict: 'user_id' });

    if (error) throw error;

    const normalizedPreferences = normalizePreferences(nextPreferences);
    setPreferences(normalizedPreferences);
    storePortalTheme(normalizedPreferences.theme, userId);
    window.dispatchEvent(new Event('user-preferences-updated'));
  };

  return {
    preferences,
    loading,
    error,
    updatePreferences,
    updatePreferencesSilent,
    refetch: fetchPreferences
  };
};
