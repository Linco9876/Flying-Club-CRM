import React, { useState, useEffect } from 'react';
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
  Monitor, 
  UserCheck, 
  Database, 
  Settings as SettingsIcon 
} from 'lucide-react';
import { OrganisationSettings } from './OrganisationSettings';
import { CalendarSettings } from './CalendarSettings';
import { BookingRulesSettings } from './BookingRulesSettings';
import { NotificationsSettings } from './NotificationsSettings';
import { SafetyComplianceSettings } from './SafetyComplianceSettings';
import { MaintenanceSettings } from './MaintenanceSettings';
import { ResourcesSettings } from './ResourcesSettings';
import { DocumentsTemplatesSettings } from './DocumentsTemplatesSettings';
import { PortalUxSettings } from './PortalUxSettings';
import { RolesPermissionsSettings } from './RolesPermissionsSettings';
import { AuditDataSettings } from './AuditDataSettings';
import { PersonalPreferencesSettings } from './PersonalPreferencesSettings';
import { RosterAvailabilitySettings } from './RosterAvailabilitySettings';
import { BillingRatesSettings } from './BillingRatesSettings';
import FlightLogSettings from './FlightLogSettings';
import { IntegrationsSettings } from './IntegrationsSettings';
import { TrainingSyllabusSettings } from './TrainingSyllabusSettings';
import toast from 'react-hot-toast';

interface SettingsSection {
  id: string;
  label: string;
  category: 'Club Setup' | 'Operations' | 'Training & Billing' | 'System';
  keywords: string[];
  icon: React.ReactNode;
  roles: string[];
  component: React.ComponentType;
}

export const SettingsDashboard: React.FC = () => {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState('organisation');
  const [searchTerm, setSearchTerm] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const allSections: SettingsSection[] = [
    { id: 'organisation', label: 'Organisation', category: 'Club Setup', keywords: ['business', 'logo', 'currency', 'timezone', 'operating hours'], icon: <Building2 className="h-4 w-4" />, roles: ['admin'], component: OrganisationSettings },
    { id: 'portal', label: 'Portal & UX', category: 'Club Setup', keywords: ['theme', 'student portal', 'date format', 'time format'], icon: <Monitor className="h-4 w-4" />, roles: ['admin'], component: PortalUxSettings },
    { id: 'resources', label: 'Resources (Aircraft & Rooms)', category: 'Club Setup', keywords: ['aircraft fields', 'rooms', 'documents', 'instructor roster'], icon: <Plane className="h-4 w-4" />, roles: ['admin'], component: ResourcesSettings },
    { id: 'calendar', label: 'Calendar', category: 'Operations', keywords: ['default view', 'week starts', 'resource order', 'snap duration', 'conflicts'], icon: <Calendar className="h-4 w-4" />, roles: ['admin'], component: CalendarSettings },
    { id: 'booking-rules', label: 'Bookings & Rules', category: 'Operations', keywords: ['advance booking', 'notice', 'cancellation', 'solo approval', 'double booking', 'booking form', 'required fields'], icon: <Clock className="h-4 w-4" />, roles: ['admin'], component: BookingRulesSettings },
    { id: 'roster', label: 'Roster & Availability', category: 'Operations', keywords: ['instructor availability', 'absence', 'weekly schedule', 'duty hours'], icon: <Users className="h-4 w-4" />, roles: ['admin', 'instructor'], component: RosterAvailabilitySettings },
    { id: 'maintenance', label: 'Maintenance', category: 'Operations', keywords: ['defects', 'grounding', 'maintenance reminders', 'milestones'], icon: <Wrench className="h-4 w-4" />, roles: ['admin', 'instructor'], component: MaintenanceSettings },
    { id: 'safety', label: 'Safety & Compliance', category: 'Operations', keywords: ['incidents', 'currency', 'medical', 'checklists', 'compliance'], icon: <Shield className="h-4 w-4" />, roles: ['admin', 'instructor'], component: SafetyComplianceSettings },
    { id: 'training', label: 'Training / Syllabus', category: 'Training & Billing', keywords: ['lesson records', 'syllabus', 'student acknowledgement', 'grading'], icon: <FileText className="h-4 w-4" />, roles: ['admin', 'instructor'], component: TrainingSyllabusSettings },
    { id: 'billing', label: 'Billing & Rates', category: 'Training & Billing', keywords: ['flight types', 'rates', 'payment methods', 'prepaid', 'charges'], icon: <FileText className="h-4 w-4" />, roles: ['admin'], component: BillingRatesSettings },
    { id: 'flight-log', label: 'Flight Log Form', category: 'Training & Billing', keywords: ['tach', 'landings', 'oil', 'fuel', 'passengers'], icon: <Plane className="h-4 w-4" />, roles: ['admin'], component: FlightLogSettings },
    { id: 'documents', label: 'Documents & Templates', category: 'Training & Billing', keywords: ['pdf', 'invoice template', 'certificate', 'branding'], icon: <FileText className="h-4 w-4" />, roles: ['admin'], component: DocumentsTemplatesSettings },
    { id: 'integrations', label: 'Integrations', category: 'System', keywords: ['xero', 'accounting', 'sync', 'api'], icon: <Database className="h-4 w-4" />, roles: ['admin'], component: IntegrationsSettings },
    { id: 'notifications', label: 'Notifications', category: 'System', keywords: ['email', 'sms', 'reminders', 'alerts'], icon: <FileText className="h-4 w-4" />, roles: ['admin', 'instructor'], component: NotificationsSettings },
    { id: 'roles', label: 'Roles & Permissions', category: 'System', keywords: ['access', 'permissions', 'admin', 'instructor', 'student'], icon: <UserCheck className="h-4 w-4" />, roles: ['admin'], component: RolesPermissionsSettings },
    { id: 'audit', label: 'Audit & Data', category: 'System', keywords: ['export', 'audit log', 'data', 'backup'], icon: <Database className="h-4 w-4" />, roles: ['admin'], component: AuditDataSettings },
    { id: 'personal', label: 'Personal Preferences', category: 'System', keywords: ['my settings', 'notifications', 'display', 'calendar view'], icon: <SettingsIcon className="h-4 w-4" />, roles: ['admin', 'instructor', 'student'], component: PersonalPreferencesSettings }
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

  // Set default section based on user role (only on mount)
  useEffect(() => {
    if (user?.role === 'student' || user?.role === 'instructor' || user?.role === 'pilot') {
      setActiveSection('personal');
    } else {
      setActiveSection('organisation');
    }
  }, [user?.role]);

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
    toast.info('Changes discarded');
  };

  const handleSectionChange = (sectionId: string) => {
    if (hasUnsavedChanges) {
      const confirmLeave = window.confirm('You have unsaved changes. Are you sure you want to leave this section?');
      if (!confirmLeave) return;
    }
    setActiveSection(sectionId);
    setHasUnsavedChanges(false);
  };

  const activeComponent = sections.find(s => s.id === activeSection)?.component;
  const ActiveComponent = activeComponent || OrganisationSettings;

  const canEdit = (sectionId: string) => {
    if (user?.role === 'admin') return true;
    if ((user?.role === 'instructor' || user?.role === 'student' || user?.role === 'pilot') && sectionId === 'personal') return true;
    return false;
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600">Configure system preferences and organizational settings</p>
      </div>

      <div className="flex gap-6 h-[calc(100vh-200px)]">
        {/* Left Sidebar */}
        <div className="w-80 bg-white rounded-lg shadow-md border border-gray-200 flex flex-col">
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
                        <span className="flex-1">{section.label}</span>
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
        <div className="flex-1 bg-white rounded-lg shadow-md border border-gray-200 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <ActiveComponent 
              canEdit={canEdit(activeSection)}
              onFormChange={() => setHasUnsavedChanges(true)}
            />
          </div>

          {/* Sticky Save/Cancel Bar */}
          {hasUnsavedChanges && (
            <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">You have unsaved changes</p>
                <div className="flex space-x-3">
                  <button
                    onClick={handleCancel}
                    disabled={isLoading}
                    className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isLoading}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    <span>{isLoading ? 'Saving...' : 'Save Changes'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
