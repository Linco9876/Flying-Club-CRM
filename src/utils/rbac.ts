// Role-Based Access Control utilities
import { User, UserRole } from '../types';

export type Action =
  | 'view-dashboard'
  | 'view-calendar'
  | 'view-bookings'
  | 'view-students'
  | 'view-aircraft'
  | 'view-maintenance'
  | 'view-training'
  | 'view-outstanding-records'
  | 'view-billing'
  | 'view-reports'
  | 'view-safety'
  | 'view-settings'
  | 'view-logbook'
  | 'view-pilot-currency'
  | 'view-instructor-approvals'
  | 'view-safety-reports'
  | 'view-checklists-docs'
  | 'edit-settings'
  | 'edit-personal-settings';

export type Resource = 'all' | 'own' | 'none';

interface Permission {
  action: Action;
  resource: Resource;
}

const rolePermissions: Record<UserRole, Permission[]> = {
  admin: [
    { action: 'view-dashboard', resource: 'all' },
    { action: 'view-calendar', resource: 'all' },
    { action: 'view-bookings', resource: 'all' },
    { action: 'view-students', resource: 'all' },
    { action: 'view-aircraft', resource: 'all' },
    { action: 'view-maintenance', resource: 'all' },
    { action: 'view-training', resource: 'all' },
    { action: 'view-outstanding-records', resource: 'all' },
    { action: 'view-billing', resource: 'all' },
    { action: 'view-reports', resource: 'all' },
    { action: 'view-safety', resource: 'all' },
    { action: 'view-settings', resource: 'all' },
    { action: 'view-logbook', resource: 'own' },
    { action: 'view-pilot-currency', resource: 'all' },
    { action: 'view-instructor-approvals', resource: 'all' },
    { action: 'view-safety-reports', resource: 'all' },
    { action: 'view-checklists-docs', resource: 'all' },
    { action: 'edit-settings', resource: 'all' },
    { action: 'edit-personal-settings', resource: 'own' }
  ],
  instructor: [
    { action: 'view-dashboard', resource: 'all' },
    { action: 'view-calendar', resource: 'all' },
    { action: 'view-bookings', resource: 'all' },
    { action: 'view-students', resource: 'all' },
    { action: 'view-aircraft', resource: 'all' },
    { action: 'view-maintenance', resource: 'all' },
    { action: 'view-training', resource: 'all' },
    { action: 'view-outstanding-records', resource: 'all' },
    { action: 'view-safety', resource: 'all' },
    { action: 'view-settings', resource: 'own' },
    { action: 'view-logbook', resource: 'own' },
    { action: 'view-pilot-currency', resource: 'all' },
    { action: 'view-safety-reports', resource: 'all' },
    { action: 'view-checklists-docs', resource: 'all' },
    { action: 'edit-personal-settings', resource: 'own' }
  ],
  pilot: [
    { action: 'view-dashboard', resource: 'all' },
    { action: 'view-calendar', resource: 'all' },
    { action: 'view-bookings', resource: 'own' },
    { action: 'view-aircraft', resource: 'all' },
    { action: 'view-safety', resource: 'own' },
    { action: 'view-settings', resource: 'own' },
    { action: 'view-pilot-currency', resource: 'own' },
    { action: 'view-safety-reports', resource: 'own' },
    { action: 'view-checklists-docs', resource: 'all' },
    { action: 'edit-personal-settings', resource: 'own' }
  ],
  student: [
    { action: 'view-dashboard', resource: 'all' },
    { action: 'view-calendar', resource: 'all' },
    { action: 'view-bookings', resource: 'own' },
    { action: 'view-aircraft', resource: 'all' },
    { action: 'view-safety', resource: 'own' },
    { action: 'view-settings', resource: 'own' },
    { action: 'view-pilot-currency', resource: 'own' },
    { action: 'view-safety-reports', resource: 'own' },
    { action: 'view-checklists-docs', resource: 'all' },
    { action: 'edit-personal-settings', resource: 'own' }
  ]
};

export const hasRole = (user: User | null, role: UserRole): boolean => {
  if (!user) return false;

  if (user.roles && user.roles.length > 0) {
    return user.roles.includes(role);
  }

  return user.role === role;
};

export const hasAnyRole = (user: User | null, roles: UserRole[]): boolean => {
  if (!user) return false;
  return roles.some(role => hasRole(user, role));
};

export const getUserRoles = (user: User | null): UserRole[] => {
  if (!user) return [];
  return user.roles && user.roles.length > 0 ? user.roles : [user.role];
};

export const getPrimaryRole = (user: User | null): UserRole | null => {
  if (!user) return null;

  const roles = getUserRoles(user);

  if (roles.includes('admin')) return 'admin';
  if (roles.includes('instructor')) return 'instructor';
  if (roles.includes('pilot')) return 'pilot';
  return 'student';
};

export const can = (user: User | null, action: Action, resource: Resource = 'all'): boolean => {
  if (!user) return false;

  const userRoles = getUserRoles(user);

  for (const role of userRoles) {
    const permissions = rolePermissions[role] || [];
    const permission = permissions.find(p => p.action === action);

    if (!permission) continue;

    if (permission.resource === 'all') return true;

    if (permission.resource === 'own' && resource === 'own') return true;
  }

  return false;
};

export const getAuthorizedMenuItems = (user: User | null) => {
  if (!user) return [];

  const allMenuItems: { id: string; label: string; action: Action; resource?: Resource; roles?: UserRole[] }[] = [
    { id: 'dashboard', label: 'Dashboard', action: 'view-dashboard' },
    { id: 'calendar', label: 'Calendar', action: 'view-calendar' },
    { id: 'bookings', label: 'My Bookings', action: 'view-bookings', resource: 'own', roles: ['student', 'pilot'] },
    { id: 'students', label: 'Students', action: 'view-students' },
    { id: 'aircraft', label: 'Aircraft', action: 'view-aircraft' },
    { id: 'maintenance', label: 'Maintenance', action: 'view-maintenance' },
    { id: 'training', label: 'Training Records', action: 'view-training' },
    { id: 'outstanding-records', label: 'Outstanding Records', action: 'view-outstanding-records' },
    { id: 'profile', label: 'My Profile', action: 'edit-personal-settings', resource: 'own', roles: ['student', 'pilot'] },
    { id: 'mylogbook', label: 'My Logbook', action: 'view-logbook' },
    { id: 'billing', label: 'Billing', action: 'view-billing' },
    { id: 'reports', label: 'Reports', action: 'view-reports' },
    { id: 'safety', label: 'Safety', action: 'view-safety', resource: hasAnyRole(user, ['student', 'pilot']) ? 'own' : 'all' },
    { id: 'settings', label: 'Settings', action: 'view-settings', resource: hasRole(user, 'admin') ? 'all' : 'own' }
  ];

  return allMenuItems.filter(item => {
    if (item.roles && !hasAnyRole(user, item.roles)) return false;

    return can(user, item.action, item.resource ?? 'all');
  });
};

export const getAuthorizedSafetyTabs = (user: User | null) => {
  if (!user) return [];

  const allTabs = [
    { id: 'pilot-currency', label: 'Pilot Currency', action: 'view-pilot-currency' as Action },
    { id: 'instructor-approvals', label: 'Instructor Approvals', action: 'view-instructor-approvals' as Action },
    { id: 'safety-reports', label: 'Safety Reports', action: 'view-safety-reports' as Action },
    { id: 'checklists-docs', label: 'Checklists / Docs', action: 'view-checklists-docs' as Action }
  ];

  if (hasAnyRole(user, ['student', 'pilot'])) {
    return allTabs.filter(tab =>
      ['pilot-currency', 'safety-reports', 'checklists-docs'].includes(tab.id)
    );
  }

  const resource = hasAnyRole(user, ['student', 'pilot']) ? 'own' : 'all';
  return allTabs.filter(tab => can(user, tab.action, resource));
};

export const getAuthorizedSettingsSections = (user: User | null) => {
  if (!user) return [];

  const allSections = [
    { id: 'organisation', label: 'Organisation', roles: ['admin'] as UserRole[] },
    { id: 'calendar', label: 'Calendar', roles: ['admin'] as UserRole[] },
    { id: 'booking-rules', label: 'Bookings & Rules', roles: ['admin'] as UserRole[] },
    { id: 'booking-fields', label: 'Booking Form Fields', roles: ['admin'] as UserRole[] },
    { id: 'roster', label: 'Roster & Availability', roles: ['admin'] as UserRole[] },
    { id: 'training', label: 'Training / Syllabus', roles: ['admin'] as UserRole[] },
    { id: 'billing', label: 'Billing & Rates', roles: ['admin'] as UserRole[] },
    { id: 'flight-log', label: 'Flight Log Form', roles: ['admin'] as UserRole[] },
    { id: 'integrations', label: 'Integrations', roles: ['admin'] as UserRole[] },
    { id: 'notifications', label: 'Notifications', roles: ['admin'] as UserRole[] },
    { id: 'safety', label: 'Safety & Compliance', roles: ['admin'] as UserRole[] },
    { id: 'maintenance', label: 'Maintenance', roles: ['admin'] as UserRole[] },
    { id: 'resources', label: 'Resources (Aircraft & Rooms)', roles: ['admin'] as UserRole[] },
    { id: 'documents', label: 'Documents & Templates', roles: ['admin'] as UserRole[] },
    { id: 'portal', label: 'Portal & UX', roles: ['admin'] as UserRole[] },
    { id: 'roles', label: 'Roles & Permissions', roles: ['admin'] as UserRole[] },
    { id: 'audit', label: 'Audit & Data', roles: ['admin'] as UserRole[] },
    { id: 'personal', label: 'Personal Preferences', roles: ['admin', 'instructor', 'pilot', 'student'] as UserRole[] }
  ];

  return allSections.filter(section =>
    hasAnyRole(user, section.roles)
  );
};
