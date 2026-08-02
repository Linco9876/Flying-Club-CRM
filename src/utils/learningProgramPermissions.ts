import type { User } from '../types';

export type LearningProgramOwner = {
  createdBy?: string | null;
};

export const canDeleteLearningProgram = (
  user: User | null,
  program: LearningProgramOwner | null | undefined,
): boolean => {
  if (!user || !program) return false;
  const roles = user.roles?.length ? user.roles : [user.role];
  return roles.includes('admin') || program.createdBy === user.id;
};
