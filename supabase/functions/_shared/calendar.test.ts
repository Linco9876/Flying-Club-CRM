import {
  buildCalendar,
  escapeCalendarText,
  foldCalendarLine,
  formatCalendarDate,
  googleCalendarUrl,
} from "./calendar.ts";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("calendar text is escaped and dates are UTC", () => {
  assert(escapeCalendarText("A, B; C\nD\\E") === "A\\, B\\; C\\nD\\\\E", "text escaping failed");
  assert(formatCalendarDate("2026-07-23T10:30:00+10:00") === "20260723T003000Z", "UTC conversion failed");
});

Deno.test("calendar output has stable event fields and CRLF endings", () => {
  const output = buildCalendar("BFC bookings", [{
    uid: "booking-123@portal.bendigoflyingclub.com.au",
    title: "BFC Flight – VH-ABC",
    start: "2026-07-23T00:00:00Z",
    end: "2026-07-23T01:00:00Z",
    description: "Current status: Confirmed",
  }], { stamp: new Date("2026-07-20T00:00:00Z") });
  assert(output.includes("BEGIN:VCALENDAR\r\n"), "calendar header missing");
  assert(output.includes("UID:booking-123@portal.bendigoflyingclub.com.au"), "UID missing");
  assert(output.endsWith("END:VCALENDAR\r\n"), "calendar must end with CRLF");
});

Deno.test("long UTF-8 lines are folded safely", () => {
  const folded = foldCalendarLine(`DESCRIPTION:${"Flight information ✈ ".repeat(10)}`);
  for (const line of folded.split("\r\n")) {
    assert(new TextEncoder().encode(line).length <= 75, "folded line exceeds RFC limit");
  }
});

Deno.test("Google link contains the event time", () => {
  const url = new URL(googleCalendarUrl({
    uid: "1",
    title: "Trial flight",
    start: "2026-07-23T00:00:00Z",
    end: "2026-07-23T01:00:00Z",
  }));
  assert(url.searchParams.get("dates") === "20260723T000000Z/20260723T010000Z", "Google dates missing");
});
