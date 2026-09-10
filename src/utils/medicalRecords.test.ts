import assert from "node:assert/strict";
import test from "node:test";
import {
  assessMemberMedicals,
  medicalRecordCurrency,
  medicalOperationForAircraft,
  type MedicalRecord,
} from "./medicalRecords.ts";
const record = (overrides: Partial<MedicalRecord> = {}): MedicalRecord => ({
  id: "record",
  user_id: "member",
  type_id: "casa-class-2",
  medical_type: "CASA Class 2",
  issued_on: "2025-01-01",
  expires_on: "2028-01-01",
  review_due_on: null,
  validity_mode: "expiry_date",
  valid_until_age: null,
  accepted_operations: ["casa_private", "raaus_pilot", "raaus_instructor"],
  status: "verified",
  restrictions: null,
  document_id: null,
  verified_at: null,
  verified_by: null,
  legacy_snapshot: null,
  created_at: "2025-01-01",
  updated_at: "2025-01-01",
  ...overrides,
});
const dob = new Date(2000, 0, 1);
const at = new Date(2026, 8, 10);
const declaration = record({
  id: "declaration",
  type_id: "raaus-medical-declaration",
  medical_type: "RAAus Medical Declaration",
  expires_on: null,
  review_due_on: "2027-01-01",
  validity_mode: "until_age",
  valid_until_age: 75,
  accepted_operations: ["raaus_pilot"],
});
test("expired CASA records do not block an applicable current RAAus declaration", () => {
  const records = [
    record({ expires_on: "2025-12-31" }),
    record({
      id: "class1",
      medical_type: "CASA Class 1",
      expires_on: "2025-12-31",
    }),
    declaration,
  ];
  const result = assessMemberMedicals({
    records,
    operation: "raaus_pilot",
    dateOfBirth: dob,
    at,
  });
  assert.equal(result.state, "current");
  assert.equal(result.record?.id, "declaration");
  assert.equal(
    assessMemberMedicals({
      records,
      operation: "casa_private",
      dateOfBirth: dob,
      at,
    }).state,
    "expired",
  );
});
test("pilot declaration cannot clear instructor or Class 1 operations", () => {
  for (const operation of ["raaus_instructor", "casa_class1"] as const)
    assert.equal(
      assessMemberMedicals({
        records: [declaration],
        operation,
        dateOfBirth: dob,
        at,
      }).state,
      "missing_type",
    );
});
test("review date caps age-based validity and certificate expiry remains inclusive", () => {
  assert.equal(
    medicalRecordCurrency(declaration, dob, new Date(2027, 0, 1)).state,
    "expiring",
  );
  assert.equal(
    medicalRecordCurrency(declaration, dob, new Date(2027, 0, 2)).state,
    "expired",
  );
  assert.equal(
    medicalRecordCurrency(record({ expires_on: "2026-09-10" }), dob, at).state,
    "expiring",
  );
});
test("age boundary, missing DOB and future issue cannot grant clearance", () => {
  assert.equal(
    medicalRecordCurrency(
      { ...declaration, review_due_on: null },
      dob,
      new Date(2075, 0, 1),
    ).state,
    "expired",
  );
  assert.equal(
    medicalRecordCurrency(declaration, undefined, at).state,
    "missing_date_of_birth",
  );
  assert.equal(
    medicalRecordCurrency(record({ issued_on: "2027-01-01" }), dob, at).label,
    "Not yet effective",
  );
});
test("pending, withdrawn and superseded records are excluded", () => {
  for (const status of ["pending", "withdrawn", "superseded"] as const)
    assert.equal(
      assessMemberMedicals({
        records: [record({ status })],
        operation: "casa_private",
        at,
      }).state,
      "missing_type",
    );
});
test("suspended medical requires review even with a valid alternative", () => {
  const result = assessMemberMedicals({
    records: [record(), record({ id: "hold", status: "suspended" })],
    operation: "casa_private",
    at,
  });
  assert.equal(result.state, "expired");
  assert.equal(result.needsReview, true);
});
test("imported declaration retains known age rule without inventing issue or review dates", () => {
  assert.equal(
    assessMemberMedicals({
      records: [
        {
          ...declaration,
          status: "legacy",
          issued_on: null,
          review_due_on: null,
        },
      ],
      operation: "raaus_pilot",
      dateOfBirth: dob,
      at,
    }).state,
    "current",
  );
});
test("all-record summary chooses a valid alternative and explicit framework excludes others", () => {
  const records = [record({ expires_on: "2025-01-01" }), declaration];
  assert.equal(
    assessMemberMedicals({ records, dateOfBirth: dob, at }).record?.id,
    "declaration",
  );
  assert.equal(medicalOperationForAircraft("VH-ABC"), "casa_private");
  assert.equal(
    medicalOperationForAircraft("24-1234", true),
    "raaus_instructor",
  );
  assert.equal(medicalOperationForAircraft("N123AB"), undefined);
});
