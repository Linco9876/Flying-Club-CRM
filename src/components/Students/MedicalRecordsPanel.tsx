import { assessLicence } from "../../utils/licenceMedicals";
import React, { useEffect, useState } from "react";
import { Plus, FileText, Loader2, X } from "lucide-react";
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
    (record) =>
      !["superseded", "withdrawn"].includes(record.status) &&
      (record.status === "suspended" ||
        record.status === "pending" ||
        medicalRecordCurrency(record, dateOfBirth).label !== "Expired"),
  );
  const shown = history ? records : current;
  const type = settings.medicalTypes.find((item) => item.id === draft?.type_id);
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
                  status: "pending" as const,
                }
              : {}),
            status:
              record.status === "legacy" || renew ? "pending" : record.status,
          }
        : { user_id: userId, status: "pending", accepted_operations: [] },
    );
  };
  const save = async () => {
    if (!draft || !user) return;
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
        p_record: { ...draft, document_id: documentId || null },
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
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Medicals &amp; declarations</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Keep all certificates and declarations here. Each activity uses an
            applicable current record.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => start()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
          >
            <Plus size={16} />
            Add medical / declaration
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
          <div className="grid gap-2 sm:grid-cols-2">
            {settings.licenceTypes.map((label) => {
              const result = assessLicence(
                {
                  id: "coverage",
                  type: label,
                  isActive: true,
                  verificationStatus: "verified",
                },
                records,
                dateOfBirth,
                settings.licenceMedicalRequirements,
              );
              const valid = result.valid;
              return (
                <div
                  key={label}
                  className={`rounded-lg border p-3 ${valid ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100" : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"}`}
                >
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="mt-1 text-xs">
                    {valid
                      ? "Accepted medical requirement satisfied"
                      : result.reason}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">
            Medical support for each licence is shown above. Holding that
            licence, its expiry, instructor requirements and aircraft
            restrictions are checked when booking.
          </p>
          {shown.length === 0 && (
            <p className="text-sm">No medical records recorded.</p>
          )}
          {shown.map((record) => {
            const currency = medicalRecordCurrency(record, dateOfBirth);
            return (
              <article
                key={record.id}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold">{record.medical_type}</h4>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                    {record.status === "legacy"
                      ? "Imported · not reverified"
                      : record.status}{" "}
                    · {currency.label}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Issued/declaration: {record.issued_on || "Not recorded"} ·
                  Certificate expiry: {record.expires_on || "Not recorded"}
                  {record.review_due_on &&
                    ` · Review due: ${record.review_due_on}`}
                  {record.validity_mode === "until_age" &&
                    ` · Additional requirements at age ${record.valid_until_age || "?"}`}
                </p>
                {record.status === "legacy" &&
                  record.validity_mode === "until_age" &&
                  !record.review_due_on && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      Imported age-based validity retained. Staff should confirm
                      the declaration and next review date.
                    </p>
                  )}
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
                    <button type="button" onClick={() => start(record, true)}>
                      Renew / add replacement
                    </button>
                  )}
                  {canEdit &&
                    (staff ||
                      ["pending", "withdrawn"].includes(record.status)) && (
                      <button type="button" onClick={() => start(record)}>
                        Edit / review
                      </button>
                    )}
                </div>
              </article>
            );
          })}
          <div className="flex gap-4 text-sm">
            <button
              type="button"
              onClick={() => setHistory(!history)}
              className="text-blue-700 dark:text-blue-300"
            >
              {history ? "Hide" : "Show"} expired / superseded / withdrawn
              records
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
              {audit ? "Hide" : "View"} history
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
        </>
      )}
      {draft && (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
          <div className="flex justify-between">
            <h4 className="font-semibold">
              {draft.id ? "Review medical" : "Add medical / declaration"}
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
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              Issue / declaration date
              <input
                type="date"
                className={inputClass}
                value={draft.issued_on || ""}
                onChange={(e) => set("issued_on", e.target.value || null)}
              />
            </label>
            <label className="text-sm">
              Certificate expiry
              <input
                type="date"
                className={inputClass}
                value={draft.expires_on || ""}
                onChange={(e) => set("expires_on", e.target.value || null)}
              />
            </label>
            <label className="text-sm">
              Next declaration / review due
              <input
                type="date"
                className={inputClass}
                value={draft.review_due_on || ""}
                onChange={(e) => set("review_due_on", e.target.value || null)}
              />
            </label>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Existing uploaded medical documents remain available above. Use
            dates on the evidence. Declarations need a review date; an age
            threshold does not replace periodic review. Upload one document for
            each record, or retain the existing attachment when renewing.
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
            Supporting document
            <input
              type="file"
              className={inputClass}
              onChange={(e) => setProof(e.target.files?.[0] || null)}
            />
          </label>
          <label className="block text-sm">
            Operating restrictions / review note
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
              <option value="pending">Pending verification</option>
              {staff && (
                <>
                  <option value="verified">Verified</option>
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
            Saving new evidence does not remove an existing medical. Pending
            records do not grant medical clearance.
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
