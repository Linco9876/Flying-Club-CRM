import type { Licence } from "../types";
import { medicalRecordCurrency, type MedicalRecord } from "./medicalRecords.ts";

export interface LicenceMedicalRule {
  required: boolean;
  acceptedMedicalTypeIds: string[];
  instructorMedicalTypeIds: string[];
}
export type LicenceMedicalRequirements = Record<string, LicenceMedicalRule>;
export const licenceKey = (name: string) => name.trim().toLowerCase();
export function defaultLicenceMedicalRule(name: string): LicenceMedicalRule {
  const key = licenceKey(name);
  const casa = ["casa-class-1", "casa-class-2"];
  if (key === "raaus pilot certificate")
    return {
      required: true,
      acceptedMedicalTypeIds: [
        "raaus-medical-declaration",
        "driver-licence-medical",
        "raaus-instructor-medical-med003",
        ...casa,
      ],
      instructorMedicalTypeIds: ["raaus-instructor-medical-med003", ...casa],
    };
  if (
    [
      "casa recreational pilot licence (rpl)",
      "casa private pilot licence (ppl)",
    ].includes(key)
  )
    return {
      required: true,
      acceptedMedicalTypeIds: casa,
      instructorMedicalTypeIds: casa,
    };
  if (
    [
      "casa commercial pilot licence (cpl)",
      "casa air transport pilot licence (atpl)",
    ].includes(key)
  )
    return {
      required: true,
      acceptedMedicalTypeIds: ["casa-class-1"],
      instructorMedicalTypeIds: ["casa-class-1"],
    };
  return {
    required: true,
    acceptedMedicalTypeIds: [],
    instructorMedicalTypeIds: [],
  };
}
export function licenceMedicalRule(
  name: string,
  rules: LicenceMedicalRequirements = {},
) {
  return rules[licenceKey(name)] ?? defaultLicenceMedicalRule(name);
}
export function assessLicence(
  licence: Licence,
  records: MedicalRecord[] | undefined,
  dateOfBirth: Date | undefined,
  rules: LicenceMedicalRequirements = {},
  at = new Date(),
  through = at,
  instructing = false,
): { valid: boolean; reason: string } {
  if (
    (licence.verificationStatus ?? "verified") !== "verified" ||
    !licence.isActive
  )
    return { valid: false, reason: "Licence is not active and verified" };
  const day = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  if (licence.dateObtained && day(new Date(licence.dateObtained)) > day(at))
    return { valid: false, reason: "Licence is not yet effective" };
  if (licence.expiryDate && day(new Date(licence.expiryDate)) < day(through))
    return { valid: false, reason: "Licence expired" };
  if (records?.some((record) => record.status === "suspended"))
    return {
      valid: false,
      reason: "Medical restriction requires staff review",
    };
  const rule = licenceMedicalRule(licence.type, rules);
  if (!rule.required)
    return {
      valid: true,
      reason: "Valid — no medical required for this licence",
    };
  const accepted = instructing
    ? rule.instructorMedicalTypeIds
    : rule.acceptedMedicalTypeIds;
  if (!accepted.length)
    return { valid: false, reason: "Medical requirements need configuration" };
  const current = (record: MedicalRecord, date: Date) =>
    ["current", "expiring"].includes(
      medicalRecordCurrency(record, dateOfBirth, date).state,
    );
  const valid =
    records?.some(
      (record) =>
        ["active", "verified", "legacy"].includes(record.status) &&
        accepted.includes(record.type_id || "") &&
        current(record, at) &&
        current(record, through),
    ) ?? false;
  return {
    valid,
    reason: valid
      ? "Valid — accepted medical current"
      : "Not valid for flying — accepted medical missing, expired or missing required evidence",
  };
}
