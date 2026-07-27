export const MEMBERSHIP_DOCUMENT_MAX_FILE_SIZE = 15 * 1024 * 1024;

export const MEMBERSHIP_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const organisationDocumentCode = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 80);

export const organisationDocumentFileError = (file: Pick<File, 'size' | 'type'> | null) => {
  if (!file) return 'Choose the updated document file';
  if (file.size > MEMBERSHIP_DOCUMENT_MAX_FILE_SIZE) return 'Document files must be no larger than 15 MB';
  if (!(MEMBERSHIP_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)) return 'Choose a PDF or Word document';
  return null;
};

export const membershipDocumentsAreReady = (
  documents: Array<{ viewUrl: string | null }>,
  loading: boolean,
  error: string | null,
) => !loading && !error && documents.every(document => Boolean(document.viewUrl));
