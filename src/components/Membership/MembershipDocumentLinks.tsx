import React from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { MembershipDocument, useMembershipDocuments } from '../../hooks/useMembershipDocuments';

interface MembershipDocumentLinksProps {
  documents?: MembershipDocument[];
  loading?: boolean;
  error?: string | null;
}

export const MembershipDocumentLinks: React.FC<MembershipDocumentLinksProps> = ({
  documents: suppliedDocuments,
  loading: suppliedLoading,
  error: suppliedError,
}) => {
  const documentState = useMembershipDocuments({
    currentOnly: true,
    acknowledgementOnly: true,
    enabled: suppliedDocuments === undefined,
  });
  const documents = suppliedDocuments ?? documentState.documents;
  const loading = suppliedLoading ?? documentState.loading;
  const error = suppliedError ?? documentState.error;

  if (loading) {
    return <span className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading current documents…</span>;
  }
  if (error) {
    return <span className="mt-2 block rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">The current membership documents could not be loaded. Please try again before applying.</span>;
  }
  if (!documents.length) {
    return <span className="mt-2 block text-xs text-slate-500">There are no additional membership documents requiring acknowledgement.</span>;
  }

  return (
    <ul className="mt-3 grid gap-2" aria-label="Current membership documents">
      {documents.map(document => (
        <li key={document.id}>
          {document.viewUrl ? (
            <a
              href={document.viewUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-white px-3 py-2 text-left text-xs font-semibold text-blue-800 hover:border-blue-400 hover:bg-blue-50"
              onClick={event => event.stopPropagation()}
            >
              <span>{document.title} <span className="font-normal text-slate-500">Version {document.version}</span></span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : (
            <span className="block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {document.title} version {document.version} is temporarily unavailable. Contact the club before applying.
            </span>
          )}
        </li>
      ))}
    </ul>
  );
};

export default MembershipDocumentLinks;
