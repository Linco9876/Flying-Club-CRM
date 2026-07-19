import React, { Suspense, lazy, useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAuthorizedSettingsSections } from '../../utils/rbac';
import { 
  Search, 
  Save, 
  Building2, 
  Calendar, 
  Clock, 
  Users, 
  Plane, 
  Shield, 
  Wrench, 
  FileText, 
  Bell,
  Monitor, 
  UserCheck, 
  Database, 
  Settings as SettingsIcon,
  User,
  Lock,
  Palette,
  Eye
} from 'lucide-react';
import { PortalSectionLoader } from '../Layout/PortalSectionLoader';
import toast from 'react-hot-toast';
import { usePageLoadState } from '../../context/PageLoadContext';

const OrganisationSettings = lazy(() => import('./OrganisationSettings').then(module => ({ default: module.OrganisationSettings })));
const CalendarSettings = lazy(() => import('./CalendarSettings').then(module => ({ default: module.CalendarSettings })));
const BookingRulesSettings = lazy(() => import('./BookingRulesSettings').then(module => ({ default: module.BookingRulesSettings })));
const DutySupervisionSettings = lazy(() => import('./DutySupervisionSettings').then(module => ({ default: module.DutySupervisionSettings })));
const NotificationsSettings = lazy(() => import('./NotificationsSettings').then(module => ({ default: module.NotificationsSettings })));
const SafetyComplianceSettings = lazy(() => import('./SafetyComplianceSettings').then(module => ({ default: module.SafetyComplianceSettings })));
const MaintenanceSettings = lazy(() => import('./MaintenanceSettings').then(module => ({ default: module.MaintenanceSettings })));
const ResourcesSettings = lazy(() => import('./ResourcesSettings').then(module => ({ default: module.ResourcesSettings })));
const PortalUxSettings = lazy(() => import('./PortalUxSettings').then(module => ({ default: module.PortalUxSettings })));
const RolesPermissionsSettings = lazy(() => import('./RolesPermissionsSettings').then(module => ({ default: module.RolesPermissionsSettings })));
const AuditDataSettings = lazy(() => import('./AuditDataSettings').then(module => ({ default: module.AuditDataSettings })));
const RosterAvailabilitySettings = lazy(() => import('./RosterAvailabilitySettings').then(module => ({ default: module.RosterAvailabilitySettings })));
const BillingRatesSettings = lazy(() => import('./BillingRatesSettings').then(module => ({ default: module.BillingRatesSettings })));
const FlightLogSettings = lazy(() => import('./FlightLogSettings'));
const IntegrationsSettings = lazy(() => import('./IntegrationsSettings').then(module => ({ default: module.IntegrationsSettings })));
const TrainingSyllabusSettings = lazy(() => import('./TrainingSyllabusSettings').then(module => ({ default: module.TrainingSyllabusSettings })));
const AccountTimelineSettings = lazy(() => import('./AccountTimelineSettings').then(module => ({ default: module.AccountTimelineSettings })));
const UpdateMyInfoSettings = lazy(() => import('./PersonalPreferencesSettings').then(module => ({ default: module.UpdateMyInfoSettings })));
const AccountSecuritySettings = lazy(() => import('./PersonalPreferencesSettings').then(module => ({ default: module.AccountSecuritySettings })));
const AccountCalendarSettings = lazy(() => import('./PersonalPreferencesSettings').then(module => ({ default: module.AccountCalendarSettings })));
const AccountNotificationSettings = lazy(() => import('./PersonalPreferencesSettings').then(module => ({ default: module.AccountNotificationSettings })));
const AccountAppearanceSettings = lazy(() => import('./PersonalPreferencesSettings').then(module => ({ default: module.AccountAppearanceSettings })));
const AccountDashboardSettings = lazy(() => import('./PersonalPreferencesSettings').then(module => ({ default: module.AccountDashboardSettings })));

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

interface SettingsSection {
  id: string;
  label: string;
  category: 'Club Setup' | 'Operations' | 'Training & Billing' | 'System' | 'Account & Preferences';
  keywords: string[];
  icon: React.ReactNode;
  roles: string[];
  component: React.ElementType;
}

export const SettingsDashboard: React.FC = () => {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState('organisation');
  const [searchTerm, setSearchTerm] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const getRequestedSectionId = () => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') || params.get('section');
  };

  const allSections: SettingsSection[] = [
    { id: 'organisation', label: 'Organisation', category: 'Club Setup', keywords: ['business', 'logo', 'currency', 'timezone', 'operating hours'], icon: <Building2 className="h-4 w-4" />, roles: ['admin'], component: OrganisationSettings },
    { id: 'portal', label: 'Portal & UX', category: 'Club Setup', keywords: ['theme', 'student portal', 'date format', 'time format'], icon: <Monitor className="h-4 w-4" />, roles: ['admin'], component: PortalUxSettings },
    { id: 'resources', label: 'Resources (Aircraft & Rooms)', category: 'Club Setup', keywords: ['aircraft fields', 'rooms', 'documents', 'instructor roster'], icon: <Plane className="h-4 w-4" />, roles: ['admin'], component: ResourcesSettings },
    { id: 'calendar', label: 'Calendar', category: 'Operations', keywords: ['default view', 'week starts', 'resource order', 'snap duration', 'conflicts'], icon: <Calendar className="h-4 w-4" />, roles: ['admin'], component: CalendarSettings },
    { id: 'booking-rules', label: 'Bookings & Rules', category: 'Operations', keywords: ['advance booking', 'notice', 'cancellation', 'solo approval', 'double booking', 'booking form', 'required fields'], icon: <Clock className="h-4 w-4" />, roles: ['admin'], component: BookingRulesSettings },
    { id: 'duty-supervision', label: 'Duty & Supervision', category: 'Operations', keywords: ['duty', 'fatigue', 'supervision', 'senior instructor', 'priority', 'authorised'], icon: <UserCheck className="h-4 w-4" />, roles: ['admin'], component: DutySupervisionSettings },
    { id: 'roster', label: 'Roster & Availability', category: 'Operations', keywords: ['instructor availability', 'absence', 'weekly schedule', 'duty hours'], icon: <Users className="h-4 w-4" />, roles: ['admin', 'instructor'], component: RosterAvailabilitySettings },
    { id: 'maintenance', label: 'Maintenance', category: 'Operations', keywords: ['defects', 'grounding', 'maintenance reminders', 'milestones'], icon: <Wrench className="h-4 w-4" />, roles: ['admin', 'instructor'], component: MaintenanceSettings },
    { id: 'safety', label: 'Safety & Compliance', category: 'Operations', keywords: ['incidents', 'currency', 'medical', 'checklists', 'compliance'], icon: <Shield className="h-4 w-4" />, roles: ['admin', 'instructor'], component: SafetyComplianceSettings },
    { id: 'training', label: 'Training / Syllabus', category: 'Training & Billing', keywords: ['lesson records', 'syllabus', 'student acknowledgement', 'grading'], icon: <FileText className="h-4 w-4" />, roles: ['admin', 'instructor'], component: TrainingSyllabusSettings },
    { id: 'billing', label: 'Billing & Rates', category: 'Training & Billing', keywords: ['flight types', 'rates', 'payment methods', 'prepaid', 'charges'], icon: <FileText className="h-4 w-4" />, roles: ['admin'], component: BillingRatesSettings },
    { id: 'flight-log', label: 'Flight Log Form', category: 'Training & Billing', keywords: ['tach', 'landings', 'oil', 'fuel', 'passengers'], icon: <Plane className="h-4 w-4" />, roles: ['admin'], component: FlightLogSettings },
    { id: 'integrations', label: 'Integrations', category: 'System', keywords: ['xero', 'accounting', 'sync', 'api'], icon: <Database className="h-4 w-4" />, roles: ['admin'], component: IntegrationsSettings },
    { id: 'notifications', label: 'Notifications', category: 'System', keywords: ['email', 'sms', 'reminders', 'alerts', 'digest', 'quiet hours'], icon: <Bell className="h-4 w-4" />, roles: ['admin'], component: NotificationsSettings },
    { id: 'roles', label: 'Roles & Permissions', category: 'System', keywords: ['access', 'permissions', 'admin', 'instructor', 'student'], icon: <UserCheck className="h-4 w-4" />, roles: ['admin'], component: RolesPermissionsSettings },
    { id: 'audit', label: 'Audit & Data', category: 'System', keywords: ['export', 'audit log', 'data', 'backup'], icon: <Database className="h-4 w-4" />, roles: ['admin'], component: AuditDataSettings },
    { id: 'account-info', label: 'Update My Info', category: 'Account & Preferences', keywords: ['my settings', 'update my info', 'profile', 'name', 'email', 'phone', 'emergency contact', 'preferred aircraft'], icon: <User className="h-4 w-4" />, roles: ['admin', 'senior_instructor', 'instructor', 'pilot', 'student'], component: UpdateMyInfoSettings },
    { id: 'account-security', label: 'Security', category: 'Account & Preferences', keywords: ['password', 'security', 'verification', 'login'], icon: <Lock className="h-4 w-4" />, roles: ['admin', 'senior_instructor', 'instructor', 'pilot', 'student'], component: AccountSecuritySettings },
    { id: 'account-calendar', label: 'Calendar Preferences', category: 'Account & Preferences', keywords: ['date format', 'time format', 'calendar view', 'timezone'], icon: <SettingsIcon className="h-4 w-4" />, roles: ['admin', 'senior_instructor', 'instructor', 'pilot', 'student'], component: AccountCalendarSettings },
    { id: 'account-notifications', label: 'Notification Preferences', category: 'Account & Preferences', keywords: ['notifications', 'email', 'sms', 'alerts', 'reminders'], icon: <Bell className="h-4 w-4" />, roles: ['admin', 'senior_instructor', 'instructor', 'pilot', 'student'], component: AccountNotificationSettings },
    { id: 'account-appearance', label: 'Appearance', category: 'Account & Preferences', keywords: ['appearance', 'theme', 'compact', 'display'], icon: <Palette className="h-4 w-4" />, roles: ['admin', 'senior_instructor', 'instructor', 'pilot', 'student'], component: AccountAppearanceSettings },
    { id: 'account-dashboard', label: 'Portal Dashboard', category: 'Account & Preferences', keywords: ['dashboard', 'student portal', 'progress', 'upcoming bookings'], icon: <Eye className="h-4 w-4" />, roles: ['pilot', 'student'], component: AccountDashboardSettings },
    { id: 'account-timeline', label: 'Timeline', category: 'Account & Preferences', keywords: ['timeline', 'history', 'training history', 'exam history', 'activity'], icon: <Clock className="h-4 w-4" />, roles: ['pilot', 'student'], component: AccountTimelineSettings }
  ];

  // Get authorized sections using RBAC
  const authorizedSections = getAuthorizedSettingsSections(user);
  const sections = allSections.filter(section => 
    authorizedSections.some(authSection => authSection.id === section.id)
  );

  const filteredSections = sections.filter(section => {
    const query = searchTerm.toLowerCase();
    const matchesSearch = section.label.toLowerCase().includes(query)
      || section.category.toLowerCase().includes(query)
      || section.keywords.some(keyword => keyword.includes(query));
    return matchesSearch;
  });

  const groupedSections = filteredSections.reduce<Record<string, SettingsSection[]>>((groups, section) => {
    groups[section.category] = groups[section.category] || [];
    groups[section.category].push(section);
    return groups;
  }, {});

  // Set default section based on user role, while honouring deep links such as /settings?tab=integrations.
  useEffect(() => {
    const requestedSectionId = getRequestedSectionId();
    if (requestedSectionId && sections.some(section => section.id === requestedSectionId)) {
      setActiveSection(requestedSectionId);
      return;
    }

    if (user?.role === 'student' || user?.role === 'instructor' || user?.role === 'senior_instructor' || user?.role === 'pilot') {
      setActiveSection('account-info');
    } else {
      setActiveSection('organisation');
    }
  }, [user?.role, authorizedSections.map(section => section.id).join('|')]);

  // Ensure the active section is available to the user
  useEffect(() => {
    if (filteredSections.length > 0 && !filteredSections.find(s => s.id === activeSection)) {
      setActiveSection(filteredSections[0].id);
    }
  }, [filteredSections]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const saveFunction = (window as any)[`__${activeSection.replace(/-/g, '')}SettingsSave`];
      if (saveFunction) {
        await saveFunction();
      }
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error(getErrorMessage(error, 'Failed to save settings'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    const cancelFunction = (window as any)[`__${activeSection.replace(/-/g, '')}SettingsCancel`];
    if (cancelFunction) {
      cancelFunction();
    }
    setHasUnsavedChanges(false);
    toast('Changes discarded');
  };

  const handleSectionChange = (sectionId: string) => {
    if (hasUnsavedChanges) {
      const confirmLeave = window.confirm('You have unsaved changes. Are you sure you want to leave this section?');
      if (!confirmLeave) return;
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', sectionId);
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
    setActiveSection(sectionId);
    setHasUnsavedChanges(false);
  };

  const activeComponent = sections.find(s => s.id === activeSection)?.component;
  const ActiveComponent = activeComponent || OrganisationSettings;

  usePageLoadState(
    isLoading,
    'Loading settings',
    'Saving or preparing the selected settings section...'
  );

  const canEdit = (sectionId: string) => {
    const roles = user?.roles && user.roles.length > 0 ? user.roles : user?.role ? [user.role] : [];
    if (roles.includes('admin')) return true;
    if ((roles.includes('senior_instructor') || roles.includes('instructor')) && sectionId === 'roster') return true;
    if (
      (roles.includes('senior_instructor') || roles.includes('instructor') || roles.includes('student') || roles.includes('pilot')) &&
      sectionId.startsWith('account-')
    ) return true;
    return false;
  };

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Settings</h1>
        <p className="text-sm text-gray-600 sm:text-base">Configure system preferences and organizational settings</p>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col gap-4 lg:h-[calc(100vh-200px)] lg:flex-row lg:gap-6">
        {/* Left Sidebar */}
        <div className="flex max-h-[42vh] w-full flex-col rounded-lg border border-gray-200 bg-white shadow-md lg:max-h-none lg:w-80">
          {/* Search */}
          <div className="p-4 border-b border-gray-200">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search settings..."
              />
            </div>
          </div>

          {/* Sections List */}
          <div className="flex-1 overflow-y-auto p-2">
            <nav className="space-y-5">
              {Object.entries(groupedSections).map(([category, group]) => (
                <div key={category}>
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {category}
                  </p>
                  <div className="space-y-1">
                    {group.map(section => (
                      <button
                        key={section.id}
                        onClick={() => handleSectionChange(section.id)}
                        className={`w-full flex items-center space-x-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors text-left ${
                          activeSection === section.id
                            ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <span className={activeSection === section.id ? 'text-blue-600' : 'text-gray-400'}>
                          {section.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{section.label}</span>
                        {!canEdit(section.id) && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                            Read-only
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </div>

        {/* Right Content Pane */}
        <div className="flex min-h-[60vh] min-w-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white shadow-md">
          <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <Suspense fallback={<PortalSectionLoader message="Loading settings section" detail="Preparing this settings panel..." />}>
              <ActiveComponent
                canEdit={canEdit(activeSection)}
                onFormChange={() => setHasUnsavedChanges(true)}
              />
            </Suspense>
          </div>

          {/* Sticky Save/Cancel Bar */}
          <div
            className={`border-t border-gray-200 bg-gray-50 px-6 py-4 transition-all duration-150 ${
              hasUnsavedChanges ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            aria-hidden={!hasUnsavedChanges}
          >
            <div className="flex min-h-[4rem] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-600">You have unsaved changes</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:space-x-3">
                <button
                  onClick={handleCancel}
                  disabled={isLoading || !hasUnsavedChanges}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isLoading || !hasUnsavedChanges}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  <span>{isLoading ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
