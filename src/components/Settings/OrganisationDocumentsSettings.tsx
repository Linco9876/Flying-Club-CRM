import React, { useMemo, useRef, useState } from 'react';
import { FileCheck2, FileText, Loader2, Plus, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { MembershipDocument, useMembershipDocuments } from '../../hooks/useMembershipDocuments';
import {
  organisationDocumentCode,
  organisationDocumentFileError,
} from '../../utils/membershipDocumentRules';
import { SettingsLoadError } from './SettingsLoadError';

interface OrganisationDocumentsSettingsProps {
  canEdit: boolean;
}

type DocumentDraft = {
  replacesDocumentId: string | null;
  code: string;
  title: string;
  version: string;
  effectiveDate: string;
  acknowledgementRequired: boolean;
  notes: string;
  file: File | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const defaultVersion = () => today();
const readableSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
};
const blankDraft = (): DocumentDraft => ({
  replacesDocumentId: null,
  code: '',
  title: '',
  version: defaultVersion(),
  effectiveDate: today(),
  acknowledgementRequired: false,
  notes: '',
  file: null,
});

export const OrganisationDocumentsSettings: React.FC<OrganisationDocumentsSettingsProps> = ({ canEdit }) => {
  const { documents, loading, error, refetch } = useMembershipDocuments({ currentOnly: false });
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [changingRequirementId, setChangingRequirementId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentDocuments = useMemo(() => documents.filter(document => document.isCurrent), [documents]);
  const historyByCode = useMemo(() => documents.reduce<Record<string, MembershipDocument[]>>((groups, document) => {
    if (!document.isCurrent) (groups[document.code] ||= []).push(document);
    return groups;
  }, {}), [documents]);

  const startUpdate = (document: MembershipDocument) => {
    setDraft({
      replacesDocumentId: document.id,
      code: document.code,
      title: document.title,
      version: defaultVersion(),
      effectiveDate: today(),
      acknowledgementRequired: document.acknowledgementRequired,
      notes: document.notes || '',
      file: null,
    });
  };

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    const currentDraft = draft;
    const file = currentDraft?.file || null;
    const fileError = organisationDocumentFileError(file);
    if (fileError) {
      toast.error(fileError);
      return;
    }
    if (!currentDraft || !file) return;

    setBusy(true);
    let storagePath = '';
    try {
      const code = currentDraft.replacesDocumentId ? currentDraft.code : organisationDocumentCode(currentDraft.code || currentDraft.title);
      if (code.length < 2) throw new Error('Enter a clear document title');
      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
      storagePath = `${code}/${crypto.randomUUID()}-${safeFileName}`;
      const { error: uploadError } = await supabase.storage
        .from('organisation-documents')
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: publishError } = await supabase.rpc('publish_organisation_document_version', {
        p_replaces_document_id: currentDraft.replacesDocumentId,
        p_code: code,
        p_title: currentDraft.title.trim(),
        p_version: currentDraft.version.trim(),
        p_effective_date: currentDraft.effectiveDate,
        p_storage_path: storagePath,
        p_uploaded_file_name: file.name,
        p_file_size_bytes: file.size,
        p_mime_type: file.type,
        p_acknowledgement_required: currentDraft.acknowledgementRequired,
        p_notes: currentDraft.notes.trim() || null,
      });
      if (publishError) throw publishError;

      toast.success(currentDraft.replacesDocumentId ? 'Updated document version published' : 'Organisation document added');
      setDraft(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refetch();
    } catch (publishError) {
      if (storagePath) {
        await supabase.storage.from('organisation-documents').remove([storagePath]);
      }
      console.error('Could not publish organisation document:', publishError);
      toast.error(publishError instanceof Error ? publishError.message : 'The document could not be published');
    } finally {
      setBusy(false);
    }
  };

  const setAcknowledgementRequired = async (document: MembershipDocument, required: boolean) => {
    setChangingRequirementId(document.id);
    try {
      const { error: updateError } = await supabase.rpc('set_organisation_document_acknowledgement', {
        p_document_id: document.id,
        p_acknowledgement_required: required,
      });
      if (updateError) throw updateError;
      toast.success(required ? 'Document added to membership signup' : 'Membership acknowledgement removed');
      await refetch();
    } catch (updateError) {
      console.error('Could not update membership document requirement:', updateError);
      toast.error('The membership document setting could not be changed');
    } finally {
      setChangingRequirementId(null);
    }
  };

  if (error) {
    return <SettingsLoadError section="Organisation documents" error={error} onRetry={refetch} />;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-2">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Organisation Documents</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">
            Keep the club’s current documents here. Mark a document as a membership document when applicants must read and acknowledge it during signup. Publishing an update retains the previous version and its acknowledgement history.
            Document uploads and membership-document switches save immediately.
          </p>
        </div>
        {canEdit && !draft && (
          <button type="button" onClick={() => setDraft(blankDraft())} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <Plus className="h-4 w-4" /> Add document
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading documents…</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {currentDocuments.map(document => (
            <article key={document.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-start gap-3">
                <div className={`rounded-lg p-2 ${document.acknowledgementRequired ? 'bg-blue-100 text-blue-700' : 'bg-white text-gray-500'}`}>
                  {document.acknowledgementRequired ? <FileCheck2 className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-gray-900">{document.title}</h4>
                    <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600">v{document.version}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Effective {new Date(`${document.effectiveDate}T00:00:00`).toLocaleDateString('en-AU')}
                    {document.fileSizeBytes ? ` · ${readableSize(document.fileSizeBytes)}` : ''}
                  </p>
                  {document.notes && <p className="mt-2 text-xs leading-5 text-gray-600">{document.notes}</p>}
                </div>
              </div>
              <label className="mt-4 flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={document.acknowledgementRequired}
                  disabled={!canEdit || changingRequirementId === document.id}
                  onChange={event => void setAcknowledgementRequired(document, event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                <span><strong>Require acknowledgement during membership signup</strong><span className="mt-0.5 block text-xs font-normal text-gray-500">Applicants see and accept this exact version.</span></span>
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                {document.viewUrl && <a href={document.viewUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">Open document</a>}
                {canEdit && <button type="button" onClick={() => startUpdate(document)} className="font-semibold text-blue-700 hover:text-blue-900">Publish updated version</button>}
                {(historyByCode[document.code]?.length || 0) > 0 && (
                  <span className="ml-auto text-xs text-gray-500">{historyByCode[document.code].length} previous version{historyByCode[document.code].length === 1 ? '' : 's'} retained</span>
                )}
              </div>
              {(historyByCode[document.code]?.length || 0) > 0 && (
                <details className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                  <summary className="cursor-pointer font-semibold text-gray-700">Version history</summary>
                  <ul className="mt-2 space-y-2">
                    {historyByCode[document.code].map(previousVersion => (
                      <li key={previousVersion.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>Version {previousVersion.version}</span>
                        <span>· Effective {new Date(`${previousVersion.effectiveDate}T00:00:00`).toLocaleDateString('en-AU')}</span>
                        {previousVersion.viewUrl && <a href={previousVersion.viewUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">Open</a>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          ))}
          {currentDocuments.length === 0 && <p className="text-sm text-gray-500">No current organisation documents have been added.</p>}
        </div>
      )}

      {draft && (
        <form onSubmit={publish} className="rounded-xl border-2 border-blue-200 bg-blue-50/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold text-blue-950">{draft.replacesDocumentId ? 'Publish an updated version' : 'Add an organisation document'}</h4>
              <p className="mt-1 text-xs text-blue-800">The selected file becomes the current version. Previous versions remain available as audit evidence.</p>
            </div>
            <button type="button" onClick={() => setDraft(null)} disabled={busy} aria-label="Close document editor" className="rounded-lg p-1 text-blue-700 hover:bg-blue-100"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Document title
              <input required value={draft.title} onChange={event => setDraft(current => current && ({ ...current, title: event.target.value, ...(!current.replacesDocumentId && !current.code ? { code: organisationDocumentCode(event.target.value) } : {}) }))} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal" />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Version
              <input required value={draft.version} onChange={event => setDraft(current => current && ({ ...current, version: event.target.value }))} placeholder="e.g. 2026-07 or 3.1" className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal" />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Effective date
              <input required type="date" value={draft.effectiveDate} onChange={event => setDraft(current => current && ({ ...current, effectiveDate: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal" />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              PDF or Word file
              <input ref={fileInputRef} required type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => setDraft(current => current && ({ ...current, file: event.target.files?.[0] || null }))} className="mt-1.5 block w-full text-sm font-normal normal-case tracking-normal text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:font-semibold file:text-blue-700" />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600 md:col-span-2">
              Notes (optional)
              <textarea rows={2} value={draft.notes} onChange={event => setDraft(current => current && ({ ...current, notes: event.target.value }))} className="mt-1.5 w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal" />
            </label>
          </div>
          <label className="mt-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-white p-3 text-sm text-gray-700">
            <input type="checkbox" checked={draft.acknowledgementRequired} onChange={event => setDraft(current => current && ({ ...current, acknowledgementRequired: event.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600" />
            <span><strong>Membership document</strong><span className="mt-0.5 block text-xs font-normal text-gray-500">Require applicants to open/read and acknowledge this version during membership signup.</span></span>
          </label>
          <button type="submit" disabled={busy} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {draft.replacesDocumentId ? 'Publish updated version' : 'Add document'}
          </button>
        </form>
      )}
    </section>
  );
};

export default OrganisationDocumentsSettings;
