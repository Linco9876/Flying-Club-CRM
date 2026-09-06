import type { Booking } from '../types';
import type { BrowserCalendarEvent } from './calendar';

export interface SupervisionMarkerInput<T> {
  item: T;
  start: Date;
  end: Date;
}

export interface SupervisionMarkerLayout<T> extends SupervisionMarkerInput<T> {
  lane: number;
}

export const layoutSupervisionMarkers = <T>(
  markers: SupervisionMarkerInput<T>[],
): SupervisionMarkerLayout<T>[] => {
  const laneEnds: number[] = [];

  return [...markers]
    .sort((left, right) => (
      left.start.getTime() - right.start.getTime()
      || left.end.getTime() - right.end.getTime()
    ))
    .map((marker) => {
      const start = marker.start.getTime();
      let lane = laneEnds.findIndex(end => end <= start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = marker.end.getTime();
      return { ...marker, lane };
    });
};

export const supervisionToCalendarEvent = (
  booking: Booking,
  options: {
    aircraftLabel?: string;
    instructorName?: string;
    supervisorName?: string;
    coverageStart?: Date;
    coverageEnd?: Date;
    portalUrl?: string;
  } = {},
): BrowserCalendarEvent => {
  const aircraft = options.aircraftLabel || 'Aircraft to be advised';
  const instructor = options.instructorName || booking.instructorName || 'Instructor';
  const supervisor = options.supervisorName || booking.supervisingInstructorName || 'Senior instructor';
  const acknowledged = booking.supervisionStatus === 'acknowledged';

  return {
    uid: `supervision-${booking.id}@portal.bendigoflyingclub.com.au`,
    title: `BFC Supervision – ${instructor} – ${aircraft}`,
    description: [
      `Supervising: ${instructor}`,
      `Allocated supervisor: ${supervisor}`,
      `Acknowledgement: ${acknowledged ? 'Acknowledged' : 'Required'}`,
      `Aircraft: ${aircraft}`,
      options.portalUrl ? `Manage supervision: ${options.portalUrl}` : '',
    ].filter(Boolean).join('\n'),
    location: booking.location || 'Bendigo Flying Club',
    start: options.coverageStart || new Date(booking.startTime),
    end: options.coverageEnd || new Date(booking.endTime),
    status: acknowledged ? 'CONFIRMED' : 'TENTATIVE',
  };
};
