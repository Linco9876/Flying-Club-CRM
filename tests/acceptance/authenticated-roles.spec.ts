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

    await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Bendigo Flying Club" }),
    ).toBeVisible();
    const profileReminder = page.getByRole("button", {
      name: "Later",
      exact: true,
    });
    if (await profileReminder.isVisible()) await profileReminder.click();

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
    await mobileMenu
      .getByRole("button", { name: "Close navigation menu" })
      .evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
    await expect(mobileMenu).toBeHidden();

    await page.locator('header button[aria-label="Calendar"]').click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();

    await page.locator('header button[aria-label="Profile"]').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();

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
    await expect(page.locator("#account-personal-details")).toBeFocused();

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
      await expect(page.locator("#account-aviation-credentials")).toBeFocused();
    }

    const horizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(horizontalOverflow).toBe(false);
    expect(pageErrors).toEqual([]);
  });
}
