import { Booking } from '../types';

export interface BrowserCalendarEvent {
  uid: string;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
}

const escapeIcsText = (value: string) => value
  .replace(/\\/g, '\\\\')
  .replace(/\r?\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

const formatUtc = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const foldLine = (line: string) => {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = '';
  for (const character of line) {
    if (encoder.encode(current + character).length > 73) {
      chunks.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  chunks.push(current);
  return chunks.join('\r\n ');
};

export const bookingToCalendarEvent = (
  booking: Booking,
  options: { aircraftLabel?: string; viewerId?: string; portalUrl?: string } = {},
): BrowserCalendarEvent => {
  const aircraft = options.aircraftLabel || 'Aircraft to be advised';
  const isGround = booking.bookingKind === 'ground';
  const isInstructor = options.viewerId && booking.instructorId === options.viewerId;
  const isSupervisor = options.viewerId && booking.supervisingInstructorId === options.viewerId && !isInstructor;
  let title = booking.trialFlightVoucherId
    ? `BFC Trial Flight – ${aircraft}`
    : isGround ? 'BFC Ground Session' : `BFC Flight – ${aircraft}`;
  if (isInstructor) title = isGround
    ? `BFC Ground Instruction – ${booking.hirerName || 'Student'}`
    : `BFC Instruction – ${booking.hirerName || 'Student'} – ${aircraft}`;
  if (isSupervisor) title = `BFC Supervision – ${booking.instructorName || 'Instructor'} – ${aircraft}`;

  const status = booking.status === 'cancelled' || booking.status === 'no-show' || booking.deletedAt
    ? 'CANCELLED'
    : booking.status.startsWith('pending_') ? 'TENTATIVE' : 'CONFIRMED';
  const statusLabel = booking.status.replaceAll('_', ' ').replace(/^./, character => character.toUpperCase());
  const description = [
    `Status: ${statusLabel}`,
    `Aircraft: ${aircraft}`,
    booking.instructorName ? `Instructor: ${booking.instructorName}` : '',
    booking.supervisingInstructorName ? `Supervising senior instructor: ${booking.supervisingInstructorName}` : '',
    options.portalUrl ? `View current booking: ${options.portalUrl}` : '',
    'The BFC portal is the source of truth for this booking.',
  ].filter(Boolean).join('\n');

  return {
    uid: `booking-${booking.id}@portal.bendigoflyingclub.com.au`,
    title,
    description,
    location: booking.location || 'Bendigo Flying Club',
    start: new Date(booking.startTime),
    end: new Date(booking.endTime),
    status,
  };
};

export const buildBookingIcs = (event: BrowserCalendarEvent) => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bendigo Flying Club//Flying Club CRM//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${formatUtc(new Date())}`,
    `DTSTART:${formatUtc(event.start)}`,
    `DTEND:${formatUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    `STATUS:${event.status}`,
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
};

export const googleCalendarUrl = (event: BrowserCalendarEvent) => {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatUtc(event.start)}/${formatUtc(event.end)}`,
    details: event.description,
    location: event.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

export const outlookCalendarUrl = (event: BrowserCalendarEvent) => {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: event.start.toISOString(),
    enddt: event.end.toISOString(),
    body: event.description,
    location: event.location,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
};

export const downloadBookingIcs = (event: BrowserCalendarEvent) => {
  const blob = new Blob([buildBookingIcs(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bfc-booking-${event.start.toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
