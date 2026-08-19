export type LapsedComplianceSeverity = 'lapsed' | 'blocked';

export const credentialLapseSeverity = (
  blockingEnabled: boolean,
): LapsedComplianceSeverity => blockingEnabled ? 'blocked' : 'lapsed';

export const bfrLapseSeverity = (
  requireCurrentBfrForSolo: boolean,
  hasInstructor: boolean,
): LapsedComplianceSeverity =>
  requireCurrentBfrForSolo && !hasInstructor ? 'blocked' : 'lapsed';
