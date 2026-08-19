export type DeclarationRecipientType = "student" | "guardian";

export interface DeclarationSigningEmailInput {
  recipientType: DeclarationRecipientType;
  recipientName?: string;
  studentName: string;
  courseTitle: string;
  declarationTitle?: string;
  declarationVersion?: number;
  signingUrl: string;
  clubName?: string;
}

export interface DeclarationSigningEmail {
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

export const renderDeclarationSigningEmail = ({
  recipientType,
  recipientName,
  studentName,
  courseTitle,
  declarationTitle,
  declarationVersion = 1,
  signingUrl,
  clubName = "Bendigo Flying Club",
}: DeclarationSigningEmailInput): DeclarationSigningEmail => {
  const safeUrl = safeHttpsUrl(signingUrl);
  if (!safeUrl) throw new Error("A secure declaration signing URL is required");

  const isGuardian = recipientType === "guardian";
  const safeStudentName = singleLine(studentName) || "the student";
  const safeCourseTitle = singleLine(courseTitle) || "Flight training";
  const safeDeclarationTitle = singleLine(declarationTitle) ||
    (isGuardian ? "Parent or guardian flying declaration" : "Flying declaration");
  const greetingName = firstName(recipientName || (isGuardian ? "Parent or guardian" : safeStudentName));
  const version = Number.isFinite(declarationVersion) && declarationVersion > 0
    ? Math.floor(declarationVersion)
    : 1;
  const subject = isGuardian
    ? `Parent or guardian declaration ready for ${safeStudentName}`
    : `Your ${safeCourseTitle} flying declaration is ready to sign`;
  const preheader = isGuardian
    ? `Review and sign the flying declaration for ${safeStudentName}. No portal login is required.`
    : `Review and sign your ${safeCourseTitle} flying declaration. No portal login is required.`;
  const heading = isGuardian
    ? "Parent or guardian signature required"
    : "Your flying declaration is ready";
  const introduction = isGuardian
    ? `Please review and sign this declaration for ${safeStudentName}. It forms part of their ${safeCourseTitle} training record.`
    : `Please review and sign this declaration before continuing your ${safeCourseTitle} training.`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <style>
      body{margin:0!important;padding:0!important;width:100%!important}
      table{border-collapse:separate;border-spacing:0}
      img{border:0;display:block;line-height:100%}
      a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
      .cta-button:hover{background:#1e40af!important}
      @media only screen and (max-width:620px){.page{padding:0!important}.card{border-radius:0!important;border-left:0!important;border-right:0!important}.hero{padding:25px 20px!important}.content{padding:25px 18px!important}.cta-button{padding:16px 14px!important}.detail-cell{padding:16px!important}}
      @media (prefers-color-scheme:dark){body,.page{background:#07111f!important}.card,.content{background:#111827!important;border-color:#334155!important}.copy,.detail-value{color:#e2e8f0!important}.muted{color:#a8b5c7!important}.detail-card{background:#172033!important;border-color:#334155!important}.security-card{background:#172033!important;border-color:#6b5a2d!important}.security-copy{color:#f6dd9b!important}.detail-label{color:#93c5fd!important}.footer{color:#94a3b8!important}.cta-button{color:#ffffff!important}}
    </style>
  </head>
  <body style="margin:0;padding:0;background:#eaf0f7;font-family:Arial,Helvetica,sans-serif;color:#111827">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
    <table class="page" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#eaf0f7;padding:28px 12px">
      <tr>
        <td align="center">
          <table class="card" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #dbe3ee;border-radius:18px;overflow:hidden">
            <tr>
              <td class="hero" style="background:#08213d;background-image:linear-gradient(135deg,#071b33 0%,#0c427f 100%);padding:28px 30px 30px;color:#ffffff">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td valign="middle">
                      <span style="display:inline-block;border:1px solid #5d82aa;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:800;letter-spacing:.12em;color:#dbeafe">BFC</span>
                    </td>
                    <td align="right" valign="middle" style="font-size:11px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#bfdbfe">Secure signing request</td>
                  </tr>
                </table>
                <div style="margin-top:25px;font-size:28px;line-height:1.18;font-weight:800;letter-spacing:-.02em">${escapeHtml(heading)}</div>
                <div style="margin-top:9px;font-size:14px;line-height:1.5;color:#c8ddf5">${escapeHtml(clubName)}</div>
              </td>
            </tr>
            <tr>
              <td class="content" style="background:#ffffff;padding:31px 30px 30px">
                <p class="copy" style="margin:0 0 15px;font-size:18px;line-height:1.5;color:#111827">Hi ${escapeHtml(greetingName)},</p>
                <p class="copy" style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#334155">${escapeHtml(introduction)}</p>

                <table class="detail-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 22px;background:#f4f7fb;border:1px solid #dbe5f0;border-radius:13px">
                  <tr>
                    <td class="detail-cell" style="padding:18px 20px">
                      <div class="detail-label" style="margin-bottom:7px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#2563eb">What you are signing</div>
                      <div class="detail-value" style="font-size:17px;line-height:1.4;font-weight:800;color:#0f172a">${escapeHtml(safeDeclarationTitle)}</div>
                      <div class="muted" style="margin-top:6px;font-size:14px;line-height:1.55;color:#64748b">${escapeHtml(safeCourseTitle)}${isGuardian ? ` &nbsp;&bull;&nbsp; ${escapeHtml(safeStudentName)}` : ""} &nbsp;&bull;&nbsp; Version ${version}</div>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 23px">
                  <tr>
                    <td width="24" valign="top" style="padding:2px 0 9px;color:#2563eb;font-size:16px">&#10003;</td>
                    <td class="copy" style="padding:0 0 9px;font-size:14px;line-height:1.5;color:#334155">Private, one-time signing link</td>
                  </tr>
                  <tr>
                    <td width="24" valign="top" style="padding:2px 0 9px;color:#2563eb;font-size:16px">&#10003;</td>
                    <td class="copy" style="padding:0 0 9px;font-size:14px;line-height:1.5;color:#334155">No portal login required</td>
                  </tr>
                  <tr>
                    <td width="24" valign="top" style="padding:2px 0 0;color:#2563eb;font-size:16px">&#10003;</td>
                    <td class="copy" style="padding:0;font-size:14px;line-height:1.5;color:#334155">Available for 14 days</td>
                  </tr>
                </table>

                <table class="cta-table" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 11px">
                  <tr>
                    <td align="center" bgcolor="#2563eb" style="background:#2563eb;border-radius:12px;mso-padding-alt:16px 22px;box-shadow:0 7px 18px rgba(37,99,235,.22)">
                      <a class="cta-button" role="button" href="${escapeHtml(safeUrl)}" style="display:block;padding:16px 22px;border-radius:12px;color:#ffffff;font-size:16px;line-height:1.25;font-weight:800;text-align:center;text-decoration:none">Review and sign declaration&nbsp;&nbsp;&rarr;</a>
                    </td>
                  </tr>
                </table>
                <p class="muted" style="margin:0 0 22px;font-size:12px;line-height:1.5;text-align:center;color:#64748b">Usually takes less than two minutes</p>

                <table class="security-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#fff8e7;border:1px solid #f4d789;border-radius:11px">
                  <tr>
                    <td class="security-copy" style="padding:14px 16px;font-size:13px;line-height:1.55;color:#664d03">
                      <strong>Keep this link private.</strong> It is intended only for ${isGuardian ? "the parent or guardian receiving this email" : "you"} and stops working after the declaration is signed. If you were not expecting it, contact ${escapeHtml(clubName)}.
                    </td>
                  </tr>
                </table>

                <p class="muted" style="margin:19px 0 0;font-size:11px;line-height:1.55;color:#8491a3;word-break:break-all">Button not working? Copy this secure link into your browser:<br><a href="${escapeHtml(safeUrl)}" style="color:#2563eb;text-decoration:underline">${escapeHtml(safeUrl)}</a></p>
              </td>
            </tr>
            <tr>
              <td class="footer" align="center" style="background:#f7f9fc;border-top:1px solid #e2e8f0;padding:17px 20px;font-size:11px;line-height:1.5;color:#748197">${escapeHtml(clubName)} &nbsp;&bull;&nbsp; Secure training records</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Hi ${greetingName},`,
    "",
    introduction,
    "",
    safeDeclarationTitle,
    `${safeCourseTitle}${isGuardian ? ` — ${safeStudentName}` : ""} — Version ${version}`,
    "",
    `Review and sign the declaration: ${safeUrl}`,
    "",
    "This is a private, one-time link. No portal login is required. It expires in 14 days and stops working after the declaration is signed. Do not forward it.",
    "",
    `If you were not expecting this request, contact ${singleLine(clubName)}.`,
  ].join("\n");

  return { subject, html, text };
};
