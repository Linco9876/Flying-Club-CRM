import { assertEquals, assertFalse, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { renderTrainingRecordAcknowledgementEmail } from "./trainingRecordAcknowledgementEmail.ts";

const input = {
  studentName: "Aimee Gatford",
  instructorName: "Lincoln Cottingham",
  courseTitle: "RAAus Ab-initio RPC",
  lessonTitle: "Climbing and descending",
  lessonDate: "2 August 2026",
  acknowledgementUrl: "https://portal.bendigoflyingclub.com.au/lesson-acknowledgement?token=private-token",
};

Deno.test("lesson acknowledgement email provides a clear login-free action", () => {
  const message = renderTrainingRecordAcknowledgementEmail(input);
  assertEquals(message.subject, "Your Climbing and descending record is ready to review");
  assertStringIncludes(message.html, "Review and approve lesson");
  assertStringIncludes(message.html, "mso-padding-alt");
  assertStringIncludes(message.html, "bgcolor=\"#2563eb\"");
  assertStringIncludes(message.html, "Takes about a minute");
  assertStringIncludes(message.html, "No portal login is required");
  assertStringIncludes(message.html, "@media only screen and (max-width:620px)");
  assertStringIncludes(message.html, "@media (prefers-color-scheme:dark)");
  assertStringIncludes(message.text, input.acknowledgementUrl);
});

Deno.test("edited lesson email explains that the record changed", () => {
  const message = renderTrainingRecordAcknowledgementEmail({ ...input, isRevision: true });
  assertStringIncludes(message.subject, "has been updated");
  assertStringIncludes(message.html, "Record updated");
  assertStringIncludes(message.text, "has updated your lesson record");
});

Deno.test("lesson email escapes record content and rejects non-HTTPS links", () => {
  const message = renderTrainingRecordAcknowledgementEmail({
    ...input,
    studentName: '<img src=x onerror="alert(1)">',
    lessonTitle: "<script>alert(1)</script>",
  });
  assertFalse(message.html.includes("<script>"));
  assertFalse(message.html.includes("onerror="));
  assertStringIncludes(message.html, "&lt;script&gt;");
  assertThrows(() => renderTrainingRecordAcknowledgementEmail({
    ...input,
    acknowledgementUrl: "javascript:alert(1)",
  }));
});
