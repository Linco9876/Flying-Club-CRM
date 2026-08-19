import { SearchableSelect } from '../common/SearchableSelect';
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
  addMonths,
  subMonths,
  differenceInCalendarDays,
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
  Search,
  Sun,
} from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import { useGroundSessionLogs } from '../../hooks/useGroundSessionLogs';
import { useKeyboardNavigation } from '../../hooks/useKeyboardNavigation';
import { useCalendarSettings, useOrganisationSettings, useUserPreferences } from '../../hooks/useSettings';
import { useInstructorAvailability, type Absence } from '../../hooks/useInstructorAvailability';
import { useOrganisationLocations } from '../../hooks/useOrganisationLocations';
import { useAuth } from '../../context/AuthContext';
import { usePageLoadState } from '../../context/PageLoadContext';
import { ResourceManagerPanel, ManagedResource } from './ResourceManagerPanel';
import { supabase } from '../../lib/supabase';
import { Booking } from '../../types';
import { CurrentTimeIndicator } from './CurrentTimeIndicator';
import { MonthView } from './MonthView';
import { isPastBooking } from '../../utils/timeUtils';
import { BookingActionMenu } from '../Bookings/BookingActionMenu';
import { FlightLogModal } from '../Bookings/FlightLogModal';
import { GroundSessionLogModal } from '../Bookings/GroundSessionLogModal';
import { BookingCancellationModal } from '../Bookings/BookingCancellationModal';
import { GuestPromotionModal } from '../Bookings/GuestPromotionModal';
import type { BookingCancellationInput } from '../../hooks/useBookings';
import toast from 'react-hot-toast';
import { NextAvailableSlotModal, type NextAvailableSlot } from './NextAvailableSlotModal';
import { useLatestEffect } from '../../hooks/useLatestEffect';
import { FLIGHT_LOG_ALREADY_EXISTS_MESSAGE } from '../../utils/flightLogBookingRules';
import { resolveCalendarNotificationFocus } from '../../utils/calendarNotificationFocus';
import { useManualBookingSupervision } from '../../hooks/useManualBookingSupervision';
import {
  formatCalendarMinute,
  getCalendarDaylightTimes,
  isCalendarSlotOutsideDaylight,
} from '../../utils/calendarDaylight';
import {
  canManageCalendarDowntime,
  getCalendarUnavailabilityBackground,
  getTemporaryDowntimeValidationError,
} from '../../utils/calendarDowntime';
import {
  buildCalendarViewSearchParams,
  filterCalendarListBookings,
  formatCalendarListDate,
  getDefaultCalendarListRange,
  isCalendarListDateRangeValid,
  type CalendarListBookingType,
  type CalendarListSort,
  type CalendarListStatus,
} from '../../utils/calendarListView';
import { getCalendarStickyHeaderTransition } from '../../utils/calendarStickyHeader';

interface CalendarProps {
  bookings: Booking[];
  onNewBooking: (date?: Date) => void;
  onNewBookingWithTime?: (
    date: Date,
    startTime: string,
    endTime?: string,
    resourceId?: string,
    resourceType?: 'aircraft' | 'instructor',
    additionalData?: {
      aircraftId?: string;
      instructorId?: string;
      location?: string;
      locationId?: string;
    }
  ) => void;
  onEditBooking?: (booking: Booking) => void;
  onCopyBooking?: (booking: Booking) => void;
  onUpdateBooking?: (bookingId: string, updates: Partial<Booking>, silent?: boolean) => Promise<void> | void;
  onDeleteBooking?: (bookingId: string, cancellation?: BookingCancellationInput) => Promise<void> | void;
  onRestoreBooking?: (bookingId: string) => Promise<void> | void;
  onApproveBooking?: (bookingId: string) => Promise<void> | void;
  onRefresh?: () => Promise<void> | void;
  isKioskMode?: boolean;
}

interface Resource {
  id: string;
  name: string;
  subtitle?: string;
  type: 'aircraft' | 'instructor';
  icon: React.ReactNode;
  status?: string;
}

interface FloatingCalendarHeaderState {
  visible: boolean;
  progress: number;
  height: number;
  left: number;
  width: number;
  top: number;
  scrollLeft: number;
  contentWidth: number;
  gridLeft: number;
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
const TOUCH_HOLD_TO_DRAG_MS = 260;
const TOUCH_TAP_MAX_MS = 160;
const COMPACT_CALENDAR_HEADER_HEIGHT = 48;
const CALENDAR_HEADER_SHRINK_DISTANCE = 40;
const TOUCH_TAP_MOVE_THRESHOLD_PX = 6;
const TOUCH_CANCEL_MOVE_THRESHOLD_PX = 24;
const CALENDAR_DAYLIGHT_OVERLAY_STORAGE_KEY = 'bfc.calendar.shade_non_daylight';

const CALENDAR_BOOKING_COLOUR_CLASSES = {
  confirmed: 'bg-blue-100/90 border-blue-500 hover:bg-blue-100 text-blue-950',
  pendingApproval: 'bg-amber-100/90 border-amber-500 hover:bg-amber-100 text-amber-950',
  pendingSupervision: 'bg-orange-100/90 border-orange-500 hover:bg-orange-100 text-orange-950',
  logged: 'bg-emerald-100/90 border-emerald-500 hover:bg-emerald-100 text-emerald-950',
  attention: 'bg-red-100/90 border-red-500 hover:bg-red-100 text-red-950',
  cancelled: 'bg-gray-100/90 border-gray-500 hover:bg-gray-100 text-gray-800',
} as const;

const CALENDAR_BOOKING_LEGEND = [
  { label: 'Confirmed', classes: CALENDAR_BOOKING_COLOUR_CLASSES.confirmed },
  { label: 'Pending approval', classes: CALENDAR_BOOKING_COLOUR_CLASSES.pendingApproval },
  { label: 'Needs supervision', classes: CALENDAR_BOOKING_COLOUR_CLASSES.pendingSupervision },
  { label: 'Flight logged', classes: CALENDAR_BOOKING_COLOUR_CLASSES.logged },
  { label: 'Waitlist / past unlogged', classes: CALENDAR_BOOKING_COLOUR_CLASSES.attention },
  { label: 'Cancelled', classes: CALENDAR_BOOKING_COLOUR_CLASSES.cancelled },
] as const;

const getStoredDaylightOverlayPreference = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CALENDAR_DAYLIGHT_OVERLAY_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

interface CalendarResourceLayoutPreference {
  hiddenIds?: string[];
  orderedIds?: string[];
}

interface TouchSlotSelectionState {
  pointerId: number;
  slot: number;
  resourceId: string;
  resourceType: 'aircraft' | 'instructor';
  date: Date;
  dayIndex?: number;
  startX: number;
  startY: number;
  startedAt: number;
  moved: boolean;
  activated: boolean;
}

interface TouchBookingInteractionState {
  pointerId: number;
  booking: Booking;
  resourceType: 'aircraft' | 'instructor';
  startX: number;
  startY: number;
  activated: boolean;
  mode: 'move' | 'resize-top' | 'resize-bottom';
  pressX: number;
  pressY: number;
}

const parseCalendarDateParam = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const Calendar: React.FC<CalendarProps> = ({
  bookings,
  onNewBooking,
  onNewBookingWithTime,
  onEditBooking,
  onCopyBooking,
  onUpdateBooking,
  onDeleteBooking,
  onRestoreBooking,
  onApproveBooking,
  onRefresh,
  isKioskMode = false,
}) => {
  const { user } = useAuth();
  const {
    acceptBooking: acceptManualSupervision,
    acceptingBookingId,
    canAcceptBooking: canAcceptManualSupervision,
  } = useManualBookingSupervision();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { aircraft, loading: aircraftLoading } = useAircraft({ participateInPageLoad: false });
  const { users, loading: usersLoading } = useUsers();
  const [publicInstructorDirectory, setPublicInstructorDirectory] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const { deleteFlightLog, getFlightLogDeleteImpact, findFlightLogForBooking } = useFlightLogs(undefined, { participateInPageLoad: false });
  const { deleteGroundSessionLog } = useGroundSessionLogs();
  const bookingInstructorDirectory = useMemo(() => {
    const merged = new Map<string, { id: string; name: string; email: string }>();
    bookings.forEach((booking) => {
      if (!booking.instructorId || !booking.instructorName) return;
      if (!merged.has(booking.instructorId)) {
        merged.set(booking.instructorId, {
          id: booking.instructorId,
          name: booking.instructorName,
          email: '',
        });
      }
    });
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [bookings]);
  const instructors = useMemo(() => {
    const fromUsers = users
      .filter(u => u.roles?.includes('instructor') || u.roles?.includes('senior_instructor'))
      .map((u) => ({ id: u.id, name: u.name, email: u.email, roles: u.roles }));
    const merged = new Map<string, { id: string; name: string; email: string; roles?: string[] }>();
    fromUsers.forEach((instructor) => merged.set(instructor.id, instructor));
    publicInstructorDirectory.forEach((instructor) => {
      if (!merged.has(instructor.id)) {
        merged.set(instructor.id, { ...instructor, roles: ['instructor'] });
      }
    });
    bookingInstructorDirectory.forEach((instructor) => {
      if (!merged.has(instructor.id)) {
        merged.set(instructor.id, { ...instructor, roles: ['instructor'] });
      }
    });
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [bookingInstructorDirectory, publicInstructorDirectory, users]);
  const lastKnownAircraftRef = useRef<typeof aircraft>([]);
  const lastKnownUsersRef = useRef<typeof users>([]);
  const lastKnownInstructorsRef = useRef<typeof instructors>([]);
  useEffect(() => {
    const activeAircraft = aircraft.filter(item => !item.isArchived);
    if (activeAircraft.length > 0) lastKnownAircraftRef.current = activeAircraft;
    if (users.length > 0) lastKnownUsersRef.current = users;
    if (instructors.length > 0) lastKnownInstructorsRef.current = instructors;
  }, [aircraft, users, instructors]);
  const activeAircraft = useMemo(() => aircraft.filter(item => !item.isArchived), [aircraft]);
  const displayAircraft = activeAircraft.length > 0 ? activeAircraft : lastKnownAircraftRef.current;
  const aircraftForLookup = aircraft.length > 0 ? aircraft : displayAircraft;
  const displayUsers = users.length > 0 ? users : lastKnownUsersRef.current;
  const displayInstructors = instructors.length > 0 ? instructors : lastKnownInstructorsRef.current;
  const userRoles = user?.roles && user.roles.length > 0 ? user.roles : (user?.role ? [user.role] : []);
  const isStaffCalendarUser = userRoles.some(role => ['admin', 'senior_instructor', 'instructor'].includes(role));
  const isStudentOrPilotCalendarUser = userRoles.some(role => role === 'student' || role === 'pilot');
  const isLimitedCalendarUser = isStudentOrPilotCalendarUser && !isStaffCalendarUser;
  useEffect(() => {
    let cancelled = false;

    const fetchPublicInstructorDirectory = async () => {
      // Kiosk sessions intentionally run at AAL1 so a shared device does not
      // repeatedly prompt for an administrator's MFA. Their general users
      // query can therefore be limited to the kiosk owner. Use the restricted
      // calendar directory in kiosk mode as well so every active instructor is
      // available without exposing the wider member directory.
      if (!isLimitedCalendarUser && !isKioskMode) {
        setPublicInstructorDirectory([]);
        return;
      }

      try {
        let directory: Array<{ id: string; name: string; email: string }> = [];
        const { data, error } = await supabase.rpc('list_calendar_instructors');
        if (error) throw error;
        directory = Array.isArray(data)
          ? data.map((row: any) => ({
              id: row.id,
              name: row.name || row.email || 'Instructor',
              email: row.email || '',
            }))
          : [];

        if (directory.length === 0) {
          const [{ data: fallbackUsers }, { data: fallbackRoles }] = await Promise.all([
            supabase.from('users').select('id, name, email'),
            supabase.from('user_roles').select('user_id, role').in('role', ['instructor', 'senior_instructor']),
          ]);
          const instructorIds = new Set((fallbackRoles || []).map((row: any) => row.user_id));
          directory = (fallbackUsers || [])
            .filter((row: any) => instructorIds.has(row.id))
            .map((row: any) => ({
              id: row.id,
              name: row.name || row.email || 'Instructor',
              email: row.email || '',
            }));
        }

        if (!cancelled) {
          setPublicInstructorDirectory(directory);
        }
      } catch (error) {
        console.error('Failed to load public instructor directory:', error);
        if (!cancelled) {
          setPublicInstructorDirectory([]);
        }
      }
    };

    void fetchPublicInstructorDirectory();
    return () => {
      cancelled = true;
    };
  }, [isKioskMode, isLimitedCalendarUser]);
  const { settings: calendarSettings, loading: calendarSettingsLoading } = useCalendarSettings();
  const { preferences: userPreferences, loading: userPreferencesLoading, updatePreferencesSilent } = useUserPreferences(user?.id || '');
  const { settings: organisationSettings, loading: organisationSettingsLoading } = useOrganisationSettings();
  const {
    activeLocations,
    primaryLocation,
    loading: organisationLocationsLoading,
  } = useOrganisationLocations();
  const {
    weeklySchedules,
    absences,
    scheduleChanges,
    loading: availabilityLoading,
    addAbsence,
    updateAbsence,
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
  const initialCalendarLoading =
    aircraftLoading ||
    usersLoading ||
    calendarSettingsLoading ||
    userPreferencesLoading ||
    organisationSettingsLoading ||
    organisationLocationsLoading ||
    (!hasAvailabilityData && availabilityLoading);
  usePageLoadState(
    initialCalendarLoading,
    isKioskMode ? 'Loading kiosk calendar' : 'Loading calendar',
    'Preparing bookings, aircraft, instructors, availability and calendar preferences...'
  );
  const preferredAircraftId = user?.preferredAircraftId;
  // Per-resource visibility & ordering (loaded from/synced to DB)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [currentDate, setCurrentDate] = useState(() => parseCalendarDateParam(searchParams.get('date')) || new Date());
  const [showNextAvailableSlot, setShowNextAvailableSlot] = useState(false);
  const [datePickerMonth, setDatePickerMonth] = useState(() => parseCalendarDateParam(searchParams.get('date')) || new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const resourceCalendarGridRef = useRef<HTMLDivElement | null>(null);
  const resourceCalendarHeaderRef = useRef<HTMLDivElement | null>(null);
  const floatingHeaderFrameRef = useRef<number | null>(null);
  const [floatingHeader, setFloatingHeader] = useState<FloatingCalendarHeaderState>({
    visible: false,
    progress: 0,
    height: COMPACT_CALENDAR_HEADER_HEIGHT,
    left: 0,
    width: 0,
    top: 64,
    scrollLeft: 0,
    contentWidth: 0,
    gridLeft: 0,
  });
  const [notificationFocusBookingId, setNotificationFocusBookingId] = useState<string | null>(null);
  const handledNotificationFocusRef = useRef<string | null>(null);
  const notificationFocusAnimationFrameRef = useRef<number | null>(null);
  const notificationFocusScrollTimerRef = useRef<number | null>(null);
  const notificationFocusClearTimerRef = useRef<number | null>(null);
  const [listPilotFilter, setListPilotFilter] = useState<string>('');
  const [listInstructorFilter, setListInstructorFilter] = useState<string>('');
  const [listResourceFilter, setListResourceFilter] = useState<string>('');
  const [listBookingTypeFilter, setListBookingTypeFilter] = useState<CalendarListBookingType>('all');
  const [listStatusFilter, setListStatusFilter] = useState<CalendarListStatus>('all');
  const [listSearchQuery, setListSearchQuery] = useState('');
  const [listSort, setListSort] = useState<CalendarListSort>('ascending');
  const [listStartDate, setListStartDate] = useState(() =>
    getDefaultCalendarListRange(parseCalendarDateParam(searchParams.get('date')) || new Date()).startDate
  );
  const [listEndDate, setListEndDate] = useState(() =>
    getDefaultCalendarListRange(parseCalendarDateParam(searchParams.get('date')) || new Date()).endDate
  );
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
  const [hideAllDayUnavailableResources, setHideAllDayUnavailableResources] = useState(false);
  const [showDaylightOverlay, setShowDaylightOverlay] = useState(getStoredDaylightOverlayPreference);
  const [daylightLocationId, setDaylightLocationId] = useState('');
  const [downtimeChoice, setDowntimeChoice] = useState<{
    date: Date;
    startTime: string;
    endTime: string;
    instructorId: string;
  } | null>(null);
  const [downtimeReason, setDowntimeReason] = useState('Temporary off period');
  const [downtimeEditor, setDowntimeEditor] = useState<Absence | null>(null);
  const [downtimeEditorBusy, setDowntimeEditorBusy] = useState<'save' | 'delete' | null>(null);
  const [confirmingDowntimeDelete, setConfirmingDowntimeDelete] = useState(false);

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
  const touchSlotSelectionRef = useRef<TouchSlotSelectionState | null>(null);
  const touchSlotSelectionTimerRef = useRef<number | null>(null);
  const suppressSlotClickUntilRef = useRef(0);
  const touchBookingInteractionRef = useRef<TouchBookingInteractionState | null>(null);
  const touchBookingInteractionTimerRef = useRef<number | null>(null);

  // Dynamic slot height based on viewport and settings
  const [slotHeight, setSlotHeight] = useState<number>(MIN_CALENDAR_SLOT_HEIGHT);
  const lastStableSlotHeightRef = useRef<number>(MIN_CALENDAR_SLOT_HEIGHT);

  // Action menu and flight log states
  const [actionMenuBooking, setActionMenuBooking] = useState<Booking | null>(null);
  const [guestPromotionBooking, setGuestPromotionBooking] = useState<Booking | null>(null);
  const [cancellationBooking, setCancellationBooking] = useState<Booking | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [bookingMenuLoading, setBookingMenuLoading] = useState<{ bookingId: string; x: number; y: number } | null>(null);
  const bookingMenuOpenTokenRef = useRef(0);
  const [showFlightLogModal, setShowFlightLogModal] = useState(false);
  const [showGroundSessionLogModal, setShowGroundSessionLogModal] = useState(false);
  const [flightLogBooking, setFlightLogBooking] = useState<Booking | null>(null);
  const [flightLogMode, setFlightLogMode] = useState<'create' | 'edit'>('create');
  const [highlightUnlogged, setHighlightUnlogged] = useState(false);
  const isInteractingWithBooking = Boolean(draggedBooking || resizingBooking || pendingBookingDrag);

  const updateFloatingCalendarHeader = useCallback(() => {
    const grid = resourceCalendarGridRef.current;
    const originalHeader = resourceCalendarHeaderRef.current;
    if (!grid || !originalHeader) {
      setFloatingHeader(current => current.visible ? { ...current, visible: false } : current);
      return;
    }

    const gridBounds = grid.getBoundingClientRect();
    const headerBounds = originalHeader.getBoundingClientRect();
    const portalHeader = document.querySelector<HTMLElement>('.app-sticky-header');
    const stickyTop = Math.max(0, Math.round(portalHeader?.getBoundingClientRect().bottom || 0));
    const left = Math.max(0, Math.round(gridBounds.left));
    const right = Math.min(window.innerWidth, Math.round(gridBounds.right));
    const transition = getCalendarStickyHeaderTransition({
      viewportWidth: window.innerWidth,
      stickyTop,
      originalHeaderTop: headerBounds.top,
      originalHeaderHeight: headerBounds.height,
      calendarBottom: gridBounds.bottom,
      compactHeaderHeight: COMPACT_CALENDAR_HEADER_HEIGHT,
      shrinkDistance: CALENDAR_HEADER_SHRINK_DISTANCE,
      viewMode,
      isKioskMode,
    });
    const next: FloatingCalendarHeaderState = {
      visible: transition.visible,
      progress: transition.progress,
      height: transition.height,
      left,
      width: Math.max(0, right - left),
      top: stickyTop,
      scrollLeft: grid.scrollLeft,
      contentWidth: grid.scrollWidth,
      gridLeft: gridBounds.left,
    };

    setFloatingHeader(current => (
      current.visible === next.visible
      && Math.abs(current.progress - next.progress) < 0.001
      && Math.abs(current.height - next.height) < 0.1
      && current.left === next.left
      && current.width === next.width
      && current.top === next.top
      && current.scrollLeft === next.scrollLeft
      && current.contentWidth === next.contentWidth
      && Math.abs(current.gridLeft - next.gridLeft) < 0.5
        ? current
        : next
    ));
  }, [isKioskMode, viewMode]);

  useLayoutEffect(() => {
    const grid = resourceCalendarGridRef.current;
    if (!grid || isKioskMode || (viewMode !== 'day' && viewMode !== 'week')) {
      setFloatingHeader(current => current.visible ? { ...current, visible: false } : current);
      return undefined;
    }

    const scheduleUpdate = () => {
      if (floatingHeaderFrameRef.current !== null) return;
      floatingHeaderFrameRef.current = window.requestAnimationFrame(() => {
        floatingHeaderFrameRef.current = null;
        updateFloatingCalendarHeader();
      });
    };
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleUpdate)
      : null;

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    grid.addEventListener('scroll', scheduleUpdate, { passive: true });
    resizeObserver?.observe(grid);
    if (resourceCalendarHeaderRef.current) resizeObserver?.observe(resourceCalendarHeaderRef.current);
    scheduleUpdate();

    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      grid.removeEventListener('scroll', scheduleUpdate);
      resizeObserver?.disconnect();
      if (floatingHeaderFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingHeaderFrameRef.current);
        floatingHeaderFrameRef.current = null;
      }
    };
  }, [
    currentDate,
    hiddenIds,
    isKioskMode,
    orderedIds,
    resourceFilter,
    selectedAircraftId,
    selectedInstructorId,
    updateFloatingCalendarHeader,
    viewMode,
  ]);

  const parseHour = (time: string | undefined, fallback: number, roundUp = false) => {
    if (!time) return fallback;
    const [hour, minute] = time.split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
    return roundUp && minute > 0 ? hour + 1 : hour;
  };
  const calendarStartHour = parseHour(organisationSettings?.booking_day_start, 6);
  const calendarEndHour = Math.max(calendarStartHour + 1, parseHour(organisationSettings?.booking_day_end, 20, true));
  const availableCalendarHours = calendarEndHour - calendarStartHour;
  const daylightLocation = useMemo(
    () => activeLocations.find((item) => item.id === daylightLocationId) || primaryLocation || activeLocations[0] || null,
    [activeLocations, daylightLocationId, primaryLocation],
  );
  const daylightTimesByDate = useMemo(() => {
    const result = new Map<string, ReturnType<typeof getCalendarDaylightTimes>>();
    if (!showDaylightOverlay || !daylightLocation) return result;

    const weekStartsOn = calendarSettings?.week_starts_on === 'sunday' ? 0 : 1;
    const dates = viewMode === 'week'
      ? eachDayOfInterval({
          start: startOfWeek(currentDate, { weekStartsOn }),
          end: endOfWeek(currentDate, { weekStartsOn }),
        })
      : [currentDate];

    dates.forEach((date) => {
      result.set(
        format(date, 'yyyy-MM-dd'),
        getCalendarDaylightTimes(
          date,
          daylightLocation.latitude,
          daylightLocation.longitude,
          organisationSettings?.timezone || 'Australia/Melbourne',
        ),
      );
    });
    return result;
  }, [
    calendarSettings?.week_starts_on,
    currentDate,
    daylightLocation,
    organisationSettings?.timezone,
    showDaylightOverlay,
    viewMode,
  ]);

  useEffect(() => {
    setDaylightLocationId((current) => {
      if (activeLocations.some((item) => item.id === current)) return current;
      return primaryLocation?.id || activeLocations[0]?.id || '';
    });
  }, [activeLocations, primaryLocation]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CALENDAR_DAYLIGHT_OVERLAY_STORAGE_KEY, String(showDaylightOverlay));
    } catch {
      // This is a convenience preference; calendar shading still works for the current session.
    }
  }, [showDaylightOverlay]);

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
    const requestedView = searchParams.get('view');
    if (requestedView && ['day', 'week', 'month', 'list'].includes(requestedView)) return;
    if (calendarSettings?.default_view) {
      const defaultView = calendarSettings.default_view === 'list'
        ? 'list'
        : (calendarSettings.default_view as ViewMode);
      setViewMode(defaultView);
    }
  }, [calendarSettings?.default_view, searchParams]);

  useEffect(() => {
    const requestedView = searchParams.get('view');
    if (requestedView && ['day', 'week', 'month', 'list'].includes(requestedView)) {
      setViewMode(requestedView as ViewMode);
    }
  }, [searchParams]);

  useEffect(() => {
    if (viewMode !== 'week') return;
    if (hasAutoSelectedWeekResources.current) return;
    if (displayAircraft.length === 0 && displayInstructors.length === 0) return;
    if (!selectedAircraftId && displayAircraft.length > 0) {
      const preferredAircraft = displayAircraft.find(a => a.id === preferredAircraftId);
      setSelectedAircraftId(preferredAircraft?.id || displayAircraft[0].id);
    }
    if (!selectedInstructorId && displayInstructors.length > 0) {
      setSelectedInstructorId(displayInstructors[0].id);
    }
    hasAutoSelectedWeekResources.current = true;
  }, [displayAircraft, displayInstructors, preferredAircraftId, selectedAircraftId, selectedInstructorId, viewMode]);

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

    const aircraftIds = displayAircraft.map(a => a.id);
    const instructorIds = displayInstructors.map(i => i.id);
    const defaultOrder = calendarSettings.resource_display_order === 'instructors-first'
      ? [...instructorIds, ...aircraftIds]
      : [...aircraftIds, ...instructorIds];
    const currentResourceIds = new Set(defaultOrder);
    const resourceLayout = personalLayout || localLayout;
    const layoutHiddenIds = (resourceLayout?.hiddenIds ?? []).filter(id => currentResourceIds.has(id));
    const layoutOrderedIds = (resourceLayout?.orderedIds ?? []).filter(id => currentResourceIds.has(id));
    const filteredLayoutHiddenIds = isLimitedCalendarUser
      ? layoutHiddenIds.filter(id => !instructorIds.includes(id))
      : layoutHiddenIds;
    const hasPersonalLayout = filteredLayoutHiddenIds.length > 0 || layoutOrderedIds.length > 0;

    if (hasPersonalLayout) {
      const orderWithNewResources = [
        ...layoutOrderedIds,
        ...defaultOrder.filter(id => !layoutOrderedIds.includes(id)),
      ];
      setHiddenIds(new Set(filteredLayoutHiddenIds));
      setOrderedIds(orderWithNewResources);
      return;
    }

    const hiddenIdsFromSettings = (calendarSettings.hidden_resources ?? []).filter(id => currentResourceIds.has(id));
    setHiddenIds(new Set(
      isLimitedCalendarUser
        ? hiddenIdsFromSettings.filter(id => !instructorIds.includes(id))
        : hiddenIdsFromSettings
    ));
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
    displayAircraft.length,
    displayInstructors.length,
  ]);

  // When aircraft/instructors load, ensure orderedIds includes all current resources
  useEffect(() => {
    const aircraftIds = displayAircraft.map(a => a.id);
    const instructorIds = displayInstructors.map(i => i.id);
    const allIds = calendarSettings?.resource_display_order === 'instructors-first'
      ? [...instructorIds, ...aircraftIds]
      : [...aircraftIds, ...instructorIds];
    setOrderedIds(prev => {
      const existing = new Set(prev);
      const newIds = allIds.filter(id => !existing.has(id));
      return [...prev, ...newIds];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayAircraft.length, displayInstructors.length, calendarSettings?.resource_display_order]);

  useEffect(() => {
    if (initialCalendarLoading) return;

    const focus = resolveCalendarNotificationFocus(searchParams.get('bookingId'), bookings);
    if (!focus) return;

    const navigationKey = `${location.key}:${focus.bookingId}`;
    if (handledNotificationFocusRef.current === navigationKey) return;
    handledNotificationFocusRef.current = navigationKey;

    setViewMode('day');
    setCurrentDate(focus.date);
    setDatePickerMonth(focus.date);
    setResourceFilter('both');
    setHiddenIds((current) => {
      const next = new Set(current);
      focus.revealResourceIds.forEach((resourceId) => next.delete(resourceId));
      return next;
    });
    if (focus.showCancelled) setShowCancelledBookings(true);
    if (focus.showPending) setShowPendingBookings(true);
    if (focus.showWaitlisted) setShowWaitlistedBookings(true);

    if (notificationFocusAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(notificationFocusAnimationFrameRef.current);
    }
    if (notificationFocusScrollTimerRef.current !== null) {
      window.clearTimeout(notificationFocusScrollTimerRef.current);
    }
    if (notificationFocusClearTimerRef.current !== null) {
      window.clearTimeout(notificationFocusClearTimerRef.current);
    }

    setNotificationFocusBookingId(null);
    notificationFocusAnimationFrameRef.current = window.requestAnimationFrame(() => {
      setNotificationFocusBookingId(focus.bookingId);
      notificationFocusAnimationFrameRef.current = null;
    });
    notificationFocusScrollTimerRef.current = window.setTimeout(() => {
      const matchingCards = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-booking-id="${focus.bookingId}"]`)
      );
      const visibleCard = matchingCards.find((card) => card.getClientRects().length > 0);
      visibleCard?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      notificationFocusScrollTimerRef.current = null;
    }, 220);
    notificationFocusClearTimerRef.current = window.setTimeout(() => {
      setNotificationFocusBookingId((current) => current === focus.bookingId ? null : current);
      notificationFocusClearTimerRef.current = null;
    }, 6500);
  }, [bookings, initialCalendarLoading, location.key, searchParams]);

  useEffect(() => () => {
    if (notificationFocusAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(notificationFocusAnimationFrameRef.current);
    }
    if (notificationFocusScrollTimerRef.current !== null) {
      window.clearTimeout(notificationFocusScrollTimerRef.current);
    }
    if (notificationFocusClearTimerRef.current !== null) {
      window.clearTimeout(notificationFocusClearTimerRef.current);
    }
  }, []);


  // Compute slot height on mount and resize
  useLatestEffect(() => {
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
    } else if (viewMode === 'list') {
      const start = parseCalendarDateParam(listStartDate);
      const end = parseCalendarDateParam(listEndDate);
      if (!start || !end) return;
      const rangeLength = Math.max(1, differenceInCalendarDays(end, start) + 1);
      const offset = direction === 'next' ? rangeLength : -rangeLength;
      const nextStart = addDays(start, offset);
      const nextEnd = addDays(end, offset);
      setListStartDate(formatCalendarListDate(nextStart));
      setListEndDate(formatCalendarListDate(nextEnd));
      setCurrentDate(nextStart);
      setDatePickerMonth(nextStart);
    }
  };

  const goToToday = () => {
    const today = new Date();
    if (viewMode === 'list') {
      const range = getDefaultCalendarListRange(today);
      setListStartDate(range.startDate);
      setListEndDate(range.endDate);
    }
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
    if (booking.hirerName) return booking.hirerName;
    const hirerId = booking.studentId || booking.pilotId;
    return displayUsers.find((u) => u.id === hirerId)?.name || 'Unknown Hirer';
  };

  const getBookingHirerId = (booking: Booking) => booking.studentId || booking.pilotId || '';

  const renderHirerName = (booking: Booking, className?: string) => (
    <span className={className}>{getHirerName(booking)}</span>
  );

  const isOwnBooking = (booking: Booking) => Boolean(user?.id && getBookingHirerId(booking) === user.id);

  const canSeePrivateBookingDetails = (booking: Booking) =>
    !isLimitedCalendarUser || isOwnBooking(booking);

  const canUseBookingActions = (booking: Booking) =>
    isStaffCalendarUser || isOwnBooking(booking);

  const getInstructorName = (booking: Booking) => {
    if (booking.instructorName) return booking.instructorName;
    if (!booking.instructorId) return '';
    return displayUsers.find((u) => u.id === booking.instructorId)?.name || 'Unknown Instructor';
  };

  const getSupervisingInstructorName = (booking: Booking) => {
    if (!booking.supervisingInstructorId) return '';
    return displayUsers.find((u) => u.id === booking.supervisingInstructorId)?.name || booking.supervisingInstructorName || 'Senior instructor';
  };

  const getAircraftName = (booking: Booking) => {
    if (booking.bookingKind === 'ground') return 'Ground session';
    const bookedAircraft = aircraftForLookup.find((a) => a.id === booking.aircraftId);
    if (!bookedAircraft) return 'Unknown Aircraft';
    return `${bookedAircraft.registration} ${bookedAircraft.make || ''} ${bookedAircraft.model || ''}`.trim();
  };

  const isBookingFlightLogged = (booking: Booking) =>
    Boolean(booking.flight_logged || booking.flightLog || booking.ground_session_logged || booking.groundSessionLog);
  const canDragOrResizeBooking = (booking: Booking) => !isBookingFlightLogged(booking);

  const isCancelledBooking = (booking: Booking) =>
    booking.status === 'cancelled' || Boolean(booking.deletedAt);

  const passesCalendarFilters = (booking: Booking) => {
    if (isCancelledBooking(booking)) return showCancelledBookings;
    if (!showWaitlistedBookings && booking.hasConflict) return false;
    if (!showPendingBookings && (booking.status === 'pending_approval' || booking.status === 'pending_supervision')) return false;
    return true;
  };

  const pilotOptions = displayUsers
    .filter((candidate) =>
      candidate.role === 'student' ||
      candidate.role === 'pilot' ||
      candidate.roles?.some((role) => role === 'student' || role === 'pilot')
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const listDateRangeValid = isCalendarListDateRangeValid(listStartDate, listEndDate);
  const filteredListBookings = filterCalendarListBookings(
    bookings,
    {
      startDate: listStartDate,
      endDate: listEndDate,
      pilotId: listPilotFilter,
      instructorId: listInstructorFilter,
      resourceId: listResourceFilter,
      bookingType: listBookingTypeFilter,
      status: listStatusFilter,
      query: listSearchQuery,
      sort: listSort,
    },
    (booking) => [
      getHirerName(booking),
      getInstructorName(booking),
      getAircraftName(booking),
      booking.guestEmail,
      booking.guestPhone,
      booking.location,
      booking.notes,
      booking.status.replaceAll('_', ' '),
    ].filter(Boolean).join(' '),
  );

  const setCalendarListRange = (start: Date, end: Date) => {
    setListStartDate(formatCalendarListDate(start));
    setListEndDate(formatCalendarListDate(end));
    setCurrentDate(start);
    setDatePickerMonth(start);
  };

  const updateListStartDate = (value: string) => {
    setListStartDate(value);
    if (value && listEndDate && value > listEndDate) setListEndDate(value);
    const parsed = parseCalendarDateParam(value);
    if (parsed) {
      setCurrentDate(parsed);
      setDatePickerMonth(parsed);
    }
  };

  const updateListEndDate = (value: string) => {
    setListEndDate(value);
    if (value && listStartDate && value < listStartDate) setListStartDate(value);
  };

  const clearCalendarListFilters = () => {
    setListPilotFilter('');
    setListInstructorFilter('');
    setListResourceFilter('');
    setListBookingTypeFilter('all');
    setListStatusFilter('all');
    setListSearchQuery('');
    setListSort('ascending');
  };

  const showListBookingOnCalendar = (booking: Booking) => {
    const bookingDate = new Date(booking.startTime);
    setCurrentDate(bookingDate);
    setDatePickerMonth(bookingDate);
    setViewMode('day');
    setSearchParams((current) => {
      const next = buildCalendarViewSearchParams(current, 'day');
      next.set('date', format(bookingDate, 'yyyy-MM-dd'));
      next.set('bookingId', booking.id);
      return next;
    });
  };

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
  const getBookingGroundSessionLogId = (booking: Booking) => booking.groundSessionLog?.id || '';

  const openCreateFlightLog = async (booking: Booking) => {
    const existingLog = await findFlightLogForBooking(booking.id);
    if (existingLog.error) {
      toast.error('The CRM could not confirm whether this booking is already logged. Refresh the calendar and try again.');
      await Promise.resolve(onRefresh?.());
      return;
    }
    if (existingLog.data) {
      toast.error(FLIGHT_LOG_ALREADY_EXISTS_MESSAGE);
      await Promise.resolve(onRefresh?.());
      return;
    }

    setFlightLogBooking(booking);
    setFlightLogMode('create');
    setShowFlightLogModal(true);
  };

  const handleDeleteBookingFlightLog = async (booking: Booking) => {
    const flightLogId = getBookingFlightLogId(booking);
    if (!flightLogId) {
      toast.error('Flight log could not be found');
      return;
    }

    const impact = await getFlightLogDeleteImpact(flightLogId);
    let xeroMode: 'auto' | 'void-delete' | 'credit-note' | 'crm-only' = 'crm-only';
    let confirmMessage = 'Delete this flight log? The booking will be marked as unlogged.';

    if (impact.requiresXeroAction) {
      xeroMode = impact.recommendedAction;
      confirmMessage = impact.recommendedAction === 'credit-note'
        ? `${impact.summary}\n\n${impact.detail}\n\nA reversing credit note will be created in Xero before the CRM record is removed.${impact.hasStripePayments ? '\n\nAdmin note: This reverses the accounting in Xero but does not refund the card automatically.' : ''}\n\nContinue?`
        : `${impact.summary}\n\n${impact.detail}\n\nThe Xero invoice will be voided or deleted before the CRM record is removed.\n\nContinue?`;
    }

    if (!window.confirm(confirmMessage)) {
      return;
    }

    const { error } = await deleteFlightLog(flightLogId, { xeroMode });
    if (error) {
      toast.error(error);
      return;
    }

    toast.success(impact.requiresXeroAction ? 'Flight log reversed in Xero and removed from the CRM' : 'Flight log deleted');
  };

  const handleDeleteBookingGroundSessionLog = async (booking: Booking) => {
    const groundSessionLogId = getBookingGroundSessionLogId(booking);
    if (!groundSessionLogId) {
      toast.error('Ground session log could not be found');
      return;
    }

    if (!window.confirm('Delete this ground session log? The booking will be marked as unlogged.')) {
      return;
    }

    const { error } = await deleteGroundSessionLog(groundSessionLogId);
    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Ground session log deleted');
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
      return CALENDAR_BOOKING_COLOUR_CLASSES.attention;
    }

    if (booking.status === 'pending_approval') {
      return CALENDAR_BOOKING_COLOUR_CLASSES.pendingApproval;
    }

    if (booking.status === 'pending_supervision') {
      return CALENDAR_BOOKING_COLOUR_CLASSES.pendingSupervision;
    }

    if (booking.status === 'cancelled') {
      return CALENDAR_BOOKING_COLOUR_CLASSES.cancelled;
    }

    if (booking.flight_logged) {
      return CALENDAR_BOOKING_COLOUR_CLASSES.logged;
    }

    if (isPastBooking(booking)) {
      return CALENDAR_BOOKING_COLOUR_CLASSES.attention;
    }

    return CALENDAR_BOOKING_COLOUR_CLASSES.confirmed;
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

  const getNotificationFocusClasses = (booking: Booking) =>
    booking.id === notificationFocusBookingId
      ? 'calendar-booking-notification-focus'
      : '';

  const renderBookingContent = (
    booking: Booking,
    resourceType: 'aircraft' | 'instructor',
    density: BookingCardDensity
  ) => {
    const estimatedHeight = getBookingCardEstimatedHeight(booking);
    const showSecondaryResource = estimatedHeight >= 64;
    const showNotes = estimatedHeight >= 88;
    const notes = showNotes && canSeePrivateBookingDetails(booking)
      ? truncateNotes(booking.notes, estimatedHeight >= 120 ? 84 : 48)
      : '';
    const supervisingName = getSupervisingInstructorName(booking);

    if (density === 'name-only') {
      return (
        <div className="relative z-10 flex h-full min-h-0 items-center">
          <div className="text-[11px] font-bold leading-none truncate">
            {renderHirerName(booking)}
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
            {renderHirerName(booking)}
          </div>
          {showSecondaryResource && instructorName && (
            <div className="text-[11px] leading-tight opacity-90 truncate">
              {instructorName}
            </div>
          )}
          {supervisingName && (
            <div className="truncate text-[9px] leading-tight opacity-75">Supervised by {supervisingName}</div>
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
          {renderHirerName(booking)}
        </div>
        {showSecondaryResource && (
          <div className="text-[11px] leading-tight opacity-90 truncate">
            {getAircraftName(booking)}
          </div>
        )}
        {supervisingName && (
          <div className="truncate text-[9px] leading-tight opacity-75">Supervised by {supervisingName}</div>
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
    const notes = canSeePrivateBookingDetails(booking) ? truncateNotes(booking.notes, 110) : '';
    const isLogged = isBookingFlightLogged(booking);
    const supervisingName = getSupervisingInstructorName(booking);
    const statusLabel = booking.hasConflict
      ? 'Waitlist'
      : isLogged
        ? 'Logged'
        : isPastBooking(booking)
          ? 'Unlogged'
          : booking.status === 'pending_approval'
            ? 'Pending'
            : booking.status === 'pending_supervision'
              ? 'Pending supervision'
            : booking.status === 'cancelled'
              ? 'Cancelled'
              : 'Confirmed';

    return (
      <div
        key={booking.id}
        data-booking-id={booking.id}
        aria-current={booking.id === notificationFocusBookingId ? 'true' : undefined}
        role={canUseBookingActions(booking) ? 'button' : undefined}
        tabIndex={canUseBookingActions(booking) ? 0 : undefined}
        onClick={(event) => {
          if (!canUseBookingActions(booking)) return;
          openBookingActionMenu(booking, { x: event.clientX, y: event.clientY });
        }}
        onKeyDown={event => {
          if (!canUseBookingActions(booking) || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          openBookingActionMenu(booking, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
        }}
        className={`${getBookingColorClasses(booking)} ${getBookingAttentionClasses(booking)} ${getNotificationFocusClasses(booking)} calendar-booking-card block w-full rounded-xl border-2 p-3 text-left shadow-sm transition-transform active:scale-[0.99]`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide opacity-80">
              {formatBookingTimeRange(booking)}
            </div>
            <div className="mt-1 truncate text-base font-extrabold leading-tight">
              {renderHirerName(booking)}
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
          {booking.bookingKind === 'ground' && (
            <span className="rounded-full bg-white/55 px-2 py-1">
              Ground session
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
        {supervisingName && <p className="mt-2 text-[11px] font-medium opacity-75">Supervised by {supervisingName}</p>}
      </div>
    );
  };

  const getDaylightTimesForDate = (date: Date) =>
    daylightTimesByDate.get(format(date, 'yyyy-MM-dd')) || null;

  const renderMobileDaylightSummary = (day: Date) => {
    const daylight = getDaylightTimesForDate(day);
    if (!showDaylightOverlay || !daylight || !daylightLocation) return null;

    const calendarStartMinutes = calendarStartHour * 60;
    const calendarEndMinutes = calendarEndHour * 60;
    const calendarMinutes = Math.max(1, calendarEndMinutes - calendarStartMinutes);
    const visibleSunrise = Math.max(calendarStartMinutes, Math.min(calendarEndMinutes, daylight.sunriseMinutes));
    const visibleSunset = Math.max(calendarStartMinutes, Math.min(calendarEndMinutes, daylight.sunsetMinutes));
    const beforeWidth = ((visibleSunrise - calendarStartMinutes) / calendarMinutes) * 100;
    const daylightWidth = (Math.max(0, visibleSunset - visibleSunrise) / calendarMinutes) * 100;
    const afterWidth = Math.max(0, 100 - beforeWidth - daylightWidth);

    return (
      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/60">
        <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Sun className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span className="truncate">Daylight at {daylightLocation.name}</span>
          </span>
          <span className="shrink-0 tabular-nums">
            {formatCalendarMinute(daylight.sunriseMinutes)}–{formatCalendarMinute(daylight.sunsetMinutes)}
          </span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full ring-1 ring-slate-300 dark:ring-slate-600" aria-hidden="true">
          <span className="calendar-daylight-summary-night" style={{ width: `${beforeWidth}%` }} />
          <span className="bg-amber-100 dark:bg-amber-300/70" style={{ width: `${daylightWidth}%` }} />
          <span className="calendar-daylight-summary-night" style={{ width: `${afterWidth}%` }} />
        </div>
      </div>
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

            {renderMobileDaylightSummary(day)}

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

  const handleShowAllResources = useCallback(() => {
    setHiddenIds(new Set());
    persistResourceLayout(new Set(), orderedIds);
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
          subtitle: [a.make, a.model].filter(Boolean).join(' '),
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
          subtitle: 'Instructor',
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

    if (!hideAllDayUnavailableResources) return ordered;
    const dates = viewMode === 'week' ? getWeekDays() : [currentDate];
    return ordered.filter(resource => !dates.every(date => isResourceUnavailableAllDay(resource, date)));
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

  const isTimeSlotOutsideDaylight = (slot: number, date: Date) => {
    if (!showDaylightOverlay) return false;
    const { hour, minute } = getTimeFromSlot(slot);
    return isCalendarSlotOutsideDaylight(
      hour * 60 + minute,
      calendarSettings?.snap_duration || 15,
      getDaylightTimesForDate(date),
    );
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

  const isCalendarAdmin = Boolean(
    user?.role === 'admin' ||
    user?.roles?.some(role => role === 'admin')
  );
  const canManageInstructorDowntime = (instructorId: string) =>
    canManageCalendarDowntime(instructorId, user?.id, isCalendarAdmin);
  const canApproveCalendarBooking = (booking: Booking) => {
    const isAssignedInstructor =
      Boolean(user?.id && booking.instructorId && user.id === booking.instructorId);

    return booking.status === 'pending_approval' && (isCalendarAdmin || isAssignedInstructor);
  };

  const openBookingFormForSelection = (
    date: Date,
    startTime: string,
    endTime: string,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor'
  ) => {
    try {
      onNewBookingWithTime?.(date, startTime, endTime, resourceId, resourceType);
      return true;
    } catch (error) {
      console.error('Failed to open booking form from calendar selection:', error);
      toast.error('Could not open the booking form. Please try again.');
      return false;
    }
  };

  const handleNewTimeAllocation = (
    date: Date,
    startTime: string,
    endTime: string,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor'
  ) => {
    try {
      if (resourceType === 'instructor' && canManageInstructorDowntime(resourceId)) {
        setDowntimeChoice({ date, startTime, endTime, instructorId: resourceId });
        setDowntimeReason('Temporary off period');
        return true;
      }

      return openBookingFormForSelection(date, startTime, endTime, resourceId, resourceType);
    } catch (error) {
      console.error('Failed to allocate new booking time from calendar:', error);
      toast.error('Could not start a new booking from the calendar. Please try again.');
      return false;
    }
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

  const openInstructorDowntimeEditor = (period: UnavailabilityPeriod) => {
    if (
      period.source !== 'absence'
      || !period.id
      || !canManageInstructorDowntime(period.resourceId)
    ) return;

    const absence = displayAbsences.find((item) => item.id === period.id);
    if (!absence) {
      toast.error('This temporary off period changed. Refresh the calendar and try again.');
      return;
    }

    setDowntimeEditor({ ...absence });
    setConfirmingDowntimeDelete(false);
  };

  const handleUpdateInstructorDowntime = async () => {
    if (!downtimeEditor || downtimeEditorBusy) return;
    const validationError = getTemporaryDowntimeValidationError(downtimeEditor);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setDowntimeEditorBusy('save');
    try {
      await updateAbsence(downtimeEditor.id, {
        startDate: downtimeEditor.startDate,
        endDate: downtimeEditor.endDate,
        startTime: downtimeEditor.startTime || '',
        endTime: downtimeEditor.endTime || '',
        reason: downtimeEditor.reason?.trim() || 'Temporary off period',
      });
      setDowntimeEditor(null);
      setConfirmingDowntimeDelete(false);
    } catch {
      // The availability hook displays the actionable database or permission error.
    } finally {
      setDowntimeEditorBusy(null);
    }
  };

  const handleDeleteInstructorDowntime = async () => {
    if (!downtimeEditor || downtimeEditorBusy) return;
    setDowntimeEditorBusy('delete');
    try {
      await deleteAbsence(downtimeEditor.id);
      setDowntimeEditor(null);
      setConfirmingDowntimeDelete(false);
    } catch {
      // The availability hook displays the actionable database or permission error.
    } finally {
      setDowntimeEditorBusy(null);
    }
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
            pattern: 'diagonal',
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

  const isResourceUnavailableAllDay = (resource: Resource, date: Date) => {
    if (resource.type === 'aircraft') {
      const selectedAircraft = aircraftForLookup.find(item => item.id === resource.id);
      if (!selectedAircraft) return false;
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarEndHour, 0);
      if (selectedAircraft.autoGroundedUntil) return selectedAircraft.autoGroundedUntil >= dayEnd;
      return selectedAircraft.status !== 'serviceable';
    }

    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarStartHour, 0);
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), calendarEndHour, 0);
    const periods = getUnavailabilityPeriods(date)
      .filter(period => period.resourceType === 'instructor' && period.resourceId === resource.id)
      .map(period => ({
        start: period.startTime < dayStart ? dayStart : period.startTime,
        end: period.endTime > dayEnd ? dayEnd : period.endTime,
      }))
      .filter(period => period.end > dayStart && period.start < dayEnd)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    let coveredUntil = dayStart.getTime();
    for (const period of periods) {
      if (period.start.getTime() > coveredUntil) return false;
      coveredUntil = Math.max(coveredUntil, period.end.getTime());
      if (coveredUntil >= dayEnd.getTime()) return true;
    }
    return false;
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

  const getUnavailabilityBlockProps = (
    period: UnavailabilityPeriod,
  ): React.HTMLAttributes<HTMLDivElement> => {
    const canEditDowntime =
      period.source === 'absence'
      && Boolean(period.id)
      && canManageInstructorDowntime(period.resourceId);

    if (!canEditDowntime) {
      return {
        className: 'pointer-events-none relative z-[1] overflow-hidden border-r border-gray-200',
      };
    }

    const edit = (event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
      event.stopPropagation();
      openInstructorDowntimeEditor(period);
    };

    return {
      className: 'relative z-[3] cursor-pointer overflow-hidden border-r border-orange-300 outline-none transition-shadow hover:ring-2 hover:ring-inset hover:ring-orange-400 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500',
      role: 'button',
      tabIndex: 0,
      title: `Edit temporary off period: ${period.reason}`,
      'aria-label': `Edit temporary off period: ${period.reason}`,
      onClick: edit,
      onKeyDown: (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        edit(event);
      },
    };
  };

  const renderUnavailabilityLabel = (unavailability: UnavailabilityPeriod) => {
    const canEditDowntime =
      canManageInstructorDowntime(unavailability.resourceId) &&
      unavailability.source === 'absence' &&
      Boolean(unavailability.id);

    if (unavailability.source === 'schedule') {
      return null;
    }

    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-1">
        <span className="inline-flex max-w-full items-center gap-1 rounded border border-orange-200 bg-white bg-opacity-90 px-1.5 py-0.5 text-xs font-medium text-gray-700 shadow-sm">
          <span className="truncate">{unavailability.reason}</span>
          {canEditDowntime && (
            <span className="rounded bg-orange-100 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700">
              Edit
            </span>
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

  const clearTouchSlotSelectionIntent = useCallback(() => {
    if (touchSlotSelectionTimerRef.current) {
      window.clearTimeout(touchSlotSelectionTimerRef.current);
      touchSlotSelectionTimerRef.current = null;
    }
    touchSlotSelectionRef.current = null;
  }, []);

  const clearTouchBookingInteractionIntent = useCallback(() => {
    if (touchBookingInteractionTimerRef.current) {
      window.clearTimeout(touchBookingInteractionTimerRef.current);
      touchBookingInteractionTimerRef.current = null;
    }
    touchBookingInteractionRef.current = null;
  }, []);

  useEffect(() => () => {
    clearTouchSlotSelectionIntent();
    clearTouchBookingInteractionIntent();
  }, [clearTouchBookingInteractionIntent, clearTouchSlotSelectionIntent]);

  const findCalendarSlotFromPoint = useCallback((clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const slotElement = element?.closest('[data-calendar-slot="true"]') as HTMLElement | null;
    if (!slotElement) return null;

    const slot = Number(slotElement.dataset.slot);
    const resourceId = slotElement.dataset.resourceId;
    const resourceType = slotElement.dataset.resourceType as 'aircraft' | 'instructor' | undefined;
    const dateValue = slotElement.dataset.date;
    const dayIndexValue = slotElement.dataset.dayIndex;
    const dayIndex = dayIndexValue == null ? undefined : Number(dayIndexValue);

    if (
      !Number.isFinite(slot) ||
      !resourceId ||
      (resourceType !== 'aircraft' && resourceType !== 'instructor') ||
      !dateValue
    ) {
      return null;
    }

    return {
      slot,
      resourceId,
      resourceType,
      date: new Date(dateValue),
      dayIndex: Number.isFinite(dayIndex) ? dayIndex : undefined,
    };
  }, []);

  const resetBookingInteractionState = useCallback(() => {
    setDraggedBooking(null);
    setDraggedBookingOriginal(null);
    setDragPreview(null);
    setResizingBooking(null);
    setPendingBookingDrag(null);
    setHasBookingInteractionMoved(false);
    setTimeout(() => setWasResizing(false), 100);
    clearTouchBookingInteractionIntent();
  }, [clearTouchBookingInteractionIntent]);

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
      resourceId: resourceType === 'aircraft' ? booking.aircraftId || '' : booking.instructorId || '',
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
      resourceId: resourceType === 'aircraft' ? booking.aircraftId || '' : booking.instructorId || '',
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
            resourceId: resourceType === 'aircraft' ? resizingBooking.booking.aircraftId || '' : resizingBooking.booking.instructorId || '',
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
            resourceId: resourceType === 'aircraft' ? resizingBooking.booking.aircraftId || '' : resizingBooking.booking.instructorId || '',
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

    void Promise.resolve(onUpdateBooking(booking.id, updates, true))
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

  useLatestEffect(() => {
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

  useLatestEffect(() => {
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

  useLatestEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;

      const pendingSelection = touchSlotSelectionRef.current;
      if (pendingSelection && pendingSelection.pointerId === event.pointerId) {
        const movedDistance = Math.hypot(
          event.clientX - pendingSelection.startX,
          event.clientY - pendingSelection.startY
        );
        if (movedDistance >= TOUCH_TAP_MOVE_THRESHOLD_PX) {
          pendingSelection.moved = true;
        }

        if (!pendingSelection.activated) {
          if (movedDistance >= TOUCH_CANCEL_MOVE_THRESHOLD_PX) {
            clearTouchSlotSelectionIntent();
            suppressSlotClickUntilRef.current = Date.now() + 500;
          } else {
            event.preventDefault();
          }
          return;
        }

        const slotTarget = findCalendarSlotFromPoint(event.clientX, event.clientY);
        if (
          slotTarget &&
          slotTarget.resourceId === pendingSelection.resourceId &&
          slotTarget.resourceType === pendingSelection.resourceType &&
          slotTarget.dayIndex === pendingSelection.dayIndex
        ) {
          setDragEnd({
            hour: slotTarget.slot,
            resourceId: slotTarget.resourceId,
            resourceType: slotTarget.resourceType,
            dayIndex: slotTarget.dayIndex,
          });
          event.preventDefault();
        }
      }

      const pendingBooking = touchBookingInteractionRef.current;
      if (pendingBooking && pendingBooking.pointerId === event.pointerId) {
        const movedDistance = Math.hypot(
          event.clientX - pendingBooking.startX,
          event.clientY - pendingBooking.startY
        );

        if (!pendingBooking.activated) {
          if (movedDistance >= TOUCH_CANCEL_MOVE_THRESHOLD_PX) {
            clearTouchBookingInteractionIntent();
          }
          return;
        }

        const slotTarget = findCalendarSlotFromPoint(event.clientX, event.clientY);
        if (slotTarget) {
          updateBookingPreviewForSlot(
            slotTarget.slot,
            slotTarget.resourceId,
            slotTarget.resourceType,
            slotTarget.date
          );
          event.preventDefault();
        }
      }
    };

    const handleWindowPointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;

      const pendingSelection = touchSlotSelectionRef.current;
      if (pendingSelection && pendingSelection.pointerId === event.pointerId) {
        const activated = pendingSelection.activated;
        const originalSelection = { ...pendingSelection };
        const elapsedMs = Date.now() - originalSelection.startedAt;
        const isQuickStationaryTap = !originalSelection.moved && elapsedMs <= TOUCH_TAP_MAX_MS;
        suppressSlotClickUntilRef.current = Date.now() + 500;
        clearTouchSlotSelectionIntent();

        if (activated) {
          handleMouseUp(originalSelection.date);
        } else if (isQuickStationaryTap) {
          handleTimeSlotClick(
            originalSelection.slot,
            originalSelection.resourceId,
            originalSelection.resourceType,
            originalSelection.date
          );
        }
        return;
      }

      const pendingBooking = touchBookingInteractionRef.current;
      if (pendingBooking && pendingBooking.pointerId === event.pointerId) {
        const activated = pendingBooking.activated;
        const booking = pendingBooking.booking;
        const pressX = pendingBooking.pressX;
        const pressY = pendingBooking.pressY;
        const canOpenMenu = canUseBookingActions(booking);
        clearTouchBookingInteractionIntent();

        if (activated) {
          if (hasBookingInteractionMoved) {
            handleBookingDrop();
          } else {
            resetBookingInteractionState();
          }
          return;
        }

        if (canOpenMenu) {
          openBookingActionMenu(booking, { x: pressX, y: pressY });
        }
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', handleWindowPointerEnd);
    window.addEventListener('pointercancel', handleWindowPointerEnd);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerEnd);
      window.removeEventListener('pointercancel', handleWindowPointerEnd);
    };
  }, [
    canUseBookingActions,
    clearTouchBookingInteractionIntent,
    clearTouchSlotSelectionIntent,
    findCalendarSlotFromPoint,
    handleBookingDrop,
    hasBookingInteractionMoved,
    resetBookingInteractionState,
    updateBookingPreviewForSlot,
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
    try {
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
    } catch (error) {
      console.error('Calendar drag-create failed on mouse up:', error);
      toast.error('Could not create a booking from that drag selection. Please try again.');
    } finally {
      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
    }
  };

  const handleTouchSlotPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    slot: number,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    date: Date,
    dayIndex?: number
  ) => {
    if (event.pointerType !== 'touch') return;
    if (actionMenuBooking) {
      setActionMenuBooking(null);
      return;
    }
    if (draggedBooking || resizingBooking) return;
    if (isResourceUnavailable(resourceId, resourceType, slot, date)) return;

    suppressSlotClickUntilRef.current = Date.now() + 500;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    clearTouchSlotSelectionIntent();
    touchSlotSelectionRef.current = {
      pointerId: event.pointerId,
      slot,
      resourceId,
      resourceType,
      date,
      dayIndex,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: Date.now(),
      moved: false,
      activated: false,
    };

    touchSlotSelectionTimerRef.current = window.setTimeout(() => {
      const current = touchSlotSelectionRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.activated = true;
      setIsDragging(true);
      setDragStart({
        hour: current.slot,
        resourceId: current.resourceId,
        resourceType: current.resourceType,
        dayIndex: current.dayIndex,
      });
      setDragEnd({
        hour: current.slot,
        resourceId: current.resourceId,
        resourceType: current.resourceType,
        dayIndex: current.dayIndex,
      });
      navigator.vibrate?.(10);
    }, TOUCH_HOLD_TO_DRAG_MS);
  };

  const handleTouchBookingPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    booking: Booking,
    resourceType: 'aircraft' | 'instructor',
    mode: 'move' | 'resize-top' | 'resize-bottom' = 'move'
  ) => {
    if (event.pointerType !== 'touch') return;
    if (!canUseBookingActions(booking)) return;
    if (mode === 'move' && !canDragOrResizeBooking(booking)) return;
    if ((mode === 'resize-top' || mode === 'resize-bottom') && !canDragOrResizeBooking(booking)) return;

    event.stopPropagation();
    clearTouchBookingInteractionIntent();

    touchBookingInteractionRef.current = {
      pointerId: event.pointerId,
      booking,
      resourceType,
      startX: event.clientX,
      startY: event.clientY,
      pressX: event.clientX,
      pressY: event.clientY,
      activated: mode !== 'move',
      mode,
    };

    if (mode === 'move') {
      touchBookingInteractionTimerRef.current = window.setTimeout(() => {
        const current = touchBookingInteractionRef.current;
        if (!current || current.pointerId !== event.pointerId) return;
        current.activated = true;
        handleBookingDragStart(booking, resourceType);
        navigator.vibrate?.(10);
      }, TOUCH_HOLD_TO_DRAG_MS);
      return;
    }

    setWasResizing(true);
    setResizingBooking({ booking, handle: mode === 'resize-top' ? 'top' : 'bottom' });
    setDraggedBookingOriginal(booking);
    setHasBookingInteractionMoved(false);
    updateDragPreview({
      startTime: new Date(booking.startTime),
      endTime: new Date(booking.endTime),
      resourceId: resourceType === 'aircraft' ? booking.aircraftId || '' : booking.instructorId || '',
      resourceType,
    });
    navigator.vibrate?.(10);
  };

  const getTimeSlotDragRangeMeta = (
    slot: number,
    resourceId: string,
    resourceType: 'aircraft' | 'instructor',
    dayIndex?: number
  ) => {
    if (
      !isDragging ||
      !dragStart ||
      !dragEnd ||
      resourceId !== dragStart.resourceId ||
      resourceType !== dragStart.resourceType ||
      dayIndex !== dragStart.dayIndex
    ) {
      return {
        active: false,
        isStart: false,
        isEnd: false,
      };
    }

    const startSlot = Math.min(dragStart.hour, dragEnd.hour);
    const endSlot = Math.max(dragStart.hour, dragEnd.hour);

    return {
      active: slot >= startSlot && slot <= endSlot,
      isStart: slot === startSlot,
      isEnd: slot === endSlot,
    };
  };

  const getTimeSlotSelectionPreviewStyle = ({
    active,
    isStart,
    isEnd,
  }: {
    active: boolean;
    isStart: boolean;
    isEnd: boolean;
  }) => {
    if (!active) return undefined;

    return {
      backgroundColor: 'rgba(96, 165, 250, 0.2)',
      boxSizing: 'border-box' as const,
      borderLeft: '2px solid rgba(37, 99, 235, 0.92)',
      borderRight: '2px solid rgba(37, 99, 235, 0.92)',
      ...(isStart ? {
        borderTop: '2px solid rgba(37, 99, 235, 0.92)',
        borderTopLeftRadius: '0.5rem',
        borderTopRightRadius: '0.5rem',
      } : {}),
      ...(isEnd ? {
        borderBottom: '2px solid rgba(37, 99, 235, 0.92)',
        borderBottomLeftRadius: '0.5rem',
        borderBottomRightRadius: '0.5rem',
      } : {}),
    };
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

  const handleViewModeChange = (mode: ViewMode) => {
    setNotificationFocusBookingId(null);
    setViewMode(mode);
    setSearchParams((current) => buildCalendarViewSearchParams(current, mode));
  };

  const renderViewModeButtons = () => (
    <div className={`grid w-full min-w-0 grid-cols-4 rounded-xl bg-gray-100 p-1 dark:bg-[#11141a] ${isKioskMode ? '' : 'sm:w-auto sm:min-w-[17rem] sm:flex'}`}>
        {(['day', 'week', 'month', 'list'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => handleViewModeChange(mode)}
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
        <SearchableSelect
          value={selectedAircraftId}
          onChange={(e) => setSelectedAircraftId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:py-1"
        >
          <option value="">Select Aircraft</option>
          {displayAircraft.map((a) => (
            <option key={a.id} value={a.id}>
              {a.registration} - {a.make} {a.model}
            </option>
          ))}
        </SearchableSelect>
      </div>

      <div className="min-w-0">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Instructor
        </label>
        <SearchableSelect
          value={selectedInstructorId}
          onChange={(e) => setSelectedInstructorId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:py-1"
        >
          <option value="">Select Instructor</option>
          {displayInstructors.map((instructor) => (
            <option key={instructor.id} value={instructor.id}>
              {instructor.name}
            </option>
          ))}
        </SearchableSelect>
      </div>
    </div>
  );

  const renderDaylightControls = () => {
    if (viewMode !== 'day' && viewMode !== 'week') return null;
    const currentDaylight = viewMode === 'day' ? getDaylightTimesForDate(currentDate) : null;
    const inputSize = isKioskMode ? 'h-3.5 w-3.5' : 'h-4 w-4';
    const controlPadding = isKioskMode ? 'px-2.5 py-1.5 text-xs' : 'px-2.5 py-2 text-sm';

    return (
      <div className={`flex min-w-0 flex-wrap items-center gap-1.5 ${showDaylightOverlay && activeLocations.length > 1 ? 'w-full sm:w-auto' : ''}`}>
        <label
          className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33] ${controlPadding} ${!daylightLocation ? 'cursor-not-allowed opacity-55' : ''}`}
          title={daylightLocation
            ? `Grey out time before sunrise and after sunset at ${daylightLocation.name}`
            : 'Add an active organisation location with coordinates to calculate daylight'}
        >
          <input
            type="checkbox"
            checked={showDaylightOverlay}
            onChange={(event) => setShowDaylightOverlay(event.target.checked)}
            disabled={!daylightLocation}
            className={`${inputSize} rounded border-gray-300 text-blue-600 focus:ring-blue-500`}
          />
          <Sun className={`${isKioskMode ? 'h-3.5 w-3.5' : 'h-4 w-4'} text-amber-500`} />
          <span>Shade non-daylight</span>
          {showDaylightOverlay && currentDaylight && (
            <span className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-600 dark:bg-slate-700 dark:text-slate-200 xl:inline">
              {formatCalendarMinute(currentDaylight.sunriseMinutes)}–{formatCalendarMinute(currentDaylight.sunsetMinutes)}
            </span>
          )}
        </label>

        {showDaylightOverlay && activeLocations.length > 1 && (
          <SearchableSelect
            value={daylightLocation?.id || ''}
            onChange={(event) => setDaylightLocationId(event.target.value)}
            aria-label="Daylight calculation location"
            title="Location used to calculate sunrise and sunset"
            className={`min-w-0 rounded-lg border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 ${isKioskMode ? 'w-40 px-2.5 py-1.5 text-xs' : 'w-full px-2.5 py-2 text-sm sm:w-44'}`}
          >
            {activeLocations.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </SearchableSelect>
        )}
      </div>
    );
  };

  const getManagedResources = (): ManagedResource[] => {
    const result: ManagedResource[] = [];

    if (resourceFilter === 'aircraft' || resourceFilter === 'both') {
      displayAircraft.forEach(a => result.push({ id: a.id, name: a.registration, type: 'aircraft', status: a.status }));
    }
    if (resourceFilter === 'instructors' || resourceFilter === 'both') {
      displayInstructors.forEach(i => result.push({ id: i.id, name: i.name || i.email, type: 'instructor' }));
    }

    return result;
  };

  const renderFilterControls = () => (
    <div className="flex w-full flex-wrap items-center gap-2">
      <div className={`w-full shrink-0 ${isKioskMode ? 'sm:w-44' : 'sm:w-48 xl:w-52'}`}>
        <SearchableSelect
          value={resourceFilter}
          onChange={(e) =>
            setResourceFilter(e.target.value as any)
          }
          aria-label="Calendar resource type"
          className={`w-full rounded-lg border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 ${isKioskMode ? 'px-2.5 py-1.5 text-xs' : 'px-2.5 py-2 text-sm'}`}
        >
          <option value="both">Aircraft & Instructors</option>
          <option value="aircraft">Aircraft Only</option>
          <option value="instructors">Instructors Only</option>
        </SearchableSelect>
      </div>

      <ResourceManagerPanel
        resources={getManagedResources()}
        hiddenIds={hiddenIds}
        orderedIds={orderedIds}
        onHide={handleHideResource}
        onShow={handleShowResource}
        onShowAll={handleShowAllResources}
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

      <label className={`inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33] ${isKioskMode ? 'px-2.5 py-1.5 text-xs' : 'px-2.5 py-2 text-sm'}`} title="Hide aircraft or instructors that are unavailable for the entire displayed day">
        <input
          type="checkbox"
          checked={hideAllDayUnavailableResources}
          onChange={(event) => setHideAllDayUnavailableResources(event.target.checked)}
          className={`${isKioskMode ? 'h-3.5 w-3.5' : 'h-4 w-4'} rounded border-gray-300 text-blue-600 focus:ring-blue-500`}
        />
        <span>Hide all-day unavailable</span>
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

  const renderFloatingResourceHeader = () => {
    if (!floatingHeader.visible || floatingHeader.width <= 0 || floatingHeader.contentWidth <= 0) return null;

    const contentOffset = floatingHeader.gridLeft - floatingHeader.left - floatingHeader.scrollLeft;
    const transitionProgress = floatingHeader.progress;
    const shellStyle: React.CSSProperties = {
      left: floatingHeader.left,
      top: floatingHeader.top,
      width: floatingHeader.width,
      height: floatingHeader.height,
      boxShadow: `0 8px 18px rgba(15, 23, 42, ${0.04 + transitionProgress * 0.12})`,
      transition: 'height 90ms ease-out, box-shadow 160ms ease-out',
      willChange: 'height',
    };
    const contentStyle: React.CSSProperties = {
      width: floatingHeader.contentWidth,
      transform: `translate3d(${contentOffset}px, 0, 0)`,
    };

    if (viewMode === 'day') {
      const resources = getAllResources();
      const minWidth = 64 + resources.length * 120;
      return (
        <div
          data-calendar-floating-resource-header="day"
          data-calendar-floating-resource-header-progress={transitionProgress.toFixed(3)}
          className="pointer-events-none fixed z-[35] hidden overflow-hidden border-x border-b border-gray-300 bg-white md:block dark:border-[#363b45] dark:bg-[#171a21]"
          style={shellStyle}
          aria-hidden="true"
        >
          <div style={contentStyle}>
            <div
              className="grid"
              style={{
                gridTemplateColumns: `64px repeat(${resources.length}, minmax(120px, 1fr))`,
                minWidth,
                height: floatingHeader.height,
                transition: 'height 90ms ease-out',
              }}
            >
              <div
                className="relative flex min-w-0 items-center justify-center overflow-hidden border-r border-gray-200 bg-gray-50 text-center dark:border-[#363b45] dark:bg-[#20242c]"
                style={{ padding: `${8 - transitionProgress * 4}px` }}
              >
                <span
                  className="absolute left-1/2 top-1/2 whitespace-nowrap text-xs font-medium text-gray-500 dark:text-gray-400"
                  style={{
                    opacity: Math.max(0, 1 - transitionProgress * 2),
                    transform: 'translate(-50%, -50%) rotate(-90deg)',
                  }}
                >
                  Local time
                </span>
                <span
                  className="absolute left-1/2 top-1/2 whitespace-nowrap text-[11px] font-medium text-gray-500 dark:text-gray-400"
                  style={{
                    opacity: Math.max(0, (transitionProgress - 0.25) / 0.75),
                    transform: 'translate(-50%, -50%) rotate(-90deg)',
                  }}
                >
                  Local
                </span>
              </div>
              {resources.map(resource => (
                <div
                  key={`floating-${resource.id}`}
                  className="flex min-w-0 flex-col justify-center border-r border-gray-200 bg-gray-50 text-center dark:border-[#363b45] dark:bg-[#171a21]"
                  style={{ padding: `${8 - transitionProgress * 4}px` }}
                >
                  <div
                    className="flex min-w-0 items-center justify-center gap-1"
                    style={{ marginBottom: `${4 - transitionProgress * 2}px` }}
                  >
                    <span
                      className="shrink-0 text-gray-600 dark:text-gray-300"
                      style={{ transform: `scale(${1 - transitionProgress * 0.12})` }}
                    >
                      {resource.icon}
                    </span>
                    <span className="truncate text-xs font-semibold text-gray-900 dark:text-white">
                      {resource.name}
                    </span>
                    {resource.status && resource.status !== 'serviceable' && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-red-500"
                        style={{ opacity: transitionProgress }}
                      />
                    )}
                  </div>
                  <div className={`text-xs font-medium ${isToday(currentDate) ? 'text-blue-600 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}>
                    {format(currentDate, 'EEE d')}
                  </div>
                  {resource.status && resource.status !== 'serviceable' && (
                    <div
                      className="overflow-hidden text-xs capitalize text-red-600 dark:text-red-400"
                      style={{
                        height: `${16 * (1 - transitionProgress)}px`,
                        marginTop: `${4 * (1 - transitionProgress)}px`,
                        opacity: 1 - transitionProgress,
                      }}
                    >
                      {resource.status}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (viewMode === 'week') {
      const weekDays = getWeekDays();
      const selectedAircraft = selectedAircraftId
        ? displayAircraft.find(item => item.id === selectedAircraftId)
        : undefined;
      const selectedInstructor = selectedInstructorId
        ? displayInstructors.find(item => item.id === selectedInstructorId)
        : undefined;
      const columnsPerDay = Number(Boolean(selectedAircraft)) + Number(Boolean(selectedInstructor));
      const totalColumns = weekDays.length * columnsPerDay;
      const minWidth = 42 + totalColumns * 54;
      if (totalColumns === 0) return null;
      const dayBandHeight = 32 - transitionProgress * 14;
      const resourceBandHeight = floatingHeader.height - dayBandHeight;

      return (
        <div
          data-calendar-floating-resource-header="week"
          data-calendar-floating-resource-header-progress={transitionProgress.toFixed(3)}
          className="pointer-events-none fixed z-[35] hidden overflow-hidden border-x border-b border-gray-300 bg-white md:block dark:border-[#363b45] dark:bg-[#171a21]"
          style={shellStyle}
          aria-hidden="true"
        >
          <div style={contentStyle}>
            <div
              className="grid"
              style={{
                gridTemplateColumns: `42px repeat(${totalColumns}, minmax(54px, 1fr))`,
                gridTemplateRows: `${dayBandHeight}px ${resourceBandHeight}px`,
                minWidth,
                height: floatingHeader.height,
                transition: 'height 90ms ease-out, grid-template-rows 90ms ease-out',
              }}
            >
              <div
                className="relative flex items-center justify-center overflow-hidden border-r border-gray-200 bg-gray-50 text-gray-500 dark:border-[#363b45] dark:bg-[#20242c] dark:text-gray-400"
                style={{ gridColumn: 1, gridRow: '1 / span 2' }}
              >
                <span
                  className="absolute left-1/2 top-1/2 whitespace-nowrap text-xs font-medium"
                  style={{ opacity: Math.max(0, 1 - transitionProgress * 2), transform: 'translate(-50%, -50%) rotate(-90deg)' }}
                >
                  Local time
                </span>
                <span
                  className="absolute left-1/2 top-1/2 whitespace-nowrap text-[10px] font-medium"
                  style={{ opacity: Math.max(0, (transitionProgress - 0.25) / 0.75), transform: 'translate(-50%, -50%) rotate(-90deg)' }}
                >
                  Local
                </span>
              </div>
              {weekDays.flatMap((day, dayIndex) => {
                const firstColumn = dayIndex * columnsPerDay + 2;
                const dayColumns: React.ReactNode[] = [
                  <div
                    key={`${day.toISOString()}-floating-day`}
                    className={`flex min-w-0 items-center justify-center border-r border-gray-200 bg-gray-100 px-1 font-semibold dark:border-[#363b45] dark:bg-[#20242c] ${isToday(day) ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'}`}
                    style={{
                      gridColumn: `${firstColumn} / span ${columnsPerDay}`,
                      gridRow: 1,
                      fontSize: `${11 - transitionProgress}px`,
                    }}
                  >
                    {format(day, transitionProgress > 0.65 ? 'EEE d' : 'EEE d MMM')}
                  </div>,
                ];
                let resourceColumnOffset = 0;

                if (selectedAircraft) {
                  dayColumns.push(
                    <div
                      key={`${day.toISOString()}-floating-aircraft`}
                      className="flex min-w-0 flex-col items-center justify-center border-r border-gray-200 bg-gray-50 px-1 text-center dark:border-[#363b45] dark:bg-[#171a21]"
                      style={{ gridColumn: firstColumn + resourceColumnOffset, gridRow: 2 }}
                    >
                      <span className="flex w-full min-w-0 items-center justify-center gap-1">
                        <Plane className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate text-[11px] font-semibold text-gray-900 dark:text-white">{selectedAircraft.registration}</span>
                        {selectedAircraft.status && selectedAircraft.status !== 'serviceable' && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                        )}
                      </span>
                      <span
                        className={`overflow-hidden text-[10px] font-medium ${isToday(day) ? 'text-blue-600 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}
                        style={{ height: `${15 * (1 - transitionProgress)}px`, opacity: 1 - transitionProgress }}
                      >
                        {format(day, 'EEE d')}
                      </span>
                    </div>
                  );
                  resourceColumnOffset += 1;
                }

                if (selectedInstructor) {
                  dayColumns.push(
                    <div
                      key={`${day.toISOString()}-floating-instructor`}
                      className="flex min-w-0 flex-col items-center justify-center border-r border-gray-200 bg-gray-50 px-1 text-center dark:border-[#363b45] dark:bg-[#171a21]"
                      style={{ gridColumn: firstColumn + resourceColumnOffset, gridRow: 2 }}
                    >
                      <span className="flex w-full min-w-0 items-center justify-center gap-1">
                        <User className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate text-[11px] font-semibold text-gray-900 dark:text-white">{selectedInstructor.name || selectedInstructor.email}</span>
                      </span>
                      <span
                        className={`overflow-hidden text-[10px] font-medium ${isToday(day) ? 'text-blue-600 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}
                        style={{ height: `${15 * (1 - transitionProgress)}px`, opacity: 1 - transitionProgress }}
                      >
                        {format(day, 'EEE d')}
                      </span>
                    </div>
                  );
                }

                return dayColumns;
              })}
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderDayView = () => {
    const timeSlots = getTimeSlots();
    const resources = getAllResources();

    return (
      <div className={isKioskMode ? 'h-full p-2' : 'p-3 sm:p-6'}>
        {!isKioskMode && renderMobileAgenda([currentDate])}
        <div ref={resourceCalendarGridRef} className={`resource-calendar-grid relative overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-[#2c2f36] dark:bg-[#171a21] ${isKioskMode ? 'h-full' : 'hidden md:block'}`}>
          {/* Fixed header */}
          <div ref={resourceCalendarHeaderRef} className="sticky top-0 z-20 bg-white border-b border-gray-200">
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
                    const outsideDaylight = isTimeSlotOutsideDaylight(slot, currentDate);

                    const dragRangeMeta = getTimeSlotDragRangeMeta(
                      slot,
                      resource.id,
                      resource.type
                    );
                    const isInDragRange = dragRangeMeta.active;
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
                    const selectionPreviewStyle = getTimeSlotSelectionPreviewStyle(dragRangeMeta);

                    return (
                      <div
                        key={`${resource.id}-${slot}`}
                        data-calendar-slot="true"
                        data-slot={slot}
                        data-resource-id={resource.id}
                        data-resource-type={resource.type}
                        data-date={currentDate.toISOString()}
                        data-day-index=""
                        className={`calendar-slot-cell border-r border-gray-200 relative${borderClasses} ${cursorClass} ${backgroundClass} ${outsideDaylight ? 'calendar-slot-non-daylight' : ''}`}
                        style={{
                          height: slotHeight,
                          gridColumn: resourceIndex + 2,
                          gridRow: slotIndex + 1,
                          touchAction: 'manipulation',
                          ...selectionPreviewStyle,
                        }}
                        onClick={() => {
                          if (Date.now() < suppressSlotClickUntilRef.current) return;
                          if (!unavailability) {
                            handleTimeSlotClick(
                              slot,
                              resource.id,
                              resource.type,
                              currentDate
                            );
                          }
                        }}
                        onMouseDown={() =>
                          !unavailability && !draggedBooking &&
                          handleMouseDown(
                            slot,
                            resource.id,
                            resource.type,
                            currentDate
                          )
                        }
                        onMouseUp={() => handleMouseUp(currentDate)}
                        onPointerDown={(event) =>
                          !unavailability &&
                          handleTouchSlotPointerDown(
                            event,
                            slot,
                            resource.id,
                            resource.type,
                            currentDate
                          )
                        }
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
                      {...getUnavailabilityBlockProps(period)}
                      style={{
                        gridColumn: resourceIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        background: getCalendarUnavailabilityBackground(period.source),
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
                    data-booking-id={booking.id}
                    aria-current={booking.id === notificationFocusBookingId ? 'true' : undefined}
                    className={`${getBookingColorClasses(booking)} ${getBookingAttentionClasses(booking)} ${getNotificationFocusClasses(booking)} calendar-booking-card relative text-xs ${getBookingCardPadding(bookingCardDensity)} rounded-md shadow-sm overflow-hidden cursor-move transition-colors z-10 border-2 ${
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
                      touchAction: 'manipulation',
                    }}
                    title={canSeePrivateBookingDetails(booking) ? `${booking.notes || 'Booking'}` : 'Booking'}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (canUseBookingActions(booking) && canDragOrResizeBooking(booking)) {
                        startBookingDragIntent(e, booking, resource.type);
                      }
                    }}
                    onPointerDown={(event) => {
                      handleTouchBookingPointerDown(event, booking, resource.type);
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

                      if (canUseBookingActions(booking)) {
                        openBookingActionMenu(booking, { x: e.clientX, y: e.clientY });
                      }
                    }}
                  >
                    {canUseBookingActions(booking) && canDragOrResizeBooking(booking) && (
                      <>
                        <div
                          className="absolute top-0 left-0 right-0 h-4 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto md:h-2"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleResizeStart(e, booking, 'top', resource.type);
                          }}
                          onPointerDown={(event) => {
                            handleTouchBookingPointerDown(event, booking, resource.type, 'resize-top');
                          }}
                          title="Drag to change start time"
                        />
                        <div
                          className="absolute bottom-0 left-0 right-0 h-4 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto md:h-2"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleResizeStart(e, booking, 'bottom', resource.type);
                          }}
                          onPointerDown={(event) => {
                            handleTouchBookingPointerDown(event, booking, resource.type, 'resize-bottom');
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
                  className="relative z-20 overflow-hidden rounded border-2 border-dashed border-blue-300 bg-blue-700 p-2 text-xs text-white opacity-90 shadow-lg"
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
      ? displayInstructors.find((i) => i.id === selectedInstructorId)
      : undefined;

    return (
      <div className={isKioskMode ? 'h-full p-2' : 'p-3 sm:p-6'}>
        {!isKioskMode && renderMobileAgenda(weekDays)}
        <div ref={resourceCalendarGridRef} className={`resource-calendar-grid relative overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-[#2c2f36] dark:bg-[#171a21] ${isKioskMode ? 'h-full' : 'hidden md:block'}`}>
          {/* Fixed header */}
          <div ref={resourceCalendarHeaderRef} className="sticky top-0 z-20 border-b border-gray-200 bg-white">
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
                      const outsideDaylight = isTimeSlotOutsideDaylight(slot, day);

                      const dragRangeMeta = getTimeSlotDragRangeMeta(
                        slot,
                        selectedAircraftId,
                        'aircraft',
                        dayIndex
                      );
                      const isInDragRange = dragRangeMeta.active;
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
                      const selectionPreviewStyle = getTimeSlotSelectionPreviewStyle(dragRangeMeta);

                      daySlots.push(
                        <div
                          key={`${dayIndex}-aircraft-${slot}`}
                          data-calendar-slot="true"
                          data-slot={slot}
                          data-resource-id={selectedAircraftId}
                          data-resource-type="aircraft"
                          data-date={day.toISOString()}
                          data-day-index={dayIndex}
                          className={`calendar-slot-cell border-r border-gray-200 relative${borderClasses} ${cursorClass} ${backgroundClass} ${outsideDaylight ? 'calendar-slot-non-daylight' : ''}`}
                          style={{
                            height: slotHeight,
                            gridColumn: columnIndex + 2,
                            gridRow: slotIndex + 1,
                            touchAction: 'manipulation',
                            ...selectionPreviewStyle,
                          }}
                          onClick={() => {
                            if (Date.now() < suppressSlotClickUntilRef.current) return;
                            if (!unavailability) {
                              handleTimeSlotClick(
                                slot,
                                selectedAircraftId,
                                'aircraft',
                                day
                              );
                            }
                          }}
                          onMouseDown={() =>
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
                          onPointerDown={(event) =>
                            !unavailability &&
                            handleTouchSlotPointerDown(
                              event,
                              slot,
                              selectedAircraftId,
                              'aircraft',
                              day,
                              dayIndex
                            )
                          }
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
                      const outsideDaylight = isTimeSlotOutsideDaylight(slot, day);

                      const dragRangeMeta = getTimeSlotDragRangeMeta(
                        slot,
                        selectedInstructorId,
                        'instructor',
                        dayIndex
                      );
                      const isInDragRange = dragRangeMeta.active;
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
                      const selectionPreviewStyle = getTimeSlotSelectionPreviewStyle(dragRangeMeta);

                      daySlots.push(
                        <div
                          key={`${dayIndex}-instructor-${slot}`}
                          data-calendar-slot="true"
                          data-slot={slot}
                          data-resource-id={selectedInstructorId}
                          data-resource-type="instructor"
                          data-date={day.toISOString()}
                          data-day-index={dayIndex}
                          className={`calendar-slot-cell border-r border-gray-200 relative${borderClasses} ${cursorClass} ${backgroundClass} ${outsideDaylight ? 'calendar-slot-non-daylight' : ''}`}
                          style={{
                            height: slotHeight,
                            gridColumn: columnIndex + 2,
                            gridRow: slotIndex + 1,
                            touchAction: 'manipulation',
                            ...selectionPreviewStyle,
                          }}
                          onClick={() => {
                            if (Date.now() < suppressSlotClickUntilRef.current) return;
                            if (!unavailability) {
                              handleTimeSlotClick(
                                slot,
                                selectedInstructorId,
                                'instructor',
                                day
                              );
                            }
                          }}
                          onMouseDown={() =>
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
                          onPointerDown={(event) =>
                            !unavailability &&
                            handleTouchSlotPointerDown(
                              event,
                              slot,
                              selectedInstructorId,
                              'instructor',
                              day,
                              dayIndex
                            )
                          }
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
              const overlays: React.ReactNode[] = [];
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
                        {...getUnavailabilityBlockProps(period)}
                        style={{
                          gridColumn: columnIndex + 2,
                          gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                          marginTop: position.marginTop,
                          background: getCalendarUnavailabilityBackground(period.source),
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
                        {...getUnavailabilityBlockProps(period)}
                        style={{
                          gridColumn: columnIndex + 2,
                          gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                          marginTop: position.marginTop,
                          background: getCalendarUnavailabilityBackground(period.source),
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
              const bookingElements: React.ReactNode[] = [];
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
                      data-booking-id={booking.id}
                      aria-current={booking.id === notificationFocusBookingId ? 'true' : undefined}
                      className={`${getBookingColorClasses(booking)} ${getBookingAttentionClasses(booking)} ${getNotificationFocusClasses(booking)} calendar-booking-card relative text-xs ${getBookingCardPadding(bookingCardDensity)} rounded-md shadow-sm overflow-hidden cursor-move transition-colors z-10 border-2 ${
                        isBeingDragged ? 'opacity-30 pointer-events-none' : ''
                      } ${isBeingResized ? 'pointer-events-none' : ''} group`}
                      style={{
                        gridColumn: columnIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        ...getBookingBlockStyle(position),
                        ...getBookingLaneStyle(booking),
                        touchAction: 'manipulation',
                      }}
                    title={canSeePrivateBookingDetails(booking) ? `${booking.notes || 'Booking'}` : 'Booking'}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (canUseBookingActions(booking) && canDragOrResizeBooking(booking)) {
                          startBookingDragIntent(e, booking, 'aircraft');
                        }
                      }}
                      onPointerDown={(event) => {
                        handleTouchBookingPointerDown(event, booking, 'aircraft');
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

                        if (canUseBookingActions(booking)) {
                          openBookingActionMenu(booking, { x: e.clientX, y: e.clientY });
                        }
                      }}
                    >
                      {canUseBookingActions(booking) && canDragOrResizeBooking(booking) && (
                        <>
                          <div
                            className="absolute top-0 left-0 right-0 h-4 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto md:h-2"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleResizeStart(e, booking, 'top', 'aircraft');
                            }}
                            onPointerDown={(event) => {
                              handleTouchBookingPointerDown(event, booking, 'aircraft', 'resize-top');
                            }}
                            title="Drag to change start time"
                          />
                          <div
                            className="absolute bottom-0 left-0 right-0 h-4 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto md:h-2"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleResizeStart(e, booking, 'bottom', 'aircraft');
                            }}
                            onPointerDown={(event) => {
                              handleTouchBookingPointerDown(event, booking, 'aircraft', 'resize-bottom');
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
                      data-booking-id={booking.id}
                      aria-current={booking.id === notificationFocusBookingId ? 'true' : undefined}
                      className={`${getBookingColorClasses(booking)} ${getBookingAttentionClasses(booking)} ${getNotificationFocusClasses(booking)} calendar-booking-card relative text-xs ${getBookingCardPadding(bookingCardDensity)} rounded-md shadow-sm overflow-hidden cursor-move transition-colors z-10 border-2 ${
                        isBeingDragged ? 'opacity-30 pointer-events-none' : ''
                      } ${isBeingResized ? 'pointer-events-none' : ''} group`}
                      style={{
                        gridColumn: columnIndex + 2,
                        gridRow: `${position.gridRowStart} / ${position.gridRowEnd}`,
                        marginTop: position.marginTop,
                        ...getBookingBlockStyle(position),
                        ...getBookingLaneStyle(booking),
                        touchAction: 'manipulation',
                      }}
                      title={canSeePrivateBookingDetails(booking) ? `${booking.notes || 'Booking'}` : 'Booking'}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        if (canUseBookingActions(booking) && canDragOrResizeBooking(booking)) {
                          startBookingDragIntent(e, booking, 'instructor');
                        }
                      }}
                      onPointerDown={(event) => {
                        handleTouchBookingPointerDown(event, booking, 'instructor');
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

                        if (canUseBookingActions(booking)) {
                          openBookingActionMenu(booking, { x: e.clientX, y: e.clientY });
                        }
                      }}
                    >
                      {canUseBookingActions(booking) && canDragOrResizeBooking(booking) && (
                        <>
                          <div
                            className="absolute top-0 left-0 right-0 h-4 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto md:h-2"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleResizeStart(e, booking, 'top', 'instructor');
                            }}
                            onPointerDown={(event) => {
                              handleTouchBookingPointerDown(event, booking, 'instructor', 'resize-top');
                            }}
                            title="Drag to change start time"
                          />
                          <div
                            className="absolute bottom-0 left-0 right-0 h-4 cursor-ns-resize hover:bg-white hover:bg-opacity-30 z-20 pointer-events-auto md:h-2"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleResizeStart(e, booking, 'bottom', 'instructor');
                            }}
                            onPointerDown={(event) => {
                              handleTouchBookingPointerDown(event, booking, 'instructor', 'resize-bottom');
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
                    className="relative z-20 overflow-hidden rounded border-2 border-dashed border-blue-300 bg-blue-700 p-2 text-xs text-white opacity-90 shadow-lg"
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
                    className="relative z-20 overflow-hidden rounded border-2 border-dashed border-blue-300 bg-blue-700 p-2 text-xs text-white opacity-90 shadow-lg"
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
    <div className="border-t border-gray-200 bg-gray-50 dark:border-[#2c2f36] dark:bg-[#11141a]">
      <div className="border-b border-gray-200 bg-white px-3 py-4 dark:border-[#2c2f36] dark:bg-[#171a21] sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-950 dark:text-gray-100">Bookings by date range</h3>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {filteredListBookings.length} booking{filteredListBookings.length === 1 ? '' : 's'} match the selected range and filters.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Date range shortcuts">
            {[
              { label: 'Today', days: 1 },
              { label: 'Next 7 days', days: 7 },
              { label: 'Next 30 days', days: 30 },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  const start = new Date();
                  setCalendarListRange(start, addDays(start, preset.days - 1));
                }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-200 dark:hover:border-blue-500 dark:hover:bg-blue-950/40"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                setCalendarListRange(startOfMonth(today), endOfMonth(today));
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-200 dark:hover:border-blue-500 dark:hover:bg-blue-950/40"
            >
              This month
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-600 dark:text-gray-300">
            From
            <input
              type="date"
              value={listStartDate}
              max={listEndDate || undefined}
              onChange={(event) => updateListStartDate(event.target.value)}
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100 dark:focus:ring-blue-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-600 dark:text-gray-300">
            To
            <input
              type="date"
              value={listEndDate}
              min={listStartDate || undefined}
              onChange={(event) => updateListEndDate(event.target.value)}
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100 dark:focus:ring-blue-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-600 dark:text-gray-300 sm:col-span-2 lg:col-span-2 2xl:col-span-2">
            Search
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={listSearchQuery}
                onChange={(event) => setListSearchQuery(event.target.value)}
                placeholder="Name, aircraft, location, notes or booking ID"
                className="min-h-10 w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100 dark:focus:ring-blue-900"
              />
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-600 dark:text-gray-300">
            Pilot / Student
            <SearchableSelect
              value={listPilotFilter}
              onChange={(event) => setListPilotFilter(event.target.value)}
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100 dark:focus:ring-blue-900"
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
            </SearchableSelect>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-600 dark:text-gray-300">
            Instructor
            <SearchableSelect
              value={listInstructorFilter}
              onChange={(event) => setListInstructorFilter(event.target.value)}
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100 dark:focus:ring-blue-900"
            >
              <option value="">All instructors</option>
              {displayInstructors.map((instructor) => (
                <option key={instructor.id} value={instructor.id}>{instructor.name}</option>
              ))}
            </SearchableSelect>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-600 dark:text-gray-300">
            Aircraft / Resource
            <SearchableSelect
              value={listResourceFilter}
              onChange={(event) => setListResourceFilter(event.target.value)}
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100 dark:focus:ring-blue-900"
            >
              <option value="">All resources</option>
              <option value="ground">Ground sessions</option>
              {aircraftForLookup
                .filter((item) => !item.isArchived)
                .sort((left, right) => left.registration.localeCompare(right.registration))
                .map((item) => (
                  <option key={item.id} value={item.id}>{item.registration}</option>
                ))}
            </SearchableSelect>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-600 dark:text-gray-300">
            Booking type
            <SearchableSelect
              value={listBookingTypeFilter}
              onChange={(event) => setListBookingTypeFilter(event.target.value as CalendarListBookingType)}
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100 dark:focus:ring-blue-900"
            >
              <option value="all">All booking types</option>
              <option value="flight">Flights</option>
              <option value="ground">Ground sessions</option>
              <option value="guest">Guest / casual</option>
            </SearchableSelect>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-600 dark:text-gray-300">
            Status
            <SearchableSelect
              value={listStatusFilter}
              onChange={(event) => setListStatusFilter(event.target.value as CalendarListStatus)}
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100 dark:focus:ring-blue-900"
            >
              <option value="all">All statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="pending_approval">Pending approval</option>
              <option value="pending_supervision">Needs supervision</option>
              <option value="waitlist">Waitlist</option>
              <option value="logged">Logged</option>
              <option value="not_logged">Not logged</option>
              <option value="completed">Completed</option>
              <option value="no-show">No-show</option>
              <option value="cancelled">Cancelled</option>
            </SearchableSelect>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-600 dark:text-gray-300">
            Order
            <SearchableSelect
              value={listSort}
              onChange={(event) => setListSort(event.target.value as CalendarListSort)}
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100 dark:focus:ring-blue-900"
            >
              <option value="ascending">Earliest first</option>
              <option value="descending">Latest first</option>
            </SearchableSelect>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={clearCalendarListFilters}
              className="min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-100 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-200 dark:hover:bg-[#262b33]"
            >
              Clear filters
            </button>
          </div>
        </div>

        {!listDateRangeValid && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            Choose a valid From and To date before viewing bookings.
          </p>
        )}
      </div>

      <div className="divide-y divide-gray-200 bg-white dark:divide-[#2c2f36] dark:bg-[#171a21]">
        {filteredListBookings.map((booking) => {
          const isPast = isPastBooking(booking);
          const isLogged = isBookingFlightLogged(booking);
          const isCancelled = isCancelledBooking(booking);
          const instructorName = getInstructorName(booking);
          const notes = canSeePrivateBookingDetails(booking) ? truncateNotes(booking.notes, 96) : '';
          const statusLabel = booking.hasConflict
            ? 'Waitlist'
            : isCancelled
              ? 'Cancelled'
              : isLogged
                ? 'Logged'
                : isPast
                  ? 'Unlogged'
                  : booking.status.replaceAll('_', ' ');

          return (
            <div
              key={booking.id}
              className="grid grid-cols-1 gap-3 px-4 py-3 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-[#11141a] md:grid-cols-[9rem_minmax(0,1fr)_auto] md:items-center sm:px-5"
            >
              <div>
                <div className="font-bold text-gray-950 dark:text-gray-100">{format(new Date(booking.startTime), 'EEE, dd MMM yyyy')}</div>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{formatBookingTimeRange(booking)}</div>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {renderHirerName(booking, 'font-bold text-gray-950 dark:text-gray-100')}
                  {booking.isGuestBooking && (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-200">Guest</span>
                  )}
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="font-medium text-gray-700 dark:text-gray-200">{getAircraftName(booking)}</span>
                  {instructorName && (
                    <>
                      <span className="text-gray-300 dark:text-gray-600">|</span>
                      <span className="text-gray-600 dark:text-gray-300">{instructorName}</span>
                    </>
                  )}
                  {booking.location && (
                    <>
                      <span className="text-gray-300 dark:text-gray-600">|</span>
                      <span className="text-gray-500 dark:text-gray-400">{booking.location}</span>
                    </>
                  )}
                </div>
                {notes && <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{notes}</div>}
              </div>

              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  booking.hasConflict
                    ? 'bg-red-100 text-red-700'
                    : booking.status === 'pending_approval'
                      ? 'bg-amber-100 text-amber-700'
                      : booking.status === 'pending_supervision'
                        ? 'bg-orange-100 text-orange-700'
                      : isCancelled
                        ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                        : isLogged
                          ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200'
                          : isPast
                            ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200'
                }`}>
                  {statusLabel}
                </span>
                <button
                  type="button"
                  onClick={() => showListBookingOnCalendar(booking)}
                  className="rounded-md border border-blue-200 bg-white px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:bg-[#11141a] dark:text-blue-200 dark:hover:bg-blue-950/40"
                >
                  View day
                </button>
                {canUseBookingActions(booking) && (
                  <button
                    type="button"
                    onClick={(event) => {
                      openBookingActionMenu(booking, { x: event.clientX, y: event.clientY });
                    }}
                    className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-100 dark:border-[#363b45] dark:text-gray-200 dark:hover:bg-[#262b33]"
                  >
                    Actions
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filteredListBookings.length === 0 && (
          <div className="px-4 py-10 text-center">
            <Plane className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
            <h3 className="mt-2 text-sm font-bold text-gray-900 dark:text-gray-100">No bookings found</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {listDateRangeValid ? 'Try a wider date range or clear one of the filters.' : 'Choose a valid date range.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const getDateRangeText = () => {
    if (viewMode === 'list') {
      const start = parseCalendarDateParam(listStartDate);
      const end = parseCalendarDateParam(listEndDate);
      if (!start || !end) return 'Choose booking date range';
      if (isSameDay(start, end)) return format(start, 'EEEE, MMMM d, yyyy');
      return start.getFullYear() === end.getFullYear()
        ? `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
        : `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}`;
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
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {viewMode === 'list' ? 'Choose the range start date' : 'Choose a day to jump to'}
            </p>
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
                  if (viewMode === 'list') {
                    const currentStart = parseCalendarDateParam(listStartDate);
                    const currentEnd = parseCalendarDateParam(listEndDate);
                    const rangeLength = currentStart && currentEnd
                      ? Math.max(1, differenceInCalendarDays(currentEnd, currentStart) + 1)
                      : 30;
                    setCalendarListRange(day, addDays(day, rangeLength - 1));
                  } else {
                    setCurrentDate(day);
                  }
                  setShowDatePicker(false);
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

  const handleNextAvailableSlotSelected = (slot: NextAvailableSlot) => {
    const start = new Date(slot.slot_start);
    const end = new Date(slot.slot_end);
    onNewBookingWithTime?.(
      start,
      format(start, 'HH:mm'),
      format(end, 'HH:mm'),
      slot.aircraft_id,
      'aircraft',
      {
        aircraftId: slot.aircraft_id,
        instructorId: slot.instructor_id,
        location: slot.location_name,
        locationId: slot.location_id,
      }
    );
    setCurrentDate(start);
    setShowNextAvailableSlot(false);
  };

  const renderStandardControls = () => (
    <div className="space-y-2 sm:space-y-3">
      <div className="grid min-w-0 items-center gap-2 sm:gap-3 xl:grid-cols-[310px_minmax(360px,1fr)_300px] 2xl:grid-cols-[350px_minmax(460px,1fr)_340px]">
        <div className="grid min-w-0 gap-2 sm:flex sm:items-center">
          <h2 className="hidden text-xl font-bold tracking-tight text-gray-950 dark:text-gray-100 2xl:block">
            Calendar
          </h2>
          <button
            onClick={() => onNewBooking(currentDate)}
            className="inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 sm:w-auto sm:gap-2 sm:px-4"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">New Booking</span>
          </button>
          <button
            type="button"
            onClick={() => setShowNextAvailableSlot(true)}
            className="inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-blue-200 bg-white px-3 text-sm font-bold text-blue-700 shadow-sm transition-colors hover:bg-blue-50 dark:border-blue-800 dark:bg-[#171a21] dark:text-blue-200 dark:hover:bg-blue-950/40 sm:w-auto"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">Find next slot</span>
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

      {viewMode !== 'list' && <>
      <details className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#11141a] lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-gray-800 dark:text-gray-100 [&::-webkit-details-marker]:hidden">
          <span>Filters & options</span>
          <ChevronDown className="h-4 w-4 text-gray-500" />
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {viewMode === 'day' && renderFilterControls()}
          {viewMode === 'week' && <div className="w-full min-w-0">{renderResourceSelectors()}</div>}

          {renderDaylightControls()}

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

      <div className="hidden items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#11141a] lg:flex">
        <div className="min-w-0 flex-1">
          {viewMode === 'day' && renderFilterControls()}
          {viewMode === 'week' && <div className="w-full min-w-0">{renderResourceSelectors()}</div>}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 border-l border-gray-200 pl-2 dark:border-[#363b45]">
          {renderDaylightControls()}

          <label className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33]">
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
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-[#262b33]"
              title="Refresh calendar"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Refresh</span>
            </button>
          )}
        </div>
      </div>
      </>}
    </div>
  );

  const renderKioskControls = () => (
    <div className="space-y-3">
      <div className="grid items-center gap-4 md:grid-cols-[210px_minmax(420px,1fr)_300px] xl:grid-cols-[240px_minmax(520px,1fr)_360px]">
        <div className="flex justify-start">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onNewBooking(currentDate)}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">New Booking</span>
            </button>
            <button
              type="button"
              onClick={() => setShowNextAvailableSlot(true)}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-blue-200 bg-white px-4 text-sm font-bold text-blue-700 shadow-sm hover:bg-blue-50 dark:border-blue-800 dark:bg-[#171a21] dark:text-blue-200"
            >
              <Search className="h-4 w-4" />
              Find next slot
            </button>
          </div>
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

      {viewMode !== 'list' && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#11141a]">
        {viewMode === 'day' && renderFilterControls()}
        {viewMode === 'week' && <div className="min-w-[28rem] flex-1">{renderResourceSelectors()}</div>}

        {renderDaylightControls()}

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
      </div>}
    </div>
  );

  const renderCalendarColourLegend = () => (
    <div
      className={`shrink-0 border-t border-gray-200 bg-gray-50 dark:border-[#2c2f36] dark:bg-[#11141a] ${isKioskMode ? 'px-4 py-2.5' : 'px-3 py-2.5 sm:px-6'}`}
      role="note"
      aria-label="Calendar colour legend"
    >
      <div className="flex flex-nowrap items-center gap-x-4 overflow-x-auto pb-1 text-[11px] font-semibold text-gray-600 dark:text-gray-300 sm:flex-wrap sm:gap-y-2 sm:overflow-visible sm:pb-0 sm:text-xs">
        <span className="font-extrabold uppercase tracking-wide text-gray-500 dark:text-gray-400">Booking colours</span>
        {CALENDAR_BOOKING_LEGEND.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className={`h-3.5 w-3.5 shrink-0 rounded border-2 ${item.classes}`} aria-hidden="true" />
            {item.label}
          </span>
        ))}
        <span className="hidden h-4 w-px bg-gray-300 dark:bg-gray-600 sm:block" aria-hidden="true" />
        <span className="font-extrabold uppercase tracking-wide text-gray-500 dark:text-gray-400">Calendar shading</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="calendar-downtime-legend-swatch h-3.5 w-3.5 shrink-0 rounded border border-orange-500" aria-hidden="true" />
          Temporary off
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="calendar-unavailable-legend-swatch h-3.5 w-3.5 shrink-0 rounded border border-gray-500" aria-hidden="true" />
          Rostered unavailable
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="calendar-daylight-legend-swatch h-3.5 w-3.5 shrink-0 rounded border border-slate-500" aria-hidden="true" />
          Non-daylight (when enabled)
        </span>
      </div>
    </div>
  );

  return (
    <div className={isKioskMode ? 'flex min-h-screen select-none flex-col overflow-visible bg-white dark:bg-[#0f1117]' : 'select-none overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]'}>
      <div className={isKioskMode ? 'shrink-0 border-b border-gray-200 bg-white p-4 dark:border-[#2c2f36] dark:bg-[#0f1117]' : 'border-b border-gray-200 bg-white p-3 dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-4'}>
        {isKioskMode ? renderKioskControls() : renderStandardControls()}
      </div>

      {renderFloatingResourceHeader()}

      <div className={isKioskMode ? 'min-h-0 flex-1 overflow-auto' : undefined}>
        {viewMode === 'day' && renderDayView()}
        {viewMode === 'week' && renderWeekView()}
        {viewMode === 'list' && renderListView()}
        {viewMode === 'month' && (
        <MonthView
          currentDate={currentDate}
          bookings={bookings}
          aircraft={displayAircraft}
          instructors={displayInstructors}
          defaultAircraftId={preferredAircraftId}
          onDayClick={(date) => {
            setCurrentDate(date);
            setViewMode('day');
          }}
          weekStartsOn={calendarSettings?.week_starts_on === 'sunday' ? 0 : 1}
          showWeekends={calendarSettings?.show_weekends ?? true}
          availableHours={availableCalendarHours}
          getBookingColorClasses={getBookingColorClasses}
        />
        )}
      </div>

      {renderCalendarColourLegend()}

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
          className="booking-menu-loading fixed z-50 min-w-[210px] rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-xl dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-100"
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
          calendarAircraftLabel={(() => {
            const calendarAircraft = aircraft.find(item => item.id === actionMenuBooking.aircraftId);
            return calendarAircraft ? [calendarAircraft.registration, calendarAircraft.make, calendarAircraft.model].filter(Boolean).join(' ') : undefined;
          })()}
          position={actionMenuPosition}
          canEdit={canUseBookingActions(actionMenuBooking)}
          canLogFlight={canUseBookingActions(actionMenuBooking)}
          onAcceptSupervision={canAcceptManualSupervision(actionMenuBooking)
            ? async () => {
                try {
                  const result = await acceptManualSupervision(actionMenuBooking);
                  toast.success(`${result.supervisingInstructorName} is now confirmed as the supervisor`);
                  bookingMenuOpenTokenRef.current += 1;
                  setActionMenuBooking(null);
                  setBookingMenuLoading(null);
                  await Promise.resolve(onRefresh?.());
                } catch (error) {
                  toast.error(error instanceof Error
                    ? error.message
                    : 'The supervision commitment could not be saved.');
                }
              }
            : undefined}
          acceptingSupervision={acceptingBookingId === actionMenuBooking.id}
          onEdit={() => {
            if (isBookingFlightLogged(actionMenuBooking)) {
              toast.error('Delete the flight log before editing this booking');
              return;
            }
            if (onEditBooking) {
              const bookingToEdit = actionMenuBooking;
              const bookingDate = format(new Date(bookingToEdit.startTime), 'yyyy-MM-dd');
              setCurrentDate(new Date(`${bookingDate}T12:00:00`));
              setActionMenuBooking(null);
              window.setTimeout(() => onEditBooking(bookingToEdit), 0);
            }
          }}
          onCopy={canUseBookingActions(actionMenuBooking) ? () => {
            if (onCopyBooking) {
              const bookingToCopy = actionMenuBooking;
              const bookingDate = format(new Date(bookingToCopy.startTime), 'yyyy-MM-dd');
              setCurrentDate(new Date(`${bookingDate}T12:00:00`));
              setActionMenuBooking(null);
              window.setTimeout(() => onCopyBooking(bookingToCopy), 0);
            }
          } : undefined}
          onLogFlight={() => {
            if (actionMenuBooking.bookingKind === 'ground') {
              setFlightLogBooking(actionMenuBooking);
              setShowGroundSessionLogModal(true);
              return;
            }
            void openCreateFlightLog(actionMenuBooking);
          }}
          onEditFlightLog={() => {
            if (actionMenuBooking.bookingKind === 'ground') {
              setFlightLogBooking(actionMenuBooking);
              setShowGroundSessionLogModal(true);
              return;
            }
            setFlightLogBooking(actionMenuBooking);
            setFlightLogMode('edit');
            setShowFlightLogModal(true);
          }}
          onDeleteFlightLog={() => {
            if (actionMenuBooking.bookingKind === 'ground') {
              void handleDeleteBookingGroundSessionLog(actionMenuBooking);
              return;
            }
            void handleDeleteBookingFlightLog(actionMenuBooking);
          }}
          onDelete={() => {
            if (isBookingFlightLogged(actionMenuBooking)) {
              toast.error('Delete the flight log before deleting this booking');
              return;
            }
            if (onDeleteBooking) {
              const bookingToDelete = actionMenuBooking;
              setActionMenuBooking(null);
              setCancellationBooking(bookingToDelete);
            }
          }}
          onRestore={
            onRestoreBooking && (actionMenuBooking.status === 'cancelled' || actionMenuBooking.deletedAt)
              ? () => {
                  const bookingToRestore = actionMenuBooking;
                  void Promise.resolve(onRestoreBooking(bookingToRestore.id))
                    .then(() => {
                      setActionMenuBooking(null);
                    })
                    .catch((error) => {
                      console.error('Error reinstating booking from action menu:', error);
                    });
                }
              : undefined
          }
          onViewHirerProfile={!isKioskMode && canUseBookingActions(actionMenuBooking) && !actionMenuBooking.isGuestBooking && (actionMenuBooking.studentId || actionMenuBooking.pilotId)
            ? () => {
                const hirerId = actionMenuBooking.studentId || actionMenuBooking.pilotId;
                if (!hirerId) return;
                setActionMenuBooking(null);
                navigate(`/students/${hirerId}`);
              }
            : undefined}
          onConvertGuestToMember={!isKioskMode && canUseBookingActions(actionMenuBooking) && actionMenuBooking.isGuestBooking
            ? () => {
                const bookingToConvert = actionMenuBooking;
                setActionMenuBooking(null);
                setGuestPromotionBooking(bookingToConvert);
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

      {guestPromotionBooking && (
        <GuestPromotionModal
          booking={guestPromotionBooking}
          users={users}
          onClose={() => setGuestPromotionBooking(null)}
          onComplete={async (memberId) => {
            setGuestPromotionBooking(null);
            await Promise.resolve(onRefresh?.());
            navigate(`/students/${memberId}`);
          }}
        />
      )}

      {showFlightLogModal && flightLogBooking && (
        <FlightLogModal
          booking={{
            ...flightLogBooking,
            studentId: flightLogBooking.studentId || flightLogBooking.pilotId || '',
            aircraftId: flightLogBooking.aircraftId || '',
          }}
          mode={flightLogMode}
          flightLogId={getBookingFlightLogId(flightLogBooking)}
          onApproveBooking={onApproveBooking}
          onSaved={() => Promise.resolve(onRefresh?.())}
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

      {showGroundSessionLogModal && flightLogBooking && (
        <GroundSessionLogModal
          booking={flightLogBooking}
          mode={flightLogBooking.groundSessionLog ? 'edit' : 'create'}
          groundSessionLogId={getBookingGroundSessionLogId(flightLogBooking)}
          onClose={() => {
            setShowGroundSessionLogModal(false);
            setFlightLogBooking(null);
          }}
          onSuccess={() => {
            setShowGroundSessionLogModal(false);
            setFlightLogBooking(null);
            void Promise.resolve(onRefresh?.());
          }}
        />
      )}

      {cancellationBooking && onDeleteBooking && (
        <BookingCancellationModal
          booking={cancellationBooking}
          onClose={() => setCancellationBooking(null)}
          onConfirm={async (input) => {
            await onDeleteBooking(cancellationBooking.id, input);
            setCancellationBooking(null);
          }}
        />
      )}

      <NextAvailableSlotModal
        isOpen={showNextAvailableSlot}
        initialDate={currentDate}
        aircraft={displayAircraft.filter((item) => item.status === 'serviceable')}
        instructors={displayInstructors}
        locations={activeLocations}
        primaryLocation={primaryLocation}
        onClose={() => setShowNextAvailableSlot(false)}
        onSelect={handleNextAvailableSlotSelected}
      />

      {downtimeEditor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onMouseDown={() => {
            if (downtimeEditorBusy) return;
            setDowntimeEditor(null);
            setConfirmingDowntimeDelete(false);
          }}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#363b45] dark:bg-[#171a21]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="downtime-editor-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-gray-200 px-5 py-4 dark:border-[#363b45]">
              <h3 id="downtime-editor-title" className="text-base font-bold text-gray-950 dark:text-gray-100">
                {confirmingDowntimeDelete ? 'Delete temporary off period?' : 'Edit temporary off period'}
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {displayInstructors.find((item) => item.id === downtimeEditor.userId)?.name || 'Instructor downtime'}
              </p>
            </div>

            {confirmingDowntimeDelete ? (
              <div className="space-y-4 p-5">
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
                  <p className="font-bold">This removes the downtime entirely.</p>
                  <p className="mt-1">
                    {downtimeEditor.startDate === downtimeEditor.endDate
                      ? downtimeEditor.startDate
                      : `${downtimeEditor.startDate} to ${downtimeEditor.endDate}`}
                    {downtimeEditor.startTime && downtimeEditor.endTime
                      ? `, ${downtimeEditor.startTime}–${downtimeEditor.endTime}`
                      : ', all day'}
                    {' · '}{downtimeEditor.reason || 'Temporary off period'}
                  </p>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setConfirmingDowntimeDelete(false)}
                    disabled={Boolean(downtimeEditorBusy)}
                    className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-[#4b5563] dark:bg-[#11141a] dark:text-gray-100"
                  >
                    Keep downtime
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteInstructorDowntime()}
                    disabled={Boolean(downtimeEditorBusy)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {downtimeEditorBusy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Delete permanently
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleUpdateInstructorDowntime();
                }}
              >
                <div className="space-y-4 p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Start date
                      <input
                        type="date"
                        value={downtimeEditor.startDate}
                        max={downtimeEditor.endDate || undefined}
                        onChange={(event) => setDowntimeEditor((current) => current ? { ...current, startDate: event.target.value } : current)}
                        className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-[#4b5563] dark:bg-[#11141a] dark:text-gray-100"
                        required
                      />
                    </label>
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      End date
                      <input
                        type="date"
                        value={downtimeEditor.endDate}
                        min={downtimeEditor.startDate || undefined}
                        onChange={(event) => setDowntimeEditor((current) => current ? { ...current, endDate: event.target.value } : current)}
                        className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-[#4b5563] dark:bg-[#11141a] dark:text-gray-100"
                        required
                      />
                    </label>
                  </div>

                  <label className="flex min-h-11 items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={!downtimeEditor.startTime && !downtimeEditor.endTime}
                      onChange={(event) => setDowntimeEditor((current) => current ? {
                        ...current,
                        startTime: event.target.checked ? undefined : `${calendarStartHour.toString().padStart(2, '0')}:00`,
                        endTime: event.target.checked
                          ? undefined
                          : calendarEndHour >= 24
                            ? '23:59'
                            : `${calendarEndHour.toString().padStart(2, '0')}:00`,
                      } : current)}
                      className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                    />
                    All-day downtime
                  </label>

                  {Boolean(downtimeEditor.startTime || downtimeEditor.endTime) && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                        Start time
                        <input
                          type="time"
                          value={downtimeEditor.startTime || ''}
                          onChange={(event) => setDowntimeEditor((current) => current ? { ...current, startTime: event.target.value } : current)}
                          className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-[#4b5563] dark:bg-[#11141a] dark:text-gray-100"
                          required
                        />
                      </label>
                      <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                        End time
                        <input
                          type="time"
                          value={downtimeEditor.endTime || ''}
                          min={downtimeEditor.startTime || undefined}
                          onChange={(event) => setDowntimeEditor((current) => current ? { ...current, endTime: event.target.value } : current)}
                          className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-[#4b5563] dark:bg-[#11141a] dark:text-gray-100"
                          required
                        />
                      </label>
                    </div>
                  )}

                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Reason
                    <input
                      type="text"
                      value={downtimeEditor.reason || ''}
                      onChange={(event) => setDowntimeEditor((current) => current ? { ...current, reason: event.target.value } : current)}
                      className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-[#4b5563] dark:bg-[#11141a] dark:text-gray-100"
                      placeholder="Temporary off period"
                      maxLength={200}
                      required
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-2 border-t border-gray-200 bg-gray-50 px-5 py-4 dark:border-[#363b45] dark:bg-[#11141a] sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => setConfirmingDowntimeDelete(true)}
                    disabled={Boolean(downtimeEditorBusy)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:bg-[#171a21] dark:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                  <div className="flex flex-1 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setDowntimeEditor(null);
                        setConfirmingDowntimeDelete(false);
                      }}
                      disabled={Boolean(downtimeEditorBusy)}
                      className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-[#4b5563] dark:bg-[#171a21] dark:text-gray-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={Boolean(downtimeEditorBusy)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-60"
                    >
                      {downtimeEditorBusy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save changes
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
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
