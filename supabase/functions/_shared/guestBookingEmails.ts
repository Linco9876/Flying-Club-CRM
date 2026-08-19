export type GuestBookingEmailKind = "confirmation" | "day_prior_reminder";

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
}

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
  const reminder = details.kind === "day_prior_reminder";
  const pending = isPending(details.status);
  const date = dateLabel(details.startTime);
  const start = timeLabel(details.startTime);
  const end = timeLabel(details.endTime);
  const headline = reminder
    ? "Your flight is tomorrow"
    : pending
    ? "We received your booking request"
    : "Your flight is booked";
  const intro = reminder
    ? "This is a reminder of your Bendigo Flying Club booking tomorrow."
    : pending
    ? "Your booking is in the system and is waiting for final approval or supervision coverage."
    : "Your booking with Bendigo Flying Club is confirmed.";
  const subject = reminder
    ? `Reminder: your Bendigo Flying Club flight is tomorrow at ${start}`
    : pending
    ? "We received your Bendigo Flying Club booking request"
    : "Your Bendigo Flying Club flight is booked";
  const statusLabel = pending
    ? details.status === "pending_supervision" ? "Pending supervision" : "Pending approval"
    : "Confirmed";
  const safeContactEmail = String(details.contactEmail || "").trim();
  const contactSentence = safeContactEmail
    ? `Need to make a change? Contact us at ${safeContactEmail}.`
    : "Need to make a change? Please contact Bendigo Flying Club.";
  const rows = [
    ["Date", date],
    ["Time", `${start} – ${end}`],
    ["Aircraft", details.aircraftLabel || "To be advised"],
    ["Instructor", details.instructorName || "To be advised"],
    ["Location", details.location || "Bendigo Flying Club"],
    ["Status", statusLabel],
  ];

  const text = [
    `Hi ${details.guestName || "there"},`,
    "",
    intro,
    "",
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

  const html = `<!doctype html>
<html lang="en">
  <head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(`${headline}. ${date} at ${start}.`)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:24px 10px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 16px 40px rgba(15,23,42,.13);">
          <tr><td style="background:#06152f;background-image:linear-gradient(135deg,#06152f,#0d3b78);padding:28px;color:#ffffff;">
            <p style="margin:0 0 9px;font-size:12px;text-transform:uppercase;letter-spacing:1.8px;color:#bfdbfe;font-weight:800;">Bendigo Flying Club</p>
            <h1 style="margin:0;font-size:28px;line-height:1.2;color:#ffffff;">${escapeHtml(headline)}</h1>
          </td></tr>
          <tr><td style="padding:28px;">
            <p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Hi ${escapeHtml(details.guestName || "there")},</p>
            <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.65;">${escapeHtml(intro)}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">${htmlRows}</table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;">
              <tr><td align="center" style="border-radius:13px;background:#2563eb;">
                <a href="${escapeHtml(details.calendarUrl)}" style="display:block;padding:14px 18px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;">View booking and add to calendar</a>
              </td></tr>
            </table>
            <p style="margin:20px 0 0;color:#64748b;font-size:13px;line-height:1.6;">${escapeHtml(contactSentence)}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html, headline };
};
