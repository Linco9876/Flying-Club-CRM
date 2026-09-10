import assert from "node:assert/strict";
import test from "node:test";
import { assessLicence, defaultLicenceMedicalRule } from "./licenceMedicals.ts";
import type { MedicalRecord } from "./medicalRecords.ts";
const at = new Date(2026, 8, 10);
const dob = new Date(2000, 0, 1);
const licence = { id: "l", type: "RAAus Pilot Certificate", isActive: true };
const record = (overrides: Partial<MedicalRecord> = {}): MedicalRecord => ({
  id: "r",
  user_id: "u",
  type_id: "raaus-medical-declaration",
  medical_type: "RAAus Medical Declaration",
  issued_on: "2026-01-01",
  expires_on: null,
  review_due_on: "2028-01-01",
  validity_mode: "until_age",
  valid_until_age: 75,
  accepted_operations: [],
  status: "legacy",
  restrictions: null,
  document_id: null,
  verified_at: null,
  verified_by: null,
  legacy_snapshot: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  ...overrides,
});
test("RAAus remains valid after CASA medical expiry; unrelated expired licences do not affect it", () => {
  const records = [
    record(),
    record({
      type_id: "casa-class-1",
      validity_mode: "expiry_date",
      expires_on: "2025-01-01",
    }),
  ];
  assert.equal(assessLicence(licence, records, dob, {}, at).valid, true);
  assert.equal(
    assessLicence(
      { ...licence, type: "CASA Commercial Pilot Licence (CPL)" },
      records,
      dob,
      {},
      at,
    ).valid,
    false,
  );
});
test("pending, suspended, untyped and future-issued medicals cannot grant licence validity", () => {
  for (const override of [
    { status: "pending" as const },
    { status: "suspended" as const },
    { type_id: null },
    { issued_on: "2027-01-01" },
  ])
    assert.equal(
      assessLicence(licence, [record(override)], dob, {}, at).valid,
      false,
    );
  assert.equal(
    assessLicence(
      licence,
      [record(), record({ status: "suspended" })],
      dob,
      {},
      at,
    ).valid,
    false,
  );
});
test("expiry, review date, missing birth date and birthday are evaluated through flight end", () => {
  assert.equal(
    assessLicence(licence, [record()], undefined, {}, at).valid,
    false,
  );
  assert.equal(
    assessLicence(
      licence,
      [record({ review_due_on: "2026-09-10" })],
      dob,
      {},
      at,
      new Date(2026, 8, 11),
    ).valid,
    false,
  );
  assert.equal(
    assessLicence(
      licence,
      [record({ review_due_on: null })],
      dob,
      {},
      new Date(2074, 11, 31),
      new Date(2075, 0, 1),
    ).valid,
    false,
  );
  assert.equal(
    assessLicence(
      licence,
      [record({ review_due_on: "2026-09-10" })],
      dob,
      {},
      at,
    ).valid,
    true,
  );
});
test("licence verification, issue and expiry remain independent of medical currency", () => {
  for (const override of [
    { isActive: false },
    { verificationStatus: "pending" as const },
    { expiryDate: new Date(2026, 8, 9) },
    { dateObtained: new Date(2026, 8, 11) },
  ])
    assert.equal(
      assessLicence({ ...licence, ...override }, [record()], dob, {}, at).valid,
      false,
    );
});
test("instructor medical requirements are separate and licence configuration uses stable medical IDs", () => {
  assert.equal(
    assessLicence(licence, [record()], dob, {}, at, at, true).valid,
    false,
  );
  const rule = defaultLicenceMedicalRule(licence.type);
  const rules = { "renamed licence": rule };
  assert.equal(
    assessLicence(
      { ...licence, type: "Renamed Licence" },
      [record({ medical_type: "Old evidence name" })],
      dob,
      rules,
      at,
    ).valid,
    true,
  );
  assert.equal(
    assessLicence(
      { ...licence, type: "Unknown licence" },
      [record()],
      dob,
      {},
      at,
    ).valid,
    false,
  );
  assert.equal(
    assessLicence(
      licence,
      [],
      dob,
      { "raaus pilot certificate": { ...rule, required: false } },
      at,
    ).valid,
    true,
  );
});
