import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

type PortalRole =
  "admin" | "cfi" | "senior_instructor" | "instructor" | "pilot" | "student";
type AcceptanceUser = {
  id: string;
  role: PortalRole;
  email: string;
  password: string;
};

const credentials = JSON.parse(
  process.env.ACCEPTANCE_USERS_JSON || "{}",
) as Record<string, AcceptanceUser>;
const roles: PortalRole[] = [
  "admin",
  "cfi",
  "senior_instructor",
  "instructor",
  "pilot",
  "student",
];
const staffRoles = new Set<PortalRole>([
  "admin",
  "cfi",
  "senior_instructor",
  "instructor",
]);
const expectFinancialDashboard =
  process.env.EXPECT_FINANCIAL_DASHBOARD === "true";
const recoveryApiHost = new URL(process.env.VITE_SUPABASE_URL || "https://invalid.local").host;

const isWebKitNavigationCancellation = (message: string) =>
  (message.includes(`/${recoveryApiHost}/rest/v1/`) ||
    message.includes(`/${recoveryApiHost}/functions/v1/`)) &&
  message.endsWith(" due to access control checks.");

const expectedMenuItems: Record<PortalRole, string[]> = {
  admin: [
    "Members",
    "Club Membership",
    "Aircraft",
    "Duty",
    "Maintenance",
    "Training Courses",
    ...(expectFinancialDashboard ? ["Financial Dashboard"] : []),
    "Settings",
  ],
  cfi: [
    "Members",
    "Club Membership",
    "Aircraft",
    "Duty",
    "Maintenance",
    "Training Courses",
    "Outstanding Records",
    "Safety",
    "Settings",
  ],
  senior_instructor: [
    "Club Membership",
    "Aircraft",
    "Duty",
    "Maintenance",
    "Training Courses",
    "Learning Centre",
    "Pilot File",
    "Settings",
  ],
  instructor: [
    "Members",
    "Club Membership",
    "Aircraft",
    "Duty",
    "Maintenance",
    "Training Courses",
    "Outstanding Records",
    "Safety",
    "Settings",
  ],
  pilot: [
    "Club Membership",
    "Aircraft",
    "Learning Centre",
    "Pilot File",
    "Documents",
    "My Logbook",
    "Settings",
  ],
  student: [
    "Club Membership",
    "Aircraft",
    "Learning Centre",
    "Pilot File",
    "Documents",
    "My Logbook",
    "Safety",
    "Settings",
  ],
};

// Split the route inventory across roles so the suite opens every phone-facing
// top-level workspace without reloading the same data-heavy screen for all six
// roles. Calendar, Home, Maintenance and Settings are exercised separately.
const mobileRouteSweep: Partial<Record<PortalRole, string[]>> = {
  admin: ["/students", "/membership", "/aircraft", "/duty", "/training"],
  cfi: ["/training/outstanding-records", "/safety"],
  senior_instructor: ["/learning-centre", "/pilot-file"],
  pilot: ["/documents", "/my-logbook"],
};

const decodeBase32 = (value: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/\s/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error(`Invalid base32 character: ${character}`);
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
};

const totp = (secret: string, now = Date.now()) => {
  const counter = Math.floor(now / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(message)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number =
    (((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)) %
    1_000_000;
  return number.toString().padStart(6, "0");
};

for (const role of roles) {
  test(`${role} can authenticate and access the correct mobile portal navigation`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(role === "admin" ? 240_000 : 120_000);
    const credentialKey = `${testInfo.project.name}:${role}`;
    const user = credentials[credentialKey];
    expect(
      user,
      `Missing acceptance credentials for ${credentialKey}`,
    ).toBeTruthy();

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/");
    await page.evaluate((userId) => {
      sessionStorage.setItem(
        `safety-login-warning-dismissed:${userId}`,
        "true",
      );
    }, user.id);
    await page.getByLabel("Email Address").fill(user.email);
    await page.locator("#password").fill(user.password);
    await page.getByRole("button", { name: "Sign In" }).click();

    if (staffRoles.has(role)) {
      await expect(
        page.getByRole("heading", { name: "Protect your staff account" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Set up authenticator" }).click();
      await page.getByText("Can’t scan it?").click();
      const secret = (await page.locator("details code").textContent())?.trim();
      expect(secret).toBeTruthy();
      await page
        .getByLabel("Six-digit authenticator code")
        .fill(totp(secret || ""));
      await page.getByRole("button", { name: "Verify and finish" }).click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Authenticator protection is now active" }),
      ).toBeHidden({
        timeout: 8_000,
      });
    }

    const primaryNavigation = page.getByRole("navigation", {
      name: "Primary navigation",
    });
    await expect(primaryNavigation).toBeVisible();
    await expect(page.getByRole("button", { name: "Open profile" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Bendigo Flying Club" }),
    ).toBeVisible();
    const profileReminder = page.getByRole("button", {
      name: "Later",
      exact: true,
    });
    if (await profileReminder.isVisible()) await profileReminder.click();
    await page.waitForLoadState("networkidle");

    await page
      .getByRole("button", { name: "Open navigation menu" })
      .click({ force: true });
    const mobileMenu = page.locator(".app-sidebar:visible");
    for (const item of expectedMenuItems[role]) {
      await expect(
        mobileMenu.getByRole("button", { name: item, exact: true }),
      ).toBeVisible();
    }
    if (role !== "admin" || !expectFinancialDashboard) {
      await expect(
        mobileMenu.getByRole("button", {
          name: "Financial Dashboard",
          exact: true,
        }),
      ).toHaveCount(0);
    }
    await expect(
      mobileMenu.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    await mobileMenu
      .getByRole("button", { name: "Close navigation menu" })
      .evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
    await expect(mobileMenu).toBeHidden();

    await primaryNavigation.getByRole("button", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(primaryNavigation).toBeVisible();
    await page.waitForLoadState("networkidle");

    await primaryNavigation.getByRole("button", { name: "Home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(primaryNavigation).toBeVisible();
    await page.waitForLoadState("networkidle");

    if (expectedMenuItems[role].includes("Maintenance")) {
      await page.goto("/maintenance");
      await expect(
        page.getByRole("heading", { name: "Maintenance Board" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Report Defect" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Open", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Fixed", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Deferred", exact: true }),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");

      await page.getByRole("button", { name: "Report Defect", exact: true }).click();
      const phoneSheet = page.getByRole("dialog", { name: "Report Defect" });
      await expect(phoneSheet).toBeVisible();
      expect(
        await phoneSheet.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            fillsWidth: bounds.width >= window.innerWidth - 1,
            isBottomAnchored: Math.abs(bounds.bottom - window.innerHeight) <= 1,
            remainsOnScreen: bounds.top >= 0,
          };
        }),
      ).toEqual({ fillsWidth: true, isBottomAnchored: true, remainsOnScreen: true });
      await phoneSheet.getByRole("button", { name: "Close defect report" }).click();
      await expect(phoneSheet).toBeHidden();
    }

    for (const route of mobileRouteSweep[role] || []) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`${route.replaceAll("/", "\\/")}$`));
      await expect(page.locator("main.portal-main")).toBeVisible();
      await expect(primaryNavigation).toBeVisible();
      await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
      await page.waitForLoadState("networkidle");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
        `${route} should not make the phone viewport scroll sideways`,
      ).toBe(true);
    }

    await page.goto("/settings?tab=account-info&focus=personal-details");
    await expect(
      page.locator(
        '[data-active-settings-section="account-info"][data-active-settings-focus="personal-details"]',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Opened Update My Info" }),
    ).toContainText("Personal Details");
    await expect(page.locator("#account-personal-details")).toBeVisible();
    await expect(page.locator("#account-personal-details")).toBeInViewport();
    await page.waitForLoadState("networkidle");

    if (role === "pilot") {
      await page.goto(
        "/settings?tab=account-info&accountTab=info&focus=aviation-credentials#account-aviation-credentials",
      );
      await expect(
        page.locator(
          '[data-active-settings-section="account-info"][data-active-settings-focus="aviation-credentials"]',
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("status").filter({ hasText: "Opened Update My Info" }),
      ).toContainText("Aviation Credentials");
      await expect(page.locator("#account-aviation-credentials")).toBeVisible();
      await expect(page.locator("#account-aviation-credentials")).toBeInViewport();
      await page.waitForLoadState("networkidle");
    }

    if (role === "admin") {
      const settingsSections = [
        ["organisation", "Organisation Settings"],
        ["portal", "Portal & UX"],
        ["resources", "Resources (Aircraft & Rooms)"],
        ["calendar", "Calendar Settings"],
        ["booking-rules", "Bookings & Rules"],
        ["duty-supervision", "Duty and supervision"],
        ["roster", "Roster & Availability"],
        ["maintenance", "Maintenance Settings"],
        ["safety", "Safety & Compliance"],
        ["training", "Training / Syllabus Settings"],
        ["billing", "Billing & Rates"],
        ["flight-log", "Flight Log Form Settings"],
        ["integrations", "Integrations"],
        ["notifications", "Notifications"],
        ["roles", "Roles & Permissions"],
        ["audit", "Audit & Data"],
      ] as const;

      for (const [section, heading] of settingsSections) {
        await page.goto(`/settings?tab=${section}`);
        const panel = page.locator(`[data-active-settings-section="${section}"]`);
        await expect(panel).toBeVisible();
        await expect(panel.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        const loadErrors = await panel
          .getByRole("alert")
          .filter({ hasText: "settings could not be loaded" })
          .allTextContents();
        const unexpectedLoadErrors = loadErrors.filter(message => !(
          section === "portal" &&
          message.includes("Kiosk access settings could not be loaded") &&
          message.includes("KIOSK_TOKEN_ENCRYPTION_KEY is not configured")
        ));
        expect(unexpectedLoadErrors).toEqual([]);
        expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
    }

    const horizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(horizontalOverflow).toBe(false);
    // WebKit reports cross-origin REST and Edge Function requests cancelled by
    // a subsequent page.goto as access-control page errors. The runner verifies
    // both CORS contracts before launching the browser, so retain every
    // genuine application exception while excluding that engine-specific noise.
    expect(pageErrors.filter(error => !isWebKitNavigationCancellation(error))).toEqual([]);
  });
}
