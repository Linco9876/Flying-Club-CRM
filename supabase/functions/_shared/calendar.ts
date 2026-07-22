export interface CalendarEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: string | Date;
  end: string | Date;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  lastModified?: string | Date;
  sequence?: number;
  url?: string;
}

const CRLF = "\r\n";

export const escapeCalendarText = (value: unknown) => String(value ?? "")
  .replace(/\\/g, "\\\\")
  .replace(/\r?\n/g, "\\n")
  .replace(/,/g, "\\,")
  .replace(/;/g, "\\;");

export const formatCalendarDate = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid calendar date");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
};

export const foldCalendarLine = (line: string) => {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  for (const character of line) {
    if (encoder.encode(current + character).length > 73) {
      chunks.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  chunks.push(current);
  return chunks.join(`${CRLF} `);
};

export const calendarEventLines = (event: CalendarEvent, stamp = new Date()) => {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeCalendarText(event.uid)}`,
    `DTSTAMP:${formatCalendarDate(stamp)}`,
    `DTSTART:${formatCalendarDate(event.start)}`,
    `DTEND:${formatCalendarDate(event.end)}`,
    `SUMMARY:${escapeCalendarText(event.title)}`,
    `STATUS:${event.status || "CONFIRMED"}`,
    `SEQUENCE:${Math.max(0, event.sequence || 0)}`,
  ];
  if (event.lastModified) lines.push(`LAST-MODIFIED:${formatCalendarDate(event.lastModified)}`);
  if (event.location) lines.push(`LOCATION:${escapeCalendarText(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeCalendarText(event.description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push("END:VEVENT");
  return lines.map(foldCalendarLine);
};

export const buildCalendar = (
  name: string,
  events: CalendarEvent[],
  options: { method?: "PUBLISH" | "REQUEST" | "CANCEL"; stamp?: Date } = {},
) => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bendigo Flying Club//Flying Club CRM//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${options.method || "PUBLISH"}`,
    `X-WR-CALNAME:${escapeCalendarText(name)}`,
    "X-WR-TIMEZONE:Australia/Sydney",
    ...events.flatMap(event => calendarEventLines(event, options.stamp)),
    "END:VCALENDAR",
  ];
  return `${lines.join(CRLF)}${CRLF}`;
};

export const googleCalendarUrl = (event: CalendarEvent) => {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${formatCalendarDate(event.start)}/${formatCalendarDate(event.end)}`,
    details: event.description || "",
    location: event.location || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

export const outlookCalendarUrl = (event: CalendarEvent) => {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: new Date(event.start).toISOString(),
    enddt: new Date(event.end).toISOString(),
    body: event.description || "",
    location: event.location || "",
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
};
