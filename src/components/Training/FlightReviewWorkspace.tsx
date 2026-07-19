import React, { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileUp,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import toast from "react-hot-toast";
import { useAuth } from "../../context/AuthContext";
import {
  type FlightReviewAttachmentCategory,
  type FlightReviewRecord,
  type FlightReviewRecordItem,
  type FlightReviewStatus,
  type FlightReviewTemplate,
  useFlightReviews,
} from "../../hooks/useFlightReviews";
import type { CoursePurpose, FlightReviewConfiguration } from "../../types";
import { hasAnyRole } from "../../utils/rbac";

type TemplateStep = "basic" | "rules" | "checklist" | "publish";

const today = () => new Date().toISOString().slice(0, 10);

const blankConfiguration = (): FlightReviewConfiguration => ({
  review_type: "custom_review",
  authority: "club",
  outcome_scheme: "completion",
  minimum_ground_minutes: 0,
  minimum_flight_minutes: 0,
  validity_months: 0,
  resets_flight_review: false,
  candidate_ack_required: true,
  allowed_reviewer_roles: ["instructor", "senior_instructor", "cfi"],
  required_evidence: [],
  source_documents: [],
  checklist: [],
});

const blankTemplate = (): Omit<FlightReviewTemplate, "id" | "lastUpdated"> & {
  id?: string;
} => ({
  title: "",
  description: "",
  category: "Flight Reviews",
  version: "1.0",
  status: "draft",
  tags: [],
  coursePurpose: "flight_review",
  configuration: blankConfiguration(),
});

const purposeLabel: Record<
  Exclude<CoursePurpose, "training" | "instructor_compliance">,
  string
> = {
  flight_review: "Flight review",
  flight_test: "Flight test",
  proficiency_check: "Proficiency check",
};

const statusLabel: Record<FlightReviewStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  further_training_required: "Further training required",
  completed: "Completed",
  cancelled: "Cancelled",
};

const statusClass: Record<FlightReviewStatus, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-100",
  in_progress:
    "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200",
  further_training_required:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  completed:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200",
};

const evidenceLabels: Record<FlightReviewAttachmentCategory, string> = {
  logbook_entry: "Logbook entry",
  authority_form: "Authority form",
  external_test_report: "External test report",
  certificate: "Certificate",
  other: "Other evidence",
};

const roleLabels: Record<string, string> = {
  admin: "Admin",
  instructor: "Instructor",
  senior_instructor: "Senior Instructor",
  cfi: "CFI",
  pilot_examiner: "Pilot Examiner",
  flight_examiner: "Flight Examiner",
};

const inputClass =
  "mt-1 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-[#39414d] dark:bg-[#11141a] dark:text-gray-100 dark:focus:ring-blue-500/25";
const panelClass =
  "rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[#2c3440] dark:bg-[#171a21]";

interface FlightReviewRecordEditorProps {
  record: FlightReviewRecord;
  items: FlightReviewRecordItem[];
  attachments: ReturnType<typeof useFlightReviews>["attachments"];
  candidateName: string;
  reviewerName: string;
  currentUserId: string;
  onClose: () => void;
  onUpdateRecord: ReturnType<typeof useFlightReviews>["updateReview"];
  onUpdateItem: ReturnType<typeof useFlightReviews>["updateItem"];
  onUploadAttachment: ReturnType<typeof useFlightReviews>["uploadAttachment"];
  onCreateAttachmentUrl: ReturnType<
    typeof useFlightReviews
  >["createAttachmentUrl"];
}

export const FlightReviewRecordEditor: React.FC<
  FlightReviewRecordEditorProps
> = ({
  record,
  items,
  attachments,
  candidateName,
  reviewerName,
  currentUserId,
  onClose,
  onUpdateRecord,
  onUpdateItem,
  onUploadAttachment,
  onCreateAttachmentUrl,
}) => {
  const config =
    record.templateSnapshot.review_configuration || blankConfiguration();
  const [form, setForm] = useState({
    status: record.status,
    reviewDate: record.reviewDate,
    completionDate: record.completionDate || today(),
    groundMinutes: String(record.groundMinutes),
    flightMinutes: String(record.flightMinutes),
    aircraftType: record.aircraftType,
    registration: record.registration,
    aircraftGroup: record.aircraftGroup || "",
    candidateObjectives: record.candidateObjectives,
    applicantMembershipNumber:
      record.assessmentDetails.applicantMembershipNumber || "",
    applicantMembershipExpiry:
      record.assessmentDetails.applicantMembershipExpiry || "",
    totalFlightHours:
      record.assessmentDetails.totalFlightHours?.toString() || "",
    dualFlightHours: record.assessmentDetails.dualFlightHours?.toString() || "",
    commandFlightHours:
      record.assessmentDetails.commandFlightHours?.toString() || "",
    raausFlightHours:
      record.assessmentDetails.raausFlightHours?.toString() || "",
    certificateGroup: record.assessmentDetails.certificateGroup || "",
    endorsementsSought: record.assessmentDetails.endorsementsSought || "",
    emergencyPlanConfirmed: record.emergencyPlanConfirmed,
    reviewerSummary: record.reviewerSummary,
    remedialPlan: record.remedialPlan,
    minimumsOverrideReason: record.minimumsOverrideReason,
    logbookEntryConfirmed: record.logbookEntryConfirmed,
    authoritySubmissionConfirmed: record.authoritySubmissionConfirmed,
    reviewerSignName: record.reviewerSignName || reviewerName,
  });
  const [expandedSection, setExpandedSection] = useState<string | null>(
    items[0]?.section || null,
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachmentCategory, setAttachmentCategory] =
    useState<FlightReviewAttachmentCategory>(
      config.required_evidence[0] || "other",
    );
  const groupedItems = useMemo(() => {
    const groups = new Map<string, FlightReviewRecordItem[]>();
    items.forEach((item) =>
      groups.set(item.section, [...(groups.get(item.section) || []), item]),
    );
    return Array.from(groups.entries());
  }, [items]);
  const requiredItems = items.filter((item) => item.required);
  const satisfactoryRequired = requiredItems.filter(
    (item) => item.result === "satisfactory",
  ).length;
  const completionReady = satisfactoryRequired === requiredItems.length;
  const belowMinimum =
    Number(form.groundMinutes || 0) < config.minimum_ground_minutes ||
    Number(form.flightMinutes || 0) < config.minimum_flight_minutes;
  const requiresLogbookConfirmation =
    record.reviewType === "raaus_bfr" ||
    config.requires_logbook_confirmation === true;
  const requiresAuthorityConfirmation =
    record.reviewType === "raaus_bfr" ||
    config.requires_authority_submission_confirmation === true;
  const isPassFail = config.outcome_scheme === "pass_fail";
  const isRpcFlightTest = record.reviewType === "raaus_rpc_flight_test";
  const rpcDetailsComplete =
    !isRpcFlightTest ||
    (Boolean(form.applicantMembershipNumber.trim()) &&
      Boolean(form.applicantMembershipExpiry) &&
      Boolean(form.totalFlightHours) &&
      Boolean(form.dualFlightHours) &&
      Boolean(form.commandFlightHours) &&
      Boolean(form.raausFlightHours) &&
      Boolean(form.certificateGroup.trim()) &&
      Boolean(form.endorsementsSought.trim()));

  const save = async (statusOverride?: FlightReviewStatus) => {
    const nextStatus = statusOverride || form.status;
    if (nextStatus === "completed" && !completionReady) {
      toast.error(
        "Complete every required checklist item before finishing this review",
      );
      return;
    }
    if (nextStatus === "completed" && !rpcDetailsComplete) {
      toast.error("Complete the RPC001 applicant and aeronautical experience details");
      return;
    }
    if (
      nextStatus === "completed" &&
      config.requires_reviewer_summary &&
      !form.reviewerSummary.trim()
    ) {
      toast.error("Record the examiner's overall notes before completing the form");
      return;
    }
    if (
      nextStatus === "completed" &&
      ((requiresLogbookConfirmation && !form.logbookEntryConfirmed) ||
        (requiresAuthorityConfirmation && !form.authoritySubmissionConfirmed))
    ) {
      toast.error("Confirm the required logbook and authority actions first");
      return;
    }
    if (
      nextStatus === "completed" &&
      belowMinimum &&
      !form.minimumsOverrideReason.trim()
    ) {
      toast.error(
        "Record why the review was completed below the template duration",
      );
      return;
    }
    setSaving(true);
    try {
      await onUpdateRecord(record.id, {
        status: nextStatus,
        reviewDate: form.reviewDate,
        completionDate:
          nextStatus === "completed" ? form.completionDate : undefined,
        groundMinutes: Math.max(0, Number(form.groundMinutes || 0)),
        flightMinutes: Math.max(0, Number(form.flightMinutes || 0)),
        aircraftType: form.aircraftType.trim(),
        registration: form.registration.trim(),
        aircraftGroup: form.aircraftGroup.trim(),
        candidateObjectives: form.candidateObjectives.trim(),
        assessmentDetails: {
          applicantMembershipNumber: form.applicantMembershipNumber.trim(),
          applicantMembershipExpiry: form.applicantMembershipExpiry,
          totalFlightHours: Number(form.totalFlightHours || 0),
          dualFlightHours: Number(form.dualFlightHours || 0),
          commandFlightHours: Number(form.commandFlightHours || 0),
          raausFlightHours: Number(form.raausFlightHours || 0),
          certificateGroup: form.certificateGroup.trim(),
          endorsementsSought: form.endorsementsSought.trim(),
        },
        emergencyPlanConfirmed: form.emergencyPlanConfirmed,
        reviewerSummary: form.reviewerSummary.trim(),
        remedialPlan: form.remedialPlan.trim(),
        minimumsOverrideReason: form.minimumsOverrideReason.trim(),
        logbookEntryConfirmed: form.logbookEntryConfirmed,
        authoritySubmissionConfirmed: form.authoritySubmissionConfirmed,
        reviewerSignName:
          nextStatus === "completed"
            ? form.reviewerSignName.trim()
            : record.reviewerSignName,
        reviewerSignAt:
          nextStatus === "completed"
            ? new Date().toISOString()
            : record.reviewerSignAt,
        updatedBy: currentUserId,
      });
      setForm((current) => ({ ...current, status: nextStatus }));
      toast.success(
        nextStatus === "completed"
          ? isPassFail
            ? "Assessment passed and recorded"
            : "Review completed and currency updated"
          : "Review saved",
      );
    } catch (saveError) {
      console.error("Failed to save review:", saveError);
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save review",
      );
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      await onUploadAttachment(record, file, attachmentCategory);
      toast.success("Evidence attached");
    } catch (uploadError) {
      console.error("Failed to upload review evidence:", uploadError);
      toast.error(
        uploadError instanceof Error
          ? uploadError.message
          : "Failed to upload evidence",
      );
    } finally {
      setUploading(false);
    }
  };

  const openAttachment = async (path: string) => {
    try {
      const url = await onCreateAttachmentUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Failed to open protected evidence");
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:p-6">
      <div className="my-auto w-full max-w-6xl overflow-hidden rounded-xl bg-gray-50 shadow-2xl dark:bg-[#0f1218]">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 px-4 py-4 text-white sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase text-blue-200">
              {record.templateSnapshot.title || record.reviewType}
            </p>
            <h2 className="mt-1 text-xl font-bold">{candidateName}</h2>
            <p className="mt-1 text-sm text-blue-100">
              {format(parseISO(record.reviewDate), "d MMM yyyy")} |{" "}
              {reviewerName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-blue-100 hover:bg-white/10"
            title="Close review"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <section className={`${panelClass} p-4 sm:p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-gray-950 dark:text-gray-100">
                    Review details
                  </h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Save this record across as many sessions as needed.
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass[form.status]}`}
                >
                  {statusLabel[form.status]}
                </span>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Review date
                  <input
                    type="date"
                    value={form.reviewDate}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        reviewDate: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Ground minutes
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={form.groundMinutes}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        groundMinutes: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Flight minutes
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={form.flightMinutes}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        flightMinutes: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Aircraft type
                  <input
                    value={form.aircraftType}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        aircraftType: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Registration
                  <input
                    value={form.registration}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        registration: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Aircraft group
                  <input
                    value={form.aircraftGroup}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        aircraftGroup: event.target.value,
                      }))
                    }
                    placeholder="e.g. Group A"
                    className={inputClass}
                  />
                </label>
              </div>
              <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-200">
                Candidate objectives
                <textarea
                  rows={3}
                  value={form.candidateObjectives}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      candidateObjectives: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
              </label>
              {isRpcFlightTest && (
                <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-500/25 dark:bg-blue-500/10">
                  <div>
                    <h4 className="font-bold text-blue-950 dark:text-blue-100">
                      RPC001 applicant and experience details
                    </h4>
                    <p className="mt-1 text-xs leading-5 text-blue-800 dark:text-blue-200">
                      Record the details used by the examiner to confirm eligibility for initial RPC issue.
                    </p>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      RAAus member number
                      <input
                        value={form.applicantMembershipNumber}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            applicantMembershipNumber: event.target.value,
                          }))
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      RAAus membership expiry
                      <input
                        type="date"
                        value={form.applicantMembershipExpiry}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            applicantMembershipExpiry: event.target.value,
                          }))
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      Certificate aircraft group
                      <input
                        value={form.certificateGroup}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            certificateGroup: event.target.value,
                          }))
                        }
                        placeholder="e.g. Group A"
                        className={inputClass}
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      Endorsements to issue
                      <input
                        value={form.endorsementsSought}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            endorsementsSought: event.target.value,
                          }))
                        }
                        placeholder="e.g. HF, Radio"
                        className={inputClass}
                      />
                    </label>
                    {[
                      ["totalFlightHours", "Total flight hours"],
                      ["dualFlightHours", "Dual hours"],
                      ["commandFlightHours", "Command hours"],
                      ["raausFlightHours", "RAAus aircraft hours"],
                    ].map(([field, label]) => (
                      <label
                        key={field}
                        className="text-sm font-medium text-gray-700 dark:text-gray-200"
                      >
                        {label}
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={form[field as keyof typeof form] as string}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              [field]: event.target.value,
                            }))
                          }
                          className={inputClass}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <label className="mt-3 flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm text-gray-700 dark:border-[#343b46] dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={form.emergencyPlanConfirmed}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      emergencyPlanConfirmed: event.target.checked,
                    }))
                  }
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <strong>Emergency control plan agreed.</strong>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                    Confirm who takes control and the handover process before
                    flight.
                  </span>
                </span>
              </label>
            </section>

            <section className={`${panelClass} overflow-hidden`}>
              <div className="border-b border-gray-200 p-4 sm:p-5 dark:border-[#2c3440]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-gray-950 dark:text-gray-100">
                      Assessment checklist
                    </h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {satisfactoryRequired}/{requiredItems.length} required
                      items satisfactory
                    </p>
                  </div>
                  <div className="h-2 w-36 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className="h-full bg-emerald-500"
                      style={{
                        width: `${requiredItems.length ? (satisfactoryRequired / requiredItems.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-[#2c3440]">
                {groupedItems.map(([section, sectionItems]) => {
                  const expanded = expandedSection === section;
                  const sectionDone = sectionItems.filter(
                    (item) => item.required && item.result === "satisfactory",
                  ).length;
                  const sectionRequired = sectionItems.filter(
                    (item) => item.required,
                  ).length;
                  return (
                    <div key={section}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSection(expanded ? null : section)
                        }
                        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-gray-50 dark:hover:bg-[#11141a] sm:px-5"
                      >
                        <span>
                          <span className="block font-bold text-gray-950 dark:text-gray-100">
                            {section}
                          </span>
                          <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                            {sectionDone}/{sectionRequired} required complete
                          </span>
                        </span>
                        {expanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      {expanded && (
                        <div className="space-y-3 bg-gray-50 p-4 dark:bg-[#11141a] sm:p-5">
                          {sectionItems.map((item) => (
                            <article
                              key={item.id}
                              className="rounded-lg border border-gray-200 bg-white p-4 dark:border-[#343b46] dark:bg-[#171a21]"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                                    {item.code}
                                    {item.required
                                      ? " | Required"
                                      : " | Optional"}
                                  </p>
                                  <h4 className="mt-1 font-semibold text-gray-950 dark:text-gray-100">
                                    {item.title}
                                  </h4>
                                  {item.guidance && (
                                    <p className="mt-1 text-sm leading-5 text-gray-500 dark:text-gray-400">
                                      {item.guidance}
                                    </p>
                                  )}
                                </div>
                                <select
                                  value={item.result}
                                  onChange={async (event) => {
                                    try {
                                      await onUpdateItem(item.id, {
                                        result: event.target
                                          .value as FlightReviewRecordItem["result"],
                                      });
                                    } catch (itemError) {
                                      toast.error(
                                        itemError instanceof Error
                                          ? itemError.message
                                          : "Failed to save assessment",
                                      );
                                    }
                                  }}
                                  className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-[#39414d] dark:bg-[#11141a] dark:text-gray-100"
                                >
                                  <option value="not_assessed">
                                    Not assessed
                                  </option>
                                  <option value="satisfactory">
                                    Satisfactory
                                  </option>
                                  <option value="further_training">
                                    Further training
                                  </option>
                                  {!item.required && (
                                    <option value="not_applicable">
                                      Not applicable
                                    </option>
                                  )}
                                </select>
                              </div>
                              <textarea
                                defaultValue={item.notes}
                                onBlur={async (event) => {
                                  if (event.target.value === item.notes) return;
                                  try {
                                    await onUpdateItem(item.id, {
                                      notes: event.target.value,
                                    });
                                  } catch {
                                    toast.error(
                                      "Failed to save checklist notes",
                                    );
                                  }
                                }}
                                rows={2}
                                placeholder="Evidence, observations or remedial action for this item"
                                className={`${inputClass} mt-3`}
                              />
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={`${panelClass} p-4 sm:p-5`}>
              <h3 className="font-bold text-gray-950 dark:text-gray-100">
                Debrief and outcome
              </h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  {config.reviewer_summary_label || "Reviewer summary"}
                  <textarea
                    rows={5}
                    value={form.reviewerSummary}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        reviewerSummary: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  {config.remedial_plan_label ||
                    "Further training or development plan"}
                  <textarea
                    rows={5}
                    value={form.remedialPlan}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        remedialPlan: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
              </div>
              {belowMinimum && (
                <label className="mt-4 block rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  Duration is below the template minimum (
                  {config.minimum_ground_minutes} ground /{" "}
                  {config.minimum_flight_minutes} flight minutes).
                  <textarea
                    rows={2}
                    value={form.minimumsOverrideReason}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        minimumsOverrideReason: event.target.value,
                      }))
                    }
                    placeholder="Explain why completion below the template minimum is appropriate"
                    className={inputClass}
                  />
                </label>
              )}
              {(requiresLogbookConfirmation ||
                requiresAuthorityConfirmation) && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {requiresLogbookConfirmation && (
                    <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm font-semibold text-gray-800 dark:border-[#343b46] dark:text-gray-100">
                      <input
                        type="checkbox"
                        checked={form.logbookEntryConfirmed}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            logbookEntryConfirmed: event.target.checked,
                          }))
                        }
                        className="h-4 w-4"
                      />
                      Candidate logbook entry completed
                    </label>
                  )}
                  {requiresAuthorityConfirmation && (
                    <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm font-semibold text-gray-800 dark:border-[#343b46] dark:text-gray-100">
                      <input
                        type="checkbox"
                        checked={form.authoritySubmissionConfirmed}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            authoritySubmissionConfirmed: event.target.checked,
                          }))
                        }
                        className="h-4 w-4"
                      />
                      RAAus form completed and submitted
                    </label>
                  )}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <section className={`${panelClass} p-4`}>
              <h3 className="font-bold text-gray-950 dark:text-gray-100">
                Evidence
              </h3>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                Files are private to the candidate and authorised staff.
              </p>
              {config.required_evidence.length > 0 && (
                <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Required:{" "}
                  {config.required_evidence
                    .map((item) => evidenceLabels[item])
                    .join(", ")}
                </p>
              )}
              <select
                value={attachmentCategory}
                onChange={(event) =>
                  setAttachmentCategory(
                    event.target.value as FlightReviewAttachmentCategory,
                  )
                }
                className={inputClass}
              >
                {Object.entries(evidenceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}{" "}
                Upload evidence
                <input
                  type="file"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              <div className="mt-3 space-y-2">
                {attachments.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No evidence attached.
                  </p>
                ) : (
                  attachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      onClick={() => void openAttachment(attachment.filePath)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-[#343b46] dark:hover:bg-[#11141a]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-gray-900 dark:text-gray-100">
                          {attachment.fileName}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {evidenceLabels[attachment.category]}
                        </span>
                      </span>
                      <ExternalLink className="h-4 w-4 shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className={`${panelClass} p-4`}>
              <h3 className="font-bold text-gray-950 dark:text-gray-100">
                Save or complete
              </h3>
              <select
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as FlightReviewStatus,
                  }))
                }
                className={inputClass}
              >
                <option value="draft">Draft</option>
                <option value="in_progress">In progress</option>
                <option value="further_training_required">
                  Further training required
                </option>
                <option value="cancelled">Cancelled</option>
              </select>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-[#39414d] dark:bg-[#11141a] dark:text-gray-100"
              >
                <Save className="h-4 w-4" />
                Save progress
              </button>
              <div className="my-4 border-t border-gray-200 dark:border-[#343b46]" />
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Completion date
                <input
                  type="date"
                  value={form.completionDate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      completionDate: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
              </label>
              <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-200">
                Reviewer signature name
                <input
                  value={form.reviewerSignName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      reviewerSignName: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
              </label>
              <button
                type="button"
                onClick={() => void save("completed")}
                disabled={saving || !completionReady}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {config.completion_button_label ||
                  (isPassFail ? "Pass assessment" : "Complete review")}
              </button>
              {!completionReady && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Every required item must be satisfactory first.
                </p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export const FlightReviewWorkspace: React.FC = () => {
  const { user } = useAuth();
  const reviewData = useFlightReviews({ includeRecords: false });
  const [search, setSearch] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<ReturnType<
    typeof blankTemplate
  > | null>(null);
  const [templateStep, setTemplateStep] = useState<TemplateStep>("basic");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const canManage = hasAnyRole(user, [
    "admin",
    "instructor",
    "senior_instructor",
    "cfi",
  ]);

  const filteredTemplates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return reviewData.templates.filter(
      (template) =>
        !term ||
        [
          template.title,
          template.description,
          template.category,
          ...template.tags,
        ]
          .join(" ")
          .toLowerCase()
          .includes(term),
    );
  }, [reviewData.templates, search]);

  const openTemplate = (template?: FlightReviewTemplate) => {
    setEditingTemplate(
      template
        ? {
            ...template,
            configuration: {
              ...template.configuration,
              checklist: template.configuration.checklist.map((item) => ({
                ...item,
              })),
            },
          }
        : blankTemplate(),
    );
    setTemplateStep("basic");
  };

  const saveTemplate = async () => {
    if (!editingTemplate) return;
    if (!editingTemplate.title.trim()) {
      toast.error("Template name is required");
      return;
    }
    if (!editingTemplate.configuration.review_type.trim()) {
      toast.error("Review type code is required");
      return;
    }
    if (editingTemplate.configuration.checklist.length === 0) {
      toast.error("Add at least one checklist item");
      return;
    }
    setSavingTemplate(true);
    try {
      await reviewData.saveTemplate(editingTemplate);
      toast.success("Review template saved");
      setEditingTemplate(null);
    } catch (templateError) {
      console.error("Failed to save review template:", templateError);
      toast.error(
        templateError instanceof Error
          ? templateError.message
          : "Failed to save template",
      );
    } finally {
      setSavingTemplate(false);
    }
  };

  if (reviewData.loading)
    return (
      <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        Loading flight reviews and tests...
      </div>
    );

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-[#2c3440] dark:bg-[#171a21]">
        <header className="bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 px-5 py-6 text-white sm:px-6">
          <div>
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase text-blue-200">
                <ShieldCheck className="h-4 w-4" />
                Form template library
              </div>
              <h1 className="mt-2 text-2xl font-bold">
                Flight Reviews &amp; Tests
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100">
                Build the forms reviewers complete for flight reviews, tests and
                proficiency checks. Submitted records are kept in each member's
                Pilot File, not in this template library.
              </p>
            </div>
          </div>
        </header>
        <div className="border-b border-gray-200 bg-gray-50 p-4 dark:border-[#2c3440] dark:bg-[#11141a]">
          <label className="flex min-h-11 w-full items-center rounded-lg border border-gray-300 bg-white px-3 dark:border-[#39414d] dark:bg-[#171a21] sm:max-w-sm">
            <Search className="mr-2 h-4 w-4 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search form templates"
              className="w-full border-none bg-transparent text-sm text-gray-900 outline-none dark:text-gray-100"
            />
          </label>
        </div>
      </section>

      {reviewData.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {reviewData.error}
        </div>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">
              Review and test templates
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Changing a template never rewrites records already started from an
              earlier version.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => openTemplate()}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200"
            >
              <Plus className="h-4 w-4" />
              New template
            </button>
          )}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {filteredTemplates.map((template) => (
            <article
              key={template.id}
              className={`${panelClass} overflow-hidden`}
            >
              <div className="border-l-4 border-blue-600 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800 dark:bg-blue-500/15 dark:text-blue-200">
                      {
                        purposeLabel[
                          template.coursePurpose as keyof typeof purposeLabel
                        ]
                      }
                    </span>
                    <h3 className="mt-3 text-lg font-bold text-gray-950 dark:text-gray-100">
                      {template.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                      {template.description}
                    </p>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => openTemplate(template)}
                      title="Edit template"
                      className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 dark:border-[#39414d] dark:text-gray-300 dark:hover:bg-[#11141a]"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                  <span className="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                    v{template.version}
                  </span>
                  <span className="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                    {template.configuration.checklist.length} items
                  </span>
                  <span className="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                    {template.configuration.authority.toUpperCase()}
                  </span>
                  {template.configuration.resets_flight_review && (
                    <span className="rounded-md bg-emerald-100 px-2 py-1 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
                      Resets flight review
                    </span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {editingTemplate && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:p-6">
          <div className="my-auto w-full max-w-5xl overflow-hidden rounded-xl bg-gray-50 shadow-2xl dark:bg-[#0f1218]">
            <header className="flex items-start justify-between gap-4 bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 px-4 py-5 text-white sm:px-6">
              <div>
                <p className="text-xs font-bold uppercase text-blue-200">
                  Template editor
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  {editingTemplate.id
                    ? `Edit ${editingTemplate.title}`
                    : "New review or test template"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingTemplate(null)}
                className="rounded-lg p-2 hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="grid grid-cols-2 gap-2 border-b border-gray-200 bg-white p-3 dark:border-[#2c3440] dark:bg-[#171a21] sm:grid-cols-4">
              {(
                [
                  { id: "basic", label: "1. Basics" },
                  { id: "rules", label: "2. Rules" },
                  { id: "checklist", label: "3. Checklist" },
                  { id: "publish", label: "4. Review" },
                ] as Array<{ id: TemplateStep; label: string }>
              ).map((step) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setTemplateStep(step.id)}
                  className={`rounded-lg px-3 py-2 text-sm font-bold ${templateStep === step.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 dark:bg-[#232832] dark:text-gray-300"}`}
                >
                  {step.label}
                </button>
              ))}
            </div>
            <div className="max-h-[72vh] overflow-y-auto p-4 sm:p-6">
              {templateStep === "basic" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Template name
                    <input
                      value={editingTemplate.title}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              title: event.target.value,
                            },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Category
                    <input
                      value={editingTemplate.category}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              category: event.target.value,
                            },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Version
                    <input
                      value={editingTemplate.version}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              version: event.target.value,
                            },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Template type
                    <select
                      value={editingTemplate.coursePurpose}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              coursePurpose: event.target
                                .value as FlightReviewTemplate["coursePurpose"],
                            },
                        )
                      }
                      className={inputClass}
                    >
                      <option value="flight_review">Flight review</option>
                      <option value="flight_test">Flight test</option>
                      <option value="proficiency_check">
                        Proficiency check
                      </option>
                    </select>
                  </label>
                  <label className="sm:col-span-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                    Description
                    <textarea
                      rows={5}
                      value={editingTemplate.description}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              description: event.target.value,
                            },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="sm:col-span-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                    Tags
                    <input
                      value={editingTemplate.tags.join(", ")}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              tags: event.target.value
                                .split(",")
                                .map((item) => item.trim())
                                .filter(Boolean),
                            },
                        )
                      }
                      placeholder="RAAus, BFR, currency"
                      className={inputClass}
                    />
                  </label>
                </div>
              )}
              {templateStep === "rules" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Internal review type code
                    <input
                      value={editingTemplate.configuration.review_type}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              configuration: {
                                ...current.configuration,
                                review_type: event.target.value
                                  .replace(/[^a-z0-9_]/gi, "_")
                                  .toLowerCase(),
                              },
                            },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Authority
                    <select
                      value={editingTemplate.configuration.authority}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              configuration: {
                                ...current.configuration,
                                authority: event.target
                                  .value as FlightReviewConfiguration["authority"],
                              },
                            },
                        )
                      }
                      className={inputClass}
                    >
                      <option value="raaus">RAAus</option>
                      <option value="casa">CASA</option>
                      <option value="club">Club</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Minimum ground minutes
                    <input
                      type="number"
                      min="0"
                      value={
                        editingTemplate.configuration.minimum_ground_minutes
                      }
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              configuration: {
                                ...current.configuration,
                                minimum_ground_minutes: Number(
                                  event.target.value || 0,
                                ),
                              },
                            },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Minimum flight minutes
                    <input
                      type="number"
                      min="0"
                      value={
                        editingTemplate.configuration.minimum_flight_minutes
                      }
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              configuration: {
                                ...current.configuration,
                                minimum_flight_minutes: Number(
                                  event.target.value || 0,
                                ),
                              },
                            },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Validity after completion (months)
                    <input
                      type="number"
                      min="0"
                      value={editingTemplate.configuration.validity_months}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              configuration: {
                                ...current.configuration,
                                validity_months: Number(
                                  event.target.value || 0,
                                ),
                              },
                            },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    Outcome wording
                    <select
                      value={editingTemplate.configuration.outcome_scheme}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              configuration: {
                                ...current.configuration,
                                outcome_scheme: event.target
                                  .value as FlightReviewConfiguration["outcome_scheme"],
                              },
                            },
                        )
                      }
                      className={inputClass}
                    >
                      <option value="completion">
                        Completed / further training
                      </option>
                      <option value="pass_fail">Pass / fail</option>
                    </select>
                  </label>
                  <div className="sm:col-span-2 grid gap-3 md:grid-cols-2">
                    <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-[#343b46]">
                      <input
                        type="checkbox"
                        checked={
                          editingTemplate.configuration.resets_flight_review
                        }
                        onChange={(event) =>
                          setEditingTemplate(
                            (current) =>
                              current && {
                                ...current,
                                configuration: {
                                  ...current.configuration,
                                  resets_flight_review: event.target.checked,
                                },
                              },
                          )
                        }
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <strong className="text-gray-900 dark:text-gray-100">
                          Reset pilot flight-review currency
                        </strong>
                        <span className="mt-1 block text-xs text-gray-500">
                          Only enable where the authority recognises this
                          completion.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-[#343b46]">
                      <input
                        type="checkbox"
                        checked={
                          editingTemplate.configuration.candidate_ack_required
                        }
                        onChange={(event) =>
                          setEditingTemplate(
                            (current) =>
                              current && {
                                ...current,
                                configuration: {
                                  ...current.configuration,
                                  candidate_ack_required: event.target.checked,
                                },
                              },
                          )
                        }
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <strong className="text-gray-900 dark:text-gray-100">
                          Require candidate acknowledgement
                        </strong>
                        <span className="mt-1 block text-xs text-gray-500">
                          The candidate confirms they have read the outcome.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-[#343b46]">
                      <input
                        type="checkbox"
                        checked={
                          editingTemplate.configuration
                            .requires_reviewer_summary === true
                        }
                        onChange={(event) =>
                          setEditingTemplate(
                            (current) =>
                              current && {
                                ...current,
                                configuration: {
                                  ...current.configuration,
                                  requires_reviewer_summary:
                                    event.target.checked,
                                },
                              },
                          )
                        }
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <strong className="text-gray-900 dark:text-gray-100">
                          Require reviewer or examiner notes
                        </strong>
                        <span className="mt-1 block text-xs text-gray-500">
                          Completion is blocked until an overall assessment is
                          recorded.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-[#343b46]">
                      <input
                        type="checkbox"
                        checked={
                          editingTemplate.configuration
                            .requires_logbook_confirmation === true
                        }
                        onChange={(event) =>
                          setEditingTemplate(
                            (current) =>
                              current && {
                                ...current,
                                configuration: {
                                  ...current.configuration,
                                  requires_logbook_confirmation:
                                    event.target.checked,
                                },
                              },
                          )
                        }
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <strong className="text-gray-900 dark:text-gray-100">
                          Require logbook confirmation
                        </strong>
                        <span className="mt-1 block text-xs text-gray-500">
                          The reviewer confirms the candidate logbook entry.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-[#343b46]">
                      <input
                        type="checkbox"
                        checked={
                          editingTemplate.configuration
                            .requires_authority_submission_confirmation ===
                          true
                        }
                        onChange={(event) =>
                          setEditingTemplate(
                            (current) =>
                              current && {
                                ...current,
                                configuration: {
                                  ...current.configuration,
                                  requires_authority_submission_confirmation:
                                    event.target.checked,
                                },
                              },
                          )
                        }
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <strong className="text-gray-900 dark:text-gray-100">
                          Require authority submission confirmation
                        </strong>
                        <span className="mt-1 block text-xs text-gray-500">
                          Use when a RAAus or CASA form must be submitted.
                        </span>
                      </span>
                    </label>
                  </div>
                  <div className="sm:col-span-2 grid gap-4 md:grid-cols-3">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      Completion button wording
                      <input
                        value={
                          editingTemplate.configuration
                            .completion_button_label || ""
                        }
                        onChange={(event) =>
                          setEditingTemplate(
                            (current) =>
                              current && {
                                ...current,
                                configuration: {
                                  ...current.configuration,
                                  completion_button_label: event.target.value,
                                },
                              },
                          )
                        }
                        placeholder="Complete review"
                        className={inputClass}
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      Summary field wording
                      <input
                        value={
                          editingTemplate.configuration
                            .reviewer_summary_label || ""
                        }
                        onChange={(event) =>
                          setEditingTemplate(
                            (current) =>
                              current && {
                                ...current,
                                configuration: {
                                  ...current.configuration,
                                  reviewer_summary_label: event.target.value,
                                },
                              },
                          )
                        }
                        placeholder="Reviewer summary"
                        className={inputClass}
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      Remedial field wording
                      <input
                        value={
                          editingTemplate.configuration.remedial_plan_label ||
                          ""
                        }
                        onChange={(event) =>
                          setEditingTemplate(
                            (current) =>
                              current && {
                                ...current,
                                configuration: {
                                  ...current.configuration,
                                  remedial_plan_label: event.target.value,
                                },
                              },
                          )
                        }
                        placeholder="Further training plan"
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <fieldset className="sm:col-span-2">
                    <legend className="text-sm font-bold text-gray-900 dark:text-gray-100">
                      Who can conduct or verify this review?
                    </legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Object.entries(roleLabels).map(([role, label]) => (
                        <label
                          key={role}
                          className={`cursor-pointer rounded-full border px-3 py-2 text-sm font-semibold ${editingTemplate.configuration.allowed_reviewer_roles.includes(role) ? "border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200" : "border-gray-300 text-gray-600 dark:border-[#39414d] dark:text-gray-300"}`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={editingTemplate.configuration.allowed_reviewer_roles.includes(
                              role,
                            )}
                            onChange={() =>
                              setEditingTemplate(
                                (current) =>
                                  current && {
                                    ...current,
                                    configuration: {
                                      ...current.configuration,
                                      allowed_reviewer_roles:
                                        current.configuration.allowed_reviewer_roles.includes(
                                          role,
                                        )
                                          ? current.configuration.allowed_reviewer_roles.filter(
                                              (item) => item !== role,
                                            )
                                          : [
                                              ...current.configuration
                                                .allowed_reviewer_roles,
                                              role,
                                            ],
                                    },
                                  },
                              )
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="sm:col-span-2">
                    <legend className="text-sm font-bold text-gray-900 dark:text-gray-100">
                      Required evidence
                    </legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Object.entries(evidenceLabels).map(
                        ([category, label]) => (
                          <label
                            key={category}
                            className={`cursor-pointer rounded-full border px-3 py-2 text-sm font-semibold ${editingTemplate.configuration.required_evidence.includes(category as FlightReviewAttachmentCategory) ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : "border-gray-300 text-gray-600 dark:border-[#39414d] dark:text-gray-300"}`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={editingTemplate.configuration.required_evidence.includes(
                                category as FlightReviewAttachmentCategory,
                              )}
                              onChange={() =>
                                setEditingTemplate(
                                  (current) =>
                                    current && {
                                      ...current,
                                      configuration: {
                                        ...current.configuration,
                                        required_evidence:
                                          current.configuration.required_evidence.includes(
                                            category as FlightReviewAttachmentCategory,
                                          )
                                            ? current.configuration.required_evidence.filter(
                                                (item) => item !== category,
                                              )
                                            : [
                                                ...current.configuration
                                                  .required_evidence,
                                                category as FlightReviewAttachmentCategory,
                                              ],
                                      },
                                    },
                                )
                              }
                            />
                            {label}
                          </label>
                        ),
                      )}
                    </div>
                  </fieldset>
                  <label className="sm:col-span-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                    Source documents, one per line
                    <textarea
                      rows={3}
                      value={editingTemplate.configuration.source_documents.join(
                        "\n",
                      )}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              configuration: {
                                ...current.configuration,
                                source_documents: event.target.value
                                  .split("\n")
                                  .map((item) => item.trim())
                                  .filter(Boolean),
                              },
                            },
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                </div>
              )}
              {templateStep === "checklist" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-gray-950 dark:text-gray-100">
                        Assessment checklist
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Required items must be satisfactory before completion.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              configuration: {
                                ...current.configuration,
                                checklist: [
                                  ...current.configuration.checklist,
                                  {
                                    key: `ITEM-${Date.now()}`,
                                    section: "Assessment",
                                    code: `ITEM-${current.configuration.checklist.length + 1}`,
                                    title: "",
                                    guidance: "",
                                    required: true,
                                  },
                                ],
                              },
                            },
                        )
                      }
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white"
                    >
                      <Plus className="h-4 w-4" />
                      Add item
                    </button>
                  </div>
                  {editingTemplate.configuration.checklist.map(
                    (item, index) => (
                      <article key={item.key} className={`${panelClass} p-4`}>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="text-xs font-bold uppercase text-gray-500">
                            Section
                            <input
                              value={item.section}
                              onChange={(event) =>
                                setEditingTemplate(
                                  (current) =>
                                    current && {
                                      ...current,
                                      configuration: {
                                        ...current.configuration,
                                        checklist:
                                          current.configuration.checklist.map(
                                            (entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    section: event.target.value,
                                                  }
                                                : entry,
                                          ),
                                      },
                                    },
                                )
                              }
                              className={inputClass}
                            />
                          </label>
                          <label className="text-xs font-bold uppercase text-gray-500">
                            Code
                            <input
                              value={item.code}
                              onChange={(event) =>
                                setEditingTemplate(
                                  (current) =>
                                    current && {
                                      ...current,
                                      configuration: {
                                        ...current.configuration,
                                        checklist:
                                          current.configuration.checklist.map(
                                            (entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    code: event.target.value,
                                                  }
                                                : entry,
                                          ),
                                      },
                                    },
                                )
                              }
                              className={inputClass}
                            />
                          </label>
                          <label className="sm:col-span-2 text-xs font-bold uppercase text-gray-500">
                            Item title
                            <input
                              value={item.title}
                              onChange={(event) =>
                                setEditingTemplate(
                                  (current) =>
                                    current && {
                                      ...current,
                                      configuration: {
                                        ...current.configuration,
                                        checklist:
                                          current.configuration.checklist.map(
                                            (entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    title: event.target.value,
                                                  }
                                                : entry,
                                          ),
                                      },
                                    },
                                )
                              }
                              className={inputClass}
                            />
                          </label>
                          <label className="sm:col-span-2 text-xs font-bold uppercase text-gray-500">
                            Guidance
                            <textarea
                              rows={2}
                              value={item.guidance}
                              onChange={(event) =>
                                setEditingTemplate(
                                  (current) =>
                                    current && {
                                      ...current,
                                      configuration: {
                                        ...current.configuration,
                                        checklist:
                                          current.configuration.checklist.map(
                                            (entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    guidance:
                                                      event.target.value,
                                                  }
                                                : entry,
                                          ),
                                      },
                                    },
                                )
                              }
                              className={inputClass}
                            />
                          </label>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                            <input
                              type="checkbox"
                              checked={item.required}
                              onChange={(event) =>
                                setEditingTemplate(
                                  (current) =>
                                    current && {
                                      ...current,
                                      configuration: {
                                        ...current.configuration,
                                        checklist:
                                          current.configuration.checklist.map(
                                            (entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    required:
                                                      event.target.checked,
                                                  }
                                                : entry,
                                          ),
                                      },
                                    },
                                )
                              }
                              className="h-4 w-4"
                            />
                            Required for completion
                          </label>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() =>
                                setEditingTemplate((current) => {
                                  if (!current || index === 0) return current;
                                  const checklist = [
                                    ...current.configuration.checklist,
                                  ];
                                  [checklist[index - 1], checklist[index]] = [
                                    checklist[index],
                                    checklist[index - 1],
                                  ];
                                  return {
                                    ...current,
                                    configuration: {
                                      ...current.configuration,
                                      checklist,
                                    },
                                  };
                                })
                              }
                              className="rounded-lg border p-2 disabled:opacity-30"
                              title="Move up"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              disabled={
                                index ===
                                editingTemplate.configuration.checklist.length -
                                  1
                              }
                              onClick={() =>
                                setEditingTemplate((current) => {
                                  if (
                                    !current ||
                                    index ===
                                      current.configuration.checklist.length - 1
                                  )
                                    return current;
                                  const checklist = [
                                    ...current.configuration.checklist,
                                  ];
                                  [checklist[index + 1], checklist[index]] = [
                                    checklist[index],
                                    checklist[index + 1],
                                  ];
                                  return {
                                    ...current,
                                    configuration: {
                                      ...current.configuration,
                                      checklist,
                                    },
                                  };
                                })
                              }
                              className="rounded-lg border p-2 disabled:opacity-30"
                              title="Move down"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingTemplate(
                                  (current) =>
                                    current && {
                                      ...current,
                                      configuration: {
                                        ...current.configuration,
                                        checklist:
                                          current.configuration.checklist.filter(
                                            (_, entryIndex) =>
                                              entryIndex !== index,
                                          ),
                                      },
                                    },
                                )
                              }
                              className="rounded-lg border border-red-200 p-2 text-red-600"
                              title="Delete item"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </article>
                    ),
                  )}
                </div>
              )}
              {templateStep === "publish" && (
                <div className="space-y-4">
                  <div className={`${panelClass} p-5`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800">
                          {
                            purposeLabel[
                              editingTemplate.coursePurpose as keyof typeof purposeLabel
                            ]
                          }
                        </span>
                        <h3 className="mt-3 text-xl font-bold text-gray-950 dark:text-gray-100">
                          {editingTemplate.title || "Untitled template"}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
                          {editingTemplate.description || "No description yet."}
                        </p>
                      </div>
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                        v{editingTemplate.version}
                      </span>
                    </div>
                    <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="text-xs font-bold uppercase text-gray-500">
                          Authority
                        </dt>
                        <dd className="mt-1 font-semibold dark:text-gray-100">
                          {editingTemplate.configuration.authority.toUpperCase()}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase text-gray-500">
                          Minimum duration
                        </dt>
                        <dd className="mt-1 font-semibold dark:text-gray-100">
                          {editingTemplate.configuration.minimum_ground_minutes}
                          m ground /{" "}
                          {editingTemplate.configuration.minimum_flight_minutes}
                          m flight
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase text-gray-500">
                          Checklist
                        </dt>
                        <dd className="mt-1 font-semibold dark:text-gray-100">
                          {editingTemplate.configuration.checklist.length} items
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold uppercase text-gray-500">
                          Currency effect
                        </dt>
                        <dd className="mt-1 font-semibold dark:text-gray-100">
                          {editingTemplate.configuration.resets_flight_review
                            ? `${editingTemplate.configuration.validity_months} months`
                            : "None"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Template status
                    <select
                      value={editingTemplate.status}
                      onChange={(event) =>
                        setEditingTemplate(
                          (current) =>
                            current && {
                              ...current,
                              status: event.target
                                .value as FlightReviewTemplate["status"],
                            },
                        )
                      }
                      className={inputClass}
                    >
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                    </select>
                  </label>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
                    <strong>Version safety:</strong> records already started
                    keep their original checklist and rules. Publishing this
                    edit affects only future reviews.
                  </div>
                </div>
              )}
            </div>
            <footer className="flex flex-wrap justify-between gap-3 border-t border-gray-200 bg-white p-4 dark:border-[#2c3440] dark:bg-[#171a21]">
              <button
                type="button"
                onClick={() => setEditingTemplate(null)}
                className="min-h-10 rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold dark:border-[#39414d]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveTemplate()}
                disabled={savingTemplate}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {savingTemplate ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save template
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};
