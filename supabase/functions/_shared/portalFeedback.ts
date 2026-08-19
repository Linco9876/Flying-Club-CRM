export const PORTAL_FEEDBACK_MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const PORTAL_FEEDBACK_MAX_COMMENT_LENGTH = 4000;

export type PortalFeedbackCategory = 'bug' | 'improvement' | 'other';

export interface ValidatedPortalFeedback {
  submissionId: string;
  category: PortalFeedbackCategory;
  comment: string;
  screenshotContent: string;
  screenshotMimeType: 'image/jpeg' | 'image/png';
  screenshotExtension: 'jpg' | 'png';
  screenshotBytes: number;
  screenshotWidth: number;
  screenshotHeight: number;
  displaySurface: string;
  pageUrl: string;
  route: string;
  viewportWidth: number | null;
  viewportHeight: number | null;
  userAgent: string;
  submittedAt: string | null;
}

const clean = (value: unknown, maximum = Number.POSITIVE_INFINITY) =>
  String(value ?? '').trim().slice(0, maximum);

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character] || character));

const asPositiveInteger = (value: unknown, maximum: number) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > maximum) return null;
  return number;
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const validatePageUrl = (value: unknown) => {
  const pageUrl = clean(value, 2000);
  try {
    const parsed = new URL(pageUrl);
    return parsed.protocol === 'https:' && parsed.hostname === 'portal.bendigoflyingclub.com.au'
      ? parsed.toString()
      : '';
  } catch {
    return '';
  }
};

export const validatePortalFeedbackPayload = (
  value: unknown,
): { ok: true; value: ValidatedPortalFeedback } | { ok: false; error: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Feedback details are required.' };
  }
  const body = value as Record<string, unknown>;
  const submissionId = clean(body.submissionId, 64);
  if (!isUuid(submissionId)) return { ok: false, error: 'The feedback submission ID is invalid.' };

  const category = clean(body.category, 30) as PortalFeedbackCategory;
  if (!['bug', 'improvement', 'other'].includes(category)) {
    return { ok: false, error: 'Choose Bug, Improvement or Other.' };
  }

  const comment = clean(body.comment, PORTAL_FEEDBACK_MAX_COMMENT_LENGTH + 1);
  if (comment.length < 5) return { ok: false, error: 'Add at least 5 characters to the feedback comment.' };
  if (comment.length > PORTAL_FEEDBACK_MAX_COMMENT_LENGTH) {
    return { ok: false, error: `Keep the feedback comment under ${PORTAL_FEEDBACK_MAX_COMMENT_LENGTH} characters.` };
  }

  const dataUrl = clean(body.screenshotDataUrl, Math.ceil(PORTAL_FEEDBACK_MAX_SCREENSHOT_BYTES * 4 / 3) + 256);
  const screenshotMatch = /^data:image\/(jpeg|png);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!screenshotMatch) return { ok: false, error: 'Attach a valid JPEG or PNG screenshot.' };
  const screenshotContent = screenshotMatch[2].replace(/\s/g, '');
  let decodedScreenshot = '';
  try {
    decodedScreenshot = atob(screenshotContent);
  } catch {
    return { ok: false, error: 'The attached screenshot encoding is invalid.' };
  }
  const screenshotBytes = decodedScreenshot.length;
  if (screenshotBytes < 256) return { ok: false, error: 'The attached screenshot is empty or incomplete.' };
  if (screenshotBytes > PORTAL_FEEDBACK_MAX_SCREENSHOT_BYTES) {
    return { ok: false, error: 'The screenshot is over the 4 MB limit. Crop it and try again.' };
  }
  const declaredImageType = screenshotMatch[1].toLowerCase();
  const hasJpegSignature = decodedScreenshot.charCodeAt(0) === 0xff
    && decodedScreenshot.charCodeAt(1) === 0xd8
    && decodedScreenshot.charCodeAt(2) === 0xff;
  const hasPngSignature = decodedScreenshot.slice(0, 8) === '\x89PNG\r\n\x1a\n';
  if ((declaredImageType === 'jpeg' && !hasJpegSignature) || (declaredImageType === 'png' && !hasPngSignature)) {
    return { ok: false, error: 'The attachment does not match its declared screenshot type.' };
  }

  const screenshotWidth = asPositiveInteger(body.screenshotWidth, 12000);
  const screenshotHeight = asPositiveInteger(body.screenshotHeight, 12000);
  if (!screenshotWidth || !screenshotHeight) return { ok: false, error: 'The screenshot dimensions are invalid.' };

  const pageUrl = validatePageUrl(body.pageUrl);
  if (!pageUrl) return { ok: false, error: 'The portal page address is invalid.' };
  const route = clean(body.route, 1000) || new URL(pageUrl).pathname;
  const submittedAtValue = clean(body.submittedAt, 60);
  const submittedAt = submittedAtValue && !Number.isNaN(Date.parse(submittedAtValue))
    ? new Date(submittedAtValue).toISOString()
    : null;

  return {
    ok: true,
    value: {
      submissionId,
      category,
      comment,
      screenshotContent,
      screenshotMimeType: declaredImageType === 'png' ? 'image/png' : 'image/jpeg',
      screenshotExtension: declaredImageType === 'png' ? 'png' : 'jpg',
      screenshotBytes,
      screenshotWidth,
      screenshotHeight,
      displaySurface: clean(body.displaySurface, 40) || 'unknown',
      pageUrl,
      route,
      viewportWidth: asPositiveInteger(body.viewportWidth, 12000),
      viewportHeight: asPositiveInteger(body.viewportHeight, 12000),
      userAgent: clean(body.userAgent, 1000) || 'Unknown browser',
      submittedAt,
    },
  };
};

const categoryLabel = (category: PortalFeedbackCategory) => ({
  bug: 'Bug report',
  improvement: 'Improvement idea',
  other: 'Portal feedback',
}[category]);

const formatSydneyTime = (value: Date) => new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Sydney',
  dateStyle: 'full',
  timeStyle: 'short',
}).format(value);

export const buildPortalFeedbackEmail = ({
  feedback,
  reporterName,
  reporterEmail,
  receivedAt = new Date(),
}: {
  feedback: ValidatedPortalFeedback;
  reporterName: string;
  reporterEmail: string;
  receivedAt?: Date;
}) => {
  const label = categoryLabel(feedback.category);
  const routeLabel = clean(feedback.route, 100) || '/';
  const subjectRoute = routeLabel.length > 54 ? `${routeLabel.slice(0, 51)}...` : routeLabel;
  const subject = `[BFC Portal] ${label} — ${subjectRoute}`.replace(/[\r\n]+/g, ' ');
  const viewport = feedback.viewportWidth && feedback.viewportHeight
    ? `${feedback.viewportWidth} × ${feedback.viewportHeight}`
    : 'Not available';
  const attachmentSize = feedback.screenshotBytes < 1024 * 1024
    ? `${Math.max(1, Math.round(feedback.screenshotBytes / 1024))} KB`
    : `${(feedback.screenshotBytes / (1024 * 1024)).toFixed(1)} MB`;
  const accent = feedback.category === 'bug' ? '#dc2626' : feedback.category === 'improvement' ? '#7c3aed' : '#2563eb';

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.14);">
            <tr>
              <td style="background:linear-gradient(135deg,#07162f,#173f79);padding:30px;color:#ffffff;">
                <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#bfdbfe;font-weight:700;">Portal preview feedback</p>
                <h1 style="margin:0;font-size:27px;line-height:1.2;">${escapeHtml(label)}</h1>
                <p style="margin:12px 0 0;color:#dbeafe;font-size:14px;line-height:1.6;">Submitted by ${escapeHtml(reporterName || reporterEmail)} on ${escapeHtml(formatSydneyTime(receivedAt))}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 30px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border-left:5px solid ${accent};border-radius:12px;background:#f8fafc;">
                  <tr><td style="padding:20px 22px;white-space:pre-wrap;font-size:16px;line-height:1.65;color:#0f172a;">${escapeHtml(feedback.comment)}</td></tr>
                </table>
                <p style="margin:0 0 18px;">
                  <a href="${escapeHtml(feedback.pageUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;border-radius:12px;padding:13px 20px;">Open the reported portal page</a>
                </p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dbe3ee;border-radius:16px;overflow:hidden;border-collapse:separate;">
                  <tr><td style="padding:11px 15px;background:#f8fafc;color:#64748b;font-size:12px;width:132px;border-bottom:1px solid #e2e8f0;">Reporter</td><td style="padding:11px 15px;font-size:13px;border-bottom:1px solid #e2e8f0;">${escapeHtml(reporterName)} &lt;${escapeHtml(reporterEmail)}&gt;</td></tr>
                  <tr><td style="padding:11px 15px;background:#f8fafc;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Page</td><td style="padding:11px 15px;font-size:13px;border-bottom:1px solid #e2e8f0;word-break:break-all;">${escapeHtml(feedback.pageUrl)}</td></tr>
                  <tr><td style="padding:11px 15px;background:#f8fafc;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Screenshot</td><td style="padding:11px 15px;font-size:13px;border-bottom:1px solid #e2e8f0;">${feedback.screenshotWidth} × ${feedback.screenshotHeight} · ${escapeHtml(attachmentSize)} · ${escapeHtml(feedback.displaySurface)}</td></tr>
                  <tr><td style="padding:11px 15px;background:#f8fafc;color:#64748b;font-size:12px;border-bottom:1px solid #e2e8f0;">Viewport</td><td style="padding:11px 15px;font-size:13px;border-bottom:1px solid #e2e8f0;">${escapeHtml(viewport)}</td></tr>
                  <tr><td style="padding:11px 15px;background:#f8fafc;color:#64748b;font-size:12px;">Browser</td><td style="padding:11px 15px;font-size:12px;line-height:1.5;word-break:break-word;">${escapeHtml(feedback.userAgent)}</td></tr>
                </table>
                <p style="margin:18px 0 0;color:#64748b;font-size:12px;line-height:1.6;">The marked-up screenshot is attached. Submission reference: ${escapeHtml(feedback.submissionId)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html };
};
