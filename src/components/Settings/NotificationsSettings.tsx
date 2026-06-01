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

interface NotificationsSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

type NotificationFormData = Omit<NotificationSettingsRecord, 'id'>;
type NotificationField = keyof NotificationFormData;

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';

export const NotificationsSettings: React.FC<NotificationsSettingsProps> = ({ canEdit, onFormChange }) => {
  const { settings, loading, updateSettings } = useNotificationSettings();
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

  const updateNumberField = (field: NotificationField, value: string, fallback: number) => {
    const parsed = Number.parseInt(value, 10);
    updateField(field, Number.isFinite(parsed) ? parsed : fallback);
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

  const NumberInput = ({
    field,
    label,
    description,
    min,
    max,
    suffix,
  }: {
    field: NotificationField;
    label: string;
    description: string;
    min: number;
    max: number;
    suffix: string;
  }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div className="flex max-w-xs rounded-md shadow-sm">
        <input
          type="number"
          min={min}
          max={max}
          value={Number(formData[field])}
          onChange={event => updateNumberField(field, event.target.value, min)}
          disabled={!canEdit}
          className={`${inputClass} rounded-r-none`}
        />
        <span className="inline-flex items-center rounded-r-md border border-l-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-500">
          {suffix}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">{description}</p>
    </div>
  );

  const TimeInput = ({ field, label }: { field: NotificationField; label: string }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <input
        type="time"
        value={String(formData[field])}
        onChange={event => updateField(field, event.target.value)}
        disabled={!canEdit}
        className={`${inputClass} max-w-xs`}
      />
    </div>
  );

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

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
          <Toggle field="email_notifications_enabled" label="Email notifications" description="Allow the system to send email notifications when email delivery is connected." />
          <Toggle field="sms_notifications_enabled" label="SMS notifications" description="Allow urgent SMS alerts when an SMS provider is connected." />
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
          <Toggle field="booking_change_notification_enabled" label="Booking changes" description="Notify participants when times, aircraft, instructor or notes change." />
          <Toggle field="booking_reminder_24h_enabled" label="24 hour reminders" description="Send a reminder the day before a flight." />
          <Toggle field="booking_reminder_2h_enabled" label="2 hour reminders" description="Send a same-day reminder shortly before a flight." />
          <Toggle field="cancellation_notification_enabled" label="Cancellations" description="Notify affected people when a booking is cancelled." />
          <Toggle field="waitlist_notification_enabled" label="Waitlist movement" description="Notify people when a waitlisted booking is promoted or blocked by a conflict." />
          <Toggle field="instructor_absence_notification_enabled" label="Instructor absence changes" description="Notify affected people when temporary absences change booking availability." />
          <Toggle field="approval_request_notification_enabled" label="Approval requests" description="Notify instructors and admins when a booking or training action needs approval." />
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
          <Toggle field="defect_report_notification_enabled" label="Defect reports" description="Notify maintenance/admin staff when a defect is lodged or updated." />
          <Toggle field="safety_report_notification_enabled" label="Safety reports" description="Notify safety/admin staff when an incident or hazard report is submitted." />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberInput field="maintenance_due_alert_days" label="Calendar maintenance warning" description="Warn this many days before date-based maintenance is due." min={1} max={180} suffix="days" />
          <NumberInput field="maintenance_due_alert_hours" label="Aircraft hour maintenance warning" description="Warn when a tach or airframe milestone is this close." min={1} max={100} suffix="hours" />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <ShieldAlert className="h-5 w-5 mr-2 text-blue-600" />
            Currency & Records
          </h3>
          <p className="text-sm text-gray-500 mt-1">Settings for keeping pilot records, training records and flight logs from quietly going stale.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberInput field="currency_expiry_alert_days" label="Currency expiry warning" description="Warn before medical, licence or club currency expiry dates." min={1} max={365} suffix="days" />
          <NumberInput field="overdue_flight_record_alert_hours" label="Overdue flight record warning" description="Flag bookings that still have no logged flight after this time." min={1} max={168} suffix="hours" />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <Clock className="h-5 w-5 mr-2 text-blue-600" />
            Timing Rules
          </h3>
          <p className="text-sm text-gray-500 mt-1">These controls prepare the CRM for digest-style messaging and after-hours quiet periods.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Toggle field="daily_ops_digest_enabled" label="Daily operations digest" description="Send staff a morning summary of bookings, maintenance and outstanding records." />
          <Toggle field="quiet_hours_enabled" label="Quiet hours" description="Hold non-urgent notifications during the selected after-hours period." />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TimeInput field="daily_ops_digest_time" label="Digest time" />
          <TimeInput field="quiet_hours_start" label="Quiet hours start" />
          <TimeInput field="quiet_hours_end" label="Quiet hours end" />
        </div>
      </section>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-amber-900">Delivery note</h4>
            <p className="mt-1 text-sm text-amber-800">
              These settings control what the CRM should generate. Email, SMS and scheduled digest delivery still need their provider jobs connected before those channels can send outside the app.
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
              Club-wide settings define what is available. Each user can still narrow their own email, SMS, reminder, currency and maintenance preferences in Personal Preferences.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
