export const STUDENT_DOCUMENT_MAX_FILE_SIZE = 25 * 1024 * 1024;

type FileLike = { name?: string; size?: number } | null | undefined;

const errorDetails = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return { code: '', status: '', message: error instanceof Error ? error.message : String(error || '') };
  }
  const value = error as Record<string, unknown>;
  const text = (key: string) => typeof value[key] === 'string' ? String(value[key]).trim() : '';
  return {
    code: text('code') || text('error_code'),
    status: String(value.statusCode ?? value.status ?? ''),
    message: [text('message'), text('error'), text('details')].filter(Boolean).join(' '),
  };
};

export const studentDocumentValidationError = (file: FileLike) => {
  if (!file?.name) return 'Choose a document to upload';
  if (!Number.isFinite(file.size) || Number(file.size) <= 0) return 'The selected document is empty';
  if (Number(file.size) > STUDENT_DOCUMENT_MAX_FILE_SIZE) return 'Documents must be no larger than 25 MB';
  return null;
};

export const studentDocumentUploadFailureMessage = (error: unknown) => {
  const { code, status, message } = errorDetails(error);
  const combined = `${code} ${status} ${message}`.toLowerCase();

  if (/failed to fetch|fetch failed|network|connection|load failed/.test(combined)) {
    return 'The document could not be uploaded. Check your connection and try again.';
  }
  if (status === '413' || /payload too large|too large|maximum.*size|exceeded.*size/.test(combined)) {
    return 'The document is larger than the 25 MB upload limit.';
  }
  if (
    code === '42501'
    || status === '401'
    || status === '403'
    || /row.level security|permission denied|not authori[sz]ed|unauthori[sz]ed|invalid.*jwt|jwt.*expired/.test(combined)
  ) {
    return 'The secure document upload could not verify your account access. Reload the page, complete the authenticator check if prompted, then retry.';
  }

  const reference = code || (status && !/^2\d\d$/.test(status) ? status : '');
  return `The document could not be uploaded. Refresh the page and try again${reference ? ` (error ${reference})` : ''}.`;
};
