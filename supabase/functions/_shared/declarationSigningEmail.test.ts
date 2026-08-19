import { assertEquals, assertFalse, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { renderDeclarationSigningEmail } from "./declarationSigningEmail.ts";

const input = {
  recipientType: "student" as const,
  recipientName: "Aimee Gatford",
  studentName: "Aimee Gatford",
  courseTitle: "RAAus Ab-initio RPC",
  declarationTitle: "Student flying declaration",
  declarationVersion: 3,
  signingUrl: "https://portal.bendigoflyingclub.com.au/declaration-sign?token=private-token",
};

Deno.test("student declaration email provides a clear secure signing action", () => {
  const message = renderDeclarationSigningEmail(input);
  assertEquals(message.subject, "Your RAAus Ab-initio RPC flying declaration is ready to sign");
  assertStringIncludes(message.html, "Review and sign declaration");
  assertStringIncludes(message.html, "Private, one-time signing link");
  assertStringIncludes(message.html, "No portal login required");
  assertStringIncludes(message.html, "Available for 14 days");
  assertStringIncludes(message.html, "mso-padding-alt");
  assertStringIncludes(message.html, "@media only screen and (max-width:620px)");
  assertStringIncludes(message.html, "@media (prefers-color-scheme:dark)");
  assertStringIncludes(message.text, input.signingUrl);
});

Deno.test("guardian declaration email identifies the student and declaration", () => {
  const message = renderDeclarationSigningEmail({
    ...input,
    recipientType: "guardian",
    recipientName: "Chris Gatford",
    declarationTitle: "Under-18 parent or guardian declaration",
  });
  assertEquals(message.subject, "Parent or guardian declaration ready for Aimee Gatford");
  assertStringIncludes(message.html, "Parent or guardian signature required");
  assertStringIncludes(message.html, "Under-18 parent or guardian declaration");
  assertStringIncludes(message.html, "Aimee Gatford");
  assertStringIncludes(message.text, "forms part of their RAAus Ab-initio RPC training record");
});

Deno.test("declaration email escapes content and rejects non-HTTPS links", () => {
  const message = renderDeclarationSigningEmail({
    ...input,
    recipientName: '<img src=x onerror="alert(1)">',
    declarationTitle: "<script>alert(1)</script>",
  });
  assertFalse(message.html.includes("<script>"));
  assertFalse(message.html.includes("onerror="));
  assertStringIncludes(message.html, "&lt;script&gt;");
  assertThrows(() => renderDeclarationSigningEmail({
    ...input,
    signingUrl: "javascript:alert(1)",
  }));
});
