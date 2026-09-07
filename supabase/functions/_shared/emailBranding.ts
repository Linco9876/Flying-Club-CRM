export interface PortalEmailBranding {
  clubName: string;
  logoUrl: string;
  portalUrl: string;
}

export const DEFAULT_PORTAL_EMAIL_BRANDING: PortalEmailBranding = {
  clubName: "Bendigo Flying Club",
  logoUrl:
    "https://kcfjnpngnouyvcuvfleu.supabase.co/storage/v1/object/public/org-logos/logo.png",
  portalUrl: "https://portal.bendigoflyingclub.com.au",
};

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character] || character));

const safeHttpsUrl = (value: unknown, fallback: string) => {
  try {
    const parsed = new URL(String(value ?? "").trim());
    return parsed.protocol === "https:" ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
};

const emailOptimisedLogoUrl = (value: unknown, fallback: string) => {
  const safeUrl = safeHttpsUrl(value, fallback);
  try {
    const parsed = new URL(safeUrl);
    if (
      parsed.hostname.endsWith(".supabase.co") &&
      parsed.pathname.includes("/storage/v1/object/public/")
    ) {
      parsed.pathname = parsed.pathname.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/",
      );
      parsed.search = "";
      // Give email clients a predictable canvas. `contain` preserves the whole
      // logo (including tall or unusually wide uploads) without cropping it.
      parsed.searchParams.set("width", "320");
      parsed.searchParams.set("height", "144");
      parsed.searchParams.set("resize", "contain");
      parsed.searchParams.set("quality", "85");
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
};

let cachedBranding: { value: PortalEmailBranding; expiresAt: number } | null =
  null;

const getEnvironmentValue = (name: string) => {
  try {
    return Deno.env.get(name) || "";
  } catch {
    return "";
  }
};

export const loadPortalEmailBranding = async (): Promise<
  PortalEmailBranding
> => {
  if (cachedBranding && cachedBranding.expiresAt > Date.now()) {
    return cachedBranding.value;
  }

  const portalUrl = safeHttpsUrl(
    getEnvironmentValue("SITE_URL"),
    DEFAULT_PORTAL_EMAIL_BRANDING.portalUrl,
  ).replace(/\/$/, "");
  const fallback = { ...DEFAULT_PORTAL_EMAIL_BRANDING, portalUrl };
  const supabaseUrl = getEnvironmentValue("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = getEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return fallback;

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/organisation_settings?select=club_name,logo_url&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    if (!response.ok) return fallback;
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    const value = {
      clubName: String(row?.club_name || fallback.clubName).trim() ||
        fallback.clubName,
      logoUrl: emailOptimisedLogoUrl(row?.logo_url, fallback.logoUrl),
      portalUrl,
    };
    cachedBranding = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
    return value;
  } catch {
    return fallback;
  }
};

export const brandPortalEmailHtml = async (
  html: string,
  brandingOverride?: Partial<PortalEmailBranding>,
) => {
  if (/data-bfc-email-logo=["']true["']/i.test(html)) return html;

  const loaded = brandingOverride
    ? { ...DEFAULT_PORTAL_EMAIL_BRANDING, ...brandingOverride }
    : await loadPortalEmailBranding();
  const branding = {
    clubName: String(loaded.clubName || DEFAULT_PORTAL_EMAIL_BRANDING.clubName)
      .trim() || DEFAULT_PORTAL_EMAIL_BRANDING.clubName,
    logoUrl: emailOptimisedLogoUrl(
      loaded.logoUrl,
      DEFAULT_PORTAL_EMAIL_BRANDING.logoUrl,
    ),
    portalUrl: safeHttpsUrl(
      loaded.portalUrl,
      DEFAULT_PORTAL_EMAIL_BRANDING.portalUrl,
    ),
  };
  const brandingSlot = /<table\s+data-bfc-email-branding-slot=["']true["'][^>]*>[\s\S]*?<\/table>/i;
  if (brandingSlot.test(html)) {
    const inCardLogo =
      `<table data-bfc-email-logo="true" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">
        <tr>
          <td align="left" valign="middle" width="148" style="width:148px;padding:0">
            <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:separate;background:#ffffff;border-radius:12px">
              <tr><td style="padding:7px 10px;line-height:0">
                <a href="${escapeHtml(branding.portalUrl)}" style="display:block;width:128px;height:58px;line-height:0;text-decoration:none" target="_blank">
                  <img src="${escapeHtml(branding.logoUrl)}" width="128" height="58" alt="${escapeHtml(branding.clubName)} logo" style="display:block;width:128px!important;max-width:128px!important;height:58px!important;max-height:58px!important;object-fit:contain;object-position:center;border:0;outline:none;text-decoration:none">
                </a>
              </td></tr>
            </table>
          </td>
          <td align="right" valign="middle" style="padding:0 0 0 16px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;line-height:1.3">${escapeHtml(branding.clubName)}</td>
        </tr>
      </table>`;
    return html.replace(brandingSlot, inCardLogo);
  }
  const logo =
    `<table data-bfc-email-logo="true" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:#ffffff;border-bottom:1px solid #dbe3ee">
      <tr>
        <td align="center" style="padding:12px 20px;line-height:0">
          <a href="${
      escapeHtml(branding.portalUrl)
    }" style="display:inline-block;width:160px;height:72px;line-height:0;text-decoration:none" target="_blank">
            <img src="${
      escapeHtml(branding.logoUrl)
    }" width="160" height="72" alt="${
      escapeHtml(branding.clubName)
    } logo" style="display:block;width:160px!important;max-width:160px!important;height:72px!important;max-height:72px!important;object-fit:contain;object-position:center;border:0;outline:none;text-decoration:none">
          </a>
        </td>
      </tr>
    </table>`;

  const bodyTag = /<body\b[^>]*>/i;
  if (bodyTag.test(html)) {
    return html.replace(bodyTag, (match) => `${match}${logo}`);
  }

  return `<!doctype html><html lang="en"><body style="margin:0;padding:0">${logo}${html}</body></html>`;
};
