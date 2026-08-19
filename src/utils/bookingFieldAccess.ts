const BOOKING_FIELD_ROLE_HIERARCHY: Record<string, string[]> = {
  cfi: ['cfi', 'senior_instructor', 'instructor'],
  senior_instructor: ['senior_instructor', 'instructor'],
};

export const getEffectiveBookingFieldRoles = (role: string): string[] => {
  const normalisedRole = role.trim().toLowerCase();
  if (!normalisedRole) return [];
  return BOOKING_FIELD_ROLE_HIERARCHY[normalisedRole] || [normalisedRole];
};

export const bookingFieldAppliesToRole = (
  appliesToRoles: string[],
  userRole: string,
): boolean => {
  const configuredRoles = new Set(
    appliesToRoles.map(role => role.trim().toLowerCase()).filter(Boolean),
  );

  return getEffectiveBookingFieldRoles(userRole).some(role => configuredRoles.has(role));
};
