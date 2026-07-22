import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildCalendar,
  type CalendarEvent,
  googleCalendarUrl,
  outlookCalendarUrl,
} from "../_shared/calendar.ts";

const SITE_ORIGIN = (Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
const CALENDAR_NAME = "Bendigo Flying Club";
const CALENDAR_DOMAIN = "portal.bendigoflyingclub.com.au";
const LOCATION_FALLBACK = "Bendigo Flying Club";

const securityHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "private, max-age=60",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

const htmlHeaders = {
  ...securityHeaders,
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const errorPage = (message: string, status = 404) => new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calendar link</title></head><body style="margin:0;background:#f1f5f9;color:#0f172a;font:16px system-ui,sans-serif"><main style="max-width:560px;margin:10vh auto;padding:32px;background:#fff;border-radius:20px;box-shadow:0 15px 40px #0f172a1a"><h1 style="font-size:24px">Calendar link unavailable</h1><p style="line-height:1.6;color:#475569">${escapeHtml(message)}</p></main></body></html>`, {
  status,
  headers: htmlHeaders,
});

// Supabase's gateway converts non-2xx HTML responses to text/plain. Email links are
// browser destinations, so keep the friendly page renderable and carry the semantic
// status in a private response header. Subscription feeds retain real HTTP errors.
const eventErrorPage = (message: string, semanticStatus = 404) => {
  const response = errorPage(message, 200);
  response.headers.set("X-Calendar-Link-Status", String(semanticStatus));
  return response;
};

const calendarResponse = (calendar: string, filename: string) => new Response(calendar, {
  headers: {
    ...securityHeaders,
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `inline; filename="${filename}"`,
  },
});

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" },
});

const labelStatus = (status: string, deletedAt?: string | null) => {
  if (deletedAt || status === "cancelled") return "Cancelled";
  if (status === "pending_approval") return "Pending approval";
  if (status === "pending_supervision") return "Pending supervision";
  if (status === "no-show") return "No-show";
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
};

const calendarStatus = (status: string, deletedAt?: string | null): CalendarEvent["status"] => {
  if (deletedAt || status === "cancelled" || status === "no-show") return "CANCELLED";
  if (status.startsWith("pending_")) return "TENTATIVE";
  return "CONFIRMED";
};

const sequenceFor = (value?: string | null) => value
  ? Math.max(0, Math.floor(new Date(value).getTime() / 1000))
  : 0;

const aircraftLabel = (aircraft: any) => aircraft
  ? [aircraft.registration, aircraft.make, aircraft.model].filter(Boolean).join(" ")
  : "Aircraft to be advised";

const bookingEvent = ({
  booking,
  viewerId,
  aircraft,
  student,
  instructor,
  supervisor,
  manageUrl,
}: {
  booking: any;
  viewerId?: string;
  aircraft?: any;
  student?: any;
  instructor?: any;
  supervisor?: any;
  manageUrl?: string;
}): CalendarEvent => {
  const aircraftName = aircraftLabel(aircraft);
  const isSupervisor = viewerId && booking.supervising_instructor_id === viewerId && booking.instructor_id !== viewerId;
  const isInstructor = viewerId && booking.instructor_id === viewerId;
  const isTrial = Boolean(booking.trial_flight_voucher_id);
  const ground = booking.booking_kind === "ground";
  let title = isTrial ? `BFC Trial Flight – ${aircraftName}` : ground ? "BFC Ground Session" : `BFC Flight – ${aircraftName}`;
  if (isInstructor) title = ground
    ? `BFC Ground Instruction – ${student?.name || booking.guest_name || "Student"}`
    : `BFC Instruction – ${student?.name || booking.guest_name || "Student"} – ${aircraftName}`;
  if (isSupervisor) title = `BFC Supervision – ${instructor?.name || "Instructor"} – ${aircraftName}`;

  const details = [
    `Status: ${labelStatus(booking.status, booking.deleted_at)}`,
    `Aircraft: ${aircraftName}`,
    instructor?.name ? `Instructor: ${instructor.name}` : "",
    supervisor?.name ? `Supervising senior instructor: ${supervisor.name}` : "",
    manageUrl ? `Manage in the BFC portal: ${manageUrl}` : "",
    "The BFC portal is the source of truth for this booking.",
  ].filter(Boolean);

  return {
    uid: `booking-${booking.id}@${CALENDAR_DOMAIN}`,
    title,
    description: details.join("\n"),
    location: booking.location || LOCATION_FALLBACK,
    start: booking.start_time,
    end: booking.end_time,
    status: calendarStatus(booking.status, booking.deleted_at),
    lastModified: booking.updated_at || booking.cancelled_at || booking.created_at,
    sequence: sequenceFor(booking.updated_at || booking.cancelled_at || booking.created_at),
    url: manageUrl,
  };
};

const loadPeopleAndAircraft = async (admin: any, bookings: any[]) => {
  const userIds = [...new Set(bookings.flatMap(booking => [
    booking.student_id,
    booking.instructor_id,
    booking.supervising_instructor_id,
  ]).filter(Boolean))];
  const aircraftIds = [...new Set(bookings.map(booking => booking.aircraft_id).filter(Boolean))];
  const [{ data: users, error: usersError }, { data: aircraft, error: aircraftError }] = await Promise.all([
    userIds.length ? admin.from("users").select("id,name").in("id", userIds) : Promise.resolve({ data: [] }),
    aircraftIds.length ? admin.from("aircraft").select("id,registration,make,model").in("id", aircraftIds) : Promise.resolve({ data: [] }),
  ]);
  if (usersError) throw usersError;
  if (aircraftError) throw aircraftError;
  return {
    users: new Map((users || []).map((user: any) => [user.id, user])),
    aircraft: new Map((aircraft || []).map((item: any) => [item.id, item])),
  };
};

const touchAccess = async (
  admin: any,
  table: "calendar_feed_settings" | "booking_calendar_links",
  idColumn: "user_id" | "booking_id",
  id: string,
  lastAccessedAt?: string | null,
) => {
  if (lastAccessedAt && Date.now() - new Date(lastAccessedAt).getTime() < 60 * 60 * 1000) return;
  await admin.from(table).update({ last_accessed_at: new Date().toISOString() }).eq(idColumn, id);
};

const handleFeed = async (admin: any, feedKey: string) => {
  const { data: settings, error: settingsError } = await admin
    .from("calendar_feed_settings")
    .select("user_id,enabled,include_pending,include_supervision,include_duty,last_accessed_at")
    .eq("feed_key", feedKey)
    .maybeSingle();
  if (settingsError || !settings) return errorPage("This private calendar link is invalid or has been replaced.");
  if (!settings.enabled) return errorPage("This calendar subscription has been paused in portal settings.", 410);

  const now = new Date();
  const from = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 540 * 24 * 60 * 60 * 1000).toISOString();
  const relationshipFilter = settings.include_supervision
    ? `student_id.eq.${settings.user_id},instructor_id.eq.${settings.user_id},supervising_instructor_id.eq.${settings.user_id}`
    : `student_id.eq.${settings.user_id},instructor_id.eq.${settings.user_id}`;
  const { data: bookingRows, error: bookingError } = await admin
    .from("bookings")
    .select("id,student_id,instructor_id,supervising_instructor_id,aircraft_id,start_time,end_time,status,booking_kind,trial_flight_voucher_id,guest_name,location,supervision_status,deleted_at,cancelled_at,created_at,updated_at")
    .or(relationshipFilter)
    .gte("end_time", from)
    .lte("start_time", to)
    .order("start_time");
  if (bookingError) throw bookingError;

  const bookings = (bookingRows || []).filter((booking: any) => settings.include_pending
    || !["pending_approval", "pending_supervision"].includes(booking.status));
  const lookup = await loadPeopleAndAircraft(admin, bookings);
  const events: CalendarEvent[] = bookings.map((booking: any) => bookingEvent({
    booking,
    viewerId: settings.user_id,
    aircraft: lookup.aircraft.get(booking.aircraft_id),
    student: lookup.users.get(booking.student_id),
    instructor: lookup.users.get(booking.instructor_id),
    supervisor: lookup.users.get(booking.supervising_instructor_id),
    manageUrl: `${SITE_ORIGIN}/calendar`,
  }));

  if (settings.include_duty) {
    const { data: duties, error: dutyError } = await admin
      .from("duty_periods")
      .select("id,duty_date,planned_start,planned_end,actual_start,actual_end,location,status,entry_source,updated_at,created_at")
      .eq("instructor_id", settings.user_id)
      .or(`actual_start.gte.${from},planned_start.gte.${from}`)
      .order("duty_date");
    if (dutyError) throw dutyError;
    for (const duty of duties || []) {
      const start = duty.actual_start || duty.planned_start;
      const end = duty.actual_end || duty.planned_end;
      if (!start || !end || new Date(start) > new Date(to)) continue;
      events.push({
        uid: `duty-${duty.id}@${CALENDAR_DOMAIN}`,
        title: `BFC Duty – ${duty.location || "Bendigo"}`,
        description: [
          `Status: ${labelStatus(duty.status)}`,
          duty.entry_source === "automatic_booking" ? "Automatically created from the day's bookings." : "Recorded in the BFC Duty tab.",
          "The BFC Duty tab is the source of truth.",
        ].join("\n"),
        location: duty.location || LOCATION_FALLBACK,
        start,
        end,
        status: duty.status === "draft" ? "TENTATIVE" : "CONFIRMED",
        lastModified: duty.updated_at || duty.created_at,
        sequence: sequenceFor(duty.updated_at || duty.created_at),
        url: `${SITE_ORIGIN}/duty`,
      });
    }
  }

  void touchAccess(admin, "calendar_feed_settings", "user_id", settings.user_id, settings.last_accessed_at);
  return calendarResponse(buildCalendar(CALENDAR_NAME, events), "bfc-calendar.ics");
};

const handleEvent = async (admin: any, requestUrl: URL, token: string) => {
  if (requestUrl.searchParams.get("download") !== "1" && requestUrl.searchParams.get("format") !== "json") {
    return Response.redirect(`${SITE_ORIGIN}/calendar-booking?event=${encodeURIComponent(token)}`, 302);
  }
  const wantsJson = requestUrl.searchParams.get("format") === "json";
  const { data: link, error: linkError } = await admin
    .from("booking_calendar_links")
    .select("booking_id,revoked_at,last_accessed_at")
    .eq("token", token)
    .maybeSingle();
  if (linkError || !link || link.revoked_at) return wantsJson
    ? jsonResponse({ error: "This booking calendar link is invalid or has been replaced.", status: 404 })
    : eventErrorPage("This booking calendar link is invalid or has been replaced.");

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("id,student_id,instructor_id,supervising_instructor_id,aircraft_id,start_time,end_time,status,booking_kind,trial_flight_voucher_id,guest_name,location,supervision_status,deleted_at,cancelled_at,created_at,updated_at")
    .eq("id", link.booking_id)
    .maybeSingle();
  if (bookingError || !booking) return wantsJson
    ? jsonResponse({ error: "This booking no longer exists.", status: 410 })
    : eventErrorPage("This booking no longer exists.", 410);

  const lookup = await loadPeopleAndAircraft(admin, [booking]);
  let manageUrl = `${SITE_ORIGIN}/calendar`;
  if (booking.trial_flight_voucher_id) {
    const { data: voucher } = await admin.from("trial_flight_vouchers").select("code").eq("id", booking.trial_flight_voucher_id).maybeSingle();
    if (voucher?.code) manageUrl = `${SITE_ORIGIN}/trial-flight-voucher?voucherCode=${encodeURIComponent(voucher.code)}`;
  }
  const event = bookingEvent({
    booking,
    aircraft: lookup.aircraft.get(booking.aircraft_id),
    student: lookup.users.get(booking.student_id),
    instructor: lookup.users.get(booking.instructor_id),
    supervisor: lookup.users.get(booking.supervising_instructor_id),
    manageUrl,
  });
  const downloadUrl = new URL(requestUrl);
  downloadUrl.searchParams.delete("format");
  downloadUrl.searchParams.set("download", "1");
  const calendar = buildCalendar(CALENDAR_NAME, [event]);
  void touchAccess(admin, "booking_calendar_links", "booking_id", link.booking_id, link.last_accessed_at);
  if (requestUrl.searchParams.get("download") === "1") {
    return calendarResponse(calendar, `bfc-booking-${booking.id.slice(0, 8)}.ics`);
  }

  if (wantsJson) {
    return jsonResponse({
      event: {
        uid: event.uid,
        title: event.title,
        description: event.description || "",
        location: event.location || LOCATION_FALLBACK,
        start: new Date(event.start).toISOString(),
        end: new Date(event.end).toISOString(),
        status: event.status || "CONFIRMED",
      },
      manageUrl,
      downloadUrl: downloadUrl.toString(),
    });
  }

  const timeZone = "Australia/Sydney";
  const date = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(new Date(booking.start_time));
  const time = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(booking.start_time));
  const end = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(booking.end_time));
  const cancelled = event.status === "CANCELLED";
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Add BFC booking to calendar</title></head><body style="margin:0;background:#eef4fb;color:#0f172a;font:16px system-ui,-apple-system,sans-serif"><main style="box-sizing:border-box;max-width:650px;margin:5vh auto;padding:32px"><section style="background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 18px 45px #0f172a24"><header style="padding:28px;background:linear-gradient(135deg,#06152f,#0d3b78);color:#fff"><div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#bfdbfe;font-weight:800">Bendigo Flying Club</div><h1 style="margin:8px 0 0;font-size:28px">${cancelled ? "Booking cancelled" : "Add booking to your calendar"}</h1></header><div style="padding:28px"><h2 style="margin:0 0 8px;font-size:20px">${escapeHtml(event.title)}</h2><p style="margin:0;color:#475569;line-height:1.7">${escapeHtml(date)}<br><strong>${escapeHtml(time)} – ${escapeHtml(end)}</strong><br>${escapeHtml(event.location || LOCATION_FALLBACK)}</p>${cancelled ? `<div style="margin-top:22px;padding:16px;border-radius:14px;background:#fff1f2;color:#9f1239;font-weight:700">This booking has been cancelled. Calendar apps that support updates will mark the event as cancelled.</div>` : `<div style="display:grid;gap:12px;margin-top:26px"><a href="${escapeHtml(googleCalendarUrl(event))}" style="padding:14px 18px;border-radius:12px;background:#2563eb;color:#fff;text-align:center;text-decoration:none;font-weight:800">Add to Google Calendar</a><a href="${escapeHtml(outlookCalendarUrl(event))}" style="padding:14px 18px;border-radius:12px;background:#0369a1;color:#fff;text-align:center;text-decoration:none;font-weight:800">Add to Outlook</a><a href="${escapeHtml(downloadUrl.toString())}" style="padding:14px 18px;border-radius:12px;background:#e2e8f0;color:#0f172a;text-align:center;text-decoration:none;font-weight:800">Apple Calendar / download .ics</a></div>`}<p style="margin:24px 0 0;text-align:center"><a href="${escapeHtml(manageUrl)}" style="color:#1d4ed8;font-weight:700">View current booking in the BFC portal</a></p><p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.6">The portal is the source of truth. Keep this private link secure; anyone with it can see this booking's date and time.</p></div></section></main></body></html>`, { headers: htmlHeaders });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: securityHeaders });
  if (req.method !== "GET") return errorPage("Only calendar links can be opened here.", 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return errorPage("Calendar service is not configured.", 503);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const url = new URL(req.url);
  const feed = url.searchParams.get("feed")?.trim();
  const event = url.searchParams.get("event")?.trim();
  try {
    if (feed) return await handleFeed(admin, feed);
    if (event) return await handleEvent(admin, url, event);
    return errorPage("No calendar subscription or booking was specified.", 400);
  } catch (error) {
    console.error("Calendar feed failed", error);
    return errorPage("The calendar could not be loaded right now. Please try again shortly.", 500);
  }
});
