import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  Monitor,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { NotificationSettings as NotificationSettingsRecord, useNotificationSettings } from '../../hooks/useSettings';
import { SettingsLoadError } from './SettingsLoadError';

interface NotificationsSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

type NotificationFormData = Omit<NotificationSettingsRecord, 'id'>;
type NotificationField = keyof NotificationFormData;

export const NotificationsSettings: React.FC<NotificationsSettingsProps> = ({ canEdit, onFormChange }) => {
  const { settings, loading, error, updateSettings, refetch } = useNotificationSettings();
  const [formData, setFormData] = useState<NotificationFormData>({
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
  });

  useEffect(() => {
    if (!settings) return;
    const { id, ...values } = settings;
    setFormData(values);
  }, [settings]);

  useEffect(() => {
    (window as any).__notificationsSettingsSave = async () => {
      await updateSettings(formData);
    };
    (window as any).__notificationsSettingsCancel = () => {
      if (!settings) return;
      const { id, ...values } = settings;
      setFormData(values);
    };
    return () => {
      delete (window as any).__notificationsSettingsSave;
      delete (window as any).__notificationsSettingsCancel;
    };
  }, [formData, settings, updateSettings]);

  const updateField = (field: NotificationField, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const Toggle = ({
    field,
    label,
    description,
  }: {
    field: NotificationField;
    label: string;
    description: string;
  }) => (
    <label className="flex items-start gap-3 rounded-md border border-gray-200 bg-white p-3">
      <input
        type="checkbox"
        checked={Boolean(formData[field])}
        onChange={event => updateField(field, event.target.checked)}
        disabled={!canEdit}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
      />
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500">{description}</span>
      </span>
    </label>
  );

  const UnavailableSetting = ({
    label,
    description,
  }: {
    label: string;
    description: string;
  }) => (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3" aria-disabled="true">
      <div className="flex items-start justify-between gap-3">
        <span>
          <span className="block text-sm font-medium text-gray-700">{label}</span>
          <span className="mt-0.5 block text-xs text-gray-500">{description}</span>
        </span>
        <span className="shrink-0 rounded-full bg-gray-200 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
          Not connected
        </span>
      </div>
    </div>
  );

  const ActiveWorkflow = ({
    label,
    description,
  }: {
    label: string;
    description: string;
  }) => (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <span>
          <span className="block text-sm font-medium text-emerald-950">{label}</span>
          <span className="mt-0.5 block text-xs text-emerald-800">{description}</span>
        </span>
        <span className="shrink-0 rounded-full bg-emerald-200 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
          Active
        </span>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }
  if (error) return <SettingsLoadError section="Notification" error={error} onRetry={refetch} />;

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Bell className="h-5 w-5 mr-2" />
          Notifications
        </h2>
        <p className="text-gray-600">Configure club-wide notification channels, booking alerts and operational reminders.</p>
      </div>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <Monitor className="h-5 w-5 mr-2 text-blue-600" />
            Delivery Channels
          </h3>
          <p className="text-sm text-gray-500 mt-1">These are the system-wide channels available before each person applies their own preferences.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Toggle field="in_app_notifications_enabled" label="In-app notifications" description="Show alerts in the notification bell inside the CRM." />
          <UnavailableSetting label="Email notifications" description="No general notification email service is installed. Transactional emails continue through their own audited workflows." />
          <UnavailableSetting label="SMS notifications" description="No SMS delivery provider is installed, so this cannot be enabled yet." />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <CalendarClock className="h-5 w-5 mr-2 text-blue-600" />
            Booking Notifications
          </h3>
          <p className="text-sm text-gray-500 mt-1">Control booking lifecycle messages for students, pilots, instructors and admin staff.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Toggle field="booking_confirmation_enabled" label="Booking confirmations" description="Notify participants when a booking is created." />
          <Toggle field="booking_change_notification_enabled" label="Booking changes" description="Notify participants when times, aircraft, instructor or status change." />
          <Toggle field="cancellation_notification_enabled" label="Cancellations" description="Notify affected people when a booking is cancelled." />
          <Toggle field="waitlist_notification_enabled" label="Waitlist movement" description="Notify people when a waitlisted booking is promoted or blocked by a conflict." />
          <Toggle field="approval_request_notification_enabled" label="Approval requests" description="Notify instructors and admins when a booking or training action needs approval." />
          <ActiveWorkflow label="Guest booking emails" description="Casual guests receive a confirmation and a day-prior email reminder. The reminder is suppressed when confirmation was sent in the previous 12 hours." />
          <UnavailableSetting label="Member timed reminders" description="General member 24-hour and 2-hour reminder controls are not installed yet. Guest/casual reminders run through their dedicated audited workflow." />
          <UnavailableSetting label="Instructor absence messages" description="Availability changes affect booking checks immediately; participant messaging is not automated yet." />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <Wrench className="h-5 w-5 mr-2 text-blue-600" />
            Maintenance & Safety
          </h3>
          <p className="text-sm text-gray-500 mt-1">Keep aircraft, defect and safety notifications visible before they become operational surprises.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Toggle field="maintenance_alert_enabled" label="Maintenance alerts" description="Notify staff when aircraft maintenance milestones are coming due." />
          <Toggle field="defect_report_notification_enabled" label="Defect reports" description="Notify maintenance/admin staff about defect-related grounding and maintenance events." />
          <UnavailableSetting label="Safety report messages" description="Safety reports remain visible in the safety workflow; a separate automatic alert sender is not installed." />
        </div>
        <p className="text-sm text-gray-500">Maintenance warning thresholds are configured once in Maintenance settings, where the hourly maintenance job uses them.</p>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <ShieldAlert className="h-5 w-5 mr-2 text-blue-600" />
            Currency & Records
          </h3>
          <p className="text-sm text-gray-500 mt-1">Settings for keeping pilot records, training records and flight logs from quietly going stale.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <UnavailableSetting label="Currency expiry messages" description="Expiry status is enforced in safety checks, but scheduled expiry notifications are not installed." />
          <UnavailableSetting label="Overdue flight-record messages" description="Outstanding records are visible in the training workflow; timed reminder delivery is not installed." />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <Clock className="h-5 w-5 mr-2 text-blue-600" />
            Timing Rules
          </h3>
          <p className="text-sm text-gray-500 mt-1">Scheduled and delayed delivery features only appear as editable controls after their jobs are installed.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <UnavailableSetting label="Daily operations digest" description="No scheduled digest job is installed." />
          <UnavailableSetting label="Quiet-hours queue" description="The CRM does not yet have a delayed-delivery queue, so in-app alerts appear immediately." />
        </div>
      </section>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-amber-900">Delivery note</h4>
            <p className="mt-1 text-sm text-amber-800">
              Every editable switch on this page is enforced when an in-app notification is created. Features without a working sender are shown as unavailable instead of saving a setting that has no effect.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-green-900">Personal preferences still apply</h4>
            <p className="mt-1 text-sm text-green-800">
              Club-wide settings define what is available. Staff can additionally turn off their own maintenance alerts in Personal Preferences.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
