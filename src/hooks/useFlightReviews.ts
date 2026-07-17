import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import type {
  CoursePurpose,
  FlightReviewConfiguration,
  ReviewChecklistTemplateItem,
} from "../types";

export type FlightReviewStatus =
  | "draft"
  | "in_progress"
  | "further_training_required"
  | "completed"
  | "cancelled";
export type FlightReviewItemResult =
  "not_assessed" | "satisfactory" | "further_training" | "not_applicable";
export type FlightReviewAttachmentCategory =
  | "logbook_entry"
  | "authority_form"
  | "external_test_report"
  | "certificate"
  | "other";

export interface FlightReviewAssessmentDetails {
  applicantMembershipNumber?: string;
  applicantMembershipExpiry?: string;
  totalFlightHours?: number;
  dualFlightHours?: number;
  commandFlightHours?: number;
  raausFlightHours?: number;
  certificateGroup?: string;
  endorsementsSought?: string;
}

export interface FlightReviewTemplate {
  id: string;
  title: string;
  description: string;
  category: string;
  version: string;
  status: "draft" | "published";
  tags: string[];
  coursePurpose: CoursePurpose;
  configuration: FlightReviewConfiguration;
  lastUpdated: string;
}

export interface FlightReviewRecord {
  id: string;
  templateCourseId?: string;
  templateSnapshot: {
    title?: string;
    version?: string;
    course_purpose?: CoursePurpose;
    review_configuration?: FlightReviewConfiguration;
  };
  sourceTrainingRecordId?: string;
  candidateId: string;
  reviewerUserId?: string;
  externalExaminerName?: string;
  externalExaminerIdentifier?: string;
  externalExaminerOrganisation?: string;
  bookingId?: string;
  flightLogId?: string;
  reviewType: string;
  authority: FlightReviewConfiguration["authority"];
  status: FlightReviewStatus;
  reviewDate: string;
  completionDate?: string;
  aircraftId?: string;
  aircraftType: string;
  registration: string;
  aircraftGroup?: string;
  previousReviewDate?: string;
  previousAircraftGroup?: string;
  groundMinutes: number;
  flightMinutes: number;
  candidateObjectives: string;
  assessmentDetails: FlightReviewAssessmentDetails;
  emergencyPlanConfirmed: boolean;
  reviewerSummary: string;
  remedialPlan: string;
  minimumsOverrideReason: string;
  logbookEntryConfirmed: boolean;
  authoritySubmissionConfirmed: boolean;
  candidateAck: boolean;
  candidateAckName?: string;
  candidateAckAt?: string;
  reviewerSignName?: string;
  reviewerSignAt?: string;
  nextReviewDue?: string;
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface FlightReviewRecordItem {
  id: string;
  reviewRecordId: string;
  templateItemKey: string;
  section: string;
  code: string;
  title: string;
  guidance: string;
  required: boolean;
  result: FlightReviewItemResult;
  notes: string;
  sortOrder: number;
}

export interface FlightReviewAttachment {
  id: string;
  reviewRecordId: string;
  candidateId: string;
  uploadedBy: string;
  category: FlightReviewAttachmentCategory;
  fileName: string;
  filePath: string;
  mimeType?: string;
  fileSize?: number;
  createdAt: string;
}

export interface StartFlightReviewInput {
  templateId: string;
  candidateId: string;
  reviewerUserId?: string;
  externalExaminerName?: string;
  externalExaminerIdentifier?: string;
  externalExaminerOrganisation?: string;
  reviewDate: string;
  bookingId?: string;
  flightLogId?: string;
  aircraftId?: string;
  aircraftType?: string;
  registration?: string;
  aircraftGroup?: string;
  previousReviewDate?: string;
  previousAircraftGroup?: string;
  candidateObjectives?: string;
}

type RecordUpdate = Partial<
  Omit<
    FlightReviewRecord,
    "id" | "templateSnapshot" | "createdAt" | "createdBy" | "version"
  >
>;

const mapTemplate = (row: Record<string, unknown>): FlightReviewTemplate => ({
  id: row.id as string,
  title: (row.title as string) || "Untitled review",
  description: (row.description as string) || "",
  category: (row.category as string) || "Flight Reviews",
  version: (row.version as string) || "1.0",
  status: (row.status as FlightReviewTemplate["status"]) || "draft",
  tags: (row.tags as string[]) || [],
  coursePurpose: (row.course_purpose as CoursePurpose) || "flight_review",
  configuration: (row.review_configuration as FlightReviewConfiguration) || {
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
  },
  lastUpdated: (row.last_updated as string) || new Date().toISOString(),
});

const mapRecord = (row: Record<string, unknown>): FlightReviewRecord => ({
  id: row.id as string,
  templateCourseId: (row.template_course_id as string) || undefined,
  templateSnapshot:
    (row.template_snapshot as FlightReviewRecord["templateSnapshot"]) || {},
  sourceTrainingRecordId:
    (row.source_training_record_id as string) || undefined,
  candidateId: row.candidate_id as string,
  reviewerUserId: (row.reviewer_user_id as string) || undefined,
  externalExaminerName: (row.external_examiner_name as string) || undefined,
  externalExaminerIdentifier:
    (row.external_examiner_identifier as string) || undefined,
  externalExaminerOrganisation:
    (row.external_examiner_organisation as string) || undefined,
  bookingId: (row.booking_id as string) || undefined,
  flightLogId: (row.flight_log_id as string) || undefined,
  reviewType: (row.review_type as string) || "custom_review",
  authority:
    (row.authority as FlightReviewConfiguration["authority"]) || "club",
  status: (row.status as FlightReviewStatus) || "draft",
  reviewDate: row.review_date as string,
  completionDate: (row.completion_date as string) || undefined,
  aircraftId: (row.aircraft_id as string) || undefined,
  aircraftType: (row.aircraft_type as string) || "",
  registration: (row.registration as string) || "",
  aircraftGroup: (row.aircraft_group as string) || undefined,
  previousReviewDate: (row.previous_review_date as string) || undefined,
  previousAircraftGroup: (row.previous_aircraft_group as string) || undefined,
  groundMinutes: Number(row.ground_minutes || 0),
  flightMinutes: Number(row.flight_minutes || 0),
  candidateObjectives: (row.candidate_objectives as string) || "",
  assessmentDetails:
    (row.assessment_details as FlightReviewAssessmentDetails) || {},
  emergencyPlanConfirmed: Boolean(row.emergency_plan_confirmed),
  reviewerSummary: (row.reviewer_summary as string) || "",
  remedialPlan: (row.remedial_plan as string) || "",
  minimumsOverrideReason: (row.minimums_override_reason as string) || "",
  logbookEntryConfirmed: Boolean(row.logbook_entry_confirmed),
  authoritySubmissionConfirmed: Boolean(row.authority_submission_confirmed),
  candidateAck: Boolean(row.candidate_ack),
  candidateAckName: (row.candidate_ack_name as string) || undefined,
  candidateAckAt: (row.candidate_ack_at as string) || undefined,
  reviewerSignName: (row.reviewer_sign_name as string) || undefined,
  reviewerSignAt: (row.reviewer_sign_at as string) || undefined,
  nextReviewDue: (row.next_review_due as string) || undefined,
  createdBy: row.created_by as string,
  updatedBy: (row.updated_by as string) || undefined,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
  version: Number(row.version || 1),
});

const mapItem = (row: Record<string, unknown>): FlightReviewRecordItem => ({
  id: row.id as string,
  reviewRecordId: row.review_record_id as string,
  templateItemKey: row.template_item_key as string,
  section: row.section as string,
  code: row.code as string,
  title: row.title as string,
  guidance: (row.guidance as string) || "",
  required: Boolean(row.required),
  result: (row.result as FlightReviewItemResult) || "not_assessed",
  notes: (row.notes as string) || "",
  sortOrder: Number(row.sort_order || 0),
});

const mapAttachment = (
  row: Record<string, unknown>,
): FlightReviewAttachment => ({
  id: row.id as string,
  reviewRecordId: row.review_record_id as string,
  candidateId: row.candidate_id as string,
  uploadedBy: row.uploaded_by as string,
  category: row.category as FlightReviewAttachmentCategory,
  fileName: row.file_name as string,
  filePath: row.file_path as string,
  mimeType: (row.mime_type as string) || undefined,
  fileSize: row.file_size ? Number(row.file_size) : undefined,
  createdAt: row.created_at as string,
});

const updatePayload = (input: RecordUpdate) => {
  const payload: Record<string, unknown> = {};
  const pairs: Array<[keyof RecordUpdate, string]> = [
    ["reviewerUserId", "reviewer_user_id"],
    ["externalExaminerName", "external_examiner_name"],
    ["externalExaminerIdentifier", "external_examiner_identifier"],
    ["externalExaminerOrganisation", "external_examiner_organisation"],
    ["bookingId", "booking_id"],
    ["flightLogId", "flight_log_id"],
    ["status", "status"],
    ["reviewDate", "review_date"],
    ["completionDate", "completion_date"],
    ["aircraftId", "aircraft_id"],
    ["aircraftType", "aircraft_type"],
    ["registration", "registration"],
    ["aircraftGroup", "aircraft_group"],
    ["previousReviewDate", "previous_review_date"],
    ["previousAircraftGroup", "previous_aircraft_group"],
    ["groundMinutes", "ground_minutes"],
    ["flightMinutes", "flight_minutes"],
    ["candidateObjectives", "candidate_objectives"],
    ["assessmentDetails", "assessment_details"],
    ["emergencyPlanConfirmed", "emergency_plan_confirmed"],
    ["reviewerSummary", "reviewer_summary"],
    ["remedialPlan", "remedial_plan"],
    ["minimumsOverrideReason", "minimums_override_reason"],
    ["logbookEntryConfirmed", "logbook_entry_confirmed"],
    ["authoritySubmissionConfirmed", "authority_submission_confirmed"],
    ["candidateAck", "candidate_ack"],
    ["candidateAckName", "candidate_ack_name"],
    ["candidateAckAt", "candidate_ack_at"],
    ["reviewerSignName", "reviewer_sign_name"],
    ["reviewerSignAt", "reviewer_sign_at"],
    ["nextReviewDue", "next_review_due"],
    ["updatedBy", "updated_by"],
  ];
  pairs.forEach(([key, column]) => {
    if (input[key] !== undefined) payload[column] = input[key] ?? null;
  });
  return payload;
};

const safeFileName = (name: string) =>
  name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");

export const useFlightReviews = (
  options: {
    enabled?: boolean;
    candidateId?: string;
    includeRecords?: boolean;
  } = {},
) => {
  const { user } = useAuth();
  const { enabled = true, candidateId, includeRecords = true } = options;
  const [templates, setTemplates] = useState<FlightReviewTemplate[]>([]);
  const [records, setRecords] = useState<FlightReviewRecord[]>([]);
  const [items, setItems] = useState<FlightReviewRecordItem[]>([]);
  const [attachments, setAttachments] = useState<FlightReviewAttachment[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const templateQuery = supabase
        .from("training_courses")
        .select(
          "id,title,description,category,version,status,tags,course_purpose,review_configuration,last_updated",
        )
        .in("course_purpose", [
          "flight_review",
          "flight_test",
          "proficiency_check",
        ])
        .order("title");

      if (!includeRecords) {
        const templateResult = await templateQuery;
        if (templateResult.error) throw templateResult.error;
        setTemplates(
          (templateResult.data || []).map((row) =>
            mapTemplate(row as Record<string, unknown>),
          ),
        );
        setRecords([]);
        setItems([]);
        setAttachments([]);
        setError(null);
        return;
      }

      let recordsQuery = supabase
        .from("flight_review_records")
        .select("*")
        .order("review_date", { ascending: false });
      if (candidateId)
        recordsQuery = recordsQuery.eq("candidate_id", candidateId);
      const [templateResult, recordResult] = await Promise.all([
        templateQuery,
        recordsQuery,
      ]);
      if (templateResult.error) throw templateResult.error;
      if (recordResult.error) throw recordResult.error;
      const nextRecords = (recordResult.data || []).map((row) =>
        mapRecord(row as Record<string, unknown>),
      );
      const recordIds = nextRecords.map((record) => record.id);
      let nextItems: FlightReviewRecordItem[] = [];
      let nextAttachments: FlightReviewAttachment[] = [];
      if (recordIds.length > 0) {
        const [itemResult, attachmentResult] = await Promise.all([
          supabase
            .from("flight_review_record_items")
            .select("*")
            .in("review_record_id", recordIds)
            .order("sort_order"),
          supabase
            .from("flight_review_attachments")
            .select("*")
            .in("review_record_id", recordIds)
            .order("created_at"),
        ]);
        if (itemResult.error) throw itemResult.error;
        if (attachmentResult.error) throw attachmentResult.error;
        nextItems = (itemResult.data || []).map((row) =>
          mapItem(row as Record<string, unknown>),
        );
        nextAttachments = (attachmentResult.data || []).map((row) =>
          mapAttachment(row as Record<string, unknown>),
        );
      }
      setTemplates(
        (templateResult.data || []).map((row) =>
          mapTemplate(row as Record<string, unknown>),
        ),
      );
      setRecords(nextRecords);
      setItems(nextItems);
      setAttachments(nextAttachments);
      setError(null);
    } catch (fetchError) {
      console.error("Failed to load flight reviews:", fetchError);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to load flight reviews and tests",
      );
    } finally {
      setLoading(false);
    }
  }, [candidateId, enabled, includeRecords]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const saveTemplate = useCallback(
    async (
      template: Omit<FlightReviewTemplate, "id" | "lastUpdated"> & {
        id?: string;
      },
    ) => {
      const payload = {
        title: template.title.trim(),
        description: template.description.trim(),
        category: template.category.trim() || "Flight Reviews",
        version: template.version.trim() || "1.0",
        status: template.status,
        tags: template.tags,
        course_purpose: template.coursePurpose,
        review_configuration: template.configuration,
        requires_student_acknowledgement:
          template.configuration.candidate_ack_required,
        last_updated: new Date().toISOString(),
      };
      const result = template.id
        ? await supabase
            .from("training_courses")
            .update(payload)
            .eq("id", template.id)
            .select()
            .single()
        : await supabase
            .from("training_courses")
            .insert({ ...payload, created_by: user?.id ?? null })
            .select()
            .single();
      if (result.error) throw result.error;
      await refetch();
      return mapTemplate(result.data as Record<string, unknown>);
    },
    [refetch, user?.id],
  );

  const startReview = useCallback(
    async (input: StartFlightReviewInput) => {
      const template = templates.find((item) => item.id === input.templateId);
      if (!template) throw new Error("Select a review or test template");
      const snapshot = {
        title: template.title,
        version: template.version,
        course_purpose: template.coursePurpose,
        review_configuration: template.configuration,
        captured_at: new Date().toISOString(),
      };
      const recordResult = await supabase
        .from("flight_review_records")
        .insert({
          template_course_id: template.id,
          template_snapshot: snapshot,
          candidate_id: input.candidateId,
          reviewer_user_id: input.reviewerUserId || null,
          external_examiner_name: input.externalExaminerName?.trim() || null,
          external_examiner_identifier:
            input.externalExaminerIdentifier?.trim() || null,
          external_examiner_organisation:
            input.externalExaminerOrganisation?.trim() || null,
          booking_id: input.bookingId || null,
          flight_log_id: input.flightLogId || null,
          review_type: template.configuration.review_type,
          authority: template.configuration.authority,
          status: "draft",
          review_date: input.reviewDate,
          aircraft_id: input.aircraftId || null,
          aircraft_type: input.aircraftType?.trim() || "",
          registration: input.registration?.trim() || "",
          aircraft_group: input.aircraftGroup?.trim() || null,
          previous_review_date: input.previousReviewDate || null,
          previous_aircraft_group: input.previousAircraftGroup?.trim() || null,
          candidate_objectives: input.candidateObjectives?.trim() || "",
        })
        .select()
        .single();
      if (recordResult.error) throw recordResult.error;
      const record = mapRecord(recordResult.data as Record<string, unknown>);
      const checklist = template.configuration.checklist || [];
      if (checklist.length > 0) {
        const itemResult = await supabase
          .from("flight_review_record_items")
          .insert(
            checklist.map((item: ReviewChecklistTemplateItem, index) => ({
              review_record_id: record.id,
              template_item_key: item.key,
              section: item.section,
              code: item.code,
              title: item.title,
              guidance: item.guidance || "",
              required: item.required,
              result: "not_assessed",
              sort_order: index * 10,
            })),
          );
        if (itemResult.error) {
          await supabase
            .from("flight_review_records")
            .delete()
            .eq("id", record.id);
          throw itemResult.error;
        }
      }
      await refetch();
      return record;
    },
    [refetch, templates],
  );

  const updateReview = useCallback(
    async (id: string, input: RecordUpdate) => {
      const result = await supabase
        .from("flight_review_records")
        .update(updatePayload(input))
        .eq("id", id)
        .select()
        .single();
      if (result.error) throw result.error;
      await refetch();
      return mapRecord(result.data as Record<string, unknown>);
    },
    [refetch],
  );

  const updateItem = useCallback(
    async (
      id: string,
      input: Partial<Pick<FlightReviewRecordItem, "result" | "notes">>,
    ) => {
      const result = await supabase
        .from("flight_review_record_items")
        .update({
          ...(input.result !== undefined ? { result: input.result } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (result.error) throw result.error;
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, ...input } : item)),
      );
    },
    [],
  );

  const uploadAttachment = useCallback(
    async (
      record: FlightReviewRecord,
      file: File,
      category: FlightReviewAttachmentCategory,
    ) => {
      const unique =
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `${record.candidateId}/${record.id}/${unique}-${safeFileName(file.name)}`;
      const upload = await supabase.storage
        .from("flight-review-evidence")
        .upload(path, file, {
          contentType: file.type || undefined,
          upsert: false,
        });
      if (upload.error) throw upload.error;
      const metadata = await supabase
        .from("flight_review_attachments")
        .insert({
          review_record_id: record.id,
          candidate_id: record.candidateId,
          category,
          file_name: file.name,
          file_path: path,
          mime_type: file.type || null,
          file_size: file.size,
        })
        .select()
        .single();
      if (metadata.error) {
        await supabase.storage.from("flight-review-evidence").remove([path]);
        throw metadata.error;
      }
      const attachment = mapAttachment(
        metadata.data as Record<string, unknown>,
      );
      setAttachments((current) => [...current, attachment]);
      return attachment;
    },
    [],
  );

  const createAttachmentUrl = useCallback(async (path: string) => {
    const result = await supabase.storage
      .from("flight-review-evidence")
      .createSignedUrl(path, 300);
    if (result.error) throw result.error;
    return result.data.signedUrl;
  }, []);

  const itemsByRecord = useMemo(() => {
    const map = new Map<string, FlightReviewRecordItem[]>();
    items.forEach((item) =>
      map.set(item.reviewRecordId, [
        ...(map.get(item.reviewRecordId) || []),
        item,
      ]),
    );
    return map;
  }, [items]);

  const attachmentsByRecord = useMemo(() => {
    const map = new Map<string, FlightReviewAttachment[]>();
    attachments.forEach((item) =>
      map.set(item.reviewRecordId, [
        ...(map.get(item.reviewRecordId) || []),
        item,
      ]),
    );
    return map;
  }, [attachments]);

  return {
    templates,
    records,
    items,
    attachments,
    itemsByRecord,
    attachmentsByRecord,
    loading,
    error,
    refetch,
    saveTemplate,
    startReview,
    updateReview,
    updateItem,
    uploadAttachment,
    createAttachmentUrl,
  };
};
