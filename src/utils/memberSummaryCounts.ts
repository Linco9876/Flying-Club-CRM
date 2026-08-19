export interface MemberSummaryInput {
  isActive?: boolean;
  role: string;
  roles?: string[];
}

export const getActiveMemberSummaryCounts = (members: MemberSummaryInput[]) => {
  const activeMembers = members.filter(member => member.isActive !== false);
  const roles = {
    admin: 0,
    instructor: 0,
    pilot: 0,
    student: 0,
  };

  activeMembers.forEach(member => {
    const memberRoles = member.roles && member.roles.length > 0
      ? member.roles
      : [member.role];
    if (memberRoles.includes('admin')) roles.admin += 1;
    if (memberRoles.includes('instructor') || memberRoles.includes('senior_instructor')) roles.instructor += 1;
    if (memberRoles.includes('pilot')) roles.pilot += 1;
    if (memberRoles.includes('student')) roles.student += 1;
  });

  return {
    active: activeMembers.length,
    archived: members.length - activeMembers.length,
    total: activeMembers.length,
    roles,
  };
};
