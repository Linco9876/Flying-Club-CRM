export type GuestBookingEmailKind = "confirmation" | "booking_update" | "day_prior_reminder";

export interface GuestBookingEmailDetails {
  kind: GuestBookingEmailKind;
  guestName: string;
  startTime: string;
  endTime: string;
  status: string;
  aircraftLabel: string;
  instructorName: string;
  location: string;
  calendarUrl: string;
  contactEmail?: string;
  contactPhone?: string;
  previousStartTime?: string | null;
  previousEndTime?: string | null;
  businessName?: string;
}

export interface GuestReviewRequestEmailDetails {
  guestName: string;
  businessName: string;
  flightDate: string;
  aircraftLabel?: string;
  instructorName?: string;
  reviewUrl: string;
  privateFeedbackEmail: string;
  unsubscribeUrl: string;
  isTest?: boolean;
}

export interface BookingScheduleChangeRow {
  label: "Date" | "Time";
  before: string;
  after: string;
}

const DEFAULT_CONTACT_EMAIL = "bfc@bendigoflyingclub.com.au";
const DEFAULT_CONTACT_PHONE = "(03) 5443 8395";

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character] || character));

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Sydney",
  }).format(new Date(value));

const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Sydney",
  }).format(new Date(value));

const validInstant = (value: string | null | undefined) => {
  if (!value) return null;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? value : null;
};

const scheduleDateLabel = (startTime: string, endTime: string) => {
  const startDate = dateLabel(startTime);
  const endDate = dateLabel(endTime);
  return startDate === endDate ? startDate : `${startDate} - ${endDate}`;
};

const scheduleTimeLabel = (startTime: string, endTime: string) =>
  `${timeLabel(startTime)} - ${timeLabel(endTime)}`;

export const buildBookingScheduleChangeRows = ({
  previousStartTime,
  previousEndTime,
  startTime,
  endTime,
}: Pick<GuestBookingEmailDetails, "previousStartTime" | "previousEndTime" | "startTime" | "endTime">): BookingScheduleChangeRow[] => {
  const previousStart = validInstant(previousStartTime);
  const previousEnd = validInstant(previousEndTime);
  const currentStart = validInstant(startTime);
  const currentEnd = validInstant(endTime);
  if (!previousStart || !previousEnd || !currentStart || !currentEnd) return [];

  const previousDate = scheduleDateLabel(previousStart, previousEnd);
  const currentDate = scheduleDateLabel(currentStart, currentEnd);
  const previousTime = scheduleTimeLabel(previousStart, previousEnd);
  const currentTime = scheduleTimeLabel(currentStart, currentEnd);
  return [
    ...(previousDate === currentDate ? [] : [{ label: "Date" as const, before: previousDate, after: currentDate }]),
    ...(previousTime === currentTime ? [] : [{ label: "Time" as const, before: previousTime, after: currentTime }]),
  ];
};

const isPending = (status: string) => status.startsWith("pending_");

export const guestBookingEmailRetryDelaySeconds = (attempt: number) => {
  const delays = [60, 5 * 60, 15 * 60, 60 * 60, 4 * 60 * 60];
  return delays[Math.max(0, Math.min(delays.length - 1, attempt - 1))];
};

export const shouldSuppressGuestReminder = (
  confirmationSentAt: string | null | undefined,
  now = new Date(),
) => {
  if (!confirmationSentAt) return false;
  const confirmationTime = new Date(confirmationSentAt).getTime();
  if (!Number.isFinite(confirmationTime) || confirmationTime > now.getTime()) return false;
  return now.getTime() - confirmationTime < 12 * 60 * 60 * 1000;
};

export const buildGuestBookingEmail = (details: GuestBookingEmailDetails) => {
  const businessName = String(details.businessName || "").trim() || "Bendigo Flying Club";
  const reminder = details.kind === "day_prior_reminder";
  const bookingUpdate = details.kind === "booking_update";
  const pending = isPending(details.status);
  const date = dateLabel(details.startTime);
  const start = timeLabel(details.startTime);
  const end = timeLabel(details.endTime);
  const scheduleChanges = bookingUpdate ? buildBookingScheduleChangeRows(details) : [];
  const headline = reminder
    ? "Your flight is tomorrow"
    : bookingUpdate
    ? "Your booking has been updated"
    : pending
    ? "We received your booking request"
    : "Your flight is booked";
  const intro = reminder
    ? `This is a reminder of your ${businessName} booking tomorrow.`
    : bookingUpdate
    ? `The date or time of your ${businessName} booking has changed. The updated details are below.`
    : pending
    ? "Your booking is in the system and is waiting for final approval or supervision coverage."
    : `Your booking with ${businessName} is confirmed.`;
  const subject = reminder
    ? `Reminder: your ${businessName} flight is tomorrow at ${start}`
    : bookingUpdate
    ? `Updated: your ${businessName} flight is now ${date} at ${start}`
    : pending
    ? `We received your ${businessName} booking request`
    : `Your ${businessName} flight is booked`;
  const statusLabel = pending
    ? details.status === "pending_supervision" ? "Pending supervision" : "Pending approval"
    : "Confirmed";
  const requestedContactEmail = String(details.contactEmail || "").trim();
  const safeContactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedContactEmail)
    ? requestedContactEmail
    : DEFAULT_CONTACT_EMAIL;
  const requestedContactPhone = String(details.contactPhone || "").trim();
  const safeContactPhone = requestedContactPhone.replace(/\D/g, "").length >= 8
    ? requestedContactPhone
    : DEFAULT_CONTACT_PHONE;
  const localPhoneDigits = safeContactPhone.replace(/\D/g, "");
  const internationalPhone = localPhoneDigits.startsWith("0")
    ? `+61${localPhoneDigits.slice(1)}`
    : `+${localPhoneDigits}`;
  const contactSentence = `Need to make a change? Email ${safeContactEmail} or call ${safeContactPhone}.`;
  const contactHtml = `Need to make a change? Email <a href="mailto:${escapeHtml(safeContactEmail)}" style="color:#1d4ed8;font-weight:700;text-decoration:none;">${escapeHtml(safeContactEmail)}</a> or call <a href="tel:${escapeHtml(internationalPhone)}" style="color:#1d4ed8;font-weight:700;text-decoration:none;">${escapeHtml(safeContactPhone)}</a>.`;
  const rows = [
    ["Date", date],
    ["Time", `${start} – ${end}`],
    ["Aircraft", details.aircraftLabel || "To be advised"],
    ["Instructor", details.instructorName || "To be advised"],
    ["Location", details.location || businessName],
    ["Status", statusLabel],
  ];

  const textChangeSummary = scheduleChanges.length > 0
    ? [
      "What changed:",
      ...scheduleChanges.flatMap((change) => [
        `${change.label}:`,
        `  Was: ${change.before}`,
        `  Now: ${change.after}`,
      ]),
      "",
      "Updated booking details:",
      "",
    ]
    : [];

  const text = [
    `Hi ${details.guestName || "there"},`,
    "",
    intro,
    "",
    ...textChangeSummary,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `View or add the booking to your calendar: ${details.calendarUrl}`,
    "",
    contactSentence,
  ].join("\n");

  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:700;vertical-align:top;width:110px;">${escapeHtml(label)}</td>
      <td style="padding:10px 0;color:#0f172a;font-size:15px;font-weight:700;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`).join("");
  const htmlChangeSummary = scheduleChanges.length > 0
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border:1px solid #bfdbfe;border-radius:14px;background:#eff6ff;">
        <tr><td style="padding:18px;">
          <p style="margin:0 0 12px;color:#1e3a8a;font-size:14px;font-weight:800;">What changed</p>
          ${scheduleChanges.map((change) => `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #dbeafe;">
            <p style="margin:0 0 5px;color:#334155;font-size:13px;font-weight:800;">${escapeHtml(change.label)}</p>
            <p style="margin:0 0 3px;color:#64748b;font-size:13px;line-height:1.5;"><strong>Was:</strong> ${escapeHtml(change.before)}</p>
            <p style="margin:0;color:#0f172a;font-size:14px;line-height:1.5;"><strong>Now:</strong> ${escapeHtml(change.after)}</p>
          </div>`).join("")}
        </td></tr>
      </table>`
    : "";

  const html = `<!doctype html>
<html lang="en">
  <head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(`${headline}. ${date} at ${start}.`)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:24px 10px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 16px 40px rgba(15,23,42,.13);">
          <tr><td style="background:#06152f;background-image:linear-gradient(135deg,#06152f,#0d3b78);padding:28px;color:#ffffff;">
            <p style="margin:0 0 9px;font-size:12px;text-transform:uppercase;letter-spacing:1.8px;color:#bfdbfe;font-weight:800;">${escapeHtml(businessName)}</p>
            <h1 style="margin:0;font-size:28px;line-height:1.2;color:#ffffff;">${escapeHtml(headline)}</h1>
          </td></tr>
          <tr><td style="padding:28px;">
            <p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Hi ${escapeHtml(details.guestName || "there")},</p>
            <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.65;">${escapeHtml(intro)}</p>
            ${htmlChangeSummary}
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">${htmlRows}</table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;">
              <tr><td align="center" style="border-radius:13px;background:#2563eb;">
                <a href="${escapeHtml(details.calendarUrl)}" style="display:block;padding:14px 18px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;">View booking and add to calendar</a>
              </td></tr>
            </table>
            <p style="margin:20px 0 0;color:#64748b;font-size:13px;line-height:1.6;">${contactHtml}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html, headline };
};

const safeHttpsUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : "#";
  } catch {
    return "#";
  }
};

export const buildGuestReviewRequestEmail = (details: GuestReviewRequestEmailDetails) => {
  const businessName = String(details.businessName || "").trim() || "Your flying club";
  const guestName = String(details.guestName || "").trim() || "there";
  const reviewUrl = safeHttpsUrl(details.reviewUrl);
  const unsubscribeUrl = safeHttpsUrl(details.unsubscribeUrl);
  const feedbackEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.privateFeedbackEmail.trim())
    ? details.privateFeedbackEmail.trim().toLowerCase()
    : "";
  const flightDate = dateLabel(details.flightDate);
  const feedbackSubject = encodeURIComponent(`Private feedback about my flight with ${businessName}`);
  const privateFeedbackUrl = feedbackEmail
    ? `mailto:${feedbackEmail}?subject=${feedbackSubject}`
    : "#";
  const subject = `${details.isTest ? "Test: " : ""}How was your flight with ${businessName}?`;
  const flightContext = [
    flightDate,
    details.aircraftLabel ? `Aircraft: ${details.aircraftLabel}` : "",
    details.instructorName ? `Instructor: ${details.instructorName}` : "",
  ].filter(Boolean);
  const text = [
    `Hi ${guestName},`,
    "",
    details.isTest ? "This is a preview of the post-flight email your visitors will receive." : `Thank you for flying with ${businessName}. We hope you enjoyed your experience.`,
    "",
    ...flightContext,
    "",
    `We would love your honest feedback about your experience with ${businessName}.`,
    "Leave a Google review:",
    reviewUrl,
    "",
    feedbackEmail ? `Prefer to contact us privately? Email ${feedbackEmail}.` : "",
    "",
    "No longer want post-flight feedback emails? Unsubscribe:",
    unsubscribeUrl,
    "",
    `Thank you from the ${businessName} team.`,
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");

  const contextHtml = flightContext.map((item) => `<tr>
                <td align="center" style="padding:0 0 6px;">
                  <table role="presentation" align="center" cellspacing="0" cellpadding="0" style="border-collapse:separate;">
                    <tr><td align="center" style="padding:7px 11px;border:1px solid #dbeafe;border-radius:14px;background:#f8fbff;color:#334155;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;line-height:1.3;">${escapeHtml(item)}</td></tr>
                  </table>
                </td>
              </tr>`).join("");
  const testBanner = details.isTest
    ? `<tr><td style="padding:10px 20px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:800;text-align:center;letter-spacing:.3px;">EMAIL DESIGN PREVIEW — NO VISITOR WAS CONTACTED</td></tr>`
    : "";
  const privateFeedbackButton = feedbackEmail
    ? `<table data-review-action="private" role="presentation" align="center" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:440px;border-collapse:separate;">
        <tr><td height="12" style="height:12px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td align="center" valign="middle" height="50" style="height:50px;border:2px solid #315b88;border-radius:10px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:800;line-height:20px;"><a href="${escapeHtml(privateFeedbackUrl)}" role="button" aria-label="Send private feedback by email" style="display:block;color:#123c70;text-decoration:none;">&#9993;&nbsp;&nbsp;Send private feedback</a></td></tr>
      </table>`
    : "";
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light only">
    <meta name="x-apple-disable-message-reformatting">
    <style>@media only screen and (max-width:620px){.email-shell{padding:10px!important}.email-card{border-radius:16px!important}.brand-header{padding:16px!important}.content-pad{padding:28px 20px 24px!important}.feedback-title{font-size:30px!important}}</style>
  </head>
  <body style="margin:0;padding:0;background:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#0b2347;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">We would value your honest feedback about your recent flight.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="email-shell" style="width:100%;background:#eef3f8;padding:24px 10px;border-collapse:collapse;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="email-card" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #d5e0ec;border-radius:20px;overflow:hidden;box-shadow:0 12px 32px rgba(15,35,70,.12);border-collapse:separate;">
          ${testBanner}
          <tr><td class="brand-header" style="padding:20px 26px;background:#082a50;background-image:linear-gradient(135deg,#071f3d 0%,#0b4678 100%);color:#ffffff;">
            <table data-bfc-email-branding-slot="true" role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td></td></tr></table>
          </td></tr>
          <tr><td align="center" class="content-pad" style="padding:38px 38px 28px;background:#ffffff;">
            <h1 class="feedback-title" style="margin:0;color:#071f49;font-family:Arial,Helvetica,sans-serif;font-size:38px;font-weight:800;line-height:1.15;letter-spacing:-.6px;">We&rsquo;d love your feedback!</h1>
            <p style="margin:20px auto 0;max-width:520px;color:#1f3658;font-size:17px;line-height:1.6;">Hi ${escapeHtml(guestName)}, thank you for flying with ${escapeHtml(businessName)}. We hope you enjoyed your experience.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin:18px 0 14px;border-collapse:collapse;">${contextHtml}</table>
            <p style="margin:0 auto;max-width:520px;color:#1f3658;font-size:17px;line-height:1.6;">Would you consider sharing your honest feedback? It helps future visitors know what to expect.</p>
            <div aria-hidden="true" style="margin:20px 0 18px;color:#ffb317;font-size:34px;line-height:1;letter-spacing:5px;">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
            <table data-review-action="google" role="presentation" align="center" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:440px;border-collapse:separate;">
              <tr><td align="center" valign="middle" height="50" style="height:50px;border-radius:10px;background:#1769e0;background-image:linear-gradient(135deg,#1976f3 0%,#0b5bd3 100%);box-shadow:0 7px 16px rgba(23,105,224,.24);font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:800;line-height:21px;">
                <a href="${escapeHtml(reviewUrl)}" role="button" aria-label="Leave an honest Google review" style="display:block;color:#ffffff;text-decoration:none;">Leave a Google review</a>
              </td></tr>
            </table>
            ${privateFeedbackButton}
            <p style="margin:24px auto 0;max-width:470px;color:#526984;font-size:15px;line-height:1.6;">It only takes a minute, and your feedback helps others learn about ${escapeHtml(businessName)}.</p>
            <p style="margin:8px auto 0;max-width:470px;color:#71839a;font-size:13px;line-height:1.5;">Every experience is welcome&mdash;positive, negative or somewhere in between.</p>
            <div style="margin-top:28px;padding-top:22px;border-top:1px solid #dce5ef;text-align:center;">
              <p style="margin:0;color:#0b2d59;font-family:Georgia,'Times New Roman',serif;font-size:27px;font-style:italic;line-height:1.25;">Thank you!</p>
              <p style="margin:5px 0 0;color:#193c68;font-size:15px;font-weight:700;line-height:1.5;">The ${escapeHtml(businessName)} Team</p>
              <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">This one-time request was sent because you agreed to receive a post-flight feedback email.</p>
              <p style="margin:7px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">Unsubscribe from future post-flight feedback emails</a></p>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
};
