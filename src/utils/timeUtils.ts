// Timezone-aware utility functions
import { format, isAfter, isBefore, parseISO } from 'date-fns';

export const getCurrentTime = (): Date => {
  return new Date();
};

export const isPastBooking = (booking: { startTime: Date | string }): boolean => {
  const now = getCurrentTime();
  const startTime = typeof booking.startTime === 'string' 
    ? parseISO(booking.startTime) 
    : booking.startTime;
  
  return isBefore(startTime, now);
};

export const formatLocalTime = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, 'h:mm a');
};

export const formatLocalDateTime = (date: Date | string): string => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, 'MMM d, h:mm a');
};

export const getCurrentTimeInMinutes = (): number => {
  const now = getCurrentTime();
  return now.getHours() * 60 + now.getMinutes();
};

export const getTimeSlotFromMinutes = (minutes: number): number => {
  // Convert minutes since midnight to time slot (15-minute intervals starting from 6:00 AM)
  const startHour = 6; // 6:00 AM
  const startMinutes = startHour * 60;

  if (minutes < startMinutes) return -1; // Before start time

  const minutesFromStart = minutes - startMinutes;
  return Math.floor(minutesFromStart / 15);
};
