export type InstructorComplianceSaveStage =
  | 'form-upload'
  | 'record-save'
  | 'flight-finalise';

const errorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }
  return '';
};

const errorCode = (error: unknown): string => {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }
  return '';
};

const isAccessPolicyError = (error: unknown): boolean => {
  const message = errorText(error).toLowerCase();
  return errorCode(error) === '42501'
    || message.includes('row-level security')
    || message.includes('not authorized')
    || message.includes('not authorised');
};

export const instructorComplianceSaveFailureMessage = (
  error: unknown,
  stage: InstructorComplianceSaveStage,
): string => {
  if (isAccessPolicyError(error)) {
    if (stage === 'form-upload') {
      return 'The renewal form upload was not authorised. Refresh the page, confirm you are signed in with CFI/DCFI authority, then try again.';
    }
    if (stage === 'flight-finalise') {
      return 'The instructor review was saved, but the flight could not be marked as recorded. Refresh the training queue before taking any further action.';
    }
    return 'The instructor review could not confirm your CFI/DCFI authority. Refresh the page and sign in again before retrying.';
  }

  const message = errorText(error).trim();
  if (stage === 'flight-finalise') {
    return 'The instructor review was saved, but the training queue could not be refreshed. Refresh the page before taking any further action.';
  }
  return message || (stage === 'form-upload'
    ? 'The renewal form could not be uploaded.'
    : 'The instructor review could not be saved.');
};
