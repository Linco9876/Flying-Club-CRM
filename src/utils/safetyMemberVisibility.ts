export interface SafetyMemberVisibilityRecord {
  isActive?: boolean | null;
}

export const isActiveSafetyMember = (member: SafetyMemberVisibilityRecord) =>
  member.isActive !== false;

export const filterActiveSafetyMembers = <T extends SafetyMemberVisibilityRecord>(members: readonly T[]) =>
  members.filter(isActiveSafetyMember);
