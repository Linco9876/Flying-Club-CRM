import {
  evaluateMedicalCurrency,
  DEFAULT_MEDICAL_TYPES,
  type MedicalCurrencyStatus,
  type MedicalTypeDefinition,
} from "./medicalRequirements.ts";

export const MEDICAL_OPERATIONS = {
  raaus_pilot: "RAAus flying",
  raaus_instructor: "RAAus instructing",
  casa_private: "CASA private flying",
  casa_class1: "Operations requiring Class 1",
} as const;
export type MedicalOperation = keyof typeof MEDICAL_OPERATIONS;
export interface MedicalRecord {
  id: string;
  user_id: string;
  medical_type: string;
  type_id: string | null;
  issued_on: string | null;
  expires_on: string | null;
  review_due_on: string | null;
  validity_mode: "expiry_date" | "until_age";
  valid_until_age: number | null;
  accepted_operations: MedicalOperation[];
  status:
    | "pending"
    | "verified"
    | "legacy"
    | "superseded"
    | "withdrawn"
    | "suspended";
  restrictions: string | null;
  document_id: string | null;
  verified_at: string | null;
  verified_by: string | null;
  legacy_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
export const defaultMedicalOperations = (name: string): MedicalOperation[] => {
  const clean = name.toLowerCase().trim();
  if (clean === "casa class 1")
    return ["raaus_pilot", "raaus_instructor", "casa_private", "casa_class1"];
  if (clean === "casa class 2")
    return ["raaus_pilot", "raaus_instructor", "casa_private"];
  if (clean === "raaus instructor medical (med003)")
    return ["raaus_pilot", "raaus_instructor"];
  if (
    clean === "raaus medical declaration" ||
    clean === "driver licence medical"
  )
    return ["raaus_pilot"];
  // Restricted CASA certificates need explicit club review of the intended activity.
  return [];
};
export const dateOnly = (value: string | null | undefined) =>
  value ? new Date(`${value.slice(0, 10)}T00:00:00`) : undefined;
export const medicalRecordCurrency = (
  record: MedicalRecord,
  dateOfBirth?: Date | null,
  at = new Date(),
  warningDays = 60,
): MedicalCurrencyStatus => {
  const definition: MedicalTypeDefinition = {
    id: record.type_id || record.id,
    name: record.medical_type,
    validityMode: record.validity_mode,
    validUntilAge: record.valid_until_age,
    isActive: true,
  };
  const assessed = evaluateMedicalCurrency({
    required: true,
    medicalType: record.medical_type,
    medicalExpiry: dateOnly(record.expires_on),
    dateOfBirth,
    definitions: [definition],
    at,
    warningDays,
  });
  const dates = [
    assessed.effectiveExpiry,
    dateOnly(record.review_due_on),
    dateOnly(record.expires_on),
  ].filter((date): date is Date => Boolean(date));
  const earliest = dates.sort((a, b) => a.getTime() - b.getTime())[0];
  if (record.issued_on && record.issued_on > localDate(at))
    return { ...assessed, state: "expired", label: "Not yet effective" };
  if (assessed.state === "missing_date_of_birth") return assessed;
  if (!earliest) return assessed;
  const expiresOnBirthday =
    record.validity_mode === "until_age" &&
    assessed.effectiveExpiry?.getTime() === earliest.getTime();
  return evaluateMedicalCurrency({
    required: true,
    medicalType: record.medical_type,
    medicalExpiry: earliest,
    dateOfBirth,
    definitions: [
      {
        ...definition,
        validityMode: expiresOnBirthday ? "until_age" : "expiry_date",
      },
    ],
    at,
    warningDays,
  });
};
const localDate = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
export interface MemberMedicalAssessment extends MedicalCurrencyStatus {
  record?: MedicalRecord;
  operation?: MedicalOperation;
  needsReview?: boolean;
}
export const assessMemberMedicals = ({
  records,
  operation,
  required = true,
  dateOfBirth,
  at = new Date(),
  warningDays = 60,
  medicalType,
  medicalExpiry,
  definitions = DEFAULT_MEDICAL_TYPES,
}: {
  records?: MedicalRecord[];
  operation?: MedicalOperation;
  required?: boolean;
  dateOfBirth?: Date | null;
  at?: Date;
  warningDays?: number;
  medicalType?: string | null;
  medicalExpiry?: Date | null;
  definitions?: MedicalTypeDefinition[];
}): MemberMedicalAssessment => {
  const base = evaluateMedicalCurrency({
    required,
    medicalType,
    medicalExpiry,
    dateOfBirth,
    definitions,
    at,
    warningDays,
  });
  if (!required) return base;
  if (records === undefined) return { ...base, needsReview: true }; // Loading/legacy callers only.
  if (records.some((record) => record.status === "suspended"))
    return {
      ...base,
      state: "expired",
      label: "Medical restriction requires staff review",
      needsReview: true,
      operation,
    };
  const applicable = records.filter(
    (record) =>
      ["verified", "legacy"].includes(record.status) &&
      (operation
        ? record.accepted_operations.includes(operation)
        : record.accepted_operations.length > 0),
  );
  const assessed = applicable.map((record) => ({
    ...medicalRecordCurrency(record, dateOfBirth, at, warningDays),
    record,
    operation,
  }));
  const rank = (item: MedicalCurrencyStatus) =>
    item.state === "current"
      ? 3
      : item.state === "expiring"
        ? 2
        : item.state === "expired"
          ? 0
          : 1;
  assessed.sort(
    (a, b) =>
      rank(b) - rank(a) ||
      (b.effectiveExpiry?.getTime() || 0) - (a.effectiveExpiry?.getTime() || 0),
  );
  if (!assessed.length)
    return {
      ...base,
      state: "missing_type",
      label: records.some((r) => r.status === "pending")
        ? "Medical awaiting verification"
        : "No applicable medical recorded",
      needsReview: true,
      operation,
      effectiveExpiry: null,
      daysRemaining: null,
      definition: null,
    };
  return assessed[0];
};
export const medicalOperationForAircraft = (
  registration?: string | null,
  instructing = false,
): MedicalOperation | undefined => {
  if (/^VH[- ]/i.test((registration || "").trim())) return "casa_private";
  if (/^\d{2}[- ]\d{3,4}$/i.test((registration || "").trim()))
    return instructing ? "raaus_instructor" : "raaus_pilot";
  return undefined;
};
