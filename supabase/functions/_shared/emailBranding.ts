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
      parsed.searchParams.set("width", "288");
      parsed.searchParams.set("height", "180");
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
  const logo =
    `<table data-bfc-email-logo="true" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:#ffffff;border-bottom:1px solid #dbe3ee">
      <tr>
        <td align="center" height="114" style="height:114px;padding:12px 20px;line-height:0">
          <a href="${
      escapeHtml(branding.portalUrl)
    }" style="display:inline-block;width:144px;height:90px;line-height:0;text-decoration:none" target="_blank">
            <img src="${
      escapeHtml(branding.logoUrl)
    }" width="144" height="90" alt="${
      escapeHtml(branding.clubName)
    } logo" style="display:block;width:144px!important;max-width:144px!important;height:90px!important;max-height:90px!important;object-fit:contain;object-position:center;border:0;outline:none;text-decoration:none">
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
