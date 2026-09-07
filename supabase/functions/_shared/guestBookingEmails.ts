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
    "We would value your honest feedback. Leave a Google review:",
    reviewUrl,
    "",
    feedbackEmail ? `Prefer to contact us privately? Email ${feedbackEmail}.` : "",
    "",
    "No longer want post-flight feedback emails? Unsubscribe:",
    unsubscribeUrl,
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");

  const contextHtml = flightContext.map((item) => `<span style="display:inline-block;margin:3px 4px;padding:7px 11px;border:1px solid #dbeafe;border-radius:999px;background:#f8fbff;color:#334155;font-size:12px;font-weight:700;">${escapeHtml(item)}</span>`).join("");
  const testBanner = details.isTest
    ? `<tr><td style="padding:10px 20px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:800;text-align:center;letter-spacing:.3px;">EMAIL DESIGN PREVIEW — NO VISITOR WAS CONTACTED</td></tr>`
    : "";
  const privateFeedbackButton = feedbackEmail
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:12px;">
        <tr><td align="center"><a href="${escapeHtml(privateFeedbackUrl)}" style="display:inline-block;padding:11px 18px;color:#334155;text-decoration:none;font-size:14px;font-weight:800;border:1px solid #cbd5e1;border-radius:12px;background:#ffffff;">Send private feedback</a></td></tr>
      </table>`
    : "";
  const html = `<!doctype html>
<html lang="en">
  <head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
  <body style="margin:0;background:#edf3fa;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">We would value your honest feedback about your recent flight.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#edf3fa;padding:24px 10px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 16px 44px rgba(15,23,42,.14);">
          ${testBanner}
          <tr><td align="center" style="padding:34px 24px 30px;background:#071a37;background-image:linear-gradient(145deg,#071a37 0%,#0e4b8e 100%);color:#ffffff;">
            <p style="margin:0 0 14px;color:#bfdbfe;font-size:12px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;">${escapeHtml(businessName)}</p>
            <div aria-hidden="true" style="margin:0 0 12px;color:#fbbf24;font-size:24px;letter-spacing:5px;">★★★★★</div>
            <h1 style="margin:0;color:#ffffff;font-size:29px;line-height:1.2;">How was your flight?</h1>
            <p style="margin:10px auto 0;max-width:440px;color:#dbeafe;font-size:15px;line-height:1.55;">Your honest feedback helps future visitors know what to expect.</p>
          </td></tr>
          <tr><td style="padding:30px 26px 26px;">
            <p style="margin:0 0 12px;font-size:17px;line-height:1.6;color:#0f172a;">Hi ${escapeHtml(guestName)},</p>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#334155;">${escapeHtml(details.isTest ? "This is a preview of the post-flight email your visitors will receive." : `Thank you for flying with ${businessName}. We hope you enjoyed your experience.`)}</p>
            <div style="margin:0 0 22px;text-align:center;">${contextHtml}</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr><td align="center" style="border-radius:14px;background:#1a73e8;box-shadow:0 8px 18px rgba(26,115,232,.25);">
                <a href="${escapeHtml(reviewUrl)}" style="display:block;padding:16px 20px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;line-height:1.2;">Leave a Google review</a>
              </td></tr>
            </table>
            <p style="margin:12px 0 0;text-align:center;color:#64748b;font-size:12px;line-height:1.5;">Share an honest review — positive, negative or somewhere in between.</p>
            ${privateFeedbackButton}
            <div style="margin-top:26px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">This one-time request was sent because you agreed to receive a post-flight feedback email.</p>
              <p style="margin:7px 0 0;color:#94a3b8;font-size:11px;line-height:1.5;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">Unsubscribe from future post-flight feedback emails</a></p>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
};
