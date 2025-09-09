// Role-Based Access Control utilities
import { User } from '../types';

export type Action = 
  | 'view-dashboard'
  | 'view-calendar'
  | 'view-bookings'
  | 'view-students'
  | 'view-aircraft'
  | 'view-maintenance'
  | 'view-training'
  | 'view-billing'
  | 'view-reports'
  | 'view-safety'
  | 'view-settings'
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

const rolePermissions: Record<string, Permission[]> = {
  admin: [
    { action: 'view-dashboard', resource: 'all' },
    { action: 'view-calendar', resource: 'all' },
    { action: 'view-bookings', resource: 'all' },
    { action: 'view-students', resource: 'all' },
    { action: 'view-aircraft', resource: 'all' },
    { action: 'view-maintenance', resource: 'all' },
    { action: 'view-training', resource: 'all' },
    { action: 'view-billing', resource: 'all' },
    { action: 'view-reports', resource: 'all' },
    { action: 'view-safety', resource: 'all' },
    { action: 'view-settings', resource: 'all' },
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
    { action: 'view-students', resource: 'all' },
    { action: 'view-aircraft', resource: 'all' },
    { action: 'view-maintenance', resource: 'all' },
    { action: 'view-training', resource: 'all' },
    { action: 'view-safety', resource: 'all' },
    { action: 'view-settings', resource: 'own' },
    { action: 'view-pilot-currency', resource: 'all' },
    { action: 'view-safety-reports', resource: 'all' },
    { action: 'view-checklists-docs', resource: 'all' },
    { action: 'edit-personal-settings', resource: 'own' }
  ],
  student: [
    { action: 'view-dashboard', resource: 'own' },
    { action: 'view-calendar', resource: 'own' },
    { action: 'view-bookings', resource: 'own' },
    { action: 'view-safety', resource: 'own' },
    { action: 'view-settings', resource: 'own' },
    { action: 'view-pilot-currency', resource: 'own' },
    { action: 'view-safety-reports', resource: 'own' },
    { action: 'view-checklists-docs', resource: 'all' },
    { action: 'edit-personal-settings', resource: 'own' }
  ]
};

export const can = (user: User | null, action: Action, resource: Resource = 'all'): boolean => {
  if (!user) return false;
  
  const permissions = rolePermissions[user.role] || [];
  const permission = permissions.find(p => p.action === action);
  
  if (!permission) return false;
  
  // If permission allows 'all', user can access
  if (permission.resource === 'all') return true;
  
  // If permission is 'own' and requested resource is 'own', allow
  if (permission.resource === 'own' && resource === 'own') return true;
  
  // If permission is 'own' but requested resource is 'all', deny
  if (permission.resource === 'own' && resource === 'all') return false;
  
  return false;
};

export const getAuthorizedMenuItems = (user: User | null) => {
  if (!user) return [];
  
  const allMenuItems = [
    { id: 'dashboard', label: 'Dashboard', action: 'view-dashboard' as Action },
    { id: 'calendar', label: 'Calendar', action: 'view-calendar' as Action },
    { id: 'bookings', label: 'My Bookings', action: 'view-bookings' as Action, roles: ['student'] },
    { id: 'students', label: 'Students', action: 'view-students' as Action },
    { id: 'aircraft', label: 'Aircraft', action: 'view-aircraft' as Action },
    { id: 'maintenance', label: 'Maintenance', action: 'view-maintenance' as Action },
    { id: 'training', label: 'Training Records', action: 'view-training' as Action },
    { id: 'profile', label: 'My Profile', action: 'view-students' as Action, roles: ['student'] },
    { id: 'billing', label: 'Billing', action: 'view-billing' as Action },
    { id: 'reports', label: 'Reports', action: 'view-reports' as Action },
    { id: 'safety', label: 'Safety', action: 'view-safety' as Action },
    { id: 'settings', label: 'Settings', action: 'view-settings' as Action }
  ];
  
  return allMenuItems.filter(item => {
    // Check role-specific restrictions
    if (item.roles && !item.roles.includes(user.role)) return false;
    
    // Check RBAC permissions
    return can(user, item.action);
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
  
  return allTabs.filter(tab => can(user, tab.action));
};

export const getAuthorizedSettingsSections = (user: User | null) => {
  if (!user) return [];
  
  const allSections = [
    { id: 'organisation', label: 'Organisation', roles: ['admin'] },
    { id: 'calendar', label: 'Calendar', roles: ['admin'] },
    { id: 'booking-rules', label: 'Bookings & Rules', roles: ['admin'] },
    { id: 'roster', label: 'Roster & Availability', roles: ['admin'] },
    { id: 'training', label: 'Training / Syllabus', roles: ['admin'] },
    { id: 'billing', label: 'Billing & Rates', roles: ['admin'] },
    { id: 'integrations', label: 'Integrations', roles: ['admin'] },
    { id: 'notifications', label: 'Notifications', roles: ['admin'] },
    { id: 'safety', label: 'Safety & Compliance', roles: ['admin'] },
    { id: 'maintenance', label: 'Maintenance', roles: ['admin'] },
    { id: 'resources', label: 'Resources (Aircraft & Rooms)', roles: ['admin'] },
    { id: 'documents', label: 'Documents & Templates', roles: ['admin'] },
    { id: 'portal', label: 'Portal & UX', roles: ['admin'] },
    { id: 'roles', label: 'Roles & Permissions', roles: ['admin'] },
    { id: 'audit', label: 'Audit & Data', roles: ['admin'] },
    { id: 'personal', label: 'Personal Preferences', roles: ['admin', 'instructor', 'student'] }
  ];
  
  return allSections.filter(section => 
    section.roles.includes(user.role)
  );
};