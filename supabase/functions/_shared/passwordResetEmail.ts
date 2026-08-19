import {
  brandPortalEmailHtml,
  type PortalEmailBranding,
} from "./emailBranding.ts";

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>'"]/g, (character) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character] || character);

export const buildPasswordResetEmail = async ({
  name,
  setupLink,
  brandingOverride,
}: {
  name: string;
  setupLink: string;
  brandingOverride?: Partial<PortalEmailBranding>;
}) => {
  const safeName = escapeHtml(name.trim() || "there");
  const safeLink = escapeHtml(setupLink);
  const subject = "Reset your Bendigo Flying Club portal password";

  const htmlContent = await brandPortalEmailHtml(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${subject}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { padding: 20px 10px !important; }
        .email-content { padding: 28px 22px !important; }
        .email-heading { font-size: 27px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#eef3f8;font-family:Arial,'Helvetica Neue',sans-serif;color:#172033;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Securely choose a new password for your Bendigo Flying Club portal account.
    </div>
    <table data-bfc-password-reset-email="true" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:#eef3f8;">
      <tr>
        <td class="email-shell" align="center" style="padding:36px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;border-collapse:separate;background:#ffffff;border:1px solid #dbe4ee;border-radius:20px;overflow:hidden;box-shadow:0 14px 34px rgba(15,35,64,.10);">
            <tr>
              <td height="7" style="height:7px;background:#1d4ed8;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td class="email-content" style="padding:40px 42px 34px;">
                <div style="display:inline-block;margin:0 0 18px;padding:7px 11px;border-radius:999px;background:#eaf2ff;color:#1d4ed8;font-size:11px;line-height:1;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;">
                  Secure account access
                </div>
                <h1 class="email-heading" style="margin:0 0 18px;color:#13233d;font-size:32px;line-height:1.18;letter-spacing:-.5px;">
                  Reset your password
                </h1>
                <p style="margin:0 0 12px;font-size:17px;line-height:1.6;color:#243b5a;">
                  Hello <strong>${safeName}</strong>,
                </p>
                <p style="margin:0 0 26px;font-size:15px;line-height:1.75;color:#52647a;">
                  We received a request to reset the password for your Bendigo Flying Club portal account. Choose a new password using the secure button below.
                </p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td align="center" style="border-radius:12px;background:#1d4ed8;box-shadow:0 7px 16px rgba(29,78,216,.22);">
                      <a href="${safeLink}" target="_blank" style="display:block;padding:16px 24px;color:#ffffff;text-decoration:none;font-size:16px;line-height:1.25;font-weight:800;text-align:center;border-radius:12px;">
                        Reset my password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:13px 0 28px;font-size:12px;line-height:1.55;text-align:center;color:#718096;">
                  This secure link can be used once. For your protection, open it promptly.
                </p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;background:#eff6ff;border:1px solid #cfe0ff;border-radius:13px;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <p style="margin:0 0 6px;font-size:14px;line-height:1.45;font-weight:800;color:#173b76;">
                        Why is there a confirmation step?
                      </p>
                      <p style="margin:0;font-size:13px;line-height:1.65;color:#456386;">
                        Your first click opens a confirmation page before the one-time link is used. This prevents automated email security scanners from accidentally consuming your reset link.
                      </p>
                    </td>
                  </tr>
                </table>

                <p style="margin:26px 0 6px;font-size:14px;line-height:1.55;font-weight:800;color:#263b56;">
                  Didn't request this?
                </p>
                <p style="margin:0 0 24px;font-size:13px;line-height:1.65;color:#64748b;">
                  Your password has not changed. You can safely ignore this email. If you are concerned about your account, contact Bendigo Flying Club.
                </p>

                <div style="height:1px;background:#e4eaf1;font-size:0;line-height:0;">&nbsp;</div>
                <p style="margin:22px 0 7px;font-size:12px;line-height:1.55;font-weight:700;color:#52647a;">
                  Button not working?
                </p>
                <p style="margin:0;font-size:11px;line-height:1.55;color:#718096;word-break:break-all;">
                  Copy and paste this secure address into your browser:<br>
                  <a href="${safeLink}" target="_blank" style="color:#1d4ed8;text-decoration:underline;">${safeLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e4eaf1;text-align:center;">
                <p style="margin:0;font-size:11px;line-height:1.6;color:#7b8797;">
                  This is an automated security email from the Bendigo Flying Club portal. Please do not reply.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    brandingOverride,
  );

  return { subject, htmlContent };
};
