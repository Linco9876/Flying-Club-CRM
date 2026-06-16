import React, { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import {
  format,
  addDays,
  isSameDay,
  isToday,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Plane,
  Trash2,
  User,
  RefreshCw,
  CalendarDays,
  Loader2,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import { useKeyboardNavigation } from '../../hooks/useKeyboardNavigation';
import { useCalendarSettings, useOrganisationSettings, useUserPreferences } from '../../hooks/useSettings';
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
  onCopyBooking?: (booking: Booking) => void;
  onUpdateBooking?: (bookingId: string, updates: Partial<Booking>, silent?: boolean) => void;
  onDeleteBooking?: (bookingId: string) => Promise<void> | void;
  onApproveBooking?: (bookingId: string) => Promise<void> | void;
  onRefresh?: () => Promise<void> | void;
  isKioskMode?: boolean;
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
const BOOKING_DRAG_MOVE_THRESHOLD_PX = 4;
const CALENDAR_RESOURCE_LAYOUT_KEY = 'calendar_resource_layout';
const MIN_CALENDAR_SLOT_HEIGHT = 18;
const MAX_CALENDAR_SLOT_HEIGHT = 48;
const MIN_CALENDAR_VISIBLE_SLOTS = 12;

interface CalendarResourceLayoutPreference {
  hiddenIds?: string[];
  orderedIds?: string[];
}

const parseCalendarDateParam = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getStoredCalendarDate = (key: string) => {
  if (typeof window === 'undefined') return null;
  return parseCalendarDateParam(window.sessionStorage.getItem(key));
};

export const Calendar: React.FC<CalendarProps> = ({
  bookings,
  onNewBooking,
  onNewBookingWithTime,
  onEditBooking,
  onCopyBooking,
  onUpdateBooking,
  onDeleteBooking,
  onApproveBooking,
  onRefresh,
  isKioskMode = false,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { aircraft } = useAircraft();
  const { users } = useUsers();
  const { deleteFlightLog } = useFlightLogs();
  const instructors = useMemo(
    () => users.filter(u => u.roles?.includes('instructor') || u.roles?.includes('senior_instructor')),
    [users]
  );
  const lastKnownAircraftRef = useRef<typeof aircraft>([]);
  const lastKnownUsersRef = useRef<typeof users>([]);
  const lastKnownInstructorsRef = useRef<typeof instructors>([]);
  useEffect(() => {
    if (aircraft.length > 0) lastKnownAircraftRef.current = aircraft;
    if (users.length > 0) lastKnownUsersRef.current = users;
    if (instructors.length > 0) lastKnownInstructorsRef.current = instructors;
  }, [aircraft, users, instructors]);
  const displayAircraft = aircraft.length > 0 ? aircraft : lastKnownAircraftRef.current;
  const displayUsers = users.length > 0 ? users : lastKnownUsersRef.current;
  const displayInstructors = instructors.length > 0 ? instructors : lastKnownInstructorsRef.current;
  const { settings: calendarSettings } = useCalendarSettings();
  const { preferences: userPreferences, updatePreferencesSilent } = useUserPreferences(user?.id || '');
  const { settings: organisationSettings } = useOrganisationSettings();
  const {
    weeklySchedules,
    absences,
    scheduleChanges,
    loading: availabilityLoading,
    addAbsence,
    deleteAbsence,
  } = useInstructorAvailability();
  const lastAvailabilityRef = useRef({
    weeklySchedules,
    absences,
    scheduleChanges,
    hasLoaded: false,
  });
  useEffect(() => {
    if (!availabilityLoading) {
      lastAvailabilityRef.current = {
        weeklySchedules,
        absences,
        scheduleChanges,
        hasLoaded: true,
      };
    }
  }, [absences, availabilityLoading, scheduleChanges, weeklySchedules]);
  const displayWeeklySchedules =
    availabilityLoading && lastAvailabilityRef.current.hasLoaded
      ? lastAvailabilityRef.current.weeklySchedules
      : weeklySchedules;
  const displayAbsences =
    availabilityLoading && lastAvailabilityRef.current.hasLoaded
      ? lastAvailabilityRef.current.absences
      : absences;
  const displayScheduleChanges =
    availabilityLoading && lastAvailabilityRef.current.hasLoaded
      ? lastAvailabilityRef.current.scheduleChanges
      : scheduleChanges;
  const hasAvailabilityData =
    !availabilityLoading || lastAvailabilityRef.current.hasLoaded;
  const preferredAircraftId = user?.preferredAircraftId;
  const selectedDateStorageKey = `bfc_calendar_selected_date_${isKioskMode ? 'kiosk' : 'app'}_${user?.id || 'guest'}`;

  // Per-resource visibility & ordering (loaded from/synced to DB)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [currentDate, setCurrentDate] = useState(() => parseCalendarDateParam(searchParams.get('date')) || getStoredCalendarDate(selectedDateStorageKey) || new Date());
  const [datePickerMonth, setDatePickerMonth] = useState(() => parseCalendarDateParam(searchParams.get('date')) || getStoredCalendarDate(selectedDateStorageKey) || new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [listPilotFilter, setListPilotFilter] = useState<string>('');
  const [selectedAircraftId, setSelectedAircraftId] = useState<string>('');
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>('');
  const hasAutoSelectedWeekResources = useRef(false);
  const [resourceFilter, setResourceFilter] = useState<
    'all' | 'aircraft' | 'instructors' | 'both'
  >('both');
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
  const [wasMovingBooking, setWasMovingBooking] = useState(false);
  const [pendingBookingDrag, setPendingBookingDrag] = useState<{
    booking: Booking;
    resourceType: 'aircraft' | 'instructor';
    startX: number;
    startY: number;
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

  // Dynamic slot height based on viewport and settings
  const [slotHeight, setSlotHeight] = useState<number>(MIN_CALENDAR_SLOT_HEIGHT);
  const lastStableSlotHeightRef = useRef<number>(MIN_CALENDAR_SLOT_HEIGHT);

  // Action menu and flight log states
  const [actionMenuBooking, setActionMenuBooking] = useState<Booking | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [bookingMenuLoading, setBookingMenuLoading] = useState<{ bookingId: string; x: number; y: number } | null>(null);
  const bookingMenuOpenTokenRef = useRef(0);
  const [showFlightLogModal, setShowFlightLogModal] = useState(false);
  const [flightLogBooking, setFlightLogBooking] = useState<Booking | null>(null);
  const [flightLogMode, setFlightLogMode] = useState<'create' | 'edit'>('create');
  const [highlightUnlogged, setHighlightUnlogged] = useState(false);
  const isInteractingWithBooking = Boolean(draggedBooking || resizingBooking || pendingBookingDrag);

  const parseHour = (time: string | undefined, fallback: number, roundUp = false) => {
    if (!time) return fallback;
    const [hour, minute] = time.split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
    return roundUp && minute > 0 ? hour + 1 : hour;
  };
  const calendarStartHour = parseHour(organisationSettings?.booking_day_start, 6);
  const calendarEndHour = Math.max(calendarStartHour + 1, parseHour(organisationSettings?.booking_day_end, 20, true));
  const availableCalendarHours = calendarEndHour - calendarStartHour;

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
      setPendingBookingDrag(null);
      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
      setDraggedBooking(null);
      setDraggedBookingOriginal(null);
      setDragPreview(null);
      setResizingBooking(null);
      bookingMenuOpenTokenRef.current += 1;
      setBookingMenuLoading(null);
      setActionMenuBooking(null);
      setWasResizing(false);
      setWasMovingBooking(false);
    },
    enabled: true,
  });

  useEffect(() => {
    if (!isInteractingWithBooking) return;

    document.documentElement.classList.add('calendar-booking-interaction-active');
    document.body.classList.add('calendar-booking-interaction-active');

    return () => {
      document.documentElement.classList.remove('calendar-booking-interaction-active');
      document.body.classList.remove('calendar-booking-interaction-active');
    };
  }, [isInteractingWithBooking]);

  useEffect(() => {
    setDatePickerMonth(currentDate);
  }, [currentDate]);

  useEffect(() => {
    const requestedDate = parseCalendarDateParam(searchParams.get('date'));
    if (!requestedDate) return;
    setCurrentDate(prev => isSameDay(requestedDate, prev) ? prev : requestedDate);
  }, [searchParams]);

  useEffect(() => {
    window.sessionStorage.setItem(selectedDateStorageKey, format(currentDate, 'yyyy-MM-dd'));
  }, [currentDate, selectedDateStorageKey]);

  useEffect(() => {
    if (!showDatePicker) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        datePickerRef.current &&
        !datePickerRef.current.contains(event.target as Node)
      ) {
        setShowDatePicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDatePicker]);

  useLayoutEffect(() => {
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

  const getResourceLayoutStorageKey = useCallback(
    () => `bfc_calendar_resource_layout_${user?.id || 'guest'}`,
    [user?.id]
  );

  const persistResourceLayout = useCallback((nextHiddenIds: Set<string>, nextOrderedIds: string[]) => {
    const layout: CalendarResourceLayoutPreference = {
      hiddenIds: Array.from(nextHiddenIds),
      orderedIds: nextOrderedIds,
    };

    localStorage.setItem(getResourceLayoutStorageKey(), JSON.stringify(layout));

    if (user?.id) {
      updatePreferencesSilent({
        preferences: {
          [CALENDAR_RESOURCE_LAYOUT_KEY]: layout,
        },
      }).catch((error) => {
        console.error('Failed to save calendar resource layout preference:', error);
      });
    }
  }, [getResourceLayoutStorageKey, updatePreferencesSilent, user?.id]);

  // Seed hidden/order from personal preferences first, then organisation defaults.
  useEffect(() => {
    if (!calendarSettings) return;
    const personalLayout = userPreferences?.preferences?.[CALENDAR_RESOURCE_LAYOUT_KEY] as CalendarResourceLayoutPreference | undefined;
    let localLayout: CalendarResourceLayoutPreference | undefined;
    try {
      const raw = localStorage.getItem(getResourceLayoutStorageKey());
      localLayout = raw ? JSON.parse(raw) as CalendarResourceLayoutPreference : undefined;
    } catch {
      localLayout = undefined;
    }

    const aircraftIds = aircraft.map(a => a.id);
    const instructorIds = instructors.map(i => i.id);
    const defaultOrder = calendarSettings.resource_display_order === 'instructors-first'
      ? [...instructorIds, ...aircraftIds]
      : [...aircraftIds, ...instructorIds];
    const currentResourceIds = new Set(defaultOrder);
    const resourceLayout = personalLayout || localLayout;
    const layoutHiddenIds = (resourceLayout?.hiddenIds ?? []).filter(id => currentResourceIds.has(id));
    const layoutOrderedIds = (resourceLayout?.orderedIds ?? []).filter(id => currentResourceIds.has(id));
    const hasPersonalLayout = layoutHiddenIds.length > 0 || layoutOrderedIds.length > 0;

    if (hasPersonalLayout) {
      const orderWithNewResources = [
        ...layoutOrderedIds,
        ...defaultOrder.filter(id => !layoutOrderedIds.includes(id)),
      ];
      setHiddenIds(new Set(layoutHiddenIds));
      setOrderedIds(orderWithNewResources);
      return;
    }

    setHiddenIds(new Set((calendarSettings.hidden_resources ?? []).filter(id => currentResourceIds.has(id))));
    const savedOrder = (calendarSettings.resource_order ?? [])
      .map((r: { id: string }) => r.id)
      .filter(id => currentResourceIds.has(id));
    setOrderedIds(savedOrder.length > 0
      ? [...savedOrder, ...defaultOrder.filter(id => !savedOrder.includes(id))]
      : defaultOrder);
  // Only run when settings first loads (id changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    calendarSettings?.id,
    calendarSettings?.resource_order,
    calendarSettings?.hidden_resources,
    calendarSettings?.resource_display_order,
    userPreferences?.preferences,
    getResourceLayoutStorageKey,
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
      const availableHeight = Math.max(420, window.innerHeight - headerHeight);
      const snapDuration = calendarSettings?.snap_duration || 15;
      const slotsPerHour = 60 / snapDuration;
      const numSlots = availableCalendarHours * slotsPerHour;
      if (!Number.isFinite(numSlots) || numSlots < MIN_CALENDAR_VISIBLE_SLOTS) {
        return;
      }

      const baseHeight = availableHeight / numSlots;
      const heightMultiplier = calendarSettings?.double_height_slots ? 2 : 1;
      const maxSlotHeight = MAX_CALENDAR_SLOT_HEIGHT * heightMultiplier;
      const nextSlotHeight = baseHeight * heightMultiplier;

      if (!Number.isFinite(nextSlotHeight)) return;

      setSlotHeight((currentHeight) => {
        if (nextSlotHeight > maxSlotHeight) {
          const stableHeight =
            currentHeight > 0 && currentHeight <= maxSlotHeight
              ? currentHeight
              : Math.min(lastStableSlotHeightRef.current, maxSlotHeight);
          lastStableSlotHeightRef.current = stableHeight;
          return stableHeight;
        }

        const boundedHeight = Math.min(
          maxSlotHeight,
          Math.max(MIN_CALENDAR_SLOT_HEIGHT, nextSlotHeight)
        );
        if (Math.abs(currentHeight - boundedHeight) < 0.5) {
          return currentHeight;
        }
        lastStableSlotHeightRef.current = boundedHeight;
        return boundedHeight;
      });
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

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setDatePickerMonth(today);
    setShowDatePicker(false);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('date', format(today, 'yyyy-MM-dd'));
      return next;
    });
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
      const selectedAircraft = displayAircraft.find(
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
      const instructor = displayInstructors.find(
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
    return displayUsers.find((u) => u.id === hirerId)?.name || 'Unknown Hirer';
  };

  const getInstructorName = (booking: Booking) => {
    if (!booking.instructorId) return '';
    return displayUsers.find((u) => u.id === booking.instructorId)?.name || 'Unknown Instructor';
  };

  const getAircraftName = (booking: Booking) => {
    const bookedAircraft = displayAircraft.find((a) => a.id === booking.aircraftId);
    if (!bookedAircraft) return 'Unknown Aircraft';
    return `${bookedAircraft.registration} ${bookedAircraft.make || ''} ${bookedAircraft.model || ''}`.trim();
  };

  const isBookingFlightLogged = (booking: Booking) => Boolean(booking.flight_logged || booking.flightLog);
  const canDragOrResizeBooking = (booking: Booking) => !isBookingFlightLogged(booking);

  const isCancelledBooking = (booking: Booking) =>
    booking.status === 'cancelled' || Boolean(booking.deletedAt);

  const passesCalendarFilters = (booking: Booking) => {
    if (isCancelledBooking(booking)) return showCancelledBookings;
    if (!showWaitlistedBookings && booking.hasConflict) return false;
    if (!showPendingBookings && booking.status === 'pending_approval') return false;
    return true;
  };

  const pilotOptions = displayUsers
    .filter((candidate) =>
      candidate.role === 'student' ||
      candidate.role === 'pilot' ||
      candidate.roles?.some((role) => role === 'student' || role === 'pilot')
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const filteredListBookings = bookings
    .filter((booking) => {
      if (!passesCalendarFilters(booking)) return false;
      if (!listPilotFilter) return true;
      return (booking.studentId || booking.pilotId) === listPilotFilter;
    })
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  const formatBookingTimeRange = (booking: Booking) =>
    `${format(new Date(booking.startTime), 'HH:mm')} - ${format(new Date(booking.endTime), 'HH:mm')}`;

  const refreshCalendarData = useCallback(() => {
    if (onRefresh) {
      void onRefresh();
    }
  }, [onRefresh]);

  const openBookingActionMenu = useCallback((booking: Booking, position: { x: number; y: number }) => {
    const x = Math.min(position.x || window.innerWidth - 20, window.innerWidth - 20);
    const y = Math.min(position.y || 160, window.innerHeight - 20);
    const openToken = bookingMenuOpenTokenRef.current + 1;
    bookingMenuOpenTokenRef.current = openToken;

    setActionMenuBooking(null);
    setActionMenuPosition({ x, y });
    setBookingMenuLoading({ bookingId: booking.id, x, y });

    window.setTimeout(() => {
      if (bookingMenuOpenTokenRef.current !== openToken) return;
      setActionMenuBooking(booking);
      setActionMenuPosition({ x, y });
      setBookingMenuLoading((current) => current?.bookingId === booking.id ? null : current);
    }, 80);
  }, []);

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
      return 'bg-red-100/80 border-red-500 hover:bg-red-100 text-red-950';
    }

    if (booking.status === 'pending_approval') {
      return 'bg-amber-100/90 border-amber-500 hover:bg-amber-100 text-amber-950';
    }

    if (booking.status === 'cancelled') {
      return 'bg-gray-100/90 border-gray-500 hover:bg-gray-100 text-gray-800';
    }

    if (booking.flight_logged) {
      return 'bg-emerald-100/90 border-emerald-500 hover:bg-emerald-100 text-emerald-950';
    }

    if (isPastBooking(booking)) {
      return 'bg-red-100/90 border-red-500 hover:bg-red-100 text-red-950';
    }

    return 'bg-blue-100/90 border-blue-500 hover:bg-blue-100 text-blue-950';
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

  const renderMobileAgendaCard = (booking: Booking) => {
    const instructorName = getInstructorName(booking);
    const aircraftName = getAircraftName(booking);
    const notes = truncateNotes(booking.notes, 110);
    const isLogged = booking.flight_logged || Boolean(booking.flightLog);
    const statusLabel = booking.hasConflict
      ? 'Waitlist'
      : isLogged
        ? 'Logged'
        : isPastBooking(booking)
          ? 'Unlogged'
          : booking.status === 'pending_approval'
            ? 'Pending'
            : booking.status === 'cancelled'
              ? 'Cancelled'
              : 'Confirmed';

    return (
      <button
        key={booking.id}
        type="button"
        onClick={(event) => {
          openBookingActionMenu(booking, { x: event.clientX, y: event.clientY });
        }}
        className={`${getBookingColorClasses(booking)} ${getBookingAttentionClasses(booking)} calendar-booking-card block w-full rounded-xl border-2 p-3 text-left shadow-sm transition-transform active:scale-[0.99]`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide opacity-80">
              {formatBookingTimeRange(booking)}
            </div>
            <div className="mt-1 truncate text-base font-extrabold leading-tight">
              {getHirerName(booking)}
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-white/70 px-2 py-1 text-[11px] font-bold leading-none text-gray-800 ring-1 ring-black/5">
            {statusLabel}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
          {booking.aircraftId && (
            <span className="rounded-full bg-white/55 px-2 py-1">
              {aircraftName}
            </span>
          )}
          {instructorName && (
            <span className="rounded-full bg-white/55 px-2 py-1">
              {instructorName}
            </span>
          )}
        </div>

        {notes && (
          <p className="mt-2 line-clamp-2 text-xs leading-snug opacity-85">
            {notes}
          </p>
        )}
      </button>
    );
  };

  const renderMobileAgenda = (days: Date[]) => (
    <div className="space-y-3 md:hidden">
      {days.map((day) => {
        const dayBookings = getAgendaBookingsForDate(day);
        return (
          <section
            key={day.toISOString()}
            className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-gray-950 dark:text-gray-100">
                  {format(day, 'EEEE')}
                </h3>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {format(day, 'MMMM d, yyyy')}
                </p>
              </div>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-600 dark:bg-[#262b33] dark:text-gray-200">
                {dayBookings.length}
              </span>
            </div>

            {dayBookings.length > 0 ? (
              <div className="space-y-2">
                {dayBookings.map(renderMobileAgendaCard)}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center dark:border-[#363b45] dark:bg-[#11141a]">
                <Plane className="mx-auto h-7 w-7 text-gray-300 dark:text-gray-600" />
                <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  No bookings
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Use New Booking above to add one for this date.
                </p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );

  const handleHideResource = useCallback((id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.add(id);
      persistResourceLayout(next, orderedIds);
      return next;
    });
  }, [orderedIds, persistResourceLayout]);

  const handleShowResource = useCallback((id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      persistResourceLayout(next, orderedIds);
      return next;
    });
  }, [orderedIds, persistResourceLayout]);

  const handleReorderResources = useCallback((newOrderIds: string[]) => {
    setOrderedIds(newOrderIds);
    persistResourceLayout(hiddenIds, newOrderIds);
  }, [hiddenIds, persistResourceLayout]);

  const getAllResources = (): Resource[] => {
    const resourceMap = new Map<string, Resource>();

    if (resourceFilter === 'aircraft' || resourceFilter === 'both') {
      displayAircraft.forEach((a) => {
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
      displayInstructors.forEach((instructor) => {
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
        slots.push(hour * slotsPerHour + i);
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

  const getUnavailabilityPeriods = useMemo(() => {
    const cache = new Map<string, UnavailabilityPeriod[]>();

    return (date: Date): UnavailabilityPeriod[] => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const cachedPeriods = cache.get(dateStr);
      if (cachedPeriods) return cachedPeriods;

      const periods: UnavailabilityPeriod[] = [];
      const dayOfWeek = date.getDay();

      displayInstructors.forEach((instructor) => {
        // One-off absences layer over the permanent weekly schedule.
        const instructorAbsences = displayAbsences.filter(
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

        if (!hasAvailabilityData) {
          return;
        }

        // Check for schedule changes effective on this date
        const applicableChanges = displayScheduleChanges
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
        const weeklySchedule = displayWeeklySchedules.find(
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

      cache.set(dateStr, periods);
      return periods;
    };
  }, [
    calendarEndHour,
    calendarStartHour,
    displayAbsences,
    displayInstructors,
    displayScheduleChanges,
    displayWeeklySchedules,
    hasAvailabilityData,
  ]);

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
      return passesCalendarFilters(booking);
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

  const getAgendaBookingsForDate = (date: Date): Booking[] => {
    const resources = getAllResources();
    const visibleAircraftIds = new Set(
      resources.filter((resource) => resource.type === 'aircraft').map((resource) => resource.id)
    );
    const visibleInstructorIds = new Set(
      resources.filter((resource) => resource.type === 'instructor').map((resource) => resource.id)
    );

    return bookings
      .map((booking) => ({
        ...booking,
        ...optimisticBookingUpdates[booking.id],
      }))
      .filter((booking) => {
        if (!isSameDay(new Date(booking.startTime), date)) return false;
        if (!passesCalendarFilters(booking)) return false;
        return (
          (booking.aircraftId && visibleAircraftIds.has(booking.aircraftId)) ||
          (booking.instructorId && visibleInstructorIds.has(booking.instructorId))
        );
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
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

  const getPeriodPosition = (startTime: Date, endTime: Date) => {
    const snapDuration = calendarSettings?.snap_duration || 15;
    const slotsPerHour = 60 / snapDuration;
    const startHour = startTime.getHours();
    const startMinute = startTime.getMinutes();
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    const rawStartSlot =
      (startHour - calendarStartHour) * slotsPerHour +
      Math.floor(startMinute / snapDuration);
    const totalSlots = getTimeSlots().length;
    const startSlot = Math.max(0, Math.min(totalSlots - 1, rawStartSlot));
    const durationInSlots = Math.max(1, Math.ceil(durationHours * slotsPerHour));
    const remainderMinutes = startMinute % snapDuration;
    const minuteHeight = slotHeight / snapDuration;

    return {
      gridRowStart: startSlot + 1,
      gridRowEnd: Math.min(totalSlots + 1, startSlot + 1 + durationInSlots),
      marginTop:
        remainderMinutes === 0 ? 0 : remainderMinutes * minuteHeight,
    };
  };

  const getBookingBlockStyle = (
    position: ReturnType<typeof getBookingPosition>
  ): React.CSSProperties => {
    const rowSpan = Math.max(1, position.gridRowEnd - position.gridRowStart);
    const blockHeight = Math.max(slotHeight, rowSpan * slotHeight - position.marginTop);

    return {
      alignSelf: 'start',
      boxSizing: 'border-box',
      height: blockHeight,
      minHeight: slotHeight,
      maxHeight: blockHeight,
    };
  };

  const getUnavailabilityBlockStyle = (
    position: ReturnType<typeof getPeriodPosition>
  ): React.CSSProperties => {
    const rowSpan = Math.max(1, position.gridRowEnd - position.gridRowStart);
    const blockHeight = Math.max(slotHeight, rowSpan * slotHeight - position.marginTop);

    return {
      alignSelf: 'start',
      boxSizing: 'border-box',
      height: blockHeight,
      minHeight: slotHeight,
      maxHeight: blockHeight,
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

    if (unavailability.source === 'schedule') {
      return null;
    }

    return (
      <div className="absolute inset-0 flex items-center justify-center px-1">
        <span className="pointer-events-auto inline-flex max-w-full items-center gap-1 rounded bg-white bg-opacity-85 px-1.5 py-0.5 text-xs font-medium text-gray-700 shadow-sm">
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

  const resetBookingInteractionState = useCallback(() => {
    setDraggedBooking(null);
    setDraggedBookingOriginal(null);
    setDragPreview(null);
    setResizingBooking(null);
    setPendingBookingDrag(null);
    setHasBookingInteractionMoved(false);
    setTimeout(() => setWasResizing(false), 100);
  }, []);

  const startBookingDragIntent = (
    e: React.MouseEvent,
    booking: Booking,
    resourceType: 'aircraft' | 'instructor'
  ) => {
    if (!canDragOrResizeBooking(booking)) {
      return;
    }

    setActionMenuBooking(null);
    setPendingBookingDrag({
      booking,
      resourceType,
      startX: e.clientX,
      startY: e.clientY,
    });
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
    if (!canDragOrResizeBooking(booking)) {
      toast.error('Delete the flight log before editing this booking');
      return;
    }

    setDraggedBooking(booking);
    setDraggedBookingOriginal(booking);
    setPendingBookingDrag(null);
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
    if (!canDragOrResizeBooking(booking)) {
      toast.error('Delete the flight log before editing this booking');
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

  const updateBookingPreviewForSlot = (
    slot: number,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    date: Date
  ) => {
    if (!draggedBooking && !resizingBooking) return;

    const snapDuration = calendarSettings?.snap_duration || 15;

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
    updateBookingPreviewForSlot(slot, resourceId, resourceType, date);
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
    if (draggedBooking) {
      setWasMovingBooking(true);
      setTimeout(() => setWasMovingBooking(false), 150);
    }
    resetBookingInteractionState();

    void onUpdateBooking(booking.id, updates, true)
      .catch((error) => {
        console.error('Error updating booking:', error);
        setOptimisticBookingUpdates((current) => {
          const next = { ...current };
          delete next[booking.id];
          return next;
        });
        toast.error(wasResizingBooking ? 'Failed to resize booking' : 'Failed to move booking');
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
    resetBookingInteractionState,
  ]);

  useEffect(() => {
    if (!pendingBookingDrag || draggedBooking || resizingBooking) {
      return;
    }

    const handleWindowMouseMove = (event: MouseEvent) => {
      const distance = Math.hypot(
        event.clientX - pendingBookingDrag.startX,
        event.clientY - pendingBookingDrag.startY
      );

      if (distance >= BOOKING_DRAG_MOVE_THRESHOLD_PX) {
        handleBookingDragStart(pendingBookingDrag.booking, pendingBookingDrag.resourceType);
      }
    };

    const handleWindowMouseUp = () => {
      setPendingBookingDrag(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [pendingBookingDrag, draggedBooking, resizingBooking]);

  useEffect(() => {
    if (!draggedBooking && !resizingBooking) {
      return;
    }

    const handleWindowMouseMove = (event: MouseEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const slotElement = element?.closest('[data-calendar-slot="true"]') as HTMLElement | null;
      if (!slotElement) return;

      const slot = Number(slotElement.dataset.slot);
      const resourceId = slotElement.dataset.resourceId;
      const resourceType = slotElement.dataset.resourceType as 'aircraft' | 'instructor' | undefined;
      const dateValue = slotElement.dataset.date;

      if (
        !Number.isFinite(slot) ||
        !resourceId ||
        (resourceType !== 'aircraft' && resourceType !== 'instructor') ||
        !dateValue
      ) {
        return;
      }

      updateBookingPreviewForSlot(slot, resourceId, resourceType, new Date(dateValue));
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    return () => window.removeEventListener('mousemove', handleWindowMouseMove);
  }, [draggedBooking, resizingBooking, updateBookingPreviewForSlot]);

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

  const renderTodayButton = () => (
    <button
      type="button"
      onClick={goToToday}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white font-bold text-gray-700 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:border-blue-400/50 dark:hover:bg-[#262b33] dark:hover:text-blue-200 ${
        isKioskMode ? 'min-h-11 px-4 text-sm' : 'min-h-10 px-3 text-sm'
      }`}
    >
      Today
    </button>
  );

  const renderViewModeButtons = () => (
    <div className={`grid w-full min-w-0 grid-cols-4 rounded-xl bg-gray-100 p-1 dark:bg-[#11141a] ${isKioskMode ? '' : 'sm:w-auto sm:min-w-[17rem] sm:flex'}`}>
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
            className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${isKioskMode ? 'px-2.5 py-3 text-sm' : 'sm:px-3 sm:py-2 sm:text-sm'} ${
              viewMode === mode
                ? 'bg-white text-blue-600 shadow-sm dark:bg-[#262b33] dark:text-blue-300'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
            }`}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
    );

  const renderViewModeGroup = () => (
    <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
      {renderTodayButton()}
      <div className="min-w-0 flex-1 sm:flex-none">
        {renderViewModeButtons()}
      </div>
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
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <select
        value={resourceFilter}
        onChange={(e) =>
          setResourceFilter(e.target.value as any)
        }
        className={`w-full rounded-lg border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 sm:w-auto ${isKioskMode ? 'px-2.5 py-1.5 text-xs' : 'px-2.5 py-2 text-sm'}`}
      >
        <option value="both">Aircraft & Instructors</option>
        <option value="aircraft">Aircraft Only</option>
        <option value="instructors">Instructors Only</option>
      </select>

      <ResourceManagerPanel
        resources={getManagedResources()}
        hiddenIds={hiddenIds}
        orderedIds={orderedIds}
        onHide={handleHideResource}
        onShow={handleShowResource}
        onReorder={handleReorderResources}
        compact={isKioskMode}
      />

      <label className={`inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33] ${isKioskMode ? 'px-2.5 py-1.5 text-xs' : 'px-2.5 py-2 text-sm'}`}>
        <input
          type="checkbox"
          checked={showWaitlistedBookings}
          onChange={(event) => setShowWaitlistedBookings(event.target.checked)}
          className={`${isKioskMode ? 'h-3.5 w-3.5' : 'h-4 w-4'} rounded border-gray-300 text-blue-600 focus:ring-blue-500`}
        />
        <span>Waitlist</span>
      </label>

      <label className={`inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33] ${isKioskMode ? 'px-2.5 py-1.5 text-xs' : 'px-2.5 py-2 text-sm'}`}>
        <input
          type="checkbox"
          checked={showPendingBookings}
          onChange={(event) => setShowPendingBookings(event.target.checked)}
          className={`${isKioskMode ? 'h-3.5 w-3.5' : 'h-4 w-4'} rounded border-gray-300 text-blue-600 focus:ring-blue-500`}
        />
        <span>Pending</span>
      </label>

      <label className={`inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33] ${isKioskMode ? 'px-2.5 py-1.5 text-xs' : 'px-2.5 py-2 text-sm'}`}>
        <input
          type="checkbox"
          checked={showUnavailableBlocks}
          onChange={(event) => setShowUnavailableBlocks(event.target.checked)}
          className={`${isKioskMode ? 'h-3.5 w-3.5' : 'h-4 w-4'} rounded border-gray-300 text-blue-600 focus:ring-blue-500`}
        />
        <span>Unavailable</span>
      </label>

      <label className={`inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33] ${isKioskMode ? 'px-2.5 py-1.5 text-xs' : 'px-2.5 py-2 text-sm'}`}>
        <input
          type="checkbox"
          checked={showCancelledBookings}
          onChange={(event) => setShowCancelledBookings(event.target.checked)}
          className={`${isKioskMode ? 'h-3.5 w-3.5' : 'h-4 w-4'} rounded border-gray-300 text-blue-600 focus:ring-blue-500`}
        />
        <span>Cancelled</span>
      </label>
    </div>
  );

  const renderDayView = () => {
    const timeSlots = getTimeSlots();
    const resources = getAllResources();

    return (
      <div className={isKioskMode ? 'h-full p-2' : 'p-3 sm:p-6'}>
        {!isKioskMode && renderMobileAgenda([currentDate])}
        <div className={`resource-calendar-grid relative overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-[#2c2f36] dark:bg-[#171a21] ${isKioskMode ? 'h-full' : 'hidden md:block'}`}>
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
              const timeLabel = isHourStart ? formatHourLabel(slot) : '';
              const resourceBorderClasses = `${
                isHourStart ? ' border-t border-gray-200' : ''
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
                      ? 'calendar-slot-selected bg-blue-100'
                      : isAlternateHour
                      ? 'calendar-slot-alt bg-blue-50 hover:bg-blue-100'
                      : 'calendar-slot-base hover:bg-gray-50';
                    const borderClasses = resourceBorderClasses;

                    return (
                      <div
                        key={`${resource.id}-${slot}`}
                        data-calendar-slot="true"
                        data-slot={slot}
                        data-resource-id={resource.id}
                        data-resource-type={resource.type}
                        data-date={currentDate.toISOString()}
                        className={`calendar-slot-cell border-r border-gray-200 relative${borderClasses} ${cursorClass} ${backgroundClass}`}
                        style={{
                          height: slotHeight,
                          gridColumn: resourceIndex + 2,
                          gridRow: slotIndex + 1,
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
                      />
                    );
                  })}
                </React.Fragment>
              );
            })}

            {timeSlots.map((slot, slotIndex) => {
              const { minute } = getTimeFromSlot(slot);
              if (minute !== 30) return null;

              return (
                <div
                  key={`half-hour-line-${slot}`}
                  className="pointer-events-none relative z-[2] border-t border-dotted border-gray-300"
                  style={{
                    gridColumn: '1 / -1',
                    gridRow: slotIndex + 1,
                    alignSelf: 'start',
                  }}
                />
              );
            })}

            {showUnavailableBlocks && resources.map((resource, resourceIndex) =>
              getUnavailabilityPeriods(currentDate)
                .filter(
                  (period) =>
                    period.resourceId === resource.id &&
                    period.resourceType === resource.type
                )
                .map((period) => {
                  const position = getPeriodPosition(period.startTime, period.endTime);
                  return (
                    <div
                      key={`unavailable-${resource.id}-${period.id || period.reason}-${period.startTime.getTime()}-${period.endTime.getTime()}`}
                      className="pointer-events-none relative z-[1] overflow-hidden border-r border-gray-200"
                      style={{
                        gridColumn: resourceIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        background: period.source === 'schedule'
                          ? 'rgba(156, 163, 175, 0.35)'
                          : period.pattern === 'diagonal'
                          ? `repeating-linear-gradient(
                              45deg,
                              rgba(156, 163, 175, 0.3),
                              rgba(156, 163, 175, 0.3) 4px,
                              transparent 4px,
                              transparent 8px
                            )`
                          : 'rgba(156, 163, 175, 0.5)',
                        ...getUnavailabilityBlockStyle(position),
                      }}
                    >
                      {renderUnavailabilityLabel(period)}
                    </div>
                  );
                })
            )}

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
                    className={`${getBookingColorClasses(booking)} ${getBookingAttentionClasses(booking)} calendar-booking-card relative text-xs ${getBookingCardPadding(bookingCardDensity)} rounded-md shadow-sm overflow-hidden cursor-move transition-colors z-10 border-2 ${
                      isBeingDragged
                        ? 'opacity-30 pointer-events-none'
                        : ''
                    } ${isBeingResized ? 'pointer-events-none' : ''} group`}
                    style={{
                      gridColumn: resourceIndex + 2,
                      gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                      marginTop: position.marginTop,
                      ...getBookingBlockStyle(position),
                      ...getBookingLaneStyle(booking),
                    }}
                    title={`${booking.notes || 'Booking'}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (canDragOrResizeBooking(booking)) {
                        startBookingDragIntent(e, booking, resource.type);
                      }
                    }}
                    onClick={(e) => {
                      e.stopPropagation();

                      setPendingBookingDrag(null);

                      // If drag already started, cancel it
                      if (draggedBooking) {
                        setDraggedBooking(null);
                        setDraggedBookingOriginal(null);
                        setDragPreview(null);
                        return;
                      }

                      if (wasResizing || wasMovingBooking) {
                        return;
                      }

                      openBookingActionMenu(booking, { x: e.clientX, y: e.clientY });
                    }}
                  >
                    {canDragOrResizeBooking(booking) && (
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
                    ...getBookingBlockStyle(previewPosition),
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
      <div className={isKioskMode ? 'h-full p-2' : 'p-3 sm:p-6'}>
        {!isKioskMode && renderMobileAgenda(weekDays)}
        <div className={`resource-calendar-grid relative overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-[#2c2f36] dark:bg-[#171a21] ${isKioskMode ? 'h-full' : 'hidden md:block'}`}>
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
              const timeLabel = isHourStart ? formatHourLabel(slot) : '';
              const resourceBorderClasses = `${
                isHourStart ? ' border-t border-gray-200' : ''
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
                        ? 'calendar-slot-selected bg-blue-100'
                        : isAlternateHour
                        ? 'calendar-slot-alt bg-blue-50 hover:bg-blue-100'
                        : 'calendar-slot-base hover:bg-gray-50';

                      daySlots.push(
                        <div
                          key={`${dayIndex}-aircraft-${slot}`}
                          data-calendar-slot="true"
                          data-slot={slot}
                          data-resource-id={selectedAircraftId}
                          data-resource-type="aircraft"
                          data-date={day.toISOString()}
                          className={`calendar-slot-cell border-r border-gray-200 relative${borderClasses} ${cursorClass} ${backgroundClass}`}
                          style={{
                            height: slotHeight,
                            gridColumn: columnIndex + 2,
                            gridRow: slotIndex + 1,
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
                        />
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
                        ? 'calendar-slot-selected bg-blue-100'
                        : isAlternateHour
                        ? 'calendar-slot-alt bg-blue-50 hover:bg-blue-100'
                        : 'calendar-slot-base hover:bg-gray-50';

                      daySlots.push(
                        <div
                          key={`${dayIndex}-instructor-${slot}`}
                          data-calendar-slot="true"
                          data-slot={slot}
                          data-resource-id={selectedInstructorId}
                          data-resource-type="instructor"
                          data-date={day.toISOString()}
                          className={`calendar-slot-cell border-r border-gray-200 relative${borderClasses} ${cursorClass} ${backgroundClass}`}
                          style={{
                            height: slotHeight,
                            gridColumn: columnIndex + 2,
                            gridRow: slotIndex + 1,
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
                        />
                      );
                    }

                    return daySlots;
                  })}
                  </React.Fragment>
                );
              })}

            {timeSlots.map((slot, slotIndex) => {
              const { minute } = getTimeFromSlot(slot);
              if (minute !== 30) return null;

              return (
                <div
                  key={`week-half-hour-line-${slot}`}
                  className="pointer-events-none relative z-[2] border-t border-dotted border-gray-300"
                  style={{
                    gridColumn: '1 / -1',
                    gridRow: slotIndex + 1,
                    alignSelf: 'start',
                  }}
                />
              );
            })}

            {showUnavailableBlocks && weekDays.map((day, dayIndex) => {
              const overlays = [];
              let columnOffset = 0;

              if (hasAircraft) {
                const columnIndex = dayIndex * columnsPerDay + columnOffset;
                getUnavailabilityPeriods(day)
                  .filter(
                    (period) =>
                      period.resourceId === selectedAircraftId &&
                      period.resourceType === 'aircraft'
                  )
                  .forEach((period) => {
                    const position = getPeriodPosition(period.startTime, period.endTime);
                    overlays.push(
                      <div
                        key={`week-unavailable-aircraft-${dayIndex}-${period.id || period.reason}-${period.startTime.getTime()}-${period.endTime.getTime()}`}
                        className="pointer-events-none relative z-[1] overflow-hidden border-r border-gray-200"
                        style={{
                          gridColumn: columnIndex + 2,
                          gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                          marginTop: position.marginTop,
                          background: period.source === 'schedule'
                            ? 'rgba(156, 163, 175, 0.35)'
                            : period.pattern === 'diagonal'
                            ? `repeating-linear-gradient(
                                45deg,
                                rgba(156, 163, 175, 0.3),
                                rgba(156, 163, 175, 0.3) 4px,
                                transparent 4px,
                                transparent 8px
                              )`
                            : 'rgba(156, 163, 175, 0.5)',
                          ...getUnavailabilityBlockStyle(position),
                        }}
                      >
                        {renderUnavailabilityLabel(period)}
                      </div>
                    );
                  });
                columnOffset++;
              }

              if (hasInstructor) {
                const columnIndex = dayIndex * columnsPerDay + columnOffset;
                getUnavailabilityPeriods(day)
                  .filter(
                    (period) =>
                      period.resourceId === selectedInstructorId &&
                      period.resourceType === 'instructor'
                  )
                  .forEach((period) => {
                    const position = getPeriodPosition(period.startTime, period.endTime);
                    overlays.push(
                      <div
                        key={`week-unavailable-instructor-${dayIndex}-${period.id || period.reason}-${period.startTime.getTime()}-${period.endTime.getTime()}`}
                        className="pointer-events-none relative z-[1] overflow-hidden border-r border-gray-200"
                        style={{
                          gridColumn: columnIndex + 2,
                          gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                          marginTop: position.marginTop,
                          background: period.source === 'schedule'
                            ? 'rgba(156, 163, 175, 0.35)'
                            : period.pattern === 'diagonal'
                            ? `repeating-linear-gradient(
                                45deg,
                                rgba(156, 163, 175, 0.3),
                                rgba(156, 163, 175, 0.3) 4px,
                                transparent 4px,
                                transparent 8px
                              )`
                            : 'rgba(156, 163, 175, 0.5)',
                          ...getUnavailabilityBlockStyle(position),
                        }}
                      >
                        {renderUnavailabilityLabel(period)}
                      </div>
                    );
                  });
              }

              return overlays;
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
                      className={`${getBookingColorClasses(booking)} ${getBookingAttentionClasses(booking)} calendar-booking-card relative text-xs ${getBookingCardPadding(bookingCardDensity)} rounded-md shadow-sm overflow-hidden cursor-move transition-colors z-10 border-2 ${
                        isBeingDragged ? 'opacity-30 pointer-events-none' : ''
                      } ${isBeingResized ? 'pointer-events-none' : ''} group`}
                      style={{
                        gridColumn: columnIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        ...getBookingBlockStyle(position),
                        ...getBookingLaneStyle(booking),
                      }}
                      title={`${booking.notes || 'Booking'}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (canDragOrResizeBooking(booking)) {
                          startBookingDragIntent(e, booking, 'aircraft');
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingBookingDrag(null);
                        if (draggedBooking) {
                          setDraggedBooking(null);
                          setDraggedBookingOriginal(null);
                          setDragPreview(null);
                          return;
                        }
                        if (wasResizing || wasMovingBooking) {
                          return;
                        }

                        openBookingActionMenu(booking, { x: e.clientX, y: e.clientY });
                      }}
                    >
                      {canDragOrResizeBooking(booking) && (
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
                      className={`${getBookingColorClasses(booking)} ${getBookingAttentionClasses(booking)} calendar-booking-card relative text-xs ${getBookingCardPadding(bookingCardDensity)} rounded-md shadow-sm overflow-hidden cursor-move transition-colors z-10 border-2 ${
                        isBeingDragged ? 'opacity-30 pointer-events-none' : ''
                      } ${isBeingResized ? 'pointer-events-none' : ''} group`}
                      style={{
                        gridColumn: columnIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        ...getBookingBlockStyle(position),
                        ...getBookingLaneStyle(booking),
                      }}
                      title={`${booking.notes || 'Booking'}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (canDragOrResizeBooking(booking)) {
                          startBookingDragIntent(e, booking, 'instructor');
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingBookingDrag(null);
                        if (draggedBooking) {
                          setDraggedBooking(null);
                          setDraggedBookingOriginal(null);
                          setDragPreview(null);
                          return;
                        }
                        if (wasResizing || wasMovingBooking) {
                          return;
                        }

                        openBookingActionMenu(booking, { x: e.clientX, y: e.clientY });
                      }}
                    >
                      {canDragOrResizeBooking(booking) && (
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
                      ...getBookingBlockStyle(previewPosition),
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
                      ...getBookingBlockStyle(previewPosition),
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
                    openBookingActionMenu(booking, { x: event.clientX, y: event.clientY });
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

  const renderDatePicker = () => {
    const weekStartsOn = calendarSettings?.week_starts_on === 'sunday' ? 0 : 1;
    const monthStart = startOfMonth(datePickerMonth);
    const monthEnd = endOfMonth(datePickerMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn });
    const pickerDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
      format(addDays(calendarStart, index), 'EEE')
    );

    return (
      <div
        ref={datePickerRef}
        className="absolute left-1/2 top-full z-50 mt-3 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-2xl dark:border-[#363b45] dark:bg-[#171a21]"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setDatePickerMonth((date) => subMonths(date, 1))}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-[#262b33] dark:hover:text-white"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="text-center">
            <p className="text-base font-bold text-gray-950 dark:text-gray-100">
              {format(datePickerMonth, 'MMMM yyyy')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Choose a day to jump to</p>
          </div>
          <button
            type="button"
            onClick={() => setDatePickerMonth((date) => addMonths(date, 1))}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-[#262b33] dark:hover:text-white"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {weekdayLabels.map((label) => (
            <div key={label} className="py-1 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {label}
            </div>
          ))}
          {pickerDays.map((day) => {
            const isSelected = isSameDay(day, currentDate);
            const isOutsideMonth = day.getMonth() !== datePickerMonth.getMonth();
            const isCurrentDay = isToday(day);

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => {
                  setCurrentDate(day);
                  setShowDatePicker(false);
                  if (viewMode === 'list') setViewMode('day');
                }}
                className={`flex h-10 items-center justify-center rounded-xl text-sm font-semibold transition-colors ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-sm'
                    : isCurrentDay
                      ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-800'
                      : isOutsideMonth
                        ? 'text-gray-300 hover:bg-gray-50 hover:text-gray-500 dark:text-gray-600 dark:hover:bg-[#11141a] dark:hover:text-gray-300'
                        : 'text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-[#262b33]'
                }`}
              >
                {format(day, 'd')}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex justify-between gap-2 border-t border-gray-100 pt-3 dark:border-[#2c2f36]">
          <button
            type="button"
            onClick={goToToday}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#363b45] dark:text-gray-100 dark:hover:bg-[#262b33]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setShowDatePicker(false)}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-[#262b33] dark:hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    );
  };

  const renderStandardControls = () => (
    <div className="space-y-2 sm:space-y-3">
      <div className="grid min-w-0 items-center gap-2 sm:gap-3 xl:grid-cols-[190px_minmax(360px,1fr)_300px] 2xl:grid-cols-[220px_minmax(460px,1fr)_340px]">
        <div className="grid min-w-0 gap-2 sm:flex sm:items-center">
          <h2 className="hidden text-xl font-bold tracking-tight text-gray-950 dark:text-gray-100 2xl:block">
            Calendar
          </h2>
          <button
            onClick={onNewBooking}
            className="inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 sm:w-auto sm:gap-2 sm:px-4"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">New Booking</span>
          </button>
          <div className="min-w-0 sm:hidden">
            {renderViewModeGroup()}
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-center gap-1.5 sm:gap-2">
          <button
            onClick={() => navigateDate('prev')}
            className="rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-[#262b33] dark:hover:text-white"
            aria-label="Previous date range"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="relative min-w-0 flex-1 max-w-xl">
            <button
              type="button"
              onClick={() => setShowDatePicker((value) => !value)}
              className="flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-center text-sm font-bold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33] sm:min-h-12 sm:text-base"
              aria-expanded={showDatePicker}
              aria-haspopup="dialog"
              title="Choose date"
            >
              <CalendarDays className="h-4 w-4 flex-shrink-0 text-blue-500" />
              <span className="truncate">{getDateRangeText()}</span>
            </button>
            {showDatePicker && renderDatePicker()}
          </div>
          <button
            onClick={() => navigateDate('next')}
            className="rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-[#262b33] dark:hover:text-white"
            aria-label="Next date range"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="hidden min-w-0 justify-start sm:flex xl:justify-end">
          {renderViewModeGroup()}
        </div>
      </div>

      <details className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#11141a] sm:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-gray-800 dark:text-gray-100 [&::-webkit-details-marker]:hidden">
          <span>Filters & options</span>
          <ChevronDown className="h-4 w-4 text-gray-500" />
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {viewMode === 'day' && renderFilterControls()}
          {viewMode === 'week' && <div className="w-full min-w-0">{renderResourceSelectors()}</div>}

          <label className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33]">
            <input
              type="checkbox"
              checked={highlightUnlogged}
              onChange={(e) => setHighlightUnlogged(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Highlight Unlogged</span>
          </label>

          {onRefresh && (
            <button
              onClick={() => void onRefresh()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33]"
              title="Refresh calendar"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Refresh</span>
            </button>
          )}
        </div>
      </details>

      <div className="hidden flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#11141a] sm:flex">
        {viewMode === 'day' && renderFilterControls()}
        {viewMode === 'week' && <div className="w-full min-w-0 md:min-w-[28rem] md:flex-1">{renderResourceSelectors()}</div>}

        <label className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33]">
          <input
            type="checkbox"
            checked={highlightUnlogged}
            onChange={(e) => setHighlightUnlogged(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Highlight Unlogged</span>
        </label>

        {onRefresh && (
          <button
            onClick={() => void onRefresh()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33]"
            title="Refresh calendar"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Refresh</span>
          </button>
        )}
      </div>
    </div>
  );

  const renderKioskControls = () => (
    <div className="space-y-3">
      <div className="grid items-center gap-4 md:grid-cols-[210px_minmax(420px,1fr)_300px] xl:grid-cols-[240px_minmax(520px,1fr)_360px]">
        <div className="flex justify-start">
          <button
            onClick={onNewBooking}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">New Booking</span>
          </button>
        </div>

        <div className="flex min-w-0 items-center justify-center gap-2">
          <button
            onClick={() => navigateDate('prev')}
            className="rounded-full p-3 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-[#262b33] dark:hover:text-white"
            aria-label="Previous date range"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="relative min-w-0 flex-1 max-w-2xl">
            <button
              type="button"
              onClick={() => setShowDatePicker((value) => !value)}
              className="flex min-h-16 w-full min-w-0 items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 text-center text-xl font-bold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33] xl:text-2xl"
              aria-expanded={showDatePicker}
              aria-haspopup="dialog"
              title="Choose date"
            >
              <CalendarDays className="h-6 w-6 flex-shrink-0 text-blue-500" />
              <span className="truncate">{getDateRangeText()}</span>
            </button>
            {showDatePicker && renderDatePicker()}
          </div>
          <button
            onClick={() => navigateDate('next')}
            className="rounded-full p-3 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-[#262b33] dark:hover:text-white"
            aria-label="Next date range"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </div>

        <div className="flex min-w-0 justify-end">
          {renderViewModeGroup()}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#11141a]">
        {viewMode === 'day' && renderFilterControls()}
        {viewMode === 'week' && <div className="min-w-[28rem] flex-1">{renderResourceSelectors()}</div>}

        <label className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33]">
          <input
            type="checkbox"
            checked={highlightUnlogged}
            onChange={(e) => setHighlightUnlogged(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Highlight Unlogged</span>
        </label>

        {onRefresh && (
          <button
            onClick={() => void onRefresh()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33]"
            title="Refresh calendar"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className={isKioskMode ? 'flex h-full min-h-0 select-none flex-col overflow-hidden bg-white dark:bg-[#0f1117]' : 'select-none overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]'}>
      <div className={isKioskMode ? 'shrink-0 border-b border-gray-200 bg-white p-4 dark:border-[#2c2f36] dark:bg-[#0f1117]' : 'border-b border-gray-200 bg-white p-3 dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-4'}>
        {isKioskMode ? renderKioskControls() : renderStandardControls()}
      </div>

      <div className={isKioskMode ? 'min-h-0 flex-1 overflow-hidden' : undefined}>
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
      </div>

      {(actionMenuBooking || bookingMenuLoading) && (
        <div
          className="fixed inset-0 z-40"
          onMouseDown={(e) => {
            e.stopPropagation();
            bookingMenuOpenTokenRef.current += 1;
            setActionMenuBooking(null);
            setBookingMenuLoading(null);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {bookingMenuLoading && !actionMenuBooking && (
        <div
          className="fixed z-50 min-w-[210px] rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-xl dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100"
          style={{
            left: Math.min(Math.max(bookingMenuLoading.x, 8), Math.max(8, window.innerWidth - 230)),
            top: Math.min(Math.max(bookingMenuLoading.y, 8), Math.max(8, window.innerHeight - 72)),
          }}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span>Loading booking...</span>
          </div>
        </div>
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
              const bookingToEdit = actionMenuBooking;
              const bookingDate = format(new Date(bookingToEdit.startTime), 'yyyy-MM-dd');
              window.sessionStorage.setItem(selectedDateStorageKey, bookingDate);
              setCurrentDate(new Date(`${bookingDate}T12:00:00`));
              setActionMenuBooking(null);
              window.setTimeout(() => onEditBooking(bookingToEdit), 0);
            }
          }}
          onCopy={() => {
            if (onCopyBooking) {
              const bookingToCopy = actionMenuBooking;
              const bookingDate = format(new Date(bookingToCopy.startTime), 'yyyy-MM-dd');
              window.sessionStorage.setItem(selectedDateStorageKey, bookingDate);
              setCurrentDate(new Date(`${bookingDate}T12:00:00`));
              setActionMenuBooking(null);
              window.setTimeout(() => onCopyBooking(bookingToCopy), 0);
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
              void Promise.resolve(onDeleteBooking(actionMenuBooking.id));
            }
          }}
          onViewHirerProfile={!isKioskMode && (actionMenuBooking.studentId || actionMenuBooking.pilotId)
            ? () => {
                const hirerId = actionMenuBooking.studentId || actionMenuBooking.pilotId;
                if (!hirerId) return;
                setActionMenuBooking(null);
                navigate(`/students/${hirerId}`);
              }
            : undefined}
          onApprove={
            onApproveBooking && canApproveCalendarBooking(actionMenuBooking)
              ? () => void Promise.resolve(onApproveBooking(actionMenuBooking.id))
              : undefined
          }
          isFlightLogged={isBookingFlightLogged(actionMenuBooking)}
          canApprove={canApproveCalendarBooking(actionMenuBooking)}
          onClose={() => {
            bookingMenuOpenTokenRef.current += 1;
            setActionMenuBooking(null);
            setBookingMenuLoading(null);
          }}
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
