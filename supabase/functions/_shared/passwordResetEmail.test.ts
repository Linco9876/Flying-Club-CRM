import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { buildPasswordResetEmail } from "./passwordResetEmail.ts";

Deno.test("password reset email has a clear, mobile-friendly and scanner-safe design", async () => {
  const email = await buildPasswordResetEmail({
    name: "Robin & Team",
    setupLink:
      "https://portal.example.com/accept-invitation#mode=password-reset&setup=secure",
    brandingOverride: {
      clubName: "Example Flying Club",
      logoUrl: "https://cdn.example.com/logo.png",
      portalUrl: "https://portal.example.com",
    },
  });

  assertEquals(email.subject, "Reset your Bendigo Flying Club portal password");
  assertMatch(email.htmlContent, /data-bfc-password-reset-email="true"/);
  assertMatch(email.htmlContent, /data-bfc-email-logo="true"/);
  assertMatch(email.htmlContent, /Hello <strong>Robin &amp; Team<\/strong>/);
  assertMatch(email.htmlContent, />\s*Reset my password\s*<\/a>/);
  assertMatch(email.htmlContent, /Why is there a confirmation step\?/);
  assertMatch(email.htmlContent, /automated email security scanners/);
  assertMatch(email.htmlContent, /Your password has not changed/);
  assertMatch(email.htmlContent, /Button not working\?/);
  assertMatch(email.htmlContent, /mode=password-reset&amp;setup=secure/);
  assertMatch(email.htmlContent, /@media only screen and \(max-width: 620px\)/);
});
