import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { renderMembershipWelcomeEmail } from "./membershipWelcomeEmail.ts";

const brand = {
  clubName: "Bendigo Flying Club",
  contactEmail: "bfc@bendigoflyingclub.com.au",
  logoUrl: "https://assets.example.com/bfc-logo.png",
  portalUrl: "https://portal.bendigoflyingclub.com.au/",
};

Deno.test("automatic membership welcome email has a clear mobile-safe journey", () => {
  const message = renderMembershipWelcomeEmail({
    name: "Lincoln Cottingham",
    membershipClass: "Full",
    variant: "automatic",
    brand,
  });

  assertEquals(message.subject, "Welcome to Bendigo Flying Club, Lincoln");
  assertStringIncludes(message.html, "Welcome aboard, Lincoln");
  assertStringIncludes(message.html, "Automatic annual payment");
  assertStringIncludes(
    message.html,
    "payment will be attempted automatically on 1 July",
  );
  assertStringIncludes(message.html, "Open your member portal");
  assertStringIncludes(
    message.html,
    "@media only screen and (max-width: 620px)",
  );
  assertStringIncludes(message.html, "@media (prefers-color-scheme: dark)");
  assertStringIncludes(
    message.text,
    "Aircraft self-booking is unavailable while the fee is unpaid",
  );
});

Deno.test("manual membership welcome email explains invoices and prepaid credit", () => {
  const message = renderMembershipWelcomeEmail({
    name: "Linda Example",
    membershipClass: "Affiliate",
    variant: "manual",
    brand,
  });

  assertStringIncludes(message.html, "Annual invoice");
  assertStringIncludes(
    message.html,
    "initial prorated membership invoice will be issued through Xero",
  );
  assertStringIncludes(message.html, "Xero-verified prepaid credit");
  assertStringIncludes(
    message.text,
    "renewal invoice will be raised 30 days before the next financial year",
  );
  assertFalse(message.text.includes("automatic annual payment"));
});

Deno.test("welcome email follows configured renewal and grace settings", () => {
  const message = renderMembershipWelcomeEmail({
    name: "Configured Member",
    membershipClass: "Full",
    variant: "automatic",
    policy: {
      renewalDateLabel: "15 August",
      nonPaymentGraceDays: 45,
      renewalInvoiceLeadDays: 21,
    },
  });
  assertStringIncludes(message.text, "automatically on 15 August");
  assertStringIncludes(message.text, "45 days to pay");
  assertFalse(message.text.includes("60 days"));
});

Deno.test("welcome email escapes member-controlled content and rejects unsafe URLs", () => {
  const message = renderMembershipWelcomeEmail({
    name: `<img src=x onerror=alert(1)>`,
    membershipClass: `<script>alert("x")</script>`,
    variant: "manual",
    brand: {
      clubName: "Club <Test>",
      logoUrl: "javascript:alert(1)",
      portalUrl: "javascript:alert(1)",
      contactEmail: `" onclick="alert(1)`,
    },
    review: true,
  });

  assertFalse(message.html.includes("<script>"));
  assertFalse(message.html.includes("javascript:"));
  assertFalse(message.html.includes("onerror="));
  assertFalse(message.html.includes("mailto:"));
  assertStringIncludes(message.html, "&lt;script&gt;");
  assertStringIncludes(
    message.html,
    "https://portal.bendigoflyingclub.com.au",
  );
  assertEquals(
    message.subject,
    "[REVIEW - Annual invoice] Welcome to Club <Test>",
  );
});

Deno.test("welcome email falls back to Bendigo Flying Club branding", () => {
  const message = renderMembershipWelcomeEmail({
    name: "",
    membershipClass: "",
    variant: "manual",
  });

  assertEquals(message.subject, "Welcome to Bendigo Flying Club, there");
  assertStringIncludes(message.html, ">BFC<");
  assertStringIncludes(message.text, "Your Club membership has commenced.");
});
