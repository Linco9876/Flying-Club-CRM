import React, { useEffect, useState } from "react";
import { Plus, FileText, Loader2, X, ChevronDown } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { useTrainingSettings } from "../../hooks/useTrainingSettings";
import {
  MEDICALS_UPDATED,
  useMedicalRecords,
} from "../../hooks/useMedicalRecords";
import {
  medicalRecordCurrency,
  medicalEntryRequirements,
  defaultMedicalOperations,
  type MedicalRecord,
} from "../../utils/medicalRecords";
import { studentDocumentValidationError } from "../../utils/studentDocumentUpload";

type Draft = Partial<MedicalRecord> & { user_id: string };
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
export function MedicalRecordsPanel({
  userId,
  dateOfBirth,
  canEdit = true,
}: {
  userId: string;
  dateOfBirth?: Date;
  canEdit?: boolean;
}) {
  const { user } = useAuth();
  const {
    settings,
    loading: settingsLoading,
    error: settingsError,
  } = useTrainingSettings();
  const { records, loading, error } = useMedicalRecords(userId);
  const staff = (user?.roles || [user?.role]).some((role) =>
    ["admin", "cfi", "senior_instructor", "instructor"].includes(role || ""),
  );
  const [documents, setDocuments] = useState<
    Array<{ id: string; display_name: string }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("student_documents")
      .select("id,display_name")
      .eq("student_id", userId)
      .then(({ data }) => {
        if (!cancelled) setDocuments(data || []);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [audit, setAudit] = useState<Array<{
    id: string;
    action: string;
    created_at: string;
  }> | null>(null);
  const current = records.filter(
    (record) => !["superseded", "withdrawn"].includes(record.status),
  );
  const shown = history ? records : current;
  const type = settings.medicalTypes.find((item) => item.id === draft?.type_id);
  const requirements = medicalEntryRequirements(
    type ||
      (draft
        ? {
            validityMode: draft.validity_mode || "expiry_date",
            validUntilAge: draft.valid_until_age,
          }
        : undefined),
    dateOfBirth,
  );
  const set = (field: string, value: unknown) =>
    setDraft((previous) =>
      previous ? { ...previous, [field]: value } : previous,
    );
  const start = (record?: MedicalRecord, renew = false) => {
    setProof(null);
    setDraft(
      record
        ? {
            ...record,
            ...(renew
              ? {
                  id: undefined,
                  issued_on: null,
                  expires_on: null,
                  review_due_on: null,
                  updated_at: undefined,
                  status: "active" as const,
                }
              : {}),
            status:
              ["legacy", "verified", "pending"].includes(record.status) || renew
                ? "active"
                : record.status,
          }
        : { user_id: userId, status: "active", accepted_operations: [] },
    );
  };
  const save = async () => {
    if (!draft || !user) return;
    if (draft.status === "active") {
      if (requirements.missingDateOfBirth) {
        toast.error("Add a date of birth to the profile first.");
        return;
      }
      if (!requirements.automaticExpiry && !draft.expires_on) {
        toast.error("Enter the medical expiry date.");
        return;
      }
      if (requirements.documentRequired && !proof && !draft.document_id) {
        toast.error(
          "Upload or select a supporting document for this age-limited medical.",
        );
        return;
      }
    }
    setBusy(true);
    try {
      let documentId = draft.document_id;
      if (proof) {
        const validation = studentDocumentValidationError(proof);
        if (validation) throw new Error(validation);
        const path = `${userId}/${crypto.randomUUID()}-${proof.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: uploadError } = await supabase.storage
          .from("student-documents")
          .upload(path, proof);
        if (uploadError) throw uploadError;
        const { data: document, error: documentError } = await supabase
          .from("student_documents")
          .insert({
            student_id: userId,
            display_name: `Medical: ${type?.name || draft.medical_type}`,
            original_filename: proof.name,
            storage_path: path,
            mime_type: proof.type || null,
            size_bytes: proof.size,
            uploaded_by: user.id,
          })
          .select("id")
          .single();
        if (documentError) {
          await supabase.storage.from("student-documents").remove([path]);
          throw documentError;
        }
        documentId = document.id;
        setDocuments((previous) => [
          ...previous,
          {
            id: document.id,
            display_name: `Medical: ${type?.name || draft.medical_type}`,
          },
        ]);
        setDraft((previous) =>
          previous ? { ...previous, document_id: documentId } : previous,
        );
        setProof(null);
      }
      const { error: saveError } = await supabase.rpc("save_member_medical", {
        p_record: {
          ...draft,
          expires_on: requirements.automaticExpiry || draft.expires_on || null,
          document_id: documentId || null,
        },
      });
      if (saveError) throw saveError;
      setDraft(null);
      window.dispatchEvent(new Event(MEDICALS_UPDATED));
      toast.success("Medical record saved");
    } catch (failure) {
      toast.error(
        failure instanceof Error
          ? failure.message
          : (failure as { message?: string })?.message ||
              "Medical could not be saved",
      );
    } finally {
      setBusy(false);
    }
  };
  const openEvidence = async (id: string) => {
    const { data, error: failure } = await supabase
      .from("student_documents")
      .select("storage_path")
      .eq("id", id)
      .single();
    if (failure) {
      toast.error("Evidence could not be opened");
      return;
    }
    const { data: link, error: linkError } = await supabase.storage
      .from("student-documents")
      .createSignedUrl(data.storage_path, 60);
    if (linkError) {
      toast.error("Evidence could not be opened");
      return;
    }
    window.open(link.signedUrl, "_blank", "noopener,noreferrer");
  };
  return (
    <section className="space-y-2 text-slate-900 dark:text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Medicals &amp; declarations</h3>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => start()}
            disabled={
              loading ||
              settingsLoading ||
              Boolean(error || settingsError) ||
              busy
            }
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
          >
            <Plus size={13} />
            Add medical
          </button>
        )}
      </div>
      {loading || settingsLoading ? (
        <p className="flex items-center gap-2">
          <Loader2 className="animate-spin" size={16} />
          Loading medicals…
        </p>
      ) : error || settingsError ? (
        <p role="alert" className="text-red-600">
          Medicals could not be loaded. Refresh before checking eligibility.
        </p>
      ) : (
        <>
          {shown.length === 0 && (
            <p className="py-2 text-xs text-slate-500 dark:text-slate-400">
              No medicals recorded.
            </p>
          )}
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((record) => {
              const currency = medicalRecordCurrency(record, dateOfBirth);
              return (
                <details key={record.id} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 font-medium">
                      {record.medical_type}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={`text-xs ${currency.state === "expired" || record.status === "suspended" ? "text-amber-700 dark:text-amber-300" : "text-slate-500 dark:text-slate-400"}`}
                      >
                        {record.status === "suspended"
                          ? "Suspended · "
                          : currency.state === "expired"
                            ? "Expired · "
                            : ""}
                        {currency.effectiveExpiry
                          ? currency.effectiveExpiry.toLocaleDateString(
                              "en-AU",
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              },
                            )
                          : "Expiry not recorded"}
                      </span>
                      <ChevronDown
                        size={13}
                        className="text-slate-400 transition-transform group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </span>
                  </summary>
                  <div className="pb-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {["active", "verified", "legacy", "pending"].includes(
                        record.status,
                      )
                        ? "Recorded"
                        : record.status}{" "}
                      · {currency.label}
                    </p>
                    {record.restrictions && (
                      <p className="mt-2 text-sm">
                        Conditions / review note: {record.restrictions}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold text-blue-700 dark:text-blue-300">
                      {record.document_id && (
                        <button
                          type="button"
                          onClick={() => void openEvidence(record.document_id!)}
                          className="inline-flex items-center gap-1"
                        >
                          <FileText size={14} />
                          View evidence
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => start(record, true)}
                        >
                          Renew / add replacement
                        </button>
                      )}
                      {canEdit &&
                        (staff ||
                          [
                            "active",
                            "verified",
                            "legacy",
                            "pending",
                            "withdrawn",
                          ].includes(record.status)) && (
                          <button type="button" onClick={() => start(record)}>
                            Edit medical
                          </button>
                        )}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
          <details className="text-xs text-slate-500 dark:text-slate-400">
            <summary className="w-fit cursor-pointer py-1">History</summary>
            <div className="flex flex-wrap gap-4 py-2 text-xs">
              <button
                type="button"
                onClick={() => setHistory(!history)}
                className="text-blue-700 dark:text-blue-300"
              >
                {history ? "Hide archived records" : "Show archived records"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (audit) {
                    setAudit(null);
                    return;
                  }
                  const { data, error: auditError } = await supabase
                    .from("member_medical_audit")
                    .select("id,action,created_at")
                    .eq("user_id", userId)
                    .order("created_at", { ascending: false });
                  if (auditError) toast.error("Audit could not be loaded");
                  else setAudit(data || []);
                }}
                className="text-blue-700 dark:text-blue-300"
              >
                {audit ? "Hide audit history" : "View audit history"}
              </button>
            </div>
            {audit && (
              <ul className="space-y-1 text-xs">
                {audit.map((item) => (
                  <li key={item.id}>
                    {new Date(item.created_at).toLocaleString()} ·{" "}
                    {item.action.replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      )}
      {draft && (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
          <div className="flex justify-between">
            <h4 className="font-semibold">
              {draft.id ? "Edit medical" : "Add medical / declaration"}
            </h4>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
              aria-label="Close medical editor"
            >
              <X size={18} />
            </button>
          </div>
          <label className="block text-sm">
            Medical type
            <select
              className={inputClass}
              value={draft.type_id || ""}
              onChange={(event) => {
                const selected = settings.medicalTypes.find(
                  (item) => item.id === event.target.value,
                );
                setDraft((previous) => ({
                  ...previous!,
                  type_id: event.target.value,
                  medical_type: selected?.name,
                  accepted_operations:
                    selected?.acceptedOperations ||
                    defaultMedicalOperations(selected?.name || ""),
                }));
              }}
            >
              <option value="">Choose medical type</option>
              {settings.medicalTypes
                .filter((item) => item.isActive || item.id === draft.type_id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          {requirements.missingDateOfBirth && (
            <p
              role="alert"
              className="text-sm text-amber-700 dark:text-amber-300"
            >
              Add a date of birth to the profile to calculate this medical's
              expiry.
            </p>
          )}
          <label className="block text-sm">
            Expiry date
            <input
              type="date"
              className={inputClass}
              value={requirements.automaticExpiry || draft.expires_on || ""}
              readOnly={Boolean(requirements.automaticExpiry)}
              required={!requirements.automaticExpiry}
              onChange={(event) =>
                set("expires_on", event.target.value || null)
              }
            />
          </label>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {requirements.automaticExpiry
              ? `Valid until age ${type?.validUntilAge || draft.valid_until_age}. No supporting document is required before that birthday.`
              : requirements.documentRequired
                ? `From age ${type?.validUntilAge || draft.valid_until_age}, add a supporting document and its expiry date to keep using this medical type.`
                : "Enter the expiry date shown on the medical. A supporting document is optional."}
          </p>
          <label className="block text-sm">
            Existing evidence
            <select
              className={inputClass}
              value={draft.document_id || ""}
              onChange={(e) => set("document_id", e.target.value || null)}
            >
              <option value="">No existing document selected</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Supporting document{" "}
            {requirements.documentRequired ? "(required)" : "(optional)"}
            <input
              type="file"
              className={inputClass}
              onChange={(e) => setProof(e.target.files?.[0] || null)}
            />
          </label>
          <label className="block text-sm">
            Operating restrictions / notes
            <textarea
              className={inputClass}
              rows={2}
              value={draft.restrictions || ""}
              onChange={(e) => set("restrictions", e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Record status
            <select
              className={inputClass}
              value={draft.status}
              onChange={(e) => set("status", e.target.value)}
            >
              <option value="active">Active</option>
              {staff && (
                <>
                  <option value="superseded">Superseded</option>
                  <option value="suspended">
                    Suspended — requires medical review
                  </option>
                </>
              )}
              <option value="withdrawn">Withdrawn</option>
            </select>
          </label>
          <p className="text-xs">
            Medical records take effect when saved, subject to their expiry and
            evidence requirements. No approval is needed.
          </p>
          <button
            type="button"
            disabled={busy || (!draft.type_id && !draft.id)}
            onClick={() => void save()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save medical record"}
          </button>
        </div>
      )}
    </section>
  );
}
