import { assertEquals, assertMatch } from "jsr:@std/assert";
import {
  brandPortalEmailHtml,
  DEFAULT_PORTAL_EMAIL_BRANDING,
} from "./emailBranding.ts";

Deno.test("portal email branding inserts the configured company logo after the body tag", async () => {
  const html = await brandPortalEmailHtml(
    '<!doctype html><html><body class="mail"><p>Hello</p></body></html>',
    {
      clubName: "Example & Flying Club",
      logoUrl: "https://cdn.example.com/company-logo.png",
      portalUrl: "https://portal.example.com",
    },
  );

  assertMatch(html, /<body class="mail"><table data-bfc-email-logo="true"/);
  assertMatch(html, /src="https:\/\/cdn\.example\.com\/company-logo\.png"/);
  assertMatch(html, /alt="Example &amp; Flying Club logo"/);
  assertMatch(html, /<img[^>]+width="144" height="90"/);
  assertMatch(
    html,
    /width:144px!important;max-width:144px!important;height:90px!important;max-height:90px!important;object-fit:contain/,
  );
  assertMatch(html, /<p>Hello<\/p>/);
});

Deno.test("portal email branding is idempotent", async () => {
  const once = await brandPortalEmailHtml(
    "<html><body><p>Hello</p></body></html>",
    DEFAULT_PORTAL_EMAIL_BRANDING,
  );
  const twice = await brandPortalEmailHtml(once, DEFAULT_PORTAL_EMAIL_BRANDING);
  assertEquals(twice, once);
  assertEquals((twice.match(/data-bfc-email-logo/g) || []).length, 1);
});

Deno.test("portal email branding rejects unsafe logo and portal URLs", async () => {
  const html = await brandPortalEmailHtml("<p>Hello</p>", {
    logoUrl: "javascript:alert(1)",
    portalUrl: "data:text/html,unsafe",
  });

  assertMatch(
    html,
    /storage\/v1\/render\/image\/public\/org-logos\/logo\.png\?width=288&amp;height=180&amp;resize=contain&amp;quality=85/,
  );
  assertMatch(html, /href="https:\/\/portal\.bendigoflyingclub\.com\.au\/?"/);
});
