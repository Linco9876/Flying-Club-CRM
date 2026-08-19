const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DEFAULT_PUSH_ICON_URL =
  "https://kcfjnpngnouyvcuvfleu.supabase.co/storage/v1/object/public/org-logos/logo.png";
const ALLOWED_ROUTE_PREFIXES = [
  "/aircraft",
  "/billing",
  "/calendar",
  "/documents",
  "/duty",
  "/duty-clock",
  "/financial-dashboard",
  "/gift-vouchers",
  "/learning-centre",
  "/maintenance",
  "/membership",
  "/my-logbook",
  "/pilot-file",
  "/profile",
  "/reports",
  "/safety",
  "/settings",
  "/students",
  "/training",
];

export const cleanPushText = (value: unknown, maxLength: number) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength).trim();

export const safePushIconUrl = (value: unknown) => {
  const candidate = cleanPushText(value, 2000);
  if (!candidate) return DEFAULT_PUSH_ICON_URL;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.href : DEFAULT_PUSH_ICON_URL;
  } catch {
    return DEFAULT_PUSH_ICON_URL;
  }
};

export const safePushRoute = (value: unknown) => {
  const route = cleanPushText(value, 1200);
  if (!route.startsWith("/") || route.startsWith("//")) return null;
  try {
    const parsed = new URL(route, "https://portal.bendigoflyingclub.com.au");
    if (parsed.origin !== "https://portal.bendigoflyingclub.com.au") return null;
    const allowed = ALLOWED_ROUTE_PREFIXES.some((prefix) =>
      parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
    );
    return allowed ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
  } catch {
    return null;
  }
};

export type PushRouteNotification = {
  type?: string | null;
  user_id?: string | null;
  booking_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export const pushRouteForNotification = (notification: PushRouteNotification) => {
  const metadata = notification.metadata || {};
  const bookingId = cleanPushText(metadata.booking_id || notification.booking_id, 80);
  if (UUID_PATTERN.test(bookingId)) {
    return `/calendar?view=day&bookingId=${encodeURIComponent(bookingId)}`;
  }
  if (notification.type === "duty_break_reminder") {
    return "/duty-clock/app/";
  }
  if (notification.type === "duty_auto_started" || notification.type === "duty_auto_closed") {
    return "/duty";
  }
  const studentId = cleanPushText(metadata.student_id, 80);
  if (notification.type === "training_record" && UUID_PATTERN.test(studentId)) {
    return studentId === notification.user_id
      ? "/profile?tab=training"
      : `/students/${studentId}?tab=training`;
  }
  const licenceId = cleanPushText(metadata.licence_id, 80);
  if (notification.type === "licence_verification" && UUID_PATTERN.test(studentId) && UUID_PATTERN.test(licenceId)) {
    return `/students/${studentId}?tab=profile&action=review-licence&licenceId=${licenceId}`;
  }
  return safePushRoute(metadata.route) || "/";
};

export const shouldRevokePushSubscription = (statusCode: number | undefined) =>
  statusCode === 404 || statusCode === 410;

export const pushRetryDelaySeconds = (attemptNumber: number) =>
  Math.min(3600, Math.max(30, 30 * (2 ** Math.max(0, attemptNumber - 1))));
