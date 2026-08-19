import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import {
  PORTAL_FEEDBACK_MAX_SCREENSHOT_BYTES,
  buildPortalFeedbackEmail,
  validatePortalFeedbackPayload,
} from './portalFeedback.ts';

const screenshotContent = btoa('\xff\xd8\xff' + 'x'.repeat(297));
const payload = {
  submissionId: '11111111-1111-4111-8111-111111111111',
  category: 'bug',
  comment: 'The save button covers the final field.',
  screenshotDataUrl: `data:image/jpeg;base64,${screenshotContent}`,
  screenshotWidth: 1200,
  screenshotHeight: 800,
  displaySurface: 'browser',
  pageUrl: 'https://portal.bendigoflyingclub.com.au/calendar?date=2026-08-15',
  route: '/calendar?date=2026-08-15',
  viewportWidth: 1440,
  viewportHeight: 900,
  userAgent: 'Test Browser <script>alert(1)</script>',
  submittedAt: '2026-08-15T03:00:00.000Z',
};

Deno.test('validates a complete portal feedback report', () => {
  const result = validatePortalFeedbackPayload(payload);
  assert(result.ok);
  assertEquals(result.value.screenshotBytes, 300);
  assertEquals(result.value.screenshotMimeType, 'image/jpeg');
  assertEquals(result.value.category, 'bug');
});

Deno.test('rejects invalid categories, comments, image types and unsafe URLs', () => {
  assertEquals(validatePortalFeedbackPayload({ ...payload, category: 'urgent' }).ok, false);
  assertEquals(validatePortalFeedbackPayload({ ...payload, comment: 'no' }).ok, false);
  assertEquals(validatePortalFeedbackPayload({ ...payload, screenshotDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }).ok, false);
  assertEquals(validatePortalFeedbackPayload({ ...payload, pageUrl: 'javascript:alert(1)' }).ok, false);
  assertEquals(validatePortalFeedbackPayload({ ...payload, pageUrl: 'https://example.com/fake-portal' }).ok, false);
  assertEquals(validatePortalFeedbackPayload({ ...payload, screenshotDataUrl: `data:image/jpeg;base64,${btoa('x'.repeat(300))}` }).ok, false);
});

Deno.test('rejects screenshots over the four megabyte server limit', () => {
  const oversizedBase64Length = Math.ceil((PORTAL_FEEDBACK_MAX_SCREENSHOT_BYTES + 1) / 3) * 4;
  const result = validatePortalFeedbackPayload({
    ...payload,
    screenshotDataUrl: `data:image/jpeg;base64,${'A'.repeat(oversizedBase64Length)}`,
  });
  assertEquals(result.ok, false);
});

Deno.test('builds a readable email and escapes reporter-controlled HTML', () => {
  const result = validatePortalFeedbackPayload(payload);
  assert(result.ok);
  const email = buildPortalFeedbackEmail({
    feedback: result.value,
    reporterName: 'Alex <Admin>',
    reporterEmail: 'alex@example.com',
    receivedAt: new Date('2026-08-15T03:00:00.000Z'),
  });
  assertMatch(email.subject, /^\[BFC Portal\] Bug report/);
  assertMatch(email.html, /Alex &lt;Admin&gt;/);
  assertMatch(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert(!email.html.includes('<script>alert(1)</script>'));
  assertMatch(email.html, /The marked-up screenshot is attached/);
});
