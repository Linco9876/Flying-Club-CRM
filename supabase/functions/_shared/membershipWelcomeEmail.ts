export type MembershipWelcomeVariant = "automatic" | "manual";

export interface MembershipWelcomeBrand {
  clubName?: string | null;
  contactEmail?: string | null;
  logoUrl?: string | null;
  portalUrl?: string | null;
}

export interface MembershipWelcomeEmailInput {
  name: string;
  membershipClass: string;
  variant: MembershipWelcomeVariant;
  brand?: MembershipWelcomeBrand;
  policy?: {
    renewalDateLabel?: string | null;
    nonPaymentGraceDays?: number | null;
    renewalInvoiceLeadDays?: number | null;
  };
  review?: boolean;
}

export interface MembershipWelcomeEmail {
  subject: string;
  html: string;
  text: string;
}

const DEFAULT_CLUB_NAME = "Bendigo Flying Club";
const DEFAULT_PORTAL_URL = "https://portal.bendigoflyingclub.com.au";

const singleLine = (value: unknown) =>
  String(value ?? "").trim().replace(/\s+/g, " ");

const escapeHtml = (value: unknown) =>
  singleLine(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character] || character));

const safeUrl = (value: unknown, fallback = "") => {
  try {
    const parsed = new URL(singleLine(value));
    return parsed.protocol === "https:" ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
};

const safeEmail = (value: unknown) => {
  const email = singleLine(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
};

const initialsFor = (clubName: string) => {
  const initials = clubName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");
  return initials || "BFC";
};

const paymentCopy = (
  variant: MembershipWelcomeVariant,
  policy: MembershipWelcomeEmailInput["policy"] = {},
) => {
  const renewalDateLabel = singleLine(policy?.renewalDateLabel) || "1 July";
  const graceDays = Math.max(1, Number(policy?.nonPaymentGraceDays || 60));
  const invoiceLeadDays = Math.max(
    0,
    Number(policy?.renewalInvoiceLeadDays ?? 30),
  );
  return (
  variant === "automatic"
    ? {
      badge: "Automatic annual payment",
      intro: "You chose automatic payment for your membership.",
      steps: [
        {
          title: "Your first membership payment",
          body:
            "Your saved payment method will be used for your initial prorated membership invoice.",
        },
        {
          title: "Future renewals",
          body:
            `From the next financial year, payment will be attempted automatically on ${renewalDateLabel}.`,
        },
        {
          title: "If a renewal payment is unsuccessful",
          body:
            `You will have ${graceDays} days to pay. Aircraft self-booking is unavailable while the fee is unpaid, and membership ceases if it is still unpaid after ${graceDays} days.`,
        },
      ],
      text: [
        "You chose automatic annual payment.",
        "Your saved payment method will be used for your initial prorated membership invoice.",
        `From the next financial year, payment will be attempted automatically on ${renewalDateLabel}.`,
        `If a renewal payment is unsuccessful, you will have ${graceDays} days to pay. Aircraft self-booking is unavailable while the fee is unpaid, and membership ceases if it is still unpaid after ${graceDays} days.`,
      ].join("\n"),
    }
    : {
      badge: "Annual invoice",
      intro: "You chose to pay your membership manually by invoice.",
      steps: [
        {
          title: "Your first membership payment",
          body:
            "Your initial prorated membership invoice will be issued through Xero.",
        },
        {
          title: "Future renewals",
          body:
            `A renewal invoice will be raised ${invoiceLeadDays} days before the next financial year.`,
        },
        {
          title: "If an invoice remains unpaid",
          body:
            `Available Xero-verified prepaid credit may be applied first. Aircraft self-booking is unavailable while the fee is unpaid, and membership ceases after the ${graceDays}-day non-payment period.`,
        },
      ],
      text: [
        "You chose annual invoice payment.",
        "Your initial prorated membership invoice will be issued through Xero.",
        `A renewal invoice will be raised ${invoiceLeadDays} days before the next financial year.`,
        `If an invoice remains unpaid, available Xero-verified prepaid credit may be applied first. Aircraft self-booking is unavailable while the fee is unpaid, and membership ceases after the ${graceDays}-day non-payment period.`,
      ].join("\n"),
    }
  );
};

export const renderMembershipWelcomeEmail = ({
  name,
  membershipClass,
  variant,
  brand = {},
  policy = {},
  review = false,
}: MembershipWelcomeEmailInput): MembershipWelcomeEmail => {
  const firstName = singleLine(name).split(" ")[0] || "there";
  const className = singleLine(membershipClass) || "Club";
  const clubName = singleLine(brand.clubName) || DEFAULT_CLUB_NAME;
  const portalUrl = safeUrl(brand.portalUrl, DEFAULT_PORTAL_URL).replace(
    /\/$/,
    "",
  );
  const logoUrl = safeUrl(brand.logoUrl);
  const contactEmail = safeEmail(brand.contactEmail);
  const payment = paymentCopy(variant, policy);
  const variantName = variant === "automatic"
    ? "Automatic renewal"
    : "Annual invoice";
  const subject = review
    ? `[REVIEW - ${variantName}] Welcome to ${clubName}`
    : `Welcome to ${clubName}, ${firstName}`;
  const preheader =
    `Your ${className} membership has commenced. Your member portal is ready.`;
  const escapedClubName = escapeHtml(clubName);
  const escapedFirstName = escapeHtml(firstName);
  const escapedClassName = escapeHtml(className);
  const escapedPortalUrl = escapeHtml(portalUrl);
  const reviewBanner = review
    ? `<tr>
        <td class="review-banner" style="padding:14px 18px;background:#fff7ed;border:1px solid #fdba74;border-radius:12px;color:#9a3412;font-size:13px;line-height:1.5;">
          <strong>Review copy:</strong> This is the ${
      escapeHtml(variantName.toLowerCase())
    } version. No membership record has been changed.
        </td>
      </tr>
      <tr><td height="18" style="font-size:0;line-height:0;">&nbsp;</td></tr>`
    : "";
  const logo = logoUrl
    ? `<img src="${
      escapeHtml(logoUrl)
    }" width="48" height="48" alt="${escapedClubName} logo" style="display:block;width:48px;height:48px;max-width:48px;border:0;border-radius:12px;object-fit:contain;background:#ffffff;">`
    : `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td width="48" height="48" align="center" style="width:48px;height:48px;border-radius:12px;background:#ffffff;color:#0b2f5b;font-size:15px;font-weight:800;letter-spacing:.5px;">${
      escapeHtml(initialsFor(clubName))
    }</td></tr></table>`;
  const contactLine = contactEmail
    ? `Need a hand? Reply to this email or contact <a href="mailto:${
      escapeHtml(contactEmail)
    }" style="color:#bfdbfe;text-decoration:underline;">${
      escapeHtml(contactEmail)
    }</a>.`
    : "Need a hand? Reply to this email and the club team will help.";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(subject)}</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    @media only screen and (max-width: 620px) {
      .email-shell { width: 100% !important; }
      .email-gutter { padding-left: 14px !important; padding-right: 14px !important; }
      .hero { padding: 24px 22px 26px !important; }
      .content { padding: 24px 20px !important; }
      .hero-title { font-size: 30px !important; line-height: 1.12 !important; }
      .feature-column { display: block !important; width: 100% !important; padding: 0 0 10px !important; }
      .portal-button { display: block !important; }
    }
    @media (prefers-color-scheme: dark) {
      .email-bg { background-color: #07111f !important; }
      .email-card, .content { background-color: #111c2e !important; }
      .body-copy, .body-copy p, .body-copy h2, .body-copy h3 { color: #f1f5f9 !important; }
      .muted-copy { color: #cbd5e1 !important; }
      .membership-card, .feature-card { background-color: #17243a !important; border-color: #334155 !important; }
      .payment-card { background-color: #10294a !important; border-color: #2563eb !important; }
      .payment-step { border-color: #334155 !important; }
      .note-card { background-color: #2a2516 !important; border-color: #a16207 !important; color: #fde68a !important; }
      .footer-copy { color: #94a3b8 !important; }
      .review-banner { background-color: #431407 !important; border-color: #c2410c !important; color: #fed7aa !important; }
    }
    [data-ogsc] .email-bg { background-color: #07111f !important; }
    [data-ogsc] .email-card, [data-ogsc] .content { background-color: #111c2e !important; }
    [data-ogsc] .body-copy, [data-ogsc] .body-copy p, [data-ogsc] .body-copy h2, [data-ogsc] .body-copy h3 { color: #f1f5f9 !important; }
    [data-ogsc] .muted-copy { color: #cbd5e1 !important; }
    [data-ogsc] .membership-card, [data-ogsc] .feature-card { background-color: #17243a !important; border-color: #334155 !important; }
    [data-ogsc] .payment-card { background-color: #10294a !important; border-color: #2563eb !important; }
    [data-ogsc] .note-card { background-color: #2a2516 !important; border-color: #a16207 !important; color: #fde68a !important; }
  </style>
</head>
<body class="email-bg" style="margin:0;padding:0;background:#eef3f8;color:#172033;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${
    escapeHtml(preheader)
  }&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="email-bg" style="width:100%;background:#eef3f8;">
    <tr>
      <td align="center" class="email-gutter" style="padding:30px 16px;">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" class="email-shell email-card" style="width:640px;max-width:640px;background:#ffffff;border-radius:20px;box-shadow:0 12px 34px rgba(15,23,42,.10);overflow:hidden;">
          <tr>
            <td class="hero" style="padding:28px 34px 32px;background:#092f5e;background-image:linear-gradient(135deg,#071b33 0%,#0c427f 100%);color:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="60" valign="middle">${logo}</td>
                  <td valign="middle" style="padding-left:12px;">
                    <p style="margin:0;color:#bfdbfe;font-size:12px;font-weight:700;line-height:1.4;letter-spacing:1.2px;text-transform:uppercase;">${escapedClubName}</p>
                    <p style="margin:3px 0 0;color:#ffffff;font-size:14px;line-height:1.4;">Member welcome</p>
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 7px;color:#93c5fd;font-size:13px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;">Membership confirmed</p>
              <h1 class="hero-title" style="margin:0;color:#ffffff;font-size:36px;line-height:1.12;letter-spacing:-.7px;font-weight:800;">Welcome aboard, ${escapedFirstName}</h1>
              <p style="margin:14px 0 0;max-width:510px;color:#dbeafe;font-size:17px;line-height:1.55;">Your membership has commenced. Your portal is ready whenever you are.</p>
            </td>
          </tr>
          <tr>
            <td class="content body-copy" style="padding:30px 34px 34px;background:#ffffff;color:#172033;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${reviewBanner}
                <tr>
                  <td class="membership-card" style="padding:18px 20px;background:#f8fafc;border:1px solid #dbe4ee;border-radius:14px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td valign="middle">
                          <p class="muted-copy" style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;">Your club membership</p>
                          <p style="margin:0;color:#0f172a;font-size:20px;font-weight:800;line-height:1.35;">${escapedClassName}</p>
                        </td>
                        <td width="98" align="right" valign="middle">
                          <span style="display:inline-block;padding:7px 11px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:800;">Current</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td height="24" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td>
                    <h2 style="margin:0;color:#0f172a;font-size:22px;line-height:1.3;">Everything you need, in one place</h2>
                    <p class="muted-copy" style="margin:8px 0 18px;color:#475569;font-size:15px;line-height:1.65;">Use the member portal to manage your flying and club information.</p>
                  </td>
                </tr>
                <tr>
                  <td>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td width="50%" valign="top" class="feature-column" style="padding:0 6px 12px 0;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="feature-card" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                            <tr><td style="padding:15px 16px;"><p style="margin:0 0 5px;color:#0f172a;font-size:15px;font-weight:800;">Aircraft calendar</p><p class="muted-copy" style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">See availability and make eligible bookings.</p></td></tr>
                          </table>
                        </td>
                        <td width="50%" valign="top" class="feature-column" style="padding:0 0 12px 6px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="feature-card" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                            <tr><td style="padding:15px 16px;"><p style="margin:0 0 5px;color:#0f172a;font-size:15px;font-weight:800;">Profile and RAAus</p><p class="muted-copy" style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">Keep your personal and RAAus details current.</p></td></tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" valign="top" class="feature-column" style="padding:0 6px 12px 0;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="feature-card" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                            <tr><td style="padding:15px 16px;"><p style="margin:0 0 5px;color:#0f172a;font-size:15px;font-weight:800;">Flying records</p><p class="muted-copy" style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">Review flights, training and your logbook.</p></td></tr>
                          </table>
                        </td>
                        <td width="50%" valign="top" class="feature-column" style="padding:0 0 12px 6px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="feature-card" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                            <tr><td style="padding:15px 16px;"><p style="margin:0 0 5px;color:#0f172a;font-size:15px;font-weight:800;">Membership and billing</p><p class="muted-copy" style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">See membership, invoice and payment status.</p></td></tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:10px 0 30px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
                      <tr>
                        <td align="center" bgcolor="#1d4ed8" style="border-radius:11px;background:#1d4ed8;">
                          <a href="${escapedPortalUrl}" class="portal-button" style="display:inline-block;padding:14px 24px;color:#ffffff;font-size:15px;font-weight:800;line-height:1;text-decoration:none;border:1px solid #1d4ed8;border-radius:11px;">Open your member portal&nbsp;&nbsp;&rarr;</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td class="payment-card" style="padding:22px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:15px;">
                    <span style="display:inline-block;padding:6px 9px;border-radius:999px;background:#dbeafe;color:#1e40af;font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;">${
    escapeHtml(payment.badge)
  }</span>
                    <h2 style="margin:13px 0 6px;color:#0f172a;font-size:20px;line-height:1.3;">How your membership payments work</h2>
                    <p class="muted-copy" style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6;">${
    escapeHtml(payment.intro)
  }</p>
                    ${
    payment.steps.map((step, index) =>
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="payment-step" style="${
        index ? "border-top:1px solid #cbd5e1;" : ""
      }">
                      <tr>
                        <td width="34" valign="top" style="padding:${
        index ? "14px" : "2px"
      } 10px ${index === payment.steps.length - 1 ? "0" : "14px"} 0;">
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td width="26" height="26" align="center" style="width:26px;height:26px;border-radius:999px;background:#1d4ed8;color:#ffffff;font-size:12px;font-weight:800;">${
        index + 1
      }</td></tr></table>
                        </td>
                        <td valign="top" style="padding:${
        index ? "14px" : "2px"
      } 0 ${index === payment.steps.length - 1 ? "0" : "14px"};">
                          <p style="margin:0 0 3px;color:#0f172a;font-size:14px;font-weight:800;line-height:1.45;">${
        escapeHtml(step.title)
      }</p>
                          <p class="muted-copy" style="margin:0;color:#475569;font-size:13px;line-height:1.55;">${
        escapeHtml(step.body)
      }</p>
                        </td>
                      </tr>
                    </table>`
    ).join("")
  }
                  </td>
                </tr>
                <tr><td height="18" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td class="note-card" style="padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;color:#854d0e;font-size:13px;line-height:1.55;">
                    <strong>One important distinction:</strong> ${escapedClubName} membership and RAAus membership are separate. Please keep your RAAus details current in your portal profile.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;background:#071b33;color:#cbd5e1;">
              <p style="margin:0 0 8px;color:#ffffff;font-size:15px;font-weight:800;">Blue skies,<br>${escapedClubName}</p>
              <p style="margin:0;color:#cbd5e1;font-size:12px;line-height:1.6;">${contactLine}</p>
            </td>
          </tr>
        </table>
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" class="email-shell" style="width:640px;max-width:640px;">
          <tr>
            <td align="center" class="footer-copy" style="padding:17px 20px 0;color:#64748b;font-size:11px;line-height:1.5;">
              This operational membership email was sent by ${escapedClubName}.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const reviewText = review
    ? `REVIEW COPY - ${variantName} version. No membership record has been changed.\n\n`
    : "";
  const contactText = contactEmail
    ? `Need help? Reply to this email or contact ${contactEmail}.`
    : "Need help? Reply to this email and the club team will assist.";
  const text = `${reviewText}WELCOME TO ${clubName.toUpperCase()}

Hi ${firstName},

Your ${className} membership has commenced. Welcome to ${clubName}.

YOUR MEMBER PORTAL

Use the portal to:
- see aircraft availability and make eligible bookings
- keep your profile and RAAus details current
- review flights, training and your logbook
- see membership, invoice and payment status

Open your member portal:
${portalUrl}

HOW YOUR MEMBERSHIP PAYMENTS WORK

${payment.text}

IMPORTANT

${clubName} membership and RAAus membership are separate. Please keep your RAAus details current in your portal profile.

${contactText}

Blue skies,
${clubName}`;

  return { subject, html, text };
};
