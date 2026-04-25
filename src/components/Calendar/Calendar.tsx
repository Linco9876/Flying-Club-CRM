import React, { useState, useEffect } from 'react';
import {
  format,
  addDays,
  isSameDay,
  isToday,
  startOfWeek,
  addWeeks,
  subWeeks,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Filter,
  Plane,
  User,
} from 'lucide-react';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { useKeyboardNavigation } from '../../hooks/useKeyboardNavigation';
import { useCalendarSettings } from '../../hooks/useSettings';
import { useInstructorAvailability } from '../../hooks/useInstructorAvailability';
import { Booking } from '../../types';
import { CurrentTimeIndicator } from './CurrentTimeIndicator';
import { MonthView } from './MonthView';
import { isPastBooking, hasBookingStarted } from '../../utils/timeUtils';
import { BookingActionMenu } from '../Bookings/BookingActionMenu';
import { FlightLogModal } from '../Bookings/FlightLogModal';
import toast from 'react-hot-toast';

interface CalendarProps {
  bookings: Booking[];
  onNewBooking: () => void;
  onNewBookingWithTime?: (
    date: Date,
    startTime: string,
    endTime?: string,
    resourceId?: string,
    resourceType?: 'aircraft' | 'instructor'
  ) => void;
  onEditBooking?: (booking: Booking) => void;
  onUpdateBooking?: (bookingId: string, updates: Partial<Booking>, silent?: boolean) => void;
  onDeleteBooking?: (bookingId: string) => void;
}

interface Resource {
  id: string;
  name: string;
  type: 'aircraft' | 'instructor';
  icon: React.ReactNode;
  status?: string;
}

interface UnavailabilityPeriod {
  resourceId: string;
  resourceType: 'aircraft' | 'instructor';
  startTime: Date;
  endTime: Date;
  reason: string;
  pattern: 'diagonal' | 'solid';
}

type ViewMode = 'day' | 'week' | 'month';

export const Calendar: React.FC<CalendarProps> = ({
  bookings,
  onNewBooking,
  onNewBookingWithTime,
  onEditBooking,
  onUpdateBooking,
  onDeleteBooking,
}) => {
  const { aircraft } = useAircraft();
  const { getInstructors } = useUsers();
  const instructors = getInstructors();
  const { settings: calendarSettings } = useCalendarSettings();
  const { weeklySchedules, absences, scheduleChanges } = useInstructorAvailability();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [selectedAircraftId, setSelectedAircraftId] = useState<string>('');
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>('');
  const [resourceFilter, setResourceFilter] = useState<
    'all' | 'aircraft' | 'instructors' | 'both'
  >('both');
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Drag and drop states
  const [draggedBooking, setDraggedBooking] = useState<Booking | null>(null);
  const [draggedBookingOriginal, setDraggedBookingOriginal] = useState<Booking | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    startTime: Date;
    endTime: Date;
    resourceId: string;
    resourceType: 'aircraft' | 'instructor';
  } | null>(null);
  const [resizingBooking, setResizingBooking] = useState<{
    booking: Booking;
    handle: 'top' | 'bottom';
  } | null>(null);
  const [wasResizing, setWasResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // Time selection states
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{
    hour: number;
    resourceId: string;
    resourceType: 'aircraft' | 'instructor';
    dayIndex?: number;
  } | null>(null);
  const [dragEnd, setDragEnd] = useState<{
    hour: number;
    resourceId: string;
    resourceType: 'aircraft' | 'instructor';
    dayIndex?: number;
  } | null>(null);

  // Dynamic slot height based on viewport and settings
  const [slotHeight, setSlotHeight] = useState<number>(60);

  // Action menu and flight log states
  const [actionMenuBooking, setActionMenuBooking] = useState<Booking | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showFlightLogModal, setShowFlightLogModal] = useState(false);
  const [flightLogBooking, setFlightLogBooking] = useState<Booking | null>(null);
  const [highlightUnlogged, setHighlightUnlogged] = useState(false);

  // Drag delay state
  const [dragDelayTimer, setDragDelayTimer] = useState<NodeJS.Timeout | null>(null);
  const [isDragDelayActive, setIsDragDelayActive] = useState(false);

  // Tick every 30 seconds so past-unlogged bookings turn red automatically
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  useKeyboardNavigation({
    onArrowLeft: () => navigateDate('prev'),
    onArrowRight: () => navigateDate('next'),
    onEscape: () => {
      if (dragDelayTimer) {
        clearTimeout(dragDelayTimer);
        setDragDelayTimer(null);
      }
      setIsDragDelayActive(false);
      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
      setDraggedBooking(null);
      setDraggedBookingOriginal(null);
      setDragPreview(null);
      setResizingBooking(null);
      setWasResizing(false);
    },
    enabled: true,
  });

  // Cleanup drag delay timer on unmount
  useEffect(() => {
    return () => {
      if (dragDelayTimer) {
        clearTimeout(dragDelayTimer);
      }
    };
  }, [dragDelayTimer]);

  useEffect(() => {
    if (calendarSettings?.default_view) {
      setViewMode(calendarSettings.default_view as ViewMode);
    }
  }, [calendarSettings?.default_view]);


  // Compute slot height on mount and resize
  useEffect(() => {
    const computeSlotHeight = () => {
      const headerHeight = 200;
      const availableHeight = window.innerHeight - headerHeight;
      const numSlots = getTimeSlots().length;
      const baseHeight = availableHeight / numSlots;
      const heightMultiplier = calendarSettings?.double_height_slots ? 2 : 1;
      setSlotHeight(baseHeight * heightMultiplier);
    };

    computeSlotHeight();
    window.addEventListener('resize', computeSlotHeight);
    return () => window.removeEventListener('resize', computeSlotHeight);
  }, [calendarSettings?.double_height_slots]);

  const navigateDate = (direction: 'prev' | 'next') => {
    if (viewMode === 'day') {
      setCurrentDate((prev) =>
        addDays(prev, direction === 'next' ? 1 : -1)
      );
    } else if (viewMode === 'week') {
      setCurrentDate((prev) =>
        addWeeks(prev, direction === 'next' ? 1 : -1)
      );
    }
  };

  const getWeekDays = () => {
    const weekStartsOn = calendarSettings?.week_starts_on === 'sunday' ? 0 : 1;
    const start = startOfWeek(currentDate, { weekStartsOn });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  };

  const getSelectedResources = (): Resource[] => {
    const resources: Resource[] = [];

    if (selectedAircraftId) {
      const selectedAircraft = aircraft.find(
        (a) => a.id === selectedAircraftId
      );
      if (selectedAircraft) {
        resources.push({
          id: selectedAircraft.id,
          name: selectedAircraft.registration,
          type: 'aircraft',
          icon: <Plane className="h-4 w-4" />,
          status: selectedAircraft.status,
        });
      }
    }

    if (selectedInstructorId) {
      const instructor = instructors.find(
        (i) => i.id === selectedInstructorId
      );
      if (instructor) {
        resources.push({
          id: instructor.id,
          name: instructor.name,
          type: 'instructor',
          icon: <User className="h-4 w-4" />,
        });
      }
    }

    return resources;
  };

  const getAllResources = (): Resource[] => {
    const resources: Resource[] = [];
    const displayOrder = calendarSettings?.resource_display_order || 'aircraft-first';

    const aircraftResources: Resource[] = [];
    const instructorResources: Resource[] = [];

    if (resourceFilter === 'aircraft' || resourceFilter === 'both') {
      aircraft.forEach((a) => {
        aircraftResources.push({
          id: a.id,
          name: a.registration,
          type: 'aircraft',
          icon: <Plane className="h-4 w-4" />,
          status: a.status,
        });
      });
    }

    if (resourceFilter === 'instructors' || resourceFilter === 'both') {
      instructors.forEach((instructor) => {
        instructorResources.push({
          id: instructor.id,
          name: instructor.name || instructor.email,
          type: 'instructor',
          icon: <User className="h-4 w-4" />,
        });
      });
    }

    if (displayOrder === 'instructors-first') {
      return [...instructorResources, ...aircraftResources];
    } else {
      return [...aircraftResources, ...instructorResources];
    }
  };

  const getTimeSlots = () => {
    const snapDuration = calendarSettings?.snap_duration || 15;
    const slotsPerHour = 60 / snapDuration;
    const slots = [];
    for (let hour = 6; hour < 20; hour++) {
      for (let i = 0; i < slotsPerHour; i++) {
        slots.push(hour * (60 / snapDuration) + i);
      }
    }
    return slots;
  };

  const getTimeFromSlot = (slot: number) => {
    const snapDuration = calendarSettings?.snap_duration || 15;
    const slotsPerHour = 60 / snapDuration;
    const hour = Math.floor(slot / slotsPerHour);
    const minute = (slot % slotsPerHour) * snapDuration;
    return { hour, minute };
  };

  const formatTimeSlot = (slot: number) => {
    const { hour, minute } = getTimeFromSlot(slot);
    return `${hour.toString().padStart(2, '0')}:${minute
      .toString()
      .padStart(2, '0')}`;
  };

  const formatHourLabel = (slot: number) => {
    const { hour } = getTimeFromSlot(slot);
    return `${hour.toString().padStart(2, '0')}:00`;
  };

  const getUnavailabilityPeriods = (date: Date): UnavailabilityPeriod[] => {
    const periods: UnavailabilityPeriod[] = [];
    const dayOfWeek = date.getDay();
    const dateStr = format(date, 'yyyy-MM-dd');

    instructors.forEach((instructor) => {
      // Check for absences
      const absence = absences.find(
        (a) =>
          a.userId === instructor.id &&
          dateStr >= a.startDate &&
          dateStr <= a.endDate
      );

      if (absence) {
        let startHour = 6;
        let startMinute = 0;
        let endHour = 20;
        let endMinute = 0;

        if (absence.startTime && absence.endTime) {
          [startHour, startMinute] = absence.startTime.split(':').map(Number);
          [endHour, endMinute] = absence.endTime.split(':').map(Number);
        }

        periods.push({
          resourceId: instructor.id,
          resourceType: 'instructor',
          startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour, startMinute),
          endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour, endMinute),
          reason: absence.reason || 'Absent',
          pattern: 'solid',
        });
        return;
      }

      // Check for schedule changes effective on this date
      const applicableChanges = scheduleChanges
        .filter((c) => c.userId === instructor.id && c.dayOfWeek === dayOfWeek && c.effectiveFrom <= dateStr)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

      const scheduleChange = applicableChanges[0];

      if (scheduleChange) {
        if (!scheduleChange.isAvailable) {
          periods.push({
            resourceId: instructor.id,
            resourceType: 'instructor',
            startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6, 0),
            endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 20, 0),
            reason: 'Not Available',
            pattern: 'diagonal',
          });
        } else {
          const [startHour, startMinute] = scheduleChange.startTime.split(':').map(Number);
          const [endHour, endMinute] = scheduleChange.endTime.split(':').map(Number);

          if (startHour > 6) {
            periods.push({
              resourceId: instructor.id,
              resourceType: 'instructor',
              startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6, 0),
              endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour, startMinute),
              reason: 'Not Available',
              pattern: 'diagonal',
            });
          }

          if (scheduleChange.afternoonStartTime && scheduleChange.afternoonEndTime) {
            const [afternoonStartHour, afternoonStartMinute] = scheduleChange.afternoonStartTime.split(':').map(Number);
            const [afternoonEndHour, afternoonEndMinute] = scheduleChange.afternoonEndTime.split(':').map(Number);

            periods.push({
              resourceId: instructor.id,
              resourceType: 'instructor',
              startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour, endMinute),
              endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), afternoonStartHour, afternoonStartMinute),
              reason: 'Lunch Break',
              pattern: 'diagonal',
            });

            if (afternoonEndHour < 20) {
              periods.push({
                resourceId: instructor.id,
                resourceType: 'instructor',
                startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), afternoonEndHour, afternoonEndMinute),
                endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 20, 0),
                reason: 'Not Available',
                pattern: 'diagonal',
              });
            }
          } else {
            if (endHour < 20) {
              periods.push({
                resourceId: instructor.id,
                resourceType: 'instructor',
                startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour, endMinute),
                endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 20, 0),
                reason: 'Not Available',
                pattern: 'diagonal',
              });
            }
          }
        }
        return;
      }

      // Check weekly schedule
      const weeklySchedule = weeklySchedules.find(
        (s) => s.userId === instructor.id && s.dayOfWeek === dayOfWeek
      );

      if (!weeklySchedule || !weeklySchedule.isAvailable) {
        periods.push({
          resourceId: instructor.id,
          resourceType: 'instructor',
          startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6, 0),
          endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 20, 0),
          reason: 'Not Available',
          pattern: 'diagonal',
        });
      } else {
        const [startHour, startMinute] = weeklySchedule.startTime.split(':').map(Number);
        const [endHour, endMinute] = weeklySchedule.endTime.split(':').map(Number);

        if (startHour > 6) {
          periods.push({
            resourceId: instructor.id,
            resourceType: 'instructor',
            startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6, 0),
            endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour, startMinute),
            reason: 'Not Available',
            pattern: 'diagonal',
          });
        }

        if (weeklySchedule.afternoonStartTime && weeklySchedule.afternoonEndTime) {
          const [afternoonStartHour, afternoonStartMinute] = weeklySchedule.afternoonStartTime.split(':').map(Number);
          const [afternoonEndHour, afternoonEndMinute] = weeklySchedule.afternoonEndTime.split(':').map(Number);

          periods.push({
            resourceId: instructor.id,
            resourceType: 'instructor',
            startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour, endMinute),
            endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), afternoonStartHour, afternoonStartMinute),
            reason: 'Lunch Break',
            pattern: 'diagonal',
          });

          if (afternoonEndHour < 20) {
            periods.push({
              resourceId: instructor.id,
              resourceType: 'instructor',
              startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), afternoonEndHour, afternoonEndMinute),
              endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 20, 0),
              reason: 'Not Available',
              pattern: 'diagonal',
            });
          }
        } else {
          if (endHour < 20) {
            periods.push({
              resourceId: instructor.id,
              resourceType: 'instructor',
              startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour, endMinute),
              endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 20, 0),
              reason: 'Not Available',
              pattern: 'diagonal',
            });
          }
        }
      }
    });

    return periods;
  };

  const getBookingsForResource = (
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    date: Date
  ): Booking[] => {
    let filteredBookings = bookings.filter((booking) =>
      isSameDay(new Date(booking.startTime), date)
    );

    if (resourceType === 'aircraft') {
      filteredBookings = filteredBookings.filter(
        (booking) => booking.aircraftId === resourceId
      );
    } else {
      filteredBookings = filteredBookings.filter(
        (booking) => booking.instructorId === resourceId
      );
    }

    return filteredBookings;
  };

  const getBookingPosition = (booking: Booking) => {
    const snapDuration = calendarSettings?.snap_duration || 15;
    const slotsPerHour = 60 / snapDuration;
    const startTime = new Date(booking.startTime);
    const endTime = new Date(booking.endTime);
    const startHour = startTime.getHours();
    const startMinute = startTime.getMinutes();

    const startSlot = (startHour - 6) * slotsPerHour + Math.floor(startMinute / snapDuration);
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    const durationInSlots = Math.max(1, Math.ceil(durationHours * slotsPerHour));
    const remainderMinutes = startMinute % snapDuration;
    const minuteHeight = slotHeight / snapDuration;

    return {
      gridRowStart: startSlot + 1,
      gridRowEnd: startSlot + 1 + durationInSlots,
      marginTop:
        remainderMinutes === 0 ? 0 : remainderMinutes * minuteHeight,
    };
  };

  const isResourceUnavailable = (
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    slot: number,
    date: Date
  ) => {
    const { hour, minute } = getTimeFromSlot(slot);
    const slotTime = new Date(date);
    slotTime.setHours(hour, minute, 0, 0);

    const unavailabilityPeriods = getUnavailabilityPeriods(date);
    return unavailabilityPeriods.some(
      (period) =>
        period.resourceId === resourceId &&
        period.resourceType === resourceType &&
        slotTime >= period.startTime &&
        slotTime < period.endTime
    );
  };

  const getUnavailabilityForSlot = (
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    slot: number,
    date: Date
  ) => {
    const { hour, minute } = getTimeFromSlot(slot);
    const slotTime = new Date(date);
    slotTime.setHours(hour, minute, 0, 0);

    const unavailabilityPeriods = getUnavailabilityPeriods(date);
    return unavailabilityPeriods.find(
      (period) =>
        period.resourceId === resourceId &&
        period.resourceType === resourceType &&
        slotTime >= period.startTime &&
        slotTime < period.endTime
    );
  };

  const handleTimeSlotClick = (
    slot: number,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    date: Date
  ) => {
    if (draggedBooking || resizingBooking || isDragging) return;
    if (actionMenuBooking) { setActionMenuBooking(null); return; }

    if (isResourceUnavailable(resourceId, resourceType, slot, date)) {
      toast.error('Cannot book during unavailable time');
      return;
    }

    if (onNewBookingWithTime) {
      const snapDuration = calendarSettings?.snap_duration || 15;
      const slotsPerHour = 60 / snapDuration;
      const startTime = formatTimeSlot(slot);
      const endTime = formatTimeSlot(slot + slotsPerHour);
      onNewBookingWithTime(
        date,
        startTime,
        endTime,
        resourceId,
        resourceType
      );
    }
  };

  const cancelDragDelay = () => {
    if (dragDelayTimer) {
      clearTimeout(dragDelayTimer);
      setDragDelayTimer(null);
    }
    setIsDragDelayActive(false);
  };

  const startDragDelayTimer = (
    booking: Booking,
    resourceType: 'aircraft' | 'instructor'
  ) => {
    if (isPastBooking(booking)) {
      return;
    }

    setIsDragDelayActive(true);
    const timer = setTimeout(() => {
      handleBookingDragStart(booking, resourceType);
      setIsDragDelayActive(false);
    }, 300);
    setDragDelayTimer(timer);
  };

  const handleBookingDragStart = (
    booking: Booking,
    resourceType: 'aircraft' | 'instructor'
  ) => {
    if (isPastBooking(booking)) {
      toast.error('Cannot move past bookings');
      return;
    }

    setDraggedBooking(booking);
    setDraggedBookingOriginal(booking);
    setDragPreview({
      startTime: new Date(booking.startTime),
      endTime: new Date(booking.endTime),
      resourceId: resourceType === 'aircraft' ? booking.aircraftId : booking.instructorId || '',
      resourceType
    });
  };

  const handleResizeStart = (
    e: React.MouseEvent,
    booking: Booking,
    handle: 'top' | 'bottom',
    resourceType: 'aircraft' | 'instructor'
  ) => {
    if (isPastBooking(booking)) {
      toast.error('Cannot resize past bookings');
      return;
    }

    e.stopPropagation();
    e.preventDefault();
    setWasResizing(true);
    setResizingBooking({ booking, handle });
    setDraggedBookingOriginal(booking);
    setDragPreview({
      startTime: new Date(booking.startTime),
      endTime: new Date(booking.endTime),
      resourceId: resourceType === 'aircraft' ? booking.aircraftId : booking.instructorId || '',
      resourceType
    });
  };

  const handleBookingDragOver = (
    e: React.MouseEvent,
    slot: number,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    date: Date
  ) => {
    if (!draggedBooking && !resizingBooking) return;
    e.preventDefault();
    e.stopPropagation();

    const snapDuration = calendarSettings?.snap_duration || 15;
    const slotsPerHour = 60 / snapDuration;

    const { hour, minute } = getTimeFromSlot(slot);
    const slotTime = new Date(date);
    slotTime.setHours(hour, minute, 0, 0);

    if (resizingBooking) {
      const originalStart = new Date(draggedBookingOriginal!.startTime);
      const originalEnd = new Date(draggedBookingOriginal!.endTime);
      const minDuration = snapDuration * 60 * 1000;

      if (resizingBooking.handle === 'top') {
        const newStartTime = slotTime;
        if (newStartTime.getTime() + minDuration <= originalEnd.getTime()) {
          setDragPreview({
            startTime: newStartTime,
            endTime: originalEnd,
            resourceId: resourceType === 'aircraft' ? resizingBooking.booking.aircraftId : resizingBooking.booking.instructorId || '',
            resourceType
          });
        }
      } else {
        const newEndTime = new Date(slotTime);
        newEndTime.setMinutes(newEndTime.getMinutes() + snapDuration);

        if (newEndTime.getTime() >= originalStart.getTime() + minDuration) {
          setDragPreview({
            startTime: originalStart,
            endTime: newEndTime,
            resourceId: resourceType === 'aircraft' ? resizingBooking.booking.aircraftId : resizingBooking.booking.instructorId || '',
            resourceType
          });
        }
      }
    } else if (draggedBooking) {
      const originalStart = new Date(draggedBookingOriginal!.startTime);
      const originalEnd = new Date(draggedBookingOriginal!.endTime);
      const duration = originalEnd.getTime() - originalStart.getTime();

      const newStartTime = slotTime;
      const newEndTime = new Date(newStartTime.getTime() + duration);

      setDragPreview({
        startTime: newStartTime,
        endTime: newEndTime,
        resourceId,
        resourceType
      });
    }
  };

  const handleBookingDrop = async () => {
    const booking = draggedBooking || resizingBooking?.booking;
    if (!booking || !dragPreview || !onUpdateBooking) {
      setDraggedBooking(null);
      setDraggedBookingOriginal(null);
      setDragPreview(null);
      setResizingBooking(null);
      setTimeout(() => setWasResizing(false), 100);
      return;
    }

    try {
      const updates: Partial<Booking> = {
        startTime: dragPreview.startTime,
        endTime: dragPreview.endTime
      };

      if (draggedBooking) {
        if (dragPreview.resourceType === 'aircraft' && dragPreview.resourceId !== booking.aircraftId) {
          updates.aircraftId = dragPreview.resourceId;
        } else if (dragPreview.resourceType === 'instructor' && dragPreview.resourceId !== booking.instructorId) {
          updates.instructorId = dragPreview.resourceId;
        }
      }

      await onUpdateBooking(booking.id, updates, true);
      toast.success(resizingBooking ? 'Booking resized successfully' : 'Booking moved successfully');
    } catch (error) {
      console.error('Error updating booking:', error);
      toast.error('Failed to update booking');
    } finally {
      setDraggedBooking(null);
      setDraggedBookingOriginal(null);
      setDragPreview(null);
      setResizingBooking(null);
      setTimeout(() => setWasResizing(false), 100);
    }
  };

  const handleMouseDown = (
    slot: number,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    date: Date,
    dayIndex?: number
  ) => {
    if (actionMenuBooking) return;
    if (isResourceUnavailable(resourceId, resourceType, slot, date)) return;

    setIsDragging(true);
    setDragStart({ hour: slot, resourceId, resourceType, dayIndex });
    setDragEnd({ hour: slot, resourceId, resourceType, dayIndex });
  };

  const handleMouseEnter = (
    slot: number,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    dayIndex?: number
  ) => {
    if (
      isDragging &&
      dragStart &&
      dragStart.resourceId === resourceId &&
      dragStart.resourceType === resourceType &&
      dragStart.dayIndex === dayIndex
    ) {
      setDragEnd({ hour: slot, resourceId, resourceType, dayIndex });
    }
  };

  const handleMouseUp = (date: Date) => {
    if (isDragging && dragStart && dragEnd && onNewBookingWithTime) {
      const startSlot = Math.min(dragStart.hour, dragEnd.hour);
      const endSlot = Math.max(dragStart.hour, dragEnd.hour) + 1;
      const startTime = formatTimeSlot(startSlot);
      const endTime = formatTimeSlot(endSlot);
      onNewBookingWithTime(
        date,
        startTime,
        endTime,
        dragStart.resourceId,
        dragStart.resourceType
      );
    }
    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
  };

  const isTimeSlotInDragRange = (
    slot: number,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    dayIndex?: number
  ) => {
    if (!isDragging || !dragStart || !dragEnd) return false;
    if (
      resourceId !== dragStart.resourceId ||
      resourceType !== dragStart.resourceType ||
      dayIndex !== dragStart.dayIndex
    )
      return false;

    const minSlot = Math.min(dragStart.hour, dragEnd.hour);
    const maxSlot = Math.max(dragStart.hour, dragEnd.hour);
    return slot >= minSlot && slot <= maxSlot;
  };

  const renderViewModeButtons = () => (
    <div className="flex bg-gray-100 rounded-lg p-1">
        {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
              viewMode === mode
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
    );

  const renderResourceSelectors = () => (
    <div className="flex items-center space-x-4">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Aircraft
        </label>
        <select
          value={selectedAircraftId}
          onChange={(e) => setSelectedAircraftId(e.target.value)}
          className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select Aircraft</option>
          {aircraft.map((a) => (
            <option key={a.id} value={a.id}>
              {a.registration} - {a.make} {a.model}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Instructor
        </label>
        <select
          value={selectedInstructorId}
          onChange={(e) => setSelectedInstructorId(e.target.value)}
          className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select Instructor</option>
          {instructors.map((instructor) => (
            <option key={instructor.id} value={instructor.id}>
              {instructor.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  const renderFilterControls = () => (
    <div className="flex items-center space-x-3 flex-wrap">
      <select
        value={resourceFilter}
        onChange={(e) =>
          setResourceFilter(e.target.value as any)
        }
        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="both">Aircraft & Instructors</option>
        <option value="aircraft">Aircraft Only</option>
        <option value="instructors">Instructors Only</option>
      </select>
    </div>
  );

  const renderDayView = () => {
    const timeSlots = getTimeSlots();
    const resources = getAllResources();

    return (
      <div className="p-6">
        <div className="resource-calendar-grid relative border border-gray-200 rounded-lg overflow-hidden bg-white">
          {/* Fixed header */}
          <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
            <div
              className="grid"
              style={{
                gridTemplateColumns: `80px repeat(${resources.length}, 1fr)`,
              }}
            >
              <div className="bg-gray-50 border-r border-gray-200 p-2 h-[80px] flex items-center justify-center">
                <span className="text-xs font-medium text-gray-500 transform -rotate-90">
                  Local time
                </span>
              </div>

              {resources.map((resource) => (
                <div
                  key={resource.id}
                  className="bg-gray-50 border-r border-gray-200 p-2 text-center h-[80px] flex flex-col justify-center"
                >
                  <div className="flex items-center justify-center space-x-1 mb-1">
                    {resource.icon}
                    <span className="text-xs font-semibold text-gray-900 truncate">
                      {resource.name}
                    </span>
                  </div>
                  <div
                    className={`text-xs font-medium ${
                      isToday(currentDate)
                        ? 'text-blue-600'
                        : 'text-gray-500'
                    }`}
                  >
                    {format(currentDate, 'EEE d')}
                  </div>
                  {resource.status &&
                    resource.status !== 'serviceable' && (
                      <div className="text-xs text-red-600 mt-1 capitalize">
                        {resource.status}
                      </div>
                    )}
                </div>
                ))}
            </div>
          </div>

          {/* Time slots and resource columns */}
          <div
            className="relative overflow-hidden"
            style={{
              display: 'grid',
              gridTemplateColumns: `80px repeat(${resources.length}, 1fr)`,
              gridTemplateRows: `repeat(${timeSlots.length}, ${slotHeight}px)`,
            }}
          >
            {/* Current Time Indicator */}
            <CurrentTimeIndicator isVisible={isToday(currentDate) && (calendarSettings?.show_current_time_indicator ?? true)} />

            {timeSlots.map((slot, slotIndex) => {
              const snapDuration = calendarSettings?.snap_duration || 15;
              const slotsPerHour = 60 / snapDuration;
              const { minute } = getTimeFromSlot(slot);
              const isHourStart = minute === 0;
              const isHalfHourMarker = snapDuration <= 15 && minute === 15;
              const timeLabel = isHourStart ? formatHourLabel(slot) : '';
              const resourceBorderClasses = `${
                isHourStart ? ' border-t border-gray-200' : ''
              }${
                isHalfHourMarker
                  ? ' border-b border-dotted border-gray-300'
                  : ''
              }`;

              return (
                <React.Fragment key={slot}>
                  {/* Time label */}
                  {isHourStart && (
                    <div
                      className="relative bg-white border-r border-gray-200 border-t border-gray-200 pr-2 flex items-start justify-end"
                      style={{
                        gridColumn: 1,
                        gridRow: `${slotIndex + 1} / span ${slotsPerHour}`,
                        paddingTop: 2,
                      }}
                    >
                      {timeLabel && (
                        <span className="text-xs font-semibold text-gray-500 leading-none">
                          {timeLabel}
                        </span>
                      )}
                      <div
                        className="pointer-events-none absolute left-0 right-0 border-b border-dotted border-gray-300"
                        style={{ top: '50%' }}
                      />
                    </div>
                  )}

                  {/* Resource columns */}
                  {resources.map((resource, resourceIndex) => {
                    const unavailability = getUnavailabilityForSlot(
                      resource.id,
                      resource.type,
                      slot,
                      currentDate
                    );

                    const prevSlot = slot - 1;
                    const prevUnavailability = prevSlot >= timeSlots[0] ? getUnavailabilityForSlot(
                      resource.id,
                      resource.type,
                      prevSlot,
                      currentDate
                    ) : null;

                    const isFirstSlotOfPeriod = unavailability && (
                      !prevUnavailability ||
                      prevUnavailability.reason !== unavailability.reason ||
                      prevUnavailability.startTime.getTime() !== unavailability.startTime.getTime()
                    );

                    const isInDragRange = isTimeSlotInDragRange(
                      slot,
                      resource.id,
                      resource.type
                    );
                    const hourIndex = Math.floor(slot / slotsPerHour);
                    const isAlternateHour = hourIndex % 2 === 1;
                    const cursorClass = unavailability
                      ? 'cursor-not-allowed'
                      : 'cursor-pointer';
                    const backgroundClass = unavailability
                      ? ''
                      : isInDragRange
                      ? 'bg-blue-100'
                      : isAlternateHour
                      ? 'bg-blue-50 hover:bg-blue-100'
                      : 'hover:bg-gray-50';
                    const borderClasses = resourceBorderClasses;

                    return (
                      <div
                        key={`${resource.id}-${slot}`}
                        className={`border-r border-gray-200 relative transition-colors${borderClasses} ${cursorClass} ${backgroundClass}`}
                        style={{
                          height: slotHeight,
                          gridColumn: resourceIndex + 2,
                          gridRow: slotIndex + 1,
                          background: unavailability
                            ? unavailability.pattern === 'diagonal'
                              ? `repeating-linear-gradient(
                                  45deg,
                                  rgba(156, 163, 175, 0.3),
                                  rgba(156, 163, 175, 0.3) 4px,
                                  transparent 4px,
                                  transparent 8px
                                )`
                              : 'rgba(156, 163, 175, 0.5)'
                            : undefined,
                        }}
                        onClick={() =>
                          !unavailability &&
                          handleTimeSlotClick(
                            slot,
                            resource.id,
                            resource.type,
                            currentDate
                          )
                        }
                        onMouseDown={(e) =>
                          !unavailability && !draggedBooking &&
                          handleMouseDown(
                            slot,
                            resource.id,
                            resource.type,
                            currentDate
                          )
                        }
                        onMouseUp={() => {
                          if (draggedBooking || resizingBooking) {
                            handleBookingDrop();
                          } else {
                            handleMouseUp(currentDate);
                          }
                        }}
                        onMouseEnter={(e) => {
                          if (draggedBooking || resizingBooking) {
                            handleBookingDragOver(e, slot, resource.id, resource.type, currentDate);
                          } else {
                            handleMouseEnter(
                              slot,
                              resource.id,
                              resource.type
                            );
                          }
                        }}
                      >
                        {unavailability && isFirstSlotOfPeriod && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xs text-gray-600 font-medium bg-white bg-opacity-75 px-1 rounded">
                              {unavailability.reason}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}

            {/* Render bookings as grid items */}
            {resources.map((resource, resourceIndex) =>
              getBookingsForResource(
                resource.id,
                resource.type,
                currentDate
              ).map((booking) => {
                const position = getBookingPosition(booking);
                const bookingStart = new Date(booking.startTime);
                const bookingEnd = new Date(booking.endTime);
                const startOffset = bookingStart.getMinutes() % 30;
                const endOffset = bookingEnd.getMinutes() % 30;
                const showHalfHourMarker = startOffset === 15 || endOffset === 15;
                const isBeingDragged = draggedBooking?.id === booking.id || resizingBooking?.booking.id === booking.id;
                const isBeingResized = resizingBooking?.booking.id === booking.id;
                const isPastUnlogged = isPastBooking(booking) && !booking.flight_logged;
                const shouldFlash = highlightUnlogged && isPastUnlogged;

                return (
                  <div
                    key={`${booking.id}-${resource.id}`}
                    data-booking-element
                    className={`${
                      shouldFlash
                        ? 'flash-unlogged'
                        : booking.hasConflict
                        ? 'bg-red-500 border-red-600 hover:bg-red-600'
                        : booking.flight_logged
                        ? 'bg-green-500 border-green-600 hover:bg-green-600'
                        : isPastUnlogged
                        ? 'bg-red-500 border-red-600 hover:bg-red-600'
                        : 'bg-blue-500 border-blue-600 hover:bg-blue-600'
                    } relative text-white text-xs p-2 rounded shadow-sm overflow-hidden cursor-move transition-colors z-10 border ${
                      isBeingDragged
                        ? 'opacity-30 pointer-events-none'
                        : ''
                    } ${isBeingResized ? 'pointer-events-none' : ''} group`}
                    style={{
                      gridColumn: resourceIndex + 2,
                      gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                      marginTop: position.marginTop,
                      minHeight: slotHeight,
                    }}
                    title={`${booking.notes || 'Booking'}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (!isPastBooking(booking)) {
                        startDragDelayTimer(booking, resource.type);
                      }
                    }}
                    onMouseUp={cancelDragDelay}
                    onMouseLeave={cancelDragDelay}
                    onClick={(e) => {
                      e.stopPropagation();

                      // Cancel any drag state
                      if (dragDelayTimer) {
                        clearTimeout(dragDelayTimer);
                        setDragDelayTimer(null);
                      }
                      setIsDragDelayActive(false);

                      // If drag already started, cancel it
                      if (draggedBooking) {
                        setDraggedBooking(null);
                        setDraggedBookingOriginal(null);
                        setDragPreview(null);
                        return;
                      }

                      if (wasResizing) {
                        return;
                      }

                      if (hasBookingStarted(booking)) {
                        setActionMenuBooking(booking);
                        setActionMenuPosition({ x: e.clientX, y: e.clientY });
                      } else if (onEditBooking) {
                        onEditBooking(booking);
                      }
                    }}
                  >
                    {!isPastBooking(booking) && (
                      <>
                        <div
                          className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleResizeStart(e, booking, 'top', resource.type);
                          }}
                          title="Drag to change start time"
                        />
                        <div
                          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleResizeStart(e, booking, 'bottom', resource.type);
                          }}
                          title="Drag to change end time"
                        />
                      </>
                    )}
                    {showHalfHourMarker && (
                      <div className="pointer-events-none absolute inset-x-1 top-1/2 h-0.5 bg-white/70" />
                    )}
                    <div className="font-medium text-xs truncate">
                      {resource.type === 'aircraft'
                        ? resource.name
                        : 'Lesson'}
                    </div>
                    <div className="text-xs truncate">
                      {resource.type === 'instructor'
                        ? resource.name
                        : 'Solo'}
                    </div>
                    <div className="text-xs opacity-75 truncate">
                      {format(
                        new Date(booking.startTime),
                        'HH:mm'
                      )}{' '}
                      -{' '}
                      {format(
                        new Date(booking.endTime),
                        'HH:mm'
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* Render drag preview */}
            {dragPreview && (draggedBooking || resizingBooking) && resources.map((resource, resourceIndex) => {
              if (resource.id !== dragPreview.resourceId || resource.type !== dragPreview.resourceType) {
                return null;
              }

              const booking = draggedBooking || resizingBooking?.booking;
              const previewPosition = getBookingPosition({
                ...booking!,
                startTime: dragPreview.startTime,
                endTime: dragPreview.endTime
              });

              return (
                <div
                  key={`preview-${resource.id}`}
                  className="bg-blue-300 border-2 border-blue-600 border-dashed relative text-white text-xs p-2 rounded shadow-lg overflow-hidden z-20 opacity-70"
                  style={{
                    gridColumn: resourceIndex + 2,
                    gridRow: `${previewPosition.gridRowStart} / ${previewPosition.gridRowEnd}`,
                    marginTop: previewPosition.marginTop,
                    minHeight: slotHeight,
                    pointerEvents: 'none'
                  }}
                >
                  <div className="font-medium text-xs truncate">
                    {resource.type === 'aircraft'
                      ? resource.name
                      : 'Lesson'}
                  </div>
                  <div className="text-xs opacity-75 truncate">
                    {format(dragPreview.startTime, 'HH:mm')} - {format(dragPreview.endTime, 'HH:mm')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekDays = getWeekDays();
    const timeSlots = getTimeSlots();
    const selectedResources = getSelectedResources();

    if (selectedResources.length === 0) {
      return (
        <div className="p-6">
          <div className="text-center py-12 bg-white rounded-lg shadow-md border border-gray-200">
            <div className="text-gray-400 mb-4">
              <Plane className="h-16 w-16 mx-auto mb-2" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Select Resources
            </h3>
            <p className="text-gray-600">
              Please select at least one aircraft or instructor to view the week
              schedule.
            </p>
          </div>
        </div>
      );
    }

    // Calculate columns: each day has either 1 or 2 columns based on resource selection
    const hasAircraft = selectedAircraftId !== '';
    const hasInstructor = selectedInstructorId !== '';
    const columnsPerDay =
      hasAircraft && hasInstructor ? 2 : 1;
    const totalColumns = weekDays.length * columnsPerDay;

    return (
      <div className="p-6">
        <div className="resource-calendar-grid relative border border-gray-200 rounded-lg overflow-hidden bg-white">
          {/* Fixed header */}
          <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
            <div
              className="grid"
              style={{
                gridTemplateColumns: `80px repeat(${totalColumns}, 1fr)`,
              }}
            >
              <div className="bg-gray-50 border-r border-gray-200 p-2 h-[80px] flex items-center justify-center">
                <span className="text-xs font-medium text-gray-500 transform -rotate-90">
                  Local time
                </span>
              </div>

              {weekDays.map((day, dayIndex) => {
                const dayColumns = [];

                // Add aircraft column if selected
                if (hasAircraft) {
                  const selectedAircraft = aircraft.find(
                    (a) => a.id === selectedAircraftId
                  );
                  if (selectedAircraft) {
                    dayColumns.push(
                      <div
                        key={`${dayIndex}-aircraft`}
                        className="bg-gray-50 border-r border-gray-200 p-2 text-center h-[80px] flex flex-col justify-center"
                      >
                        <div className="flex items-center justify-center space-x-1 mb-1">
                          <Plane className="h-4 w-4" />
                          <span className="text-xs font-semibold text-gray-900 truncate">
                            {selectedAircraft.registration}
                          </span>
                        </div>
                        <div
                          className={`text-xs font-medium ${
                            isToday(day)
                              ? 'text-blue-600'
                              : 'text-gray-500'
                          }`}
                        >
                          {format(day, 'EEE d')}
                        </div>
                        {selectedAircraft.status &&
                          selectedAircraft.status !== 'serviceable' && (
                            <div className="text-xs text-red-600 mt-1 capitalize">
                              {selectedAircraft.status}
                            </div>
                          )}
                      </div>
                    );
                  }
                }

                // Add instructor column if selected
                if (hasInstructor) {
                  const instructor = instructors.find(
                    (i) => i.id === selectedInstructorId
                  );
                  if (instructor) {
                    dayColumns.push(
                      <div
                        key={`${dayIndex}-instructor`}
                        className="bg-gray-50 border-r border-gray-200 p-2 text-center h-[80px] flex flex-col justify-center"
                      >
                        <div className="flex items-center justify-center space-x-1 mb-1">
                          <User className="h-4 w-4" />
                          <span className="text-xs font-semibold text-gray-900 truncate">
                            {instructor.name}
                          </span>
                        </div>
                        <div
                          className={`text-xs font-medium ${
                            isToday(day)
                              ? 'text-blue-600'
                              : 'text-gray-500'
                          }`}
                        >
                          {format(day, 'EEE d')}
                        </div>
                      </div>
                    );
                  }
                }

                return dayColumns;
              })}
            </div>
          </div>

          {/* Time slots and resource columns */}
          <div
            className="relative overflow-hidden"
            style={{
              display: 'grid',
              gridTemplateColumns: `80px repeat(${totalColumns}, 1fr)`,
              gridTemplateRows: `repeat(${timeSlots.length}, ${slotHeight}px)`,
            }}
          >
            {/* Current Time Indicator - show on today only */}
            <CurrentTimeIndicator
              isVisible={weekDays.some((day) => isToday(day)) && (calendarSettings?.show_current_time_indicator ?? true)}
            />

            {timeSlots.map((slot, slotIndex) => {
              const snapDuration = calendarSettings?.snap_duration || 15;
              const slotsPerHour = 60 / snapDuration;
              const { minute } = getTimeFromSlot(slot);
              const isHourStart = minute === 0;
              const isHalfHourMarker = snapDuration <= 15 && minute === 15;
              const timeLabel = isHourStart ? formatHourLabel(slot) : '';
              const resourceBorderClasses = `${
                isHourStart ? ' border-t border-gray-200' : ''
              }${
                isHalfHourMarker
                  ? ' border-b border-dotted border-gray-300'
                  : ''
              }`;

              return (
                <React.Fragment key={slot}>
                  {/* Time label */}
                  {isHourStart && (
                    <div
                      className="relative bg-white border-r border-gray-200 border-t border-gray-200 pr-2 flex items-start justify-end"
                      style={{
                        gridColumn: 1,
                        gridRow: `${slotIndex + 1} / span ${slotsPerHour}`,
                        paddingTop: 2,
                      }}
                    >
                      {timeLabel && (
                        <span className="text-xs font-semibold text-gray-500 leading-none">
                          {timeLabel}
                        </span>
                      )}
                      <div
                        className="pointer-events-none absolute left-0 right-0 border-b border-dotted border-gray-300"
                        style={{ top: '50%' }}
                      />
                    </div>
                  )}

                  {/* Resource columns for each day */}
                  {weekDays.map((day, dayIndex) => {
                    const daySlots = [];
                    let columnOffset = 0;
                    const hourIndex = Math.floor(slot / slotsPerHour);
                    const isAlternateHour = hourIndex % 2 === 1;
                    const borderClasses = resourceBorderClasses;

                    // Add aircraft column if selected
                    if (hasAircraft) {
                      const unavailability = getUnavailabilityForSlot(
                        selectedAircraftId,
                        'aircraft',
                        slot,
                        day
                      );

                      const prevSlot = slot - 1;
                      const prevUnavailability = prevSlot >= timeSlots[0] ? getUnavailabilityForSlot(
                        selectedAircraftId,
                        'aircraft',
                        prevSlot,
                        day
                      ) : null;

                      const isFirstSlotOfPeriod = unavailability && (
                        !prevUnavailability ||
                        prevUnavailability.reason !== unavailability.reason ||
                        prevUnavailability.startTime.getTime() !== unavailability.startTime.getTime()
                      );

                      const isInDragRange = isTimeSlotInDragRange(
                        slot,
                        selectedAircraftId,
                        'aircraft',
                        dayIndex
                      );
                      const columnIndex = dayIndex * columnsPerDay + columnOffset;
                      const cursorClass = unavailability
                        ? 'cursor-not-allowed'
                        : 'cursor-pointer';
                      const backgroundClass = unavailability
                        ? ''
                        : isInDragRange
                        ? 'bg-blue-100'
                        : isAlternateHour
                        ? 'bg-blue-50 hover:bg-blue-100'
                        : 'hover:bg-gray-50';

                      daySlots.push(
                        <div
                          key={`${dayIndex}-aircraft-${slot}`}
                          className={`border-r border-gray-200 relative transition-colors${borderClasses} ${cursorClass} ${backgroundClass}`}
                          style={{
                            height: slotHeight,
                            gridColumn: columnIndex + 2,
                            gridRow: slotIndex + 1,
                            background: unavailability
                              ? unavailability.pattern === 'diagonal'
                                ? `repeating-linear-gradient(
                                    45deg,
                                    rgba(156, 163, 175, 0.3),
                                    rgba(156, 163, 175, 0.3) 4px,
                                    transparent 4px,
                                    transparent 8px
                                  )`
                                : 'rgba(156, 163, 175, 0.5)'
                              : undefined,
                          }}
                          onClick={() =>
                            !unavailability &&
                            handleTimeSlotClick(
                              slot,
                              selectedAircraftId,
                              'aircraft',
                              day
                            )
                          }
                          onMouseDown={(e) =>
                            !unavailability && !draggedBooking &&
                            handleMouseDown(
                              slot,
                              selectedAircraftId,
                              'aircraft',
                              day,
                              dayIndex
                            )
                          }
                          onMouseUp={() => {
                            if (draggedBooking || resizingBooking) {
                              handleBookingDrop();
                            } else {
                              handleMouseUp(day);
                            }
                          }}
                          onMouseEnter={(e) => {
                            if (draggedBooking || resizingBooking) {
                              handleBookingDragOver(e, slot, selectedAircraftId, 'aircraft', day);
                            } else {
                              handleMouseEnter(
                                slot,
                                selectedAircraftId,
                                'aircraft',
                                dayIndex
                              );
                            }
                          }}
                        >
                          {unavailability && isFirstSlotOfPeriod && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs text-gray-600 font-medium bg-white bg-opacity-75 px-1 rounded">
                                {unavailability.reason}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                      columnOffset++;
                    }

                    // Add instructor column if selected
                    if (hasInstructor) {
                      const unavailability = getUnavailabilityForSlot(
                        selectedInstructorId,
                        'instructor',
                        slot,
                        day
                      );

                      const prevSlot = slot - 1;
                      const prevUnavailability = prevSlot >= timeSlots[0] ? getUnavailabilityForSlot(
                        selectedInstructorId,
                        'instructor',
                        prevSlot,
                        day
                      ) : null;

                      const isFirstSlotOfPeriod = unavailability && (
                        !prevUnavailability ||
                        prevUnavailability.reason !== unavailability.reason ||
                        prevUnavailability.startTime.getTime() !== unavailability.startTime.getTime()
                      );

                      const isInDragRange = isTimeSlotInDragRange(
                        slot,
                        selectedInstructorId,
                        'instructor',
                        dayIndex
                      );
                      const columnIndex = dayIndex * columnsPerDay + columnOffset;
                      const cursorClass = unavailability
                        ? 'cursor-not-allowed'
                        : 'cursor-pointer';
                      const backgroundClass = unavailability
                        ? ''
                        : isInDragRange
                        ? 'bg-blue-100'
                        : isAlternateHour
                        ? 'bg-blue-50 hover:bg-blue-100'
                        : 'hover:bg-gray-50';

                      daySlots.push(
                        <div
                          key={`${dayIndex}-instructor-${slot}`}
                          className={`border-r border-gray-200 relative transition-colors${borderClasses} ${cursorClass} ${backgroundClass}`}
                          style={{
                            height: slotHeight,
                            gridColumn: columnIndex + 2,
                            gridRow: slotIndex + 1,
                            background: unavailability
                              ? unavailability.pattern === 'diagonal'
                                ? `repeating-linear-gradient(
                                    45deg,
                                    rgba(156, 163, 175, 0.3),
                                    rgba(156, 163, 175, 0.3) 4px,
                                    transparent 4px,
                                    transparent 8px
                                  )`
                                : 'rgba(156, 163, 175, 0.5)'
                              : undefined,
                          }}
                          onClick={() =>
                            !unavailability &&
                            handleTimeSlotClick(
                              slot,
                              selectedInstructorId,
                              'instructor',
                              day
                            )
                          }
                          onMouseDown={(e) =>
                            !unavailability && !draggedBooking &&
                            handleMouseDown(
                              slot,
                              selectedInstructorId,
                              'instructor',
                              day,
                              dayIndex
                            )
                          }
                          onMouseUp={() => {
                            if (draggedBooking || resizingBooking) {
                              handleBookingDrop();
                            } else {
                              handleMouseUp(day);
                            }
                          }}
                          onMouseEnter={(e) => {
                            if (draggedBooking || resizingBooking) {
                              handleBookingDragOver(e, slot, selectedInstructorId, 'instructor', day);
                            } else {
                              handleMouseEnter(
                                slot,
                                selectedInstructorId,
                                'instructor',
                                dayIndex
                              );
                            }
                          }}
                        >
                          {unavailability && isFirstSlotOfPeriod && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs text-gray-600 font-medium bg-white bg-opacity-75 px-1 rounded">
                                {unavailability.reason}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    }

                    return daySlots;
                  })}
                  </React.Fragment>
                );
              })}

            {/* Render bookings as grid items */}
            {weekDays.map((day, dayIndex) => {
              const bookingElements = [];
              let columnOffset = 0;

              // Add aircraft bookings if selected
              if (hasAircraft) {
                const columnIndex = dayIndex * columnsPerDay + columnOffset;
                const aircraftBookings = getBookingsForResource(
                  selectedAircraftId,
                  'aircraft',
                  day
                );

                aircraftBookings.forEach((booking) => {
                  const position = getBookingPosition(booking);
                  const bookingStart = new Date(booking.startTime);
                  const bookingEnd = new Date(booking.endTime);
                  const startOffset = bookingStart.getMinutes() % 30;
                  const endOffset = bookingEnd.getMinutes() % 30;
                  const showHalfHourMarker =
                    startOffset === 15 || endOffset === 15;
                  const isBeingDragged = draggedBooking?.id === booking.id || resizingBooking?.booking.id === booking.id;
                  const isBeingResized = resizingBooking?.booking.id === booking.id;
                  const isPastUnloggedAircraft = isPastBooking(booking) && !booking.flight_logged;
                  const shouldFlash = highlightUnlogged && isPastUnloggedAircraft;

                  bookingElements.push(
                    <div
                      key={`${booking.id}-${dayIndex}-aircraft`}
                      data-booking-element
                      className={`${
                        shouldFlash
                          ? 'flash-unlogged'
                          : booking.hasConflict
                          ? 'bg-red-500 border-red-600 hover:bg-red-600'
                          : booking.flight_logged
                          ? 'bg-green-500 border-green-600 hover:bg-green-600'
                          : isPastUnloggedAircraft
                          ? 'bg-red-500 border-red-600 hover:bg-red-600'
                          : 'bg-blue-500 border-blue-600 hover:bg-blue-600'
                      } relative text-white text-xs p-2 rounded shadow-sm overflow-hidden cursor-move transition-colors z-10 border ${
                        isBeingDragged ? 'opacity-30 pointer-events-none' : ''
                      } ${isBeingResized ? 'pointer-events-none' : ''} group`}
                      style={{
                        gridColumn: columnIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        minHeight: slotHeight,
                      }}
                      title={`${booking.notes || 'Booking'}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (!isPastBooking(booking)) {
                          startDragDelayTimer(booking, 'aircraft');
                        }
                      }}
                      onMouseUp={cancelDragDelay}
                      onMouseLeave={cancelDragDelay}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (wasResizing) {
                          return;
                        }

                        if (hasBookingStarted(booking)) {
                          setActionMenuBooking(booking);
                          setActionMenuPosition({ x: e.clientX, y: e.clientY });
                        } else if (onEditBooking && !draggedBooking) {
                          onEditBooking(booking);
                        }
                      }}
                    >
                      {!isPastBooking(booking) && (
                        <>
                          <div
                            className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleResizeStart(e, booking, 'top', 'aircraft');
                            }}
                            title="Drag to change start time"
                          />
                          <div
                            className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleResizeStart(e, booking, 'bottom', 'aircraft');
                            }}
                            title="Drag to change end time"
                          />
                        </>
                      )}
                      {showHalfHourMarker && (
                        <div className="pointer-events-none absolute inset-x-1 top-1/2 h-0.5 bg-white/70" />
                      )}
                      <div className="font-medium text-xs truncate">
                        Aircraft
                      </div>
                      <div className="text-xs truncate">
                        {booking.instructorId ? 'With Instructor' : 'Solo'}
                      </div>
                      <div className="text-xs opacity-75 truncate">
                        {format(
                          new Date(booking.startTime),
                          'HH:mm'
                        )}{' '}
                        -{' '}
                        {format(
                          new Date(booking.endTime),
                          'HH:mm'
                        )}
                      </div>
                    </div>
                  );
                });
                columnOffset++;
              }

              // Add instructor bookings if selected
              if (hasInstructor) {
                const columnIndex = dayIndex * columnsPerDay + columnOffset;
                const instructorBookings = getBookingsForResource(
                  selectedInstructorId,
                  'instructor',
                  day
                );

                instructorBookings.forEach((booking) => {
                  const position = getBookingPosition(booking);
                  const bookingStart = new Date(booking.startTime);
                  const bookingEnd = new Date(booking.endTime);
                  const startOffset = bookingStart.getMinutes() % 30;
                  const endOffset = bookingEnd.getMinutes() % 30;
                  const showHalfHourMarker =
                    startOffset === 15 || endOffset === 15;
                  const isBeingDragged = draggedBooking?.id === booking.id || resizingBooking?.booking.id === booking.id;
                  const isBeingResized = resizingBooking?.booking.id === booking.id;
                  const isPastUnloggedInstructor = isPastBooking(booking) && !booking.flight_logged;
                  const shouldFlash = highlightUnlogged && isPastUnloggedInstructor;

                  bookingElements.push(
                    <div
                      key={`${booking.id}-${dayIndex}-instructor`}
                      data-booking-element
                      className={`${
                        shouldFlash
                          ? 'flash-unlogged'
                          : booking.hasConflict
                          ? 'bg-red-500 border-red-600 hover:bg-red-600'
                          : booking.flight_logged
                          ? 'bg-green-500 border-green-600 hover:bg-green-600'
                          : isPastUnloggedInstructor
                          ? 'bg-red-500 border-red-600 hover:bg-red-600'
                          : 'bg-blue-500 border-blue-600 hover:bg-blue-600'
                      } relative text-white text-xs p-2 rounded shadow-sm overflow-hidden cursor-move transition-colors z-10 border ${
                        isBeingDragged ? 'opacity-30 pointer-events-none' : ''
                      } ${isBeingResized ? 'pointer-events-none' : ''} group`}
                      style={{
                        gridColumn: columnIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        minHeight: slotHeight,
                      }}
                      title={`${booking.notes || 'Booking'}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (!isPastBooking(booking)) {
                          startDragDelayTimer(booking, 'instructor');
                        }
                      }}
                      onMouseUp={cancelDragDelay}
                      onMouseLeave={cancelDragDelay}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (wasResizing) {
                          return;
                        }

                        if (hasBookingStarted(booking)) {
                          setActionMenuBooking(booking);
                          setActionMenuPosition({ x: e.clientX, y: e.clientY });
                        } else if (onEditBooking && !draggedBooking) {
                          onEditBooking(booking);
                        }
                      }}
                    >
                      {!isPastBooking(booking) && (
                        <>
                          <div
                            className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleResizeStart(e, booking, 'top', 'instructor');
                            }}
                            title="Drag to change start time"
                          />
                          <div
                            className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleResizeStart(e, booking, 'bottom', 'instructor');
                            }}
                            title="Drag to change end time"
                          />
                        </>
                      )}
                      {showHalfHourMarker && (
                        <div className="pointer-events-none absolute inset-x-1 top-1/2 h-0.5 bg-white/70" />
                      )}
                      <div className="font-medium text-xs truncate">
                        Instructor
                      </div>
                      <div className="text-xs truncate">
                        Lesson
                      </div>
                      <div className="text-xs opacity-75 truncate">
                        {format(
                          new Date(booking.startTime),
                          'HH:mm'
                        )}{' '}
                        -{' '}
                        {format(
                          new Date(booking.endTime),
                          'HH:mm'
                        )}
                      </div>
                    </div>
                  );
                });
              }

              return bookingElements;
            })}

            {/* Render drag preview */}
            {dragPreview && (draggedBooking || resizingBooking) && weekDays.map((day, dayIndex) => {
              const previewElements = [];
              let columnOffset = 0;
              const booking = draggedBooking || resizingBooking?.booking;

              // Check if preview is on this day
              if (!isSameDay(dragPreview.startTime, day)) {
                return null;
              }

              // Add aircraft preview if selected and matches
              if (hasAircraft && dragPreview.resourceType === 'aircraft' && dragPreview.resourceId === selectedAircraftId) {
                const columnIndex = dayIndex * columnsPerDay + columnOffset;
                const previewPosition = getBookingPosition({
                  ...booking!,
                  startTime: dragPreview.startTime,
                  endTime: dragPreview.endTime
                });

                previewElements.push(
                  <div
                    key={`preview-${dayIndex}-aircraft`}
                    className="bg-blue-300 border-2 border-blue-600 border-dashed relative text-white text-xs p-2 rounded shadow-lg overflow-hidden z-20 opacity-70"
                    style={{
                      gridColumn: columnIndex + 2,
                      gridRow: `${previewPosition.gridRowStart} / ${previewPosition.gridRowEnd}`,
                      marginTop: previewPosition.marginTop,
                      minHeight: slotHeight,
                      pointerEvents: 'none'
                    }}
                  >
                    <div className="font-medium text-xs truncate">Aircraft</div>
                    <div className="text-xs opacity-75 truncate">
                      {format(dragPreview.startTime, 'HH:mm')} - {format(dragPreview.endTime, 'HH:mm')}
                    </div>
                  </div>
                );
              }
              columnOffset = hasAircraft ? 1 : 0;

              // Add instructor preview if selected and matches
              if (hasInstructor && dragPreview.resourceType === 'instructor' && dragPreview.resourceId === selectedInstructorId) {
                const columnIndex = dayIndex * columnsPerDay + columnOffset;
                const previewPosition = getBookingPosition({
                  ...booking!,
                  startTime: dragPreview.startTime,
                  endTime: dragPreview.endTime
                });

                previewElements.push(
                  <div
                    key={`preview-${dayIndex}-instructor`}
                    className="bg-blue-300 border-2 border-blue-600 border-dashed relative text-white text-xs p-2 rounded shadow-lg overflow-hidden z-20 opacity-70"
                    style={{
                      gridColumn: columnIndex + 2,
                      gridRow: `${previewPosition.gridRowStart} / ${previewPosition.gridRowEnd}`,
                      marginTop: previewPosition.marginTop,
                      minHeight: slotHeight,
                      pointerEvents: 'none'
                    }}
                  >
                    <div className="font-medium text-xs truncate">Instructor</div>
                    <div className="text-xs opacity-75 truncate">
                      {format(dragPreview.startTime, 'HH:mm')} - {format(dragPreview.endTime, 'HH:mm')}
                    </div>
                  </div>
                );
              }

              return previewElements;
            })}
          </div>
        </div>
      </div>
    );
  };

  const getDateRangeText = () => {
    if (viewMode === 'day') {
      return format(currentDate, 'EEEE, MMMM d, yyyy');
    } else if (viewMode === 'week') {
      const weekDays = getWeekDays();
      const start = weekDays[0];
      const end = weekDays[6];
      return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
    }
    return format(currentDate, 'MMMM yyyy');
  };

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 select-none">
      <div className="p-6 border-b border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-4">
            <h2 className="text-xl font-semibold text-gray-900">Calendar</h2>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => navigateDate('prev')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm text-gray-600 min-w-[200px] text-center">
                {getDateRangeText()}
              </span>
              <button
                onClick={() => navigateDate('next')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex items-center space-x-3 flex-wrap">
            {renderViewModeButtons()}

            <label className="flex items-center space-x-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={highlightUnlogged}
                onChange={(e) => setHighlightUnlogged(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Highlight Unlogged</span>
            </label>

            <button
              onClick={onNewBooking}
              className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>New Booking</span>
            </button>
          </div>
        </div>

        {/* Resource selectors for week view */}
        {viewMode === 'week' && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            {renderResourceSelectors()}
          </div>
        )}

        {/* Filters for day view */}
        {viewMode === 'day' && (
          <div className="hidden lg:flex items-center space-x-3">
            {renderFilterControls()}
          </div>
        )}

        {viewMode === 'day' && (
          <div className="lg:hidden">
            <button
              onClick={() => setShowMobileFilters(!showMobileFilters)}
              className="flex items-center space-x-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Filter className="h-4 w-4" />
              <span>Filter</span>
            </button>
          </div>
        )}

        {showMobileFilters && viewMode === 'day' && (
          <div className="lg:hidden mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            {renderFilterControls()}
          </div>
        )}
      </div>

      {viewMode === 'day' && renderDayView()}
      {viewMode === 'week' && renderWeekView()}
      {viewMode === 'month' && (
        <MonthView
          currentDate={currentDate}
          bookings={bookings}
          aircraft={aircraft}
          instructors={instructors}
          onDayClick={(date) => {
            setCurrentDate(date);
            setViewMode('day');
          }}
        />
      )}

      {actionMenuBooking && (
        <div
          className="fixed inset-0 z-40"
          onMouseDown={(e) => { e.stopPropagation(); setActionMenuBooking(null); }}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {actionMenuBooking && (
        <BookingActionMenu
          booking={actionMenuBooking}
          position={actionMenuPosition}
          onEdit={() => {
            if (onEditBooking) {
              onEditBooking(actionMenuBooking);
            }
          }}
          onLogFlight={() => {
            setFlightLogBooking(actionMenuBooking);
            setShowFlightLogModal(true);
          }}
          onDelete={() => {
            if (onDeleteBooking) {
              onDeleteBooking(actionMenuBooking.id);
            }
          }}
          onClose={() => setActionMenuBooking(null)}
        />
      )}

      {showFlightLogModal && flightLogBooking && (
        <FlightLogModal
          booking={flightLogBooking}
          onClose={() => {
            setShowFlightLogModal(false);
            setFlightLogBooking(null);
          }}
          onSuccess={() => {
            setShowFlightLogModal(false);
            setFlightLogBooking(null);
          }}
        />
      )}
    </div>
  );
};
