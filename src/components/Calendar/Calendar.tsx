import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  format,
  addDays,
  isSameDay,
  isToday,
  startOfWeek,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Filter,
  Plane,
  Trash2,
  User,
  RefreshCw,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import { useKeyboardNavigation } from '../../hooks/useKeyboardNavigation';
import { useCalendarSettings, useOrganisationSettings } from '../../hooks/useSettings';
import { useInstructorAvailability } from '../../hooks/useInstructorAvailability';
import { useAuth } from '../../context/AuthContext';
import { ResourceManagerPanel, ManagedResource } from './ResourceManagerPanel';
import { Booking } from '../../types';
import { CurrentTimeIndicator } from './CurrentTimeIndicator';
import { MonthView } from './MonthView';
import { isPastBooking } from '../../utils/timeUtils';
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
  onDeleteBooking?: (bookingId: string) => Promise<void> | void;
  onApproveBooking?: (bookingId: string) => Promise<void> | void;
  onRefresh?: () => Promise<void> | void;
}

interface Resource {
  id: string;
  name: string;
  type: 'aircraft' | 'instructor';
  icon: React.ReactNode;
  status?: string;
}

interface UnavailabilityPeriod {
  id?: string;
  resourceId: string;
  resourceType: 'aircraft' | 'instructor';
  startTime: Date;
  endTime: Date;
  reason: string;
  pattern: 'diagonal' | 'solid';
  source?: 'absence' | 'schedule';
}

type ViewMode = 'day' | 'week' | 'month' | 'list';
type BookingCardDensity = 'full' | 'compact' | 'name-only';
const BOOKING_DRAG_START_DELAY_MS = 75;

export const Calendar: React.FC<CalendarProps> = ({
  bookings,
  onNewBooking,
  onNewBookingWithTime,
  onEditBooking,
  onUpdateBooking,
  onDeleteBooking,
  onApproveBooking,
  onRefresh,
}) => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { aircraft } = useAircraft();
  const { users, getInstructors } = useUsers();
  const { deleteFlightLog } = useFlightLogs();
  const instructors = getInstructors();
  const { settings: calendarSettings, updateSettingsSilent } = useCalendarSettings();
  const { settings: organisationSettings } = useOrganisationSettings();
  const { weeklySchedules, absences, scheduleChanges, addAbsence, deleteAbsence } = useInstructorAvailability();
  const preferredAircraftId = user?.preferredAircraftId;

  // Per-resource visibility & ordering (loaded from/synced to DB)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [listPilotFilter, setListPilotFilter] = useState<string>('');
  const [selectedAircraftId, setSelectedAircraftId] = useState<string>('');
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>('');
  const hasAutoSelectedWeekResources = useRef(false);
  const [resourceFilter, setResourceFilter] = useState<
    'all' | 'aircraft' | 'instructors' | 'both'
  >('both');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showWaitlistedBookings, setShowWaitlistedBookings] = useState(true);
  const [showPendingBookings, setShowPendingBookings] = useState(true);
  const [showCancelledBookings, setShowCancelledBookings] = useState(false);
  const [showUnavailableBlocks, setShowUnavailableBlocks] = useState(true);
  const [downtimeChoice, setDowntimeChoice] = useState<{
    date: Date;
    startTime: string;
    endTime: string;
    instructorId: string;
  } | null>(null);
  const [downtimeReason, setDowntimeReason] = useState('Temporary off period');

  // Drag and drop states
  const [draggedBooking, setDraggedBooking] = useState<Booking | null>(null);
  const [draggedBookingOriginal, setDraggedBookingOriginal] = useState<Booking | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    startTime: Date;
    endTime: Date;
    resourceId: string;
    resourceType: 'aircraft' | 'instructor';
  } | null>(null);
  const [optimisticBookingUpdates, setOptimisticBookingUpdates] = useState<Record<string, Partial<Booking>>>({});
  const [resizingBooking, setResizingBooking] = useState<{
    booking: Booking;
    handle: 'top' | 'bottom';
  } | null>(null);
  const [hasBookingInteractionMoved, setHasBookingInteractionMoved] =
    useState(false);
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
  const [flightLogMode, setFlightLogMode] = useState<'create' | 'edit'>('create');
  const [highlightUnlogged, setHighlightUnlogged] = useState(false);

  const parseHour = (time: string | undefined, fallback: number, roundUp = false) => {
    if (!time) return fallback;
    const [hour, minute] = time.split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
    return roundUp && minute > 0 ? hour + 1 : hour;
  };
  const calendarStartHour = parseHour(organisationSettings?.booking_day_start, 6);
  const calendarEndHour = Math.max(calendarStartHour + 1, parseHour(organisationSettings?.booking_day_end, 20, true));
  const availableCalendarHours = calendarEndHour - calendarStartHour;

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
    if (searchParams.get('view') === 'list') return;
    if (calendarSettings?.default_view) {
      const defaultView = calendarSettings.default_view === 'list'
        ? 'list'
        : (calendarSettings.default_view as ViewMode);
      setViewMode(defaultView);
    }
  }, [calendarSettings?.default_view, searchParams]);

  useEffect(() => {
    const requestedView = searchParams.get('view');
    if (requestedView === 'list') {
      setViewMode('list');
    }
  }, [searchParams]);

  useEffect(() => {
    if (viewMode !== 'list') return;
    setListPilotFilter(prev => prev || user?.id || '');
  }, [user?.id, viewMode]);

  useEffect(() => {
    if (viewMode !== 'week') return;
    if (hasAutoSelectedWeekResources.current) return;
    if (aircraft.length === 0 && instructors.length === 0) return;
    if (!selectedAircraftId && aircraft.length > 0) {
      const preferredAircraft = aircraft.find(a => a.id === preferredAircraftId);
      setSelectedAircraftId(preferredAircraft?.id || aircraft[0].id);
    }
    if (!selectedInstructorId && instructors.length > 0) {
      setSelectedInstructorId(instructors[0].id);
    }
    hasAutoSelectedWeekResources.current = true;
  }, [aircraft, instructors, preferredAircraftId, selectedAircraftId, selectedInstructorId, viewMode]);

  useEffect(() => {
    setHighlightUnlogged(calendarSettings?.highlight_unlogged_bookings ?? false);
  }, [calendarSettings?.highlight_unlogged_bookings]);

  // Seed hidden/order from persisted settings once data is ready
  useEffect(() => {
    if (!calendarSettings) return;
    setHiddenIds(new Set(calendarSettings.hidden_resources ?? []));
    const savedOrder = calendarSettings.resource_order ?? [];
    if (savedOrder.length > 0) {
      setOrderedIds(savedOrder.map((r: { id: string }) => r.id));
    } else {
      const aircraftIds = aircraft.map(a => a.id);
      const instructorIds = instructors.map(i => i.id);
      setOrderedIds(calendarSettings.resource_display_order === 'instructors-first'
        ? [...instructorIds, ...aircraftIds]
        : [...aircraftIds, ...instructorIds]);
    }
  // Only run when settings first loads (id changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    calendarSettings?.id,
    calendarSettings?.resource_order,
    calendarSettings?.hidden_resources,
    calendarSettings?.resource_display_order,
    aircraft.length,
    instructors.length,
  ]);

  // When aircraft/instructors load, ensure orderedIds includes all current resources
  useEffect(() => {
    const aircraftIds = aircraft.map(a => a.id);
    const instructorIds = instructors.map(i => i.id);
    const allIds = calendarSettings?.resource_display_order === 'instructors-first'
      ? [...instructorIds, ...aircraftIds]
      : [...aircraftIds, ...instructorIds];
    setOrderedIds(prev => {
      const existing = new Set(prev);
      const newIds = allIds.filter(id => !existing.has(id));
      return [...prev, ...newIds];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraft.length, instructors.length, calendarSettings?.resource_display_order]);


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
  }, [
    calendarSettings?.double_height_slots,
    calendarSettings?.snap_duration,
    calendarStartHour,
    calendarEndHour,
  ]);

  const navigateDate = (direction: 'prev' | 'next') => {
    if (viewMode === 'day') {
      setCurrentDate((prev) =>
        addDays(prev, direction === 'next' ? 1 : -1)
      );
    } else if (viewMode === 'week') {
      setCurrentDate((prev) =>
        addWeeks(prev, direction === 'next' ? 1 : -1)
      );
    } else if (viewMode === 'month') {
      setCurrentDate((prev) =>
        direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1)
      );
    }
  };

  const getWeekDays = () => {
    const weekStartsOn = calendarSettings?.week_starts_on === 'sunday' ? 0 : 1;
    const start = startOfWeek(currentDate, { weekStartsOn });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
      .filter(day => calendarSettings?.show_weekends !== false || (day.getDay() !== 0 && day.getDay() !== 6));
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

  const getHirerName = (booking: Booking) => {
    const hirerId = booking.studentId || booking.pilotId;
    return users.find((u) => u.id === hirerId)?.name || 'Unknown Hirer';
  };

  const getInstructorName = (booking: Booking) => {
    if (!booking.instructorId) return '';
    return users.find((u) => u.id === booking.instructorId)?.name || 'Unknown Instructor';
  };

  const getAircraftName = (booking: Booking) => {
    const bookedAircraft = aircraft.find((a) => a.id === booking.aircraftId);
    if (!bookedAircraft) return 'Unknown Aircraft';
    return `${bookedAircraft.registration} ${bookedAircraft.make || ''} ${bookedAircraft.model || ''}`.trim();
  };

  const isBookingFlightLogged = (booking: Booking) => Boolean(booking.flight_logged || booking.flightLog);

  const pilotOptions = users
    .filter((candidate) =>
      candidate.role === 'student' ||
      candidate.role === 'pilot' ||
      candidate.roles?.some((role) => role === 'student' || role === 'pilot')
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const filteredListBookings = bookings
    .filter((booking) => {
      if (!listPilotFilter) return true;
      return (booking.studentId || booking.pilotId) === listPilotFilter;
    })
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  const formatBookingTimeRange = (booking: Booking) =>
    `${format(new Date(booking.startTime), 'HH:mm')} - ${format(new Date(booking.endTime), 'HH:mm')}`;

  const refreshCalendarData = useCallback(() => {
    window.dispatchEvent(new Event('calendar-data-changed'));
    if (onRefresh) {
      void onRefresh();
    }
  }, [onRefresh]);

  const getBookingFlightLogId = (booking: Booking) => booking.flightLog?.id || '';

  const handleDeleteBookingFlightLog = async (booking: Booking) => {
    const flightLogId = getBookingFlightLogId(booking);
    if (!flightLogId) {
      toast.error('Flight log could not be found');
      return;
    }

    if (!window.confirm('Delete this flight log? The booking will be marked as unlogged.')) {
      return;
    }

    const { error } = await deleteFlightLog(flightLogId);
    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Flight log deleted');
    refreshCalendarData();
  };

  const truncateNotes = (notes?: string, maxLength = 84) => {
    const normalized = notes?.trim().replace(/\s+/g, ' ');
    if (!normalized) return '';
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}...` : normalized;
  };

  const getBookingCardEstimatedHeight = (booking: Booking) => {
    const snapDuration = calendarSettings?.snap_duration || 15;
    const durationMinutes = Math.max(
      1,
      (new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60)
    );
    const renderedSlots = Math.max(1, Math.ceil(durationMinutes / snapDuration));
    return renderedSlots * slotHeight;
  };

  const getBookingCardDensity = (booking: Booking): BookingCardDensity => {
    const estimatedHeight = getBookingCardEstimatedHeight(booking);

    if (estimatedHeight < 44) return 'name-only';
    if (estimatedHeight < 76) return 'compact';
    return 'full';
  };

  const getBookingCardPadding = (density: BookingCardDensity) => {
    if (density === 'name-only') return 'px-1 py-0';
    if (density === 'compact') return 'p-1';
    return 'p-2';
  };

  const getBookingLaneStyle = (booking: Booking): React.CSSProperties => ({
    width: booking.hasConflict ? '20%' : '80%',
    justifySelf: booking.hasConflict ? 'end' : 'start',
  });

  const getBookingColorClasses = (booking: Booking) => {
    if (booking.hasConflict) {
      return 'bg-red-200/70 border-red-300 hover:bg-red-200 text-red-950';
    }

    if (booking.status === 'pending_approval') {
      return 'bg-yellow-400 border-yellow-500 hover:bg-yellow-500 text-gray-900';
    }

    if (booking.status === 'cancelled') {
      return 'bg-gray-300 border-gray-400 hover:bg-gray-300 text-gray-800';
    }

    if (booking.flight_logged) {
      return 'bg-green-500 border-green-600 hover:bg-green-600 text-white';
    }

    if (isPastBooking(booking)) {
      return 'bg-red-500 border-red-600 hover:bg-red-600 text-white';
    }

    return 'bg-blue-500 border-blue-600 hover:bg-blue-600 text-white';
  };

  const getBookingAttentionClasses = (booking: Booking) => {
    if (
      highlightUnlogged &&
      isPastBooking(booking) &&
      !booking.flight_logged &&
      booking.status !== 'cancelled' &&
      !booking.hasConflict
    ) {
      return 'animate-pulse ring-2 ring-red-300 ring-offset-1';
    }

    return '';
  };

  const renderBookingContent = (
    booking: Booking,
    resourceType: 'aircraft' | 'instructor',
    density: BookingCardDensity
  ) => {
    const estimatedHeight = getBookingCardEstimatedHeight(booking);
    const showSecondaryResource = estimatedHeight >= 64;
    const showNotes = estimatedHeight >= 88;
    const notes = showNotes
      ? truncateNotes(booking.notes, estimatedHeight >= 120 ? 84 : 48)
      : '';
    const hirerName = getHirerName(booking);

    if (density === 'name-only') {
      return (
        <div className="relative z-10 flex h-full min-h-0 items-center">
          <div className="text-[11px] font-bold leading-none truncate">
            {hirerName}
          </div>
        </div>
      );
    }

    if (resourceType === 'aircraft') {
      const instructorName = getInstructorName(booking);

      return (
        <div className="relative z-10 flex h-full min-h-0 flex-col gap-0.5">
          <div className="text-[11px] font-semibold leading-tight opacity-95 truncate">
            {formatBookingTimeRange(booking)}
          </div>
          <div className="text-sm font-bold leading-tight truncate">
            {hirerName}
          </div>
          {showSecondaryResource && instructorName && (
            <div className="text-[11px] leading-tight opacity-90 truncate">
              {instructorName}
            </div>
          )}
          {notes && (
            <div className="mt-auto line-clamp-2 text-[10px] leading-tight opacity-90">
              {notes}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="relative z-10 flex h-full min-h-0 flex-col gap-0.5">
        <div className="text-[11px] font-semibold leading-tight opacity-95 truncate">
          {formatBookingTimeRange(booking)}
        </div>
        <div className="text-xs font-bold leading-tight truncate">
          {hirerName}
        </div>
        {showSecondaryResource && (
          <div className="text-[11px] leading-tight opacity-90 truncate">
            {getAircraftName(booking)}
          </div>
        )}
        {notes && (
          <div className="mt-auto line-clamp-2 text-[10px] leading-tight opacity-90">
            {notes}
          </div>
        )}
      </div>
    );
  };

  const handleHideResource = useCallback((id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.add(id);
      updateSettingsSilent({ hidden_resources: Array.from(next) });
      return next;
    });
  }, [updateSettingsSilent]);

  const handleShowResource = useCallback((id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      updateSettingsSilent({ hidden_resources: Array.from(next) });
      return next;
    });
  }, [updateSettingsSilent]);

  const handleReorderResources = useCallback((newOrderIds: string[]) => {
    setOrderedIds(newOrderIds);
    const allResources = [
      ...aircraft.map(a => ({ id: a.id, type: 'aircraft' as const })),
      ...instructors.map(i => ({ id: i.id, type: 'instructor' as const })),
    ];
    const resourceMap = new Map(allResources.map(r => [r.id, r]));
    const resourceOrder = newOrderIds
      .map(id => resourceMap.get(id))
      .filter((r): r is { id: string; type: 'aircraft' | 'instructor' } => !!r);
    updateSettingsSilent({ resource_order: resourceOrder });
  }, [aircraft, instructors, updateSettingsSilent]);

  const getAllResources = (): Resource[] => {
    const resourceMap = new Map<string, Resource>();

    if (resourceFilter === 'aircraft' || resourceFilter === 'both') {
      aircraft.forEach((a) => {
        resourceMap.set(a.id, {
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
        resourceMap.set(instructor.id, {
          id: instructor.id,
          name: instructor.name || instructor.email,
          type: 'instructor',
          icon: <User className="h-4 w-4" />,
        });
      });
    }

    // Apply custom order, then append any not yet in order list
    const ordered: Resource[] = [];
    const seen = new Set<string>();

    orderedIds.forEach(id => {
      if (!hiddenIds.has(id) && resourceMap.has(id)) {
        ordered.push(resourceMap.get(id)!);
        seen.add(id);
      }
    });

    resourceMap.forEach((r, id) => {
      if (!seen.has(id) && !hiddenIds.has(id)) {
        ordered.push(r);
      }
    });

    return ordered;
  };

  const getTimeSlots = () => {
    const snapDuration = calendarSettings?.snap_duration || 15;
    const slotsPerHour = 60 / snapDuration;
    const slots = [];
    for (let hour = calendarStartHour; hour < calendarEndHour; hour++) {
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

  const canCreateInstructorDowntime =
    user?.role === 'admin' ||
    user?.role === 'instructor' ||
    user?.roles?.some(role => role === 'admin' || role === 'instructor');
  const canManageCalendarResources =
    user?.role === 'admin' ||
    user?.roles?.some(role => role === 'admin');

  const canApproveCalendarBooking = (booking: Booking) => {
    const isAdmin =
      user?.role === 'admin' ||
      user?.roles?.some(role => role === 'admin');
    const isAssignedInstructor =
      Boolean(user?.id && booking.instructorId && user.id === booking.instructorId);

    return booking.status === 'pending_approval' && (isAdmin || isAssignedInstructor);
  };

  const openBookingFormForSelection = (
    date: Date,
    startTime: string,
    endTime: string,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor'
  ) => {
    onNewBookingWithTime?.(date, startTime, endTime, resourceId, resourceType);
  };

  const handleNewTimeAllocation = (
    date: Date,
    startTime: string,
    endTime: string,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor'
  ) => {
    if (resourceType === 'instructor' && canCreateInstructorDowntime) {
      setDowntimeChoice({ date, startTime, endTime, instructorId: resourceId });
      setDowntimeReason('Temporary off period');
      return;
    }

    openBookingFormForSelection(date, startTime, endTime, resourceId, resourceType);
  };

  const handleCreateInstructorDowntime = async () => {
    if (!downtimeChoice) return;

    await addAbsence({
      userId: downtimeChoice.instructorId,
      startDate: format(downtimeChoice.date, 'yyyy-MM-dd'),
      endDate: format(downtimeChoice.date, 'yyyy-MM-dd'),
      startTime: downtimeChoice.startTime,
      endTime: downtimeChoice.endTime,
      reason: downtimeReason.trim() || 'Temporary off period',
    });

    setDowntimeChoice(null);
  };

  const handleDeleteInstructorDowntime = async (absenceId: string) => {
    await deleteAbsence(absenceId);
  };

  const getUnavailabilityPeriods = (date: Date): UnavailabilityPeriod[] => {
    const periods: UnavailabilityPeriod[] = [];
    const dayOfWeek = date.getDay();
    const dateStr = format(date, 'yyyy-MM-dd');

    instructors.forEach((instructor) => {
      // One-off absences layer over the permanent weekly schedule.
      const instructorAbsences = absences.filter(
        (a) =>
          a.userId === instructor.id &&
          dateStr >= a.startDate &&
          dateStr <= a.endDate
      );

      instructorAbsences.forEach((absence) => {
        let startHour = calendarStartHour;
        let startMinute = 0;
        let endHour = calendarEndHour;
        let endMinute = 0;

        if (absence.startTime && absence.endTime) {
          [startHour, startMinute] = absence.startTime.split(':').map(Number);
          [endHour, endMinute] = absence.endTime.split(':').map(Number);
        }

        periods.push({
          id: absence.id,
          resourceId: instructor.id,
          resourceType: 'instructor',
          startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour, startMinute),
          endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour, endMinute),
          reason: absence.reason || 'Absent',
          pattern: 'solid',
          source: 'absence',
        });
      });

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
            startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarStartHour, 0),
            endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarEndHour, 0),
            reason: 'Not Available',
            pattern: 'diagonal',
            source: 'schedule',
          });
        } else {
          const [startHour, startMinute] = scheduleChange.startTime.split(':').map(Number);
          const [endHour, endMinute] = scheduleChange.endTime.split(':').map(Number);

          if (startHour > calendarStartHour) {
            periods.push({
              resourceId: instructor.id,
              resourceType: 'instructor',
              startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarStartHour, 0),
              endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour, startMinute),
              reason: 'Not Available',
              pattern: 'diagonal',
              source: 'schedule',
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
              source: 'schedule',
            });

            if (afternoonEndHour < calendarEndHour) {
              periods.push({
                resourceId: instructor.id,
                resourceType: 'instructor',
                startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), afternoonEndHour, afternoonEndMinute),
                endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarEndHour, 0),
                reason: 'Not Available',
                pattern: 'diagonal',
                source: 'schedule',
              });
            }
          } else {
            if (endHour < calendarEndHour) {
              periods.push({
                resourceId: instructor.id,
                resourceType: 'instructor',
                startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour, endMinute),
                endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarEndHour, 0),
                reason: 'Not Available',
                pattern: 'diagonal',
                source: 'schedule',
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
          startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarStartHour, 0),
          endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarEndHour, 0),
          reason: 'Not Available',
          pattern: 'diagonal',
          source: 'schedule',
        });
      } else {
        const [startHour, startMinute] = weeklySchedule.startTime.split(':').map(Number);
        const [endHour, endMinute] = weeklySchedule.endTime.split(':').map(Number);

        if (startHour > calendarStartHour) {
          periods.push({
            resourceId: instructor.id,
            resourceType: 'instructor',
            startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarStartHour, 0),
            endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour, startMinute),
            reason: 'Not Available',
            pattern: 'diagonal',
            source: 'schedule',
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
            source: 'schedule',
          });

          if (afternoonEndHour < calendarEndHour) {
            periods.push({
              resourceId: instructor.id,
              resourceType: 'instructor',
              startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), afternoonEndHour, afternoonEndMinute),
              endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarEndHour, 0),
              reason: 'Not Available',
              pattern: 'diagonal',
              source: 'schedule',
            });
          }
        } else {
          if (endHour < calendarEndHour) {
            periods.push({
              resourceId: instructor.id,
              resourceType: 'instructor',
              startTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour, endMinute),
              endTime: new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarEndHour, 0),
              reason: 'Not Available',
              pattern: 'diagonal',
              source: 'schedule',
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
    const visibleBookings = bookings.map((booking) => ({
      ...booking,
      ...optimisticBookingUpdates[booking.id],
    }));

    let filteredBookings = visibleBookings.filter((booking) => {
      if (!isSameDay(new Date(booking.startTime), date)) return false;
      if (!showWaitlistedBookings && booking.hasConflict) return false;
      if (!showPendingBookings && booking.status === 'pending_approval') return false;
      if (!showCancelledBookings && booking.status === 'cancelled') return false;
      return true;
    });

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

    const startSlot = (startHour - calendarStartHour) * slotsPerHour + Math.floor(startMinute / snapDuration);
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
    if (!showUnavailableBlocks) return undefined;

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

  const renderUnavailabilityLabel = (unavailability: UnavailabilityPeriod) => {
    const canRemoveDowntime =
      canCreateInstructorDowntime &&
      unavailability.source === 'absence' &&
      Boolean(unavailability.id);

    return (
      <div className="absolute inset-0 flex items-center justify-center px-1">
        <span className="inline-flex max-w-full items-center gap-1 rounded bg-white bg-opacity-85 px-1.5 py-0.5 text-xs font-medium text-gray-700 shadow-sm">
          <span className="truncate">{unavailability.reason}</span>
          {canRemoveDowntime && (
            <button
              type="button"
              className="rounded p-0.5 text-red-600 hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-400"
              title="Remove temporary off period"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteInstructorDowntime(unavailability.id!);
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </span>
      </div>
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
      handleNewTimeAllocation(
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

  const resetBookingInteractionState = useCallback(() => {
    setDraggedBooking(null);
    setDraggedBookingOriginal(null);
    setDragPreview(null);
    setResizingBooking(null);
    setHasBookingInteractionMoved(false);
    setTimeout(() => setWasResizing(false), 100);
  }, []);

  const startDragDelayTimer = (
    booking: Booking,
    resourceType: 'aircraft' | 'instructor'
  ) => {
    if (isBookingFlightLogged(booking)) {
      return;
    }

    if (isPastBooking(booking)) {
      return;
    }

    setIsDragDelayActive(true);
    const timer = setTimeout(() => {
      handleBookingDragStart(booking, resourceType);
      setIsDragDelayActive(false);
      setDragDelayTimer(null);
    }, BOOKING_DRAG_START_DELAY_MS);
    setDragDelayTimer(timer);
  };

  const updateDragPreview = (nextPreview: NonNullable<typeof dragPreview>) => {
    setDragPreview((current) => {
      if (
        current &&
        current.resourceId === nextPreview.resourceId &&
        current.resourceType === nextPreview.resourceType &&
        current.startTime.getTime() === nextPreview.startTime.getTime() &&
        current.endTime.getTime() === nextPreview.endTime.getTime()
      ) {
        return current;
      }

      return nextPreview;
    });
  };

  const handleBookingDragStart = (
    booking: Booking,
    resourceType: 'aircraft' | 'instructor'
  ) => {
    if (isBookingFlightLogged(booking)) {
      toast.error('Delete the flight log before editing this booking');
      return;
    }

    if (isPastBooking(booking)) {
      toast.error('Cannot move past bookings');
      return;
    }

    setDraggedBooking(booking);
    setDraggedBookingOriginal(booking);
    setHasBookingInteractionMoved(false);
    updateDragPreview({
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
    if (isBookingFlightLogged(booking)) {
      toast.error('Delete the flight log before editing this booking');
      return;
    }

    if (isPastBooking(booking)) {
      toast.error('Cannot resize past bookings');
      return;
    }

    e.stopPropagation();
    e.preventDefault();
    setWasResizing(true);
    setResizingBooking({ booking, handle });
    setDraggedBookingOriginal(booking);
    setHasBookingInteractionMoved(false);
    updateDragPreview({
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
          setHasBookingInteractionMoved(true);
          updateDragPreview({
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
          setHasBookingInteractionMoved(true);
          updateDragPreview({
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

      setHasBookingInteractionMoved(true);
      updateDragPreview({
        startTime: newStartTime,
        endTime: newEndTime,
        resourceId,
        resourceType
      });
    }
  };

  const handleBookingDrop = useCallback(() => {
    const booking = draggedBooking || resizingBooking?.booking;
    if (!booking || !dragPreview || !onUpdateBooking) {
      resetBookingInteractionState();
      return;
    }

    const wasResizingBooking = Boolean(resizingBooking);
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

    setOptimisticBookingUpdates((current) => ({
      ...current,
      [booking.id]: {
        ...current[booking.id],
        ...updates,
      },
    }));
    resetBookingInteractionState();

    void onUpdateBooking(booking.id, updates, true)
      .then(() => {
        refreshCalendarData();
        toast.success(wasResizingBooking ? 'Booking resized successfully' : 'Booking moved successfully');
      })
      .catch((error) => {
        console.error('Error updating booking:', error);
        setOptimisticBookingUpdates((current) => {
          const next = { ...current };
          delete next[booking.id];
          return next;
        });
        toast.error('Failed to update booking');
      })
      .finally(() => {
        setOptimisticBookingUpdates((current) => {
          const next = { ...current };
          delete next[booking.id];
          return next;
        });
      });
  }, [
    draggedBooking,
    resizingBooking,
    dragPreview,
    onUpdateBooking,
    refreshCalendarData,
    resetBookingInteractionState,
  ]);

  useEffect(() => {
    if (!draggedBooking && !resizingBooking) {
      return;
    }

    const handleWindowMouseUp = () => {
      if (hasBookingInteractionMoved) {
        handleBookingDrop();
      } else {
        resetBookingInteractionState();
      }
    };

    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [
    draggedBooking,
    resizingBooking,
    hasBookingInteractionMoved,
    handleBookingDrop,
    resetBookingInteractionState,
  ]);

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
      handleNewTimeAllocation(
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
    <div className="grid w-full grid-cols-4 rounded-xl bg-gray-100 p-1 sm:w-auto sm:flex">
        {(['day', 'week', 'month', 'list'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => {
              setViewMode(mode);
              if (mode === 'list') {
                setListPilotFilter(prev => prev || user?.id || '');
                setSearchParams(prev => {
                  const next = new URLSearchParams(prev);
                  next.set('view', 'list');
                  return next;
                });
              } else if (searchParams.get('view') === 'list') {
                setSearchParams(prev => {
                  const next = new URLSearchParams(prev);
                  next.delete('view');
                  return next;
                });
              }
            }}
            className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors sm:px-3 sm:py-1.5 sm:text-sm ${
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
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Aircraft
        </label>
        <select
          value={selectedAircraftId}
          onChange={(e) => setSelectedAircraftId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:py-1"
        >
          <option value="">Select Aircraft</option>
          {aircraft.map((a) => (
            <option key={a.id} value={a.id}>
              {a.registration} - {a.make} {a.model}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-0">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Instructor
        </label>
        <select
          value={selectedInstructorId}
          onChange={(e) => setSelectedInstructorId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:py-1"
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

  const getManagedResources = (): ManagedResource[] => {
    const result: ManagedResource[] = [];

    if (resourceFilter === 'aircraft' || resourceFilter === 'both') {
      aircraft.forEach(a => result.push({ id: a.id, name: a.registration, type: 'aircraft', status: a.status }));
    }
    if (resourceFilter === 'instructors' || resourceFilter === 'both') {
      instructors.forEach(i => result.push({ id: i.id, name: i.name || i.email, type: 'instructor' }));
    }

    return result;
  };

  const renderFilterControls = () => (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <select
        value={resourceFilter}
        onChange={(e) =>
          setResourceFilter(e.target.value as any)
        }
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-auto"
      >
        <option value="both">Aircraft & Instructors</option>
        <option value="aircraft">Aircraft Only</option>
        <option value="instructors">Instructors Only</option>
      </select>

      {canManageCalendarResources && (
        <ResourceManagerPanel
          resources={getManagedResources()}
          hiddenIds={hiddenIds}
          orderedIds={orderedIds}
          onHide={handleHideResource}
          onShow={handleShowResource}
          onReorder={handleReorderResources}
        />
      )}

      <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
        <input
          type="checkbox"
          checked={showWaitlistedBookings}
          onChange={(event) => setShowWaitlistedBookings(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span>Waitlist</span>
      </label>

      <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
        <input
          type="checkbox"
          checked={showPendingBookings}
          onChange={(event) => setShowPendingBookings(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span>Pending</span>
      </label>

      <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
        <input
          type="checkbox"
          checked={showUnavailableBlocks}
          onChange={(event) => setShowUnavailableBlocks(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span>Unavailable</span>
      </label>

      <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
        <input
          type="checkbox"
          checked={showCancelledBookings}
          onChange={(event) => setShowCancelledBookings(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span>Cancelled</span>
      </label>
    </div>
  );

  const renderDayView = () => {
    const timeSlots = getTimeSlots();
    const resources = getAllResources();

    return (
      <div className="p-3 sm:p-6">
        <div className="resource-calendar-grid relative overflow-x-auto rounded-lg border border-gray-200 bg-white">
          {/* Fixed header */}
          <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
            <div
              className="grid"
              style={{
                gridTemplateColumns: `64px repeat(${resources.length}, minmax(120px, 1fr))`,
                minWidth: `${64 + resources.length * 120}px`,
              }}
            >
              <div className="flex h-[72px] items-center justify-center border-r border-gray-200 bg-gray-50 p-2">
                <span className="text-xs font-medium text-gray-500 transform -rotate-90">
                  Local time
                </span>
              </div>

              {resources.map((resource) => (
                <div
                  key={resource.id}
                  className="flex h-[72px] flex-col justify-center border-r border-gray-200 bg-gray-50 p-2 text-center"
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
              gridTemplateColumns: `64px repeat(${resources.length}, minmax(120px, 1fr))`,
              gridTemplateRows: `repeat(${timeSlots.length}, ${slotHeight}px)`,
              minWidth: `${64 + resources.length * 120}px`,
            }}
          >
            {/* Current Time Indicator */}
            <CurrentTimeIndicator
              isVisible={isToday(currentDate) && (calendarSettings?.show_current_time_indicator ?? true)}
              startHour={calendarStartHour}
              endHour={calendarEndHour}
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
                        onMouseUp={() => handleMouseUp(currentDate)}
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
                          renderUnavailabilityLabel(unavailability)
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
                const isBeingDragged = draggedBooking?.id === booking.id || resizingBooking?.booking.id === booking.id;
                const isBeingResized = resizingBooking?.booking.id === booking.id;
                const bookingCardDensity = getBookingCardDensity(booking);
                return (
                  <div
                    key={`${booking.id}-${resource.id}`}
                    data-booking-element
                    className={`${getBookingColorClasses(booking)} ${getBookingAttentionClasses(booking)} relative text-xs ${getBookingCardPadding(bookingCardDensity)} rounded shadow-sm overflow-hidden cursor-move transition-colors z-10 border ${
                      isBeingDragged
                        ? 'opacity-30 pointer-events-none'
                        : ''
                    } ${isBeingResized ? 'pointer-events-none' : ''} group`}
                    style={{
                      gridColumn: resourceIndex + 2,
                      gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                      marginTop: position.marginTop,
                      minHeight: slotHeight,
                      ...getBookingLaneStyle(booking),
                    }}
                    title={`${booking.notes || 'Booking'}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (!isPastBooking(booking)) {
                        startDragDelayTimer(booking, resource.type);
                      }
                    }}
                    onMouseUp={cancelDragDelay}
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

                      setActionMenuBooking(booking);
                      setActionMenuPosition({ x: e.clientX, y: e.clientY });
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
                    {renderBookingContent(booking, resource.type, bookingCardDensity)}
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
    const weekTimeColumnWidth = 42;
    const weekResourceColumnWidth = 54;
    const weekGridTemplateColumns = `${weekTimeColumnWidth}px repeat(${totalColumns}, minmax(${weekResourceColumnWidth}px, 1fr))`;
    const selectedAircraft = hasAircraft
      ? aircraft.find((a) => a.id === selectedAircraftId)
      : undefined;
    const selectedInstructor = hasInstructor
      ? instructors.find((i) => i.id === selectedInstructorId)
      : undefined;

    return (
      <div className="p-3 sm:p-6">
        <div className="resource-calendar-grid relative overflow-x-auto rounded-lg border border-gray-200 bg-white">
          {/* Fixed header */}
          <div className="sticky top-0 z-20 border-b border-gray-200 bg-white">
            <div
              className="grid"
              style={{
                gridTemplateColumns: weekGridTemplateColumns,
                gridTemplateRows: '32px 56px',
                minWidth: `${weekTimeColumnWidth + totalColumns * weekResourceColumnWidth}px`,
              }}
            >
              <div
                className="flex items-center justify-center border-r border-gray-200 bg-gray-50 p-1"
                style={{ gridColumn: 1, gridRow: '1 / span 2' }}
              >
                <span className="text-xs font-medium text-gray-500 transform -rotate-90">
                  Local time
                </span>
              </div>

              {weekDays.map((day, dayIndex) => {
                const firstColumn = dayIndex * columnsPerDay + 2;
                const dayColumns = [
                  <div
                    key={`${dayIndex}-day`}
                    className={`flex min-w-0 items-center justify-center border-r border-gray-200 bg-gray-100 px-1 text-[11px] font-semibold ${
                      isToday(day) ? 'text-blue-700' : 'text-gray-700'
                    }`}
                    style={{
                      gridColumn: `${firstColumn} / span ${columnsPerDay}`,
                      gridRow: 1,
                    }}
                  >
                    {format(day, 'EEE d MMM')}
                  </div>,
                ];
                let resourceColumnOffset = 0;

                // Add aircraft column if selected
                if (hasAircraft && selectedAircraft) {
                    dayColumns.push(
                      <div
                        key={`${dayIndex}-aircraft`}
                        className="flex min-w-0 flex-col justify-center border-r border-gray-200 bg-gray-50 px-1 py-2 text-center"
                        style={{
                          gridColumn: firstColumn + resourceColumnOffset,
                          gridRow: 2,
                        }}
                      >
                        <div className="flex min-w-0 items-center justify-center space-x-1 mb-1">
                          <Plane className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate text-[11px] font-semibold text-gray-900">
                            {selectedAircraft.registration}
                          </span>
                        </div>
                        <div
                          className={`text-[10px] font-medium ${
                            isToday(day)
                              ? 'text-blue-600'
                              : 'text-gray-500'
                          }`}
                        >
                          {format(day, 'EEE d')}
                        </div>
                        {selectedAircraft.status &&
                          selectedAircraft.status !== 'serviceable' && (
                            <div className="mt-1 truncate text-[10px] capitalize text-red-600">
                              {selectedAircraft.status}
                            </div>
                          )}
                      </div>
                    );
                  resourceColumnOffset++;
                }

                // Add instructor column if selected
                if (hasInstructor && selectedInstructor) {
                    dayColumns.push(
                      <div
                        key={`${dayIndex}-instructor`}
                        className="flex min-w-0 flex-col justify-center border-r border-gray-200 bg-gray-50 px-1 py-2 text-center"
                        style={{
                          gridColumn: firstColumn + resourceColumnOffset,
                          gridRow: 2,
                        }}
                      >
                        <div className="flex min-w-0 items-center justify-center space-x-1 mb-1">
                          <User className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate text-[11px] font-semibold text-gray-900">
                            {selectedInstructor.name}
                          </span>
                        </div>
                        <div
                          className={`text-[10px] font-medium ${
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

                return dayColumns;
              })}
            </div>
          </div>

          {/* Time slots and resource columns */}
          <div
            className="relative"
            style={{
              display: 'grid',
              gridTemplateColumns: weekGridTemplateColumns,
              gridTemplateRows: `repeat(${timeSlots.length}, ${slotHeight}px)`,
              minWidth: `${weekTimeColumnWidth + totalColumns * weekResourceColumnWidth}px`,
            }}
          >
            {/* Current Time Indicator - show on today only */}
            <CurrentTimeIndicator
              isVisible={weekDays.some((day) => isToday(day)) && (calendarSettings?.show_current_time_indicator ?? true)}
              startHour={calendarStartHour}
              endHour={calendarEndHour}
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
                          onMouseUp={() => handleMouseUp(day)}
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
                            renderUnavailabilityLabel(unavailability)
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
                          onMouseUp={() => handleMouseUp(day)}
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
                            renderUnavailabilityLabel(unavailability)
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
                  const isBeingDragged = draggedBooking?.id === booking.id || resizingBooking?.booking.id === booking.id;
                  const isBeingResized = resizingBooking?.booking.id === booking.id;
                  const bookingCardDensity = getBookingCardDensity(booking);
                  bookingElements.push(
                    <div
                      key={`${booking.id}-${dayIndex}-aircraft`}
                      data-booking-element
                      className={`${getBookingColorClasses(booking)} ${getBookingAttentionClasses(booking)} relative text-xs ${getBookingCardPadding(bookingCardDensity)} rounded shadow-sm overflow-hidden cursor-move transition-colors z-10 border ${
                        isBeingDragged ? 'opacity-30 pointer-events-none' : ''
                      } ${isBeingResized ? 'pointer-events-none' : ''} group`}
                      style={{
                        gridColumn: columnIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        minHeight: slotHeight,
                        ...getBookingLaneStyle(booking),
                      }}
                      title={`${booking.notes || 'Booking'}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (!isPastBooking(booking)) {
                          startDragDelayTimer(booking, 'aircraft');
                        }
                      }}
                      onMouseUp={cancelDragDelay}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (wasResizing) {
                          return;
                        }

                        setActionMenuBooking(booking);
                        setActionMenuPosition({ x: e.clientX, y: e.clientY });
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
                      {renderBookingContent(booking, 'aircraft', bookingCardDensity)}
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
                  const isBeingDragged = draggedBooking?.id === booking.id || resizingBooking?.booking.id === booking.id;
                  const isBeingResized = resizingBooking?.booking.id === booking.id;
                  const bookingCardDensity = getBookingCardDensity(booking);
                  bookingElements.push(
                    <div
                      key={`${booking.id}-${dayIndex}-instructor`}
                      data-booking-element
                      className={`${getBookingColorClasses(booking)} ${getBookingAttentionClasses(booking)} relative text-xs ${getBookingCardPadding(bookingCardDensity)} rounded shadow-sm overflow-hidden cursor-move transition-colors z-10 border ${
                        isBeingDragged ? 'opacity-30 pointer-events-none' : ''
                      } ${isBeingResized ? 'pointer-events-none' : ''} group`}
                      style={{
                        gridColumn: columnIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        minHeight: slotHeight,
                        ...getBookingLaneStyle(booking),
                      }}
                      title={`${booking.notes || 'Booking'}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (!isPastBooking(booking)) {
                          startDragDelayTimer(booking, 'instructor');
                        }
                      }}
                      onMouseUp={cancelDragDelay}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (wasResizing) {
                          return;
                        }

                        setActionMenuBooking(booking);
                        setActionMenuPosition({ x: e.clientX, y: e.clientY });
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
                      {renderBookingContent(booking, 'instructor', bookingCardDensity)}
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

  const renderListView = () => (
    <div className="border-t border-gray-200 bg-gray-50">
      <div className="flex flex-col gap-3 border-b border-gray-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Booking List</h3>
          <p className="text-xs text-gray-500">
            {filteredListBookings.length} booking{filteredListBookings.length === 1 ? '' : 's'} shown
          </p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 sm:min-w-72">
          Pilot / Student
          <select
            value={listPilotFilter}
            onChange={(event) => setListPilotFilter(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            <option value="">All pilots/students</option>
            {user && !pilotOptions.some((pilot) => pilot.id === user.id) && (
              <option value={user.id}>{user.name || user.email || 'Logged in user'}</option>
            )}
            {pilotOptions.map((pilot) => (
              <option key={pilot.id} value={pilot.id}>
                {pilot.id === user?.id ? `${pilot.name} (me)` : pilot.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="divide-y divide-gray-200 bg-white">
        {filteredListBookings.map((booking) => {
          const isPast = isPastBooking(booking);
          const isLogged = booking.flight_logged || Boolean(booking.flightLog);
          const instructorName = getInstructorName(booking);
          const notes = truncateNotes(booking.notes, 96);

          return (
            <div
              key={booking.id}
              className="grid grid-cols-1 gap-2 px-4 py-3 text-sm hover:bg-gray-50 md:grid-cols-[8.5rem_1fr_auto] md:items-center"
            >
              <div>
                <div className="font-semibold text-gray-900">{format(new Date(booking.startTime), 'dd MMM yyyy')}</div>
                <div className="text-xs text-gray-500">{formatBookingTimeRange(booking)}</div>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-gray-900">{getHirerName(booking)}</span>
                  <span className="text-gray-400">|</span>
                  <span className="text-gray-700">{getAircraftName(booking)}</span>
                  {instructorName && (
                    <>
                      <span className="text-gray-400">|</span>
                      <span className="text-gray-600">{instructorName}</span>
                    </>
                  )}
                </div>
                {notes && <div className="mt-0.5 truncate text-xs text-gray-500">{notes}</div>}
              </div>

              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  booking.hasConflict
                    ? 'bg-red-100 text-red-700'
                    : booking.status === 'pending_approval'
                      ? 'bg-amber-100 text-amber-700'
                      : booking.status === 'cancelled'
                        ? 'bg-gray-100 text-gray-600'
                        : isLogged
                          ? 'bg-green-100 text-green-700'
                          : isPast
                            ? 'bg-red-100 text-red-700'
                            : 'bg-blue-100 text-blue-700'
                }`}>
                  {booking.hasConflict
                    ? 'Waitlist'
                    : isLogged
                      ? 'Logged'
                      : isPast
                        ? 'Unlogged'
                        : booking.status.replace('_', ' ')}
                </span>
                <button
                  type="button"
                  onClick={(event) => {
                    setActionMenuBooking(booking);
                    setActionMenuPosition({ x: event.clientX, y: event.clientY });
                  }}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Actions
                </button>
              </div>
            </div>
          );
        })}

        {filteredListBookings.length === 0 && (
          <div className="px-4 py-10 text-center">
            <Plane className="mx-auto h-8 w-8 text-gray-300" />
            <h3 className="mt-2 text-sm font-semibold text-gray-900">No bookings found</h3>
            <p className="mt-1 text-xs text-gray-500">Change the pilot/student filter to show more bookings.</p>
          </div>
        )}
      </div>
    </div>
  );

  const getDateRangeText = () => {
    if (viewMode === 'list') {
      return 'List view';
    }
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
    <div className="select-none overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-white p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:space-x-4">
            <h2 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl">Calendar</h2>
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 sm:flex sm:space-x-2">
              <button
                onClick={() => navigateDate('prev')}
                className="rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                aria-label="Previous date range"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-0 truncate px-1 text-center text-base font-medium text-gray-600 sm:min-w-[200px]">
                {getDateRangeText()}
              </span>
              <button
                onClick={() => navigateDate('next')}
                className="rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                aria-label="Next date range"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentDate(new Date())}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Today
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            {renderViewModeButtons()}

            <label className="flex items-center justify-center space-x-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-center transition-colors hover:bg-gray-100">
              <input
                type="checkbox"
                checked={highlightUnlogged}
                onChange={(e) => setHighlightUnlogged(e.target.checked)}
                className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Highlight Unlogged</span>
            </label>

            {onRefresh && (
              <button
                onClick={() => void onRefresh()}
                className="flex items-center justify-center space-x-2 rounded-xl border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                title="Refresh calendar"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Refresh</span>
              </button>
            )}

            <button
              onClick={onNewBooking}
              className="flex items-center justify-center space-x-2 rounded-xl bg-blue-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 sm:py-2.5 sm:text-sm"
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
              className="flex items-center space-x-2 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50"
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
      {viewMode === 'list' && renderListView()}
      {viewMode === 'month' && (
        <MonthView
          currentDate={currentDate}
          bookings={bookings}
          aircraft={aircraft}
          instructors={instructors}
          defaultAircraftId={preferredAircraftId}
          onDayClick={(date) => {
            setCurrentDate(date);
            setViewMode('day');
          }}
          weekStartsOn={calendarSettings?.week_starts_on === 'sunday' ? 0 : 1}
          showWeekends={calendarSettings?.show_weekends ?? true}
          availableHours={availableCalendarHours}
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
            if (isBookingFlightLogged(actionMenuBooking)) {
              toast.error('Delete the flight log before editing this booking');
              return;
            }
            if (onEditBooking) {
              onEditBooking(actionMenuBooking);
            }
          }}
          onLogFlight={() => {
            setFlightLogBooking(actionMenuBooking);
            setFlightLogMode('create');
            setShowFlightLogModal(true);
          }}
          onEditFlightLog={() => {
            setFlightLogBooking(actionMenuBooking);
            setFlightLogMode('edit');
            setShowFlightLogModal(true);
          }}
          onDeleteFlightLog={() => {
            void handleDeleteBookingFlightLog(actionMenuBooking);
          }}
          onDelete={() => {
            if (isBookingFlightLogged(actionMenuBooking)) {
              toast.error('Delete the flight log before deleting this booking');
              return;
            }
            if (onDeleteBooking) {
              void Promise.resolve(onDeleteBooking(actionMenuBooking.id)).then(refreshCalendarData);
            }
          }}
          onApprove={
            onApproveBooking && canApproveCalendarBooking(actionMenuBooking)
              ? () => void Promise.resolve(onApproveBooking(actionMenuBooking.id)).then(refreshCalendarData)
              : undefined
          }
          isFlightLogged={isBookingFlightLogged(actionMenuBooking)}
          canApprove={canApproveCalendarBooking(actionMenuBooking)}
          onClose={() => setActionMenuBooking(null)}
        />
      )}

      {showFlightLogModal && flightLogBooking && (
        <FlightLogModal
          booking={flightLogBooking}
          mode={flightLogMode}
          flightLogId={getBookingFlightLogId(flightLogBooking)}
          onApproveBooking={onApproveBooking}
          onClose={() => {
            setShowFlightLogModal(false);
            setFlightLogBooking(null);
            setFlightLogMode('create');
          }}
          onSuccess={() => {
            setShowFlightLogModal(false);
            setFlightLogBooking(null);
            setFlightLogMode('create');
            refreshCalendarData();
          }}
        />
      )}

      {downtimeChoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white shadow-xl border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">Instructor Time Slot</h3>
              <p className="text-sm text-gray-600 mt-1">
                {format(downtimeChoice.date, 'MMM d, yyyy')} · {downtimeChoice.startTime} - {downtimeChoice.endTime}
              </p>
            </div>

            <div className="p-4 space-y-4">
              <button
                type="button"
                onClick={() => {
                  openBookingFormForSelection(
                    downtimeChoice.date,
                    downtimeChoice.startTime,
                    downtimeChoice.endTime,
                    downtimeChoice.instructorId,
                    'instructor'
                  );
                  setDowntimeChoice(null);
                }}
                className="w-full rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-left hover:bg-blue-100 transition-colors"
              >
                <span className="block text-sm font-semibold text-blue-900">Create booking</span>
                <span className="block text-xs text-blue-700 mt-1">Book a student or pilot with this instructor.</span>
              </button>

              <div className="rounded-md border border-gray-200 p-3">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Downtime reason
                </label>
                <input
                  type="text"
                  value={downtimeReason}
                  onChange={(event) => setDowntimeReason(event.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Temporary off period"
                />
                <button
                  type="button"
                  onClick={handleCreateInstructorDowntime}
                  className="mt-3 w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
                >
                  Block as downtime
                </button>
              </div>
            </div>

            <div className="flex justify-end px-4 py-3 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => setDowntimeChoice(null)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
