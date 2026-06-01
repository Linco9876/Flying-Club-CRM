import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarDays,
  Eye,
  Globe,
  Lock,
  Palette,
  Phone,
  Shield,
  User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useAircraft } from '../../hooks/useAircraft';
import { defaultUserPreferences, useUserPreferences, UserPreferences } from '../../hooks/useSettings';

interface PersonalPreferencesSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
  activeAccountTab?: AccountTab;
  saveKey?: string;
  showInternalTabs?: boolean;
}

type PreferenceFormData = Omit<UserPreferences, 'id' | 'user_id' | 'preferences'>;
type PreferenceField = keyof PreferenceFormData;
type AccountTab = 'info' | 'security' | 'calendar' | 'notifications' | 'appearance' | 'dashboard';

interface ProfileFormData {
  name: string;
  email: string;
  birthdate: string;
  mobile: string;
  homePhone: string;
  workPhone: string;
  address: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelationship: string;
  preferredAircraftId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';

const blankProfile: ProfileFormData = {
  name: '',
  email: '',
  birthdate: '',
  mobile: '',
  homePhone: '',
  workPhone: '',
  address: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelationship: '',
  preferredAircraftId: '',
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

export const PersonalPreferencesSettings: React.FC<PersonalPreferencesSettingsProps> = ({
  canEdit,
  onFormChange,
  activeAccountTab,
  saveKey = 'personal',
  showInternalTabs = true,
}) => {
  const { user } = useAuth();
  const { aircraft } = useAircraft();
  const { preferences, loading, error, updatePreferences } = useUserPreferences(user?.id || '');
  const [activeTab, setActiveTab] = useState<AccountTab>('info');
  const selectedTab = activeAccountTab || activeTab;
  const [profileForm, setProfileForm] = useState<ProfileFormData>(blankProfile);
  const [savedProfile, setSavedProfile] = useState<ProfileFormData>(blankProfile);
  const [profileLoading, setProfileLoading] = useState(true);
  const [preferenceForm, setPreferenceForm] = useState<PreferenceFormData>(() => {
    const { user_id, preferences: _preferences, ...defaults } = defaultUserPreferences(user?.id || '');
    return defaults;
  });

  const hasStaffRole = user?.roles?.some(role => ['admin', 'senior_instructor', 'instructor'].includes(role))
    || ['admin', 'senior_instructor', 'instructor'].includes(user?.role || '');

  const isStudentOrPilot = user?.roles?.some(role => ['student', 'pilot'].includes(role))
    || ['student', 'pilot'].includes(user?.role || '');

  const tabs = useMemo(() => {
    const base: Array<{ id: AccountTab; label: string; icon: React.ReactNode }> = [
      { id: 'info', label: 'Update My Info', icon: <User className="h-4 w-4" /> },
      { id: 'security', label: 'Security', icon: <Lock className="h-4 w-4" /> },
      { id: 'calendar', label: 'Calendar', icon: <CalendarDays className="h-4 w-4" /> },
      { id: 'notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
      { id: 'appearance', label: 'Appearance', icon: <Palette className="h-4 w-4" /> },
    ];

    if (isStudentOrPilot) {
      base.push({ id: 'dashboard', label: 'Portal Dashboard', icon: <Eye className="h-4 w-4" /> });
    }

    return base;
  }, [isStudentOrPilot]);

  const fetchProfile = async () => {
    if (!user?.id) {
      setProfileLoading(false);
      return;
    }

    try {
      setProfileLoading(true);
      const [{ data: userData, error: userError }, { data: studentData, error: studentError }] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('students').select('*').eq('id', user.id).maybeSingle(),
      ]);

      if (userError) throw userError;
      if (studentError) throw studentError;

      const nextProfile: ProfileFormData = {
        ...blankProfile,
        name: userData?.name || user.name || '',
        email: userData?.email || user.email || '',
        birthdate: userData?.date_of_birth || studentData?.date_of_birth || '',
        mobile: userData?.mobile_phone || userData?.phone || user.phone || '',
        homePhone: userData?.home_phone || '',
        workPhone: userData?.work_phone || '',
        address: userData?.address || '',
        emergencyName: userData?.emergency_contact_name || studentData?.emergency_contact_name || '',
        emergencyPhone: userData?.emergency_contact_phone || studentData?.emergency_contact_phone || '',
        emergencyRelationship: userData?.emergency_contact_relationship || studentData?.emergency_contact_relationship || '',
        preferredAircraftId: userData?.preferred_aircraft_id || '',
      };

      setProfileForm(nextProfile);
      setSavedProfile(nextProfile);
    } catch (err: any) {
      console.error('Failed to load account settings:', err);
      toast.error(err.message || 'Failed to load account settings');
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [user?.id]);

  useEffect(() => {
    if (!preferences) return;
    const { id, user_id, preferences: _preferences, ...values } = preferences;
    setPreferenceForm(values);
  }, [preferences]);

  useEffect(() => {
    const globalSaveKey = `__${saveKey.replace(/-/g, '')}SettingsSave`;
    const globalCancelKey = `__${saveKey.replace(/-/g, '')}SettingsCancel`;

    (window as any)[globalSaveKey] = async () => {
      await saveAccountSettings();
    };
    (window as any)[globalCancelKey] = () => {
      setProfileForm(savedProfile);
      if (preferences) {
        const { id, user_id, preferences: _preferences, ...values } = preferences;
        setPreferenceForm(values);
      }
    };
    return () => {
      delete (window as any)[globalSaveKey];
      delete (window as any)[globalCancelKey];
    };
  }, [profileForm, savedProfile, preferenceForm, preferences, updatePreferences, user?.id, saveKey]);

  const saveAccountSettings = async () => {
    if (!user?.id) return;

    const trimmedEmail = profileForm.email.trim().toLowerCase();
    const currentEmail = savedProfile.email.trim().toLowerCase();

    if (!profileForm.name.trim()) {
      toast.error('Name is required');
      throw new Error('Name is required');
    }

    if (profileForm.newPassword || profileForm.confirmPassword || profileForm.currentPassword) {
      if (!profileForm.currentPassword) {
        toast.error('Enter your current password before changing password');
        throw new Error('Current password required');
      }
      if (profileForm.newPassword.length < 6) {
        toast.error('New password must be at least 6 characters');
        throw new Error('Password too short');
      }
      if (profileForm.newPassword !== profileForm.confirmPassword) {
        toast.error('New password and confirmation do not match');
        throw new Error('Password mismatch');
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: currentEmail || user.email,
        password: profileForm.currentPassword,
      });
      if (signInError) {
        toast.error('Current password could not be verified');
        throw signInError;
      }

      const { error: passwordError } = await supabase.auth.updateUser({ password: profileForm.newPassword });
      if (passwordError) throw passwordError;
      toast.success('Password updated');
    }

    if (trimmedEmail && trimmedEmail !== currentEmail) {
      const { error: emailError } = await supabase.auth.updateUser({ email: trimmedEmail });
      if (emailError) throw emailError;
      toast.success('Verification email sent. Your login email will change after you confirm it.');
    }

    const profileUpdates = {
      name: profileForm.name.trim(),
      phone: profileForm.mobile.trim() || null,
      mobile_phone: profileForm.mobile.trim() || null,
      home_phone: profileForm.homePhone.trim() || null,
      work_phone: profileForm.workPhone.trim() || null,
      address: profileForm.address.trim() || null,
      date_of_birth: profileForm.birthdate || null,
      emergency_contact_name: profileForm.emergencyName.trim() || null,
      emergency_contact_phone: profileForm.emergencyPhone.trim() || null,
      emergency_contact_relationship: profileForm.emergencyRelationship.trim() || null,
      preferred_aircraft_id: profileForm.preferredAircraftId || null,
      updated_at: new Date().toISOString(),
    };

    const { error: updateUserError } = await supabase
      .from('users')
      .update(profileUpdates)
      .eq('id', user.id);

    if (updateUserError) throw updateUserError;

    if (isStudentOrPilot) {
      const { error: studentError } = await supabase
        .from('students')
        .upsert({
          id: user.id,
          date_of_birth: profileForm.birthdate || null,
          emergency_contact_name: profileForm.emergencyName.trim() || null,
          emergency_contact_phone: profileForm.emergencyPhone.trim() || null,
          emergency_contact_relationship: profileForm.emergencyRelationship.trim() || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (studentError) throw studentError;
    }

    await updatePreferences(preferenceForm);
    setProfileForm(prev => ({
      ...prev,
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
      email: trimmedEmail === currentEmail ? trimmedEmail : savedProfile.email,
    }));
    await fetchProfile();
    toast.success('Account settings saved');
  };

  const updateProfile = (field: keyof ProfileFormData, value: string) => {
    setProfileForm(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const updatePreference = (field: PreferenceField, value: string | boolean) => {
    setPreferenceForm(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const Toggle = ({ field, label, description }: { field: PreferenceField; label: string; description: string }) => (
    <label className="flex items-start gap-3 rounded-md border border-gray-200 bg-white p-3">
      <input
        type="checkbox"
        checked={Boolean(preferenceForm[field])}
        onChange={event => updatePreference(field, event.target.checked)}
        disabled={!canEdit}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
      />
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500">{description}</span>
      </span>
    </label>
  );

  const Select = ({ field, label, children }: { field: PreferenceField; label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <select
        value={String(preferenceForm[field])}
        onChange={event => updatePreference(field, event.target.value)}
        disabled={!canEdit}
        className={inputClass}
      >
        {children}
      </select>
    </div>
  );

  const Field = ({
    label,
    field,
    type = 'text',
    placeholder,
  }: {
    label: string;
    field: keyof ProfileFormData;
    type?: string;
    placeholder?: string;
  }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <input
        type={type}
        value={profileForm[field]}
        onChange={event => updateProfile(field, event.target.value)}
        disabled={!canEdit}
        placeholder={placeholder}
        className={inputClass}
      />
    </div>
  );

  const timezones = [
    'Australia/Melbourne',
    'Australia/Sydney',
    'Australia/Brisbane',
    'Australia/Adelaide',
    'Australia/Perth',
    'Australia/Darwin',
    'Australia/Hobart',
  ];

  const tabLabel = tabs.find(tab => tab.id === selectedTab)?.label || 'Account & Preferences';
  const introText = {
    info: 'Update your personal details, contact numbers, emergency contact and preferred aircraft.',
    security: 'Manage your password and account sign-in security.',
    calendar: 'Choose your personal date, time and calendar defaults.',
    notifications: 'Tune notifications for your own account.',
    appearance: 'Adjust display preferences for your own account.',
    dashboard: 'Choose which personal dashboard panels appear where supported.',
  }[selectedTab];

  if (!user) {
    return <div className="p-6"><p className="text-gray-500">Sign in to manage your account settings.</p></div>;
  }

  if (loading || profileLoading) {
    return <div className="p-6 flex items-center justify-center"><div className="text-gray-500">Loading account settings...</div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <User className="h-5 w-5 mr-2" />
          {showInternalTabs ? 'Account & Preferences' : tabLabel}
        </h2>
        <p className="text-gray-600">{showInternalTabs ? 'Update your personal details, password, preferred aircraft and display preferences.' : introText}</p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {showInternalTabs && (
        <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                selectedTab === tab.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {selectedTab === 'info' && (
        <div className="space-y-6">
          <section className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">Personal Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Name" field="name" />
              <Field label="Email" field="email" type="email" />
              <Field label="Birthdate" field="birthdate" type="date" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Preferred Aircraft</label>
                <select
                  value={profileForm.preferredAircraftId}
                  onChange={event => updateProfile('preferredAircraftId', event.target.value)}
                  disabled={!canEdit}
                  className={inputClass}
                >
                  <option value="">Use first available aircraft</option>
                  {aircraft.map(a => (
                    <option key={a.id} value={a.id}>{a.registration} - {a.make} {a.model}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-500">Email changes are sent through Supabase verification before the login email changes.</p>
          </section>

          <section className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Phone className="h-5 w-5 mr-2 text-blue-600" />
              Contact Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Mobile" field="mobile" type="tel" />
              <Field label="Home Number" field="homePhone" type="tel" />
              <Field label="Work Number" field="workPhone" type="tel" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
              <textarea
                value={profileForm.address}
                onChange={event => updateProfile('address', event.target.value)}
                disabled={!canEdit}
                rows={3}
                className={`${inputClass} resize-none`}
              />
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900 flex items-center">
              <Shield className="h-5 w-5 mr-2 text-blue-600" />
              Emergency Contact
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Contact Name" field="emergencyName" />
              <Field label="Contact Phone" field="emergencyPhone" type="tel" />
              <Field label="Relationship" field="emergencyRelationship" />
            </div>
          </section>
        </div>
      )}

      {selectedTab === 'security' && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Password</h3>
          <p className="text-sm text-gray-500">Password changes require your current password before a new password is saved.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Current Password" field="currentPassword" type="password" />
            <Field label="New Password" field="newPassword" type="password" />
            <Field label="Confirm New Password" field="confirmPassword" type="password" />
          </div>
        </section>
      )}

      {selectedTab === 'calendar' && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900 flex items-center">
            <Globe className="h-5 w-5 mr-2 text-blue-600" />
            Date, Time & Calendar
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select field="timezone" label="Timezone">{timezones.map(timezone => <option key={timezone} value={timezone}>{timezone}</option>)}</Select>
            <Select field="date_format" label="Date Format">
              <option value="dd/MM/yyyy">DD/MM/YYYY</option>
              <option value="MM/dd/yyyy">MM/DD/YYYY</option>
              <option value="yyyy-MM-dd">YYYY-MM-DD</option>
              <option value="d MMM yyyy">1 Jan 2026</option>
            </Select>
            <Select field="time_format" label="Time Format">
              <option value="24h">24 Hour (14:30)</option>
              <option value="12h">12 Hour (2:30 PM)</option>
            </Select>
            <Select field="default_calendar_view" label="Default Calendar View">
              <option value="day">Day View</option>
              <option value="week">Week View</option>
              <option value="month">Month View</option>
            </Select>
          </div>
        </section>
      )}

      {selectedTab === 'notifications' && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Notification Preferences</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Toggle field="email_notifications" label="Email notifications" description="Receive allowed CRM notifications by email when delivery is connected." />
            <Toggle field="sms_notifications" label="SMS notifications" description="Receive urgent notifications by SMS when SMS delivery is connected." />
            <Toggle field="booking_reminders" label="Booking reminders" description="Receive booking reminders where configured." />
            <Toggle field="currency_alerts" label="Currency alerts" description="Receive alerts for medical, licence, membership and BFR expiry dates." />
            {hasStaffRole && <Toggle field="maintenance_alerts" label="Maintenance alerts" description="Receive aircraft maintenance and defect-related alerts." />}
          </div>
        </section>
      )}

      {selectedTab === 'appearance' && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Appearance</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select field="theme" label="Theme">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Auto (System)</option>
            </Select>
            <div className="flex items-end">
              <Toggle field="compact_view" label="Compact view" description="Use denser lists and tables where supported." />
            </div>
          </div>
        </section>
      )}

      {selectedTab === 'dashboard' && isStudentOrPilot && (
        <section className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">Portal Dashboard</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Toggle field="show_progress_dashboard" label="Training progress" description="Show training progress summaries on your dashboard." />
            <Toggle field="show_upcoming_bookings" label="Upcoming bookings" description="Show your upcoming bookings on your dashboard." />
            <Toggle field="show_recent_activity" label="Recent activity" description="Show recent training, booking and account activity." />
          </div>
        </section>
      )}
    </div>
  );
};

const accountSection = (activeAccountTab: AccountTab, saveKey: string) => {
  const Section: React.FC<PersonalPreferencesSettingsProps> = ({ canEdit, onFormChange }) => (
    <PersonalPreferencesSettings
      canEdit={canEdit}
      onFormChange={onFormChange}
      activeAccountTab={activeAccountTab}
      saveKey={saveKey}
      showInternalTabs={false}
    />
  );
  return Section;
};

export const UpdateMyInfoSettings = accountSection('info', 'account-info');
export const AccountSecuritySettings = accountSection('security', 'account-security');
export const AccountCalendarSettings = accountSection('calendar', 'account-calendar');
export const AccountNotificationSettings = accountSection('notifications', 'account-notifications');
export const AccountAppearanceSettings = accountSection('appearance', 'account-appearance');
export const AccountDashboardSettings = accountSection('dashboard', 'account-dashboard');
