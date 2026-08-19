export const validProvisionedUserRoles = new Set([
  "admin",
  "senior_instructor",
  "instructor",
  "pilot",
  "student",
]);

const instructorCreatorRoles = new Set([
  "cfi",
  "senior_instructor",
  "instructor",
]);

export type ProvisioningAccess = {
  allowed: boolean;
  isAdmin: boolean;
  isInstructorCreator: boolean;
  error?: string;
};

export const provisioningAccessFor = (
  callerRoles: readonly string[],
  requestedRoles: readonly string[],
): ProvisioningAccess => {
  const isAdmin = callerRoles.includes("admin");
  const isInstructorCreator = callerRoles.some((role) => instructorCreatorRoles.has(role));

  if (!isAdmin && !isInstructorCreator) {
    return {
      allowed: false,
      isAdmin,
      isInstructorCreator,
      error: "Only admins and instructors can add portal users",
    };
  }

  if (!isAdmin) {
    const permitted = requestedRoles.length === 1 &&
      (requestedRoles[0] === "student" || requestedRoles[0] === "pilot");
    if (!permitted) {
      return {
        allowed: false,
        isAdmin,
        isInstructorCreator,
        error: "Instructors can add Student or Pilot users only",
      };
    }
  }

  return { allowed: true, isAdmin, isInstructorCreator };
};
