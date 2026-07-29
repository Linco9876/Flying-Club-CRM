export const requiresAutomaticInstructorSupervision = (roles: string[]): boolean => {
  const roleSet = new Set(roles);
  return roleSet.has('instructor')
    && !roleSet.has('senior_instructor')
    && !roleSet.has('cfi');
};
