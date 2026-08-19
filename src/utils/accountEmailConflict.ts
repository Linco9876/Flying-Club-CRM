export type AccountEmailConflictResponse = {
  code?: string;
  canReconcile?: boolean;
  error?: string;
  conflictEmail?: string;
};

export const isReconcileableOrphanEmailConflict = (
  value: unknown,
): value is AccountEmailConflictResponse => {
  if (!value || typeof value !== 'object') return false;
  const result = value as AccountEmailConflictResponse;
  return result.code === 'ORPHAN_AUTH_ACCOUNT' && result.canReconcile === true;
};

export const orphanEmailReconciliationPrompt = (email: string) =>
  `A login already exists for ${email}, but it is not attached to any CRM member.\n\n` +
  'The name on that login matches this member. Link it to this member and retire the unused login record?\n\n' +
  'The member will need to use the password-reset link sent to the new email before signing in.';
