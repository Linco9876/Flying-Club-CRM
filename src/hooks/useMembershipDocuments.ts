import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface MembershipDocument {
  id: string;
  code: string;
  title: string;
  version: string;
  effectiveDate: string;
  documentUrl: string | null;
  storagePath: string | null;
  uploadedFileName: string | null;
  fileSizeBytes: number | null;
  mimeType: string | null;
  acknowledgementRequired: boolean;
  isCurrent: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  viewUrl: string | null;
}

type MembershipDocumentRow = {
  id: string;
  code: string;
  title: string;
  version: string;
  effective_date: string;
  document_url: string | null;
  storage_path: string | null;
  uploaded_file_name: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  acknowledgement_required: boolean;
  is_current: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

interface UseMembershipDocumentsOptions {
  currentOnly?: boolean;
  acknowledgementOnly?: boolean;
  enabled?: boolean;
}

export const useMembershipDocuments = ({
  currentOnly = true,
  acknowledgementOnly = false,
  enabled = true,
}: UseMembershipDocumentsOptions = {}) => {
  const [documents, setDocuments] = useState<MembershipDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let query = supabase
        .from('membership_documents')
        .select('id,code,title,version,effective_date,document_url,storage_path,uploaded_file_name,file_size_bytes,mime_type,acknowledgement_required,is_current,notes,created_at,updated_at')
        .order('title')
        .order('effective_date', { ascending: false });
      if (currentOnly) query = query.eq('is_current', true);
      if (acknowledgementOnly) query = query.eq('acknowledgement_required', true);

      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      const rows = (data || []) as MembershipDocumentRow[];
      const mapped = await Promise.all(rows.map(async (row): Promise<MembershipDocument> => {
        let viewUrl = row.document_url;
        if (row.storage_path) {
          const { data: signedData, error: signedError } = await supabase.storage
            .from('organisation-documents')
            .createSignedUrl(row.storage_path, 3_600);
          if (signedError) {
            console.warn(`Could not create a link for organisation document ${row.id}:`, signedError);
          } else {
            viewUrl = signedData.signedUrl;
          }
        }
        return {
          id: row.id,
          code: row.code,
          title: row.title,
          version: row.version,
          effectiveDate: row.effective_date,
          documentUrl: row.document_url,
          storagePath: row.storage_path,
          uploadedFileName: row.uploaded_file_name,
          fileSizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
          mimeType: row.mime_type,
          acknowledgementRequired: Boolean(row.acknowledgement_required),
          isCurrent: Boolean(row.is_current),
          notes: row.notes,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          viewUrl,
        };
      }));
      setDocuments(mapped);
      setError(null);
    } catch (nextError) {
      console.error('Failed to load organisation documents:', nextError);
      setDocuments([]);
      setError(nextError instanceof Error ? nextError.message : 'Organisation documents could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [acknowledgementOnly, currentOnly, enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { documents, loading, error, refetch };
};
