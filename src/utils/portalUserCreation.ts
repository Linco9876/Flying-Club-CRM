import type { UserRole } from '../types';

const ADMIN_CREATABLE_ROLES: readonly UserRole[] = ['student', 'pilot', 'instructor', 'admin'];
const INSTRUCTOR_CREATABLE_ROLES: readonly UserRole[] = ['student', 'pilot'];
const INSTRUCTOR_ROLES: readonly UserRole[] = ['cfi', 'senior_instructor', 'instructor'];

export const portalRolesUserMayCreate = (callerRoles: readonly UserRole[]): UserRole[] => {
  if (callerRoles.includes('admin')) return [...ADMIN_CREATABLE_ROLES];
  if (callerRoles.some(role => INSTRUCTOR_ROLES.includes(role))) {
    return [...INSTRUCTOR_CREATABLE_ROLES];
  }
  return [];
};

export const canCreatePortalUsers = (callerRoles: readonly UserRole[]) =>
  portalRolesUserMayCreate(callerRoles).length > 0;
