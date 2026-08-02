import type { User, UserRole } from '../types';

export type CrmReviewerRole = Extract<
  UserRole,
  'admin' | 'cfi' | 'senior_instructor' | 'instructor'
>;

export const CRM_REVIEWER_ROLE_OPTIONS: ReadonlyArray<{
  role: CrmReviewerRole;
  label: string;
}> = [
  { role: 'admin', label: 'Admin' },
  { role: 'cfi', label: 'CFI' },
  { role: 'senior_instructor', label: 'Senior Instructor' },
  { role: 'instructor', label: 'Instructor' },
];

const CRM_REVIEWER_ROLES = new Set<UserRole>(
  CRM_REVIEWER_ROLE_OPTIONS.map(option => option.role),
);

const LEGACY_REVIEWER_ROLE_ALIASES: Record<string, CrmReviewerRole> = {
  flight_examiner: 'cfi',
  pilot_examiner: 'cfi',
};

export const normaliseReviewerRoles = (
  roles: readonly string[] | null | undefined,
): CrmReviewerRole[] => Array.from(new Set(
  (roles || [])
    .map(role => String(role || '').trim().toLowerCase())
    .map(role => LEGACY_REVIEWER_ROLE_ALIASES[role] || role)
    .filter((role): role is CrmReviewerRole => CRM_REVIEWER_ROLES.has(role as UserRole)),
));

export const assignedCrmRoles = (
  user: Pick<User, 'role' | 'roles' | 'isSeniorInstructor'> | null | undefined,
): UserRole[] => {
  if (!user) return [];
  const roles = [...(user.roles || []), user.role];
  if (user.isSeniorInstructor && !roles.includes('senior_instructor')) {
    roles.push('senior_instructor');
  }
  return Array.from(new Set(roles));
};

export const userCanConductReview = (
  user: Pick<User, 'role' | 'roles' | 'isSeniorInstructor'> | null | undefined,
  allowedRoles: readonly string[] | null | undefined,
) => {
  const allowed = new Set(normaliseReviewerRoles(allowedRoles));
  return allowed.size > 0 && assignedCrmRoles(user).some(role => allowed.has(role as CrmReviewerRole));
};
