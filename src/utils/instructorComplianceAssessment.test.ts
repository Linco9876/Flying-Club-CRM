import assert from "node:assert/strict";
import test from "node:test";
import {
  canLeaveRequiredItemNotAssessed,
  deriveInstructorAssessmentOutcome,
} from "./instructorComplianceAssessment.ts";

test("an S&P with not-assessed sections remains satisfactory", () => {
  assert.equal(
    deriveInstructorAssessmentOutcome([
      "satisfactory",
      "not_assessed",
      "not_assessed",
    ]),
    "satisfactory",
  );
  assert.equal(canLeaveRequiredItemNotAssessed("sp_check"), true);
});

test("any needs-attention section makes the assessment unsatisfactory", () => {
  assert.equal(
    deriveInstructorAssessmentOutcome([
      "not_assessed",
      "unsatisfactory",
      "satisfactory",
    ]),
    "unsatisfactory",
  );
});

test("renewals continue to require their required evidence items", () => {
  assert.equal(canLeaveRequiredItemNotAssessed("renewal"), false);
});
