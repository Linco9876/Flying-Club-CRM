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
import { Booking } from '../../types';
import { CurrentTimeIndicator } from './CurrentTimeIndicator';
import { MonthView } from './MonthView';
import { isPastBooking } from '../../utils/timeUtils';
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
  onUpdateBooking?: (bookingId: string, updates: Partial<Booking>) => void;
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
}) => {
  const { aircraft } = useAircraft();
  const { getInstructors } = useUsers();
  const instructors = getInstructors();
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
  const [resizingBooking, setResizingBooking] = useState<{
    booking: Booking;
    handle: 'top' | 'bottom';
  } | null>(null);
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

  // Dynamic slot height based on viewport
  const [slotHeight, setSlotHeight] = useState<number>(60);

  useKeyboardNavigation({
    onArrowLeft: () => navigateDate('prev'),
    onArrowRight: () => navigateDate('next'),
    onEscape: () => {
      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
    },
    enabled: true,
  });

  // Compute slot height on mount and resize
  useEffect(() => {
    const computeSlotHeight = () => {
      // Adjust headerHeight to reflect your layout (controls + top padding)
      const headerHeight = 200;
      const availableHeight = window.innerHeight - headerHeight;
      const numSlots = getTimeSlots().length;
      setSlotHeight(availableHeight / numSlots);
    };

    computeSlotHeight();
    window.addEventListener('resize', computeSlotHeight);
    return () => window.removeEventListener('resize', computeSlotHeight);
  }, []);

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
    const start = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday start
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

    if (resourceFilter === 'aircraft' || resourceFilter === 'both') {
      aircraft.forEach((a) => {
        resources.push({
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
        resources.push({
          id: instructor.id,
          name: instructor.name,
          type: 'instructor',
          icon: <User className="h-4 w-4" />,
        });
      });
    }

    return resources;
  };

  const getTimeSlots = () => {
    const slots = [];
    for (let hour = 6; hour < 20; hour++) {
      slots.push(hour * 2); // 30-minute slots: 12, 13, 14, etc.
      slots.push(hour * 2 + 1);
    }
    return slots;
  };

  const getTimeFromSlot = (slot: number) => {
    const hour = Math.floor(slot / 2);
    const minute = (slot % 2) * 30;
    return { hour, minute };
  };

  const formatTimeSlot = (slot: number) => {
    const { hour, minute } = getTimeFromSlot(slot);
    return `${hour.toString().padStart(2, '0')}:${minute
      .toString()
      .padStart(2, '0')}`;
  };

  // Mock unavailability data
  const getUnavailabilityPeriods = (date: Date): UnavailabilityPeriod[] => {
    return [
      // Aircraft maintenance periods
      {
        resourceId: '1',
        resourceType: 'aircraft',
        startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6, 0),
        endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0),
        reason: 'Maintenance',
        pattern: 'diagonal',
      },
      {
        resourceId: '3',
        resourceType: 'aircraft',
        startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 13, 0),
        endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 19, 0),
        reason: 'Unserviceable',
        pattern: 'diagonal',
      },
      // Instructor unavailability
      {
        resourceId: '2',
        resourceType: 'instructor',
        startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 17, 0),
        endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 19, 0),
        reason: 'Not Available',
        pattern: 'diagonal',
      },
    ];
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
    const startTime = new Date(booking.startTime);
    const endTime = new Date(booking.endTime);
    const startHour = startTime.getHours();
    const startMinute = startTime.getMinutes();

    // Calculate position from 6:00 AM start
    const startSlot =
      (startHour - 6) * 2 + (startMinute >= 30 ? 1 : 0);
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    const durationInSlots = Math.max(1, Math.ceil(durationHours * 2));

    return {
      gridRowStart: startSlot + 2, // +2 because grid starts with header row
      gridRowEnd: startSlot + 2 + durationInSlots,
      marginTop: startMinute % 30 === 0 ? 0 : `${startMinute % 30}px`,
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

    if (isResourceUnavailable(resourceId, resourceType, slot, date)) {
      toast.error('Cannot book during unavailable time');
      return;
    }

    if (onNewBookingWithTime) {
      const startTime = formatTimeSlot(slot);
      const endTime = formatTimeSlot(slot + 2); // Default 1 hour booking
      onNewBookingWithTime(
        date,
        startTime,
        endTime,
        resourceId,
        resourceType
      );
    }
  };

  const handleMouseDown = (
    slot: number,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    date: Date,
    dayIndex?: number
  ) => {
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
            <CurrentTimeIndicator isVisible={isToday(currentDate)} />

            {timeSlots.map((slot, slotIndex) => (
              <React.Fragment key={slot}>
                {/* Time label */}
                <div
                  className="bg-white border-r border-gray-200 border-b border-gray-100 p-2 flex items-center justify-end"
                  style={{ height: slotHeight }}
                >
                  <span className="text-xs text-gray-500">
                    {formatTimeSlot(slot)}
                  </span>
                </div>

                {/* Resource columns */}
                {resources.map((resource, resourceIndex) => {
                  const unavailability = getUnavailabilityForSlot(
                    resource.id,
                    resource.type,
                    slot,
                    currentDate
                  );
                  const isInDragRange = isTimeSlotInDragRange(
                    slot,
                    resource.id,
                    resource.type
                  );

                  return (
                    <div
                      key={`${resource.id}-${slot}`}
                      className={`border-r border-gray-200 border-b border-gray-100 relative cursor-pointer transition-colors ${
                        unavailability
                          ? 'cursor-not-allowed'
                          : isInDragRange
                          ? 'bg-blue-100'
                          : 'hover:bg-gray-50'
                      }`}
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
                      onMouseDown={() =>
                        !unavailability &&
                        handleMouseDown(
                          slot,
                          resource.id,
                          resource.type,
                          currentDate
                        )
                      }
                      onMouseUp={() => handleMouseUp(currentDate)}
                      onMouseEnter={() =>
                        handleMouseEnter(
                          slot,
                          resource.id,
                          resource.type
                        )
                      }
                    >
                      {unavailability && (
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
            ))}

            {/* Render bookings as grid items */}
            {resources.map((resource, resourceIndex) =>
              getBookingsForResource(
                resource.id,
                resource.type,
                currentDate
              ).map((booking) => {
                const position = getBookingPosition(booking);

                return (
                  <div
                    key={`${booking.id}-${resource.id}`}
                    className={`${
                      booking.hasConflict
                        ? 'bg-red-500 border-red-600 hover:bg-red-600'
                        : 'bg-blue-500 border-blue-600 hover:bg-blue-600'
                    } text-white text-xs p-2 rounded shadow-sm overflow-hidden cursor-move transition-colors z-10 border ${
                      draggedBooking?.id === booking.id
                        ? 'opacity-75'
                        : ''
                    }`}
                    style={{
                      gridColumn: resourceIndex + 2,
                      gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                      marginTop: position.marginTop,
                      minHeight: slotHeight,
                    }}
                    title={`${booking.notes || 'Booking'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        onEditBooking &&
                        !draggedBooking &&
                        !isPastBooking(booking)
                      ) {
                        onEditBooking(booking);
                      } else if (isPastBooking(booking)) {
                        // For past bookings, could show action menu here too
                        // For now, just prevent editing
                        toast(
                          'Use the action menu to manage past bookings'
                        );
                      }
                    }}
                  >
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
              isVisible={weekDays.some((day) => isToday(day))}
            />

            {timeSlots.map((slot, slotIndex) => (
              <React.Fragment key={slot}>
                {/* Time label */}
                <div
                  className="bg-white border-r border-gray-200 border-b border-gray-100 p-2 flex items-center justify-end"
                  style={{ height: slotHeight }}
                >
                  <span className="text-xs text-gray-500">
                    {formatTimeSlot(slot)}
                  </span>
                </div>

                {/* Resource columns for each day */}
                {weekDays.map((day, dayIndex) => {
                  const daySlots = [];
                  let columnOffset = 0;

                  // Add aircraft column if selected
                  if (hasAircraft) {
                    const unavailability = getUnavailabilityForSlot(
                      selectedAircraftId,
                      'aircraft',
                      slot,
                      day
                    );
                    const isInDragRange = isTimeSlotInDragRange(
                      slot,
                      selectedAircraftId,
                      'aircraft',
                      dayIndex
                    );
                    const columnIndex = dayIndex * columnsPerDay + columnOffset;

                    daySlots.push(
                      <div
                        key={`${dayIndex}-aircraft-${slot}`}
                        className={`border-r border-gray-200 border-b border-gray-100 relative cursor-pointer transition-colors ${
                          unavailability
                            ? 'cursor-not-allowed'
                            : isInDragRange
                            ? 'bg-blue-100'
                            : 'hover:bg-gray-50'
                        }`}
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
                        onMouseDown={() =>
                          !unavailability &&
                          handleMouseDown(
                            slot,
                            selectedAircraftId,
                            'aircraft',
                            day,
                            dayIndex
                          )
                        }
                        onMouseUp={() => handleMouseUp(day)}
                        onMouseEnter={() =>
                          handleMouseEnter(
                            slot,
                            selectedAircraftId,
                            'aircraft',
                            dayIndex
                          )
                        }
                      >
                        {unavailability && (
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
                    const isInDragRange = isTimeSlotInDragRange(
                      slot,
                      selectedInstructorId,
                      'instructor',
                      dayIndex
                    );
                    const columnIndex = dayIndex * columnsPerDay + columnOffset;

                    daySlots.push(
                      <div
                        key={`${dayIndex}-instructor-${slot}`}
                        className={`border-r border-gray-200 border-b border-gray-100 relative cursor-pointer transition-colors ${
                          unavailability
                            ? 'cursor-not-allowed'
                            : isInDragRange
                            ? 'bg-blue-100'
                            : 'hover:bg-gray-50'
                        }`}
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
                        onMouseDown={() =>
                          !unavailability &&
                          handleMouseDown(
                            slot,
                            selectedInstructorId,
                            'instructor',
                            day,
                            dayIndex
                          )
                        }
                        onMouseUp={() => handleMouseUp(day)}
                        onMouseEnter={() =>
                          handleMouseEnter(
                            slot,
                            selectedInstructorId,
                            'instructor',
                            dayIndex
                          )
                        }
                      >
                        {unavailability && (
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
            ))}

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

                  bookingElements.push(
                    <div
                      key={`${booking.id}-${dayIndex}-aircraft`}
                      className={`${
                        booking.hasConflict
                          ? 'bg-red-500 border-red-600 hover:bg-red-600'
                          : 'bg-blue-500 border-blue-600 hover:bg-blue-600'
                      } text-white text-xs p-2 rounded shadow-sm overflow-hidden cursor-move transition-colors z-10 border ${
                        draggedBooking?.id === booking.id ? 'opacity-75' : ''
                      }`}
                      style={{
                        gridColumn: columnIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        minHeight: slotHeight,
                      }}
                      title={`${booking.notes || 'Booking'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onEditBooking && !draggedBooking) {
                          onEditBooking(booking);
                        }
                      }}
                    >
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

                  bookingElements.push(
                    <div
                      key={`${booking.id}-${dayIndex}-instructor`}
                      className={`${
                        booking.hasConflict
                          ? 'bg-red-500 border-red-600 hover:bg-red-600'
                          : 'bg-green-500 border-green-600 hover:bg-green-600'
                      } text-white text-xs p-2 rounded shadow-sm overflow-hidden cursor-move transition-colors z-10 border ${
                        draggedBooking?.id === booking.id ? 'opacity-75' : ''
                      }`}
                      style={{
                        gridColumn: columnIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        minHeight: slotHeight,
                      }}
                      title={`${booking.notes || 'Booking'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onEditBooking && !draggedBooking) {
                          onEditBooking(booking);
                        }
                      }}
                    >
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
    </div>
  );
};
