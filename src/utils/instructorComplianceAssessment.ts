export type InstructorAssessmentResult =
  | "not_assessed"
  | "satisfactory"
  | "unsatisfactory";

export const deriveInstructorAssessmentOutcome = (
  results: InstructorAssessmentResult[],
): "satisfactory" | "unsatisfactory" =>
  results.includes("unsatisfactory") ? "unsatisfactory" : "satisfactory";

export const canLeaveRequiredItemNotAssessed = (checkType: string): boolean =>
  checkType === "sp_check";
