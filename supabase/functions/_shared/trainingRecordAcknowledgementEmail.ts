export interface TrainingRecordAcknowledgementEmailInput {
  studentName: string;
  instructorName: string;
  courseTitle: string;
  lessonTitle: string;
  lessonDate: string;
  acknowledgementUrl: string;
  isRevision?: boolean;
  clubName?: string;
}

export interface TrainingRecordAcknowledgementEmail {
  subject: string;
  html: string;
  text: string;
}

const singleLine = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ");

const escapeHtml = (value: unknown) =>
  singleLine(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character] || character));

const safeHttpsUrl = (value: unknown) => {
  try {
    const parsed = new URL(singleLine(value));
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
};

const firstName = (name: string) => singleLine(name).split(" ")[0] || "there";

export const renderTrainingRecordAcknowledgementEmail = ({
  studentName,
  instructorName,
  courseTitle,
  lessonTitle,
  lessonDate,
  acknowledgementUrl,
  isRevision = false,
  clubName = "Bendigo Flying Club",
}: TrainingRecordAcknowledgementEmailInput): TrainingRecordAcknowledgementEmail => {
  const safeUrl = safeHttpsUrl(acknowledgementUrl);
  if (!safeUrl) throw new Error("A secure acknowledgement URL is required");

  const greetingName = firstName(studentName);
  const action = isRevision ? "updated" : "completed";
  const subject = isRevision
    ? `Your ${singleLine(lessonTitle) || "lesson"} record has been updated`
    : `Your ${singleLine(lessonTitle) || "lesson"} record is ready to review`;
  const preheader = `Review and approve your ${singleLine(lessonTitle) || "lesson"} record without signing in.`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <style>
      @media only screen and (max-width:620px){.card{border-radius:0!important}.content{padding:24px 18px!important}.button{display:block!important;text-align:center!important}}
      @media (prefers-color-scheme:dark){body,.page{background:#07111f!important}.card{background:#111827!important;border-color:#334155!important}.copy,.detail{color:#dbeafe!important}.muted{color:#94a3b8!important}}
    </style>
  </head>
  <body style="margin:0;background:#eaf0f7;font-family:Arial,sans-serif;color:#111827">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
    <table class="page" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eaf0f7;padding:28px 12px">
      <tr><td align="center">
        <table class="card" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dbe3ee;border-radius:18px;overflow:hidden">
          <tr><td style="background:#07111f;padding:22px 26px;color:#ffffff">
            <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#bfdbfe">${escapeHtml(clubName)}</div>
            <div style="margin-top:6px;font-size:24px;font-weight:700">Lesson record ready</div>
          </td></tr>
          <tr><td class="content" style="padding:30px 28px">
            <p class="copy" style="margin:0 0 16px;font-size:18px;line-height:1.5">Hi ${escapeHtml(greetingName)},</p>
            <p class="copy" style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#334155">${escapeHtml(instructorName || "Your instructor")} has ${action} your lesson record. Please read it and approve it if it accurately reflects your lesson.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;background:#f1f5f9;border-radius:12px">
              <tr><td class="detail" style="padding:16px 18px;color:#334155;font-size:14px;line-height:1.7">
                <strong style="color:#0f172a">${escapeHtml(lessonTitle || "Lesson record")}</strong><br>
                ${escapeHtml(courseTitle || "Flight training")}<br>
                ${escapeHtml(lessonDate)}
              </td></tr>
            </table>
            <p style="margin:0 0 24px"><a class="button" href="${escapeHtml(safeUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:13px 20px;border-radius:10px;text-decoration:none;font-weight:700">Review and approve lesson</a></p>
            <p class="muted" style="margin:0;font-size:13px;line-height:1.6;color:#64748b">No portal login is required when you use this private link. It expires in 14 days and stops working if the record is changed or approved. Do not forward it to anyone else.</p>
            <p class="muted" style="margin:18px 0 0;font-size:11px;line-height:1.5;color:#94a3b8;word-break:break-all">If the button does not work, open: ${escapeHtml(safeUrl)}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    `Hi ${greetingName},`,
    "",
    `${instructorName || "Your instructor"} has ${action} your lesson record.`,
    `${lessonTitle || "Lesson record"} — ${courseTitle || "Flight training"} — ${lessonDate}`,
    "",
    `Review and approve it: ${safeUrl}`,
    "",
    "No portal login is required. This private link expires in 14 days and stops working if the record is changed or approved. Do not forward it.",
  ].join("\n");

  return { subject, html, text };
};
