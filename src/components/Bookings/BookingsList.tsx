import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { Booking } from '../../types';
import { Calendar, Clock, Search, SlidersHorizontal, User, MapPin, X } from 'lucide-react';
import { BookingActionMenu } from './BookingActionMenu';
import { FlightLogForm } from './FlightLogForm';
import BookingForm from './BookingForm';
import { isPastBooking } from '../../utils/timeUtils';
import toast from 'react-hot-toast';
import { useAircraft } from '../../hooks/useAircraft';
import { useStudents } from '../../hooks/useStudents';
import { useUsers } from '../../hooks/useUsers';
import { usePortalUxSettings } from '../../hooks/useSettings';

interface BookingsListProps {
  bookings: Booking[];
  onUpdateBooking?: (bookingId: string, updates: Partial<Booking>) => void;
  onDeleteBooking?: (bookingId: string) => Promise<void> | void;
  onOpenTrainingRecord?: (booking: Booking) => void;
  onApproveBooking?: (bookingId: string) => Promise<void> | void;
  onRejectBooking?: (bookingId: string) => void;
}

export const BookingsList: React.FC<BookingsListProps> = ({
  bookings,
  onUpdateBooking,
  onDeleteBooking,
  onOpenTrainingRecord,
  onApproveBooking,
  onRejectBooking
}) => {
  const { user } = useAuth();
  const { aircraft } = useAircraft();
  const { students } = useStudents();
  const { users, getInstructors } = useUsers();
  const { settings: portalSettings } = usePortalUxSettings();
  const [showFlightLogForm, setShowFlightLogForm] = React.useState(false);
  const [showEditForm, setShowEditForm] = React.useState(false);
  const [selectedBooking, setSelectedBooking] = React.useState<Booking | null>(null);
  const [showFilters, setShowFilters] = React.useState(false);
  const [filters, setFilters] = React.useState({
    search: '',
    datePreset: 'all',
    startDate: '',
    endDate: '',
    status: '',
    aircraftId: '',
    instructorId: '',
    pilotId: '',
    logState: '',
    flightMode: '',
  });

  const userBookings = user?.role === 'student' || user?.role === 'pilot'
    ? bookings.filter(b => b.studentId === user.id)
    : bookings;
  const canCancelOwnBookings = user?.role !== 'student' && user?.role !== 'pilot'
    ? true
    : portalSettings.allow_booking_cancellation;
  const isStaffUser = user?.role === 'admin' || user?.role === 'instructor' || user?.role === 'senior_instructor'
    || user?.roles?.some(role => role === 'admin' || role === 'instructor' || role === 'senior_instructor');
  const instructors = getInstructors();
  const pilotOptions = students
    .filter(student => student.role === 'student' || student.role === 'pilot')
    .sort((a, b) => a.name.localeCompare(b.name));

  const formatBookingDate = (date: Date) => {
    if (portalSettings.date_format === 'yyyy-MM-dd') return date.toISOString().slice(0, 10);
    return date.toLocaleDateString(portalSettings.date_format === 'MM/dd/yyyy' ? 'en-US' : 'en-AU');
  };

  const formatBookingTime = (date: Date) =>
    date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: portalSettings.time_format === '12h',
    });

  const getAircraftInfo = (aircraftId: string) => {
    return aircraft.find(a => a.id === aircraftId);
  };

  const getPersonName = (personId?: string) => {
    if (!personId) return '';
    return students.find(s => s.id === personId)?.name
      || users.find(u => u.id === personId)?.name
      || '';
  };

  const getDateOnly = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };

  const parseDateFilter = (value: string, endOfDay = false) => {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    if (endOfDay) date.setHours(23, 59, 59, 999);
    return date;
  };

  const resetFilters = () => {
    setFilters({
      search: '',
      datePreset: 'all',
      startDate: '',
      endDate: '',
      status: '',
      aircraftId: '',
      instructorId: '',
      pilotId: '',
      logState: '',
      flightMode: '',
    });
  };

  const setFilter = (field: keyof typeof filters, value: string) => {
    setFilters(prev => ({
      ...prev,
      [field]: value,
      ...(field === 'startDate' || field === 'endDate' ? { datePreset: 'custom' } : {}),
    }));
  };

  const matchesDatePreset = (booking: Booking) => {
    if (filters.datePreset === 'all' || filters.datePreset === 'custom') return true;

    const now = new Date();
    const todayStart = getDateOnly(now);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const weekEnd = new Date(todayStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const startTime = new Date(booking.startTime);
    const bookingDay = getDateOnly(startTime);

    if (filters.datePreset === 'today') return bookingDay.getTime() === todayStart.getTime();
    if (filters.datePreset === 'week') return startTime >= todayStart && startTime < weekEnd;
    if (filters.datePreset === 'past') return isPastBooking(booking);
    return startTime >= now || !isPastBooking(booking);
  };

  const filteredBookings = React.useMemo(() => {
    const searchTerm = filters.search.trim().toLowerCase();
    const customStart = parseDateFilter(filters.startDate);
    const customEnd = parseDateFilter(filters.endDate, true);

    return userBookings
      .filter(booking => {
        const startTime = new Date(booking.startTime);
        const aircraftInfo = getAircraftInfo(booking.aircraftId);
        const pilotName = booking.guestName || booking.hirerName || getPersonName(booking.studentId || booking.pilotId);
        const instructorName = getPersonName(booking.instructorId);
        const aircraftLabel = [aircraftInfo?.registration, aircraftInfo?.make, aircraftInfo?.model]
          .filter(Boolean)
          .join(' ');

        if (!matchesDatePreset(booking)) return false;
        if (customStart && startTime < customStart) return false;
        if (customEnd && startTime > customEnd) return false;
        if (filters.status && booking.status !== filters.status) return false;
        if (filters.aircraftId && booking.aircraftId !== filters.aircraftId) return false;
        if (filters.instructorId === 'solo' && booking.instructorId) return false;
        if (filters.instructorId && filters.instructorId !== 'solo' && booking.instructorId !== filters.instructorId) return false;
        if (filters.pilotId && (booking.studentId || booking.pilotId) !== filters.pilotId) return false;
        if (filters.logState === 'logged' && !booking.flightLog && !booking.flight_logged) return false;
        if (filters.logState === 'unlogged' && (booking.flightLog || booking.flight_logged)) return false;
        if (filters.flightMode === 'dual' && !booking.instructorId) return false;
        if (filters.flightMode === 'solo' && booking.instructorId) return false;
        if (filters.flightMode === 'waitlist' && !booking.hasConflict) return false;

        if (!searchTerm) return true;
        return [
          aircraftLabel,
          pilotName,
          instructorName,
          booking.notes,
          booking.paymentType,
          booking.status,
        ].some(value => value?.toLowerCase().includes(searchTerm));
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [userBookings, filters, aircraft, students, users]);

  const activeFilterCount = [
    filters.search,
    filters.status,
    filters.aircraftId,
    filters.instructorId,
    filters.pilotId,
    filters.logState,
    filters.flightMode,
    filters.startDate,
    filters.endDate,
    filters.datePreset !== 'all' ? filters.datePreset : '',
  ].filter(Boolean).length;

  const handleFlightLog = async (flightLogData: any) => {
    if (selectedBooking && onUpdateBooking) {
      if (selectedBooking.status === 'pending_approval' && onApproveBooking) {
        await onApproveBooking(selectedBooking.id);
      }
      
      // Update booking with flight log
      onUpdateBooking(selectedBooking.id, {
        status: 'completed',
        flightLog: {
          id: Date.now().toString(),
          ...flightLogData
        }
      });
    }
    setShowFlightLogForm(false);
    setSelectedBooking(null);
  };

  const handleEditBooking = (bookingData: any) => {
    if (selectedBooking && onUpdateBooking) {
      onUpdateBooking(selectedBooking.id, {
        startTime: new Date(`${bookingData.date}T${bookingData.startTime}`),
        endTime: new Date(`${bookingData.endDate}T${bookingData.endTime}`),
        studentId: bookingData.studentId,
        aircraftId: bookingData.aircraftId,
        instructorId: bookingData.instructorId || undefined,
        paymentType: bookingData.paymentType,
        notes: bookingData.notes,
        flightTypeId: bookingData.flightTypeId || undefined,
        isGuestBooking: bookingData.isGuestBooking || false,
        guestName: bookingData.guestName || undefined,
        guestEmail: bookingData.guestEmail || undefined,
        guestPhone: bookingData.guestPhone || undefined,
      });
      toast.success('Booking updated successfully!');
    }
    setShowEditForm(false);
    setSelectedBooking(null);
  };

  const handleDeleteBooking = async (booking: Booking) => {
    if (onDeleteBooking) {
      try {
        await Promise.resolve(onDeleteBooking(booking.id));
      } catch (error) {
        console.error('Error deleting booking from list:', error);
      }
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'pending_approval':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'pending_supervision':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'completed':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'no-show':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatPaymentType = (paymentType?: string) => {
    const normalised = (paymentType || '').trim().toLowerCase().replace(/[_-]/g, ' ');
    if (!normalised) return 'Not set';
    if (normalised === 'prepaid' || normalised === 'pre paid' || normalised === 'pre paid account') return 'Pre-paid Account';
    if (normalised === 'payg' || normalised === 'pay as you go') return 'Pay as You Go';
    if (normalised === 'account') return 'Account';
    if (normalised === 'bank transfer') return 'Bank Transfer';
    if (normalised === 'card') return 'Card';
    if (normalised === 'cash') return 'Cash';
    return normalised.replace(/\b\w/g, char => char.toUpperCase());
  };

  return (
    <div className="p-6">
      <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {user?.role === 'student' || user?.role === 'pilot' ? 'My Bookings' : 'All Bookings'}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Showing {filteredBookings.length} of {userBookings.length} bookings
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={filters.search}
              onChange={event => setFilter('search', event.target.value)}
              placeholder="Search bookings"
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:w-72"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(prev => !prev)}
            className={`inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium shadow-sm transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {[
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'Next 7 days' },
          { value: 'past', label: 'Past' },
          { value: 'all', label: 'All' },
        ].map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilters(prev => ({ ...prev, datePreset: option.value, startDate: '', endDate: '' }))}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              filters.datePreset === option.value
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {showFilters && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">From</span>
              <input
                type="date"
                value={filters.startDate}
                onChange={event => setFilter('startDate', event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">To</span>
              <input
                type="date"
                value={filters.endDate}
                onChange={event => setFilter('endDate', event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</span>
              <select
                value={filters.status}
                onChange={event => setFilter('status', event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Any status</option>
                <option value="confirmed">Confirmed</option>
                <option value="pending_approval">Pending approval</option>
                <option value="pending_supervision">Pending supervision</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="no-show">No-show</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Aircraft</span>
              <select
                value={filters.aircraftId}
                onChange={event => setFilter('aircraftId', event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Any aircraft</option>
                {aircraft.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.registration} - {item.make} {item.model}
                  </option>
                ))}
              </select>
            </label>
            {isStaffUser && (
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Pilot or student</span>
                <select
                  value={filters.pilotId}
                  onChange={event => setFilter('pilotId', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Any pilot/student</option>
                  {pilotOptions.map(student => (
                    <option key={student.id} value={student.id}>{student.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Instructor</span>
              <select
                value={filters.instructorId}
                onChange={event => setFilter('instructorId', event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Any instructor</option>
                <option value="solo">Solo / no instructor</option>
                {instructors.map(instructor => (
                  <option key={instructor.id} value={instructor.id}>{instructor.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Flight type</span>
              <select
                value={filters.flightMode}
                onChange={event => setFilter('flightMode', event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Any type</option>
                <option value="dual">Dual</option>
                <option value="solo">Solo</option>
                <option value="waitlist">Waitlisted/conflict</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Flight log</span>
              <select
                value={filters.logState}
                onChange={event => setFilter('logState', event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Any log state</option>
                <option value="logged">Logged</option>
                <option value="unlogged">Unlogged</option>
              </select>
            </label>
          </div>
          {activeFilterCount > 0 && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <X className="mr-2 h-4 w-4" />
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {filteredBookings.map(booking => {
          const aircraft = getAircraftInfo(booking.aircraftId);
          const startTime = new Date(booking.startTime);
          const endTime = new Date(booking.endTime);
          const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
          const isPast = isPastBooking(booking);

          return (
            <div key={booking.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <div
                className={`flex items-center justify-between mb-4 ${!isPast ? 'cursor-pointer' : ''}`}
                onClick={!isPast ? () => {
                  setSelectedBooking(booking);
                  setShowEditForm(true);
                } : undefined}
              >
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {aircraft?.registration} - {aircraft?.make} {aircraft?.model}
                  </h3>
                  <p className="text-sm text-gray-600">{booking.notes}</p>
                </div>
                <div className="flex items-center space-x-3">
                  <span className={`inline-flex px-3 py-1 text-xs font-medium rounded-full border ${getStatusColor(booking.status)}`}>
                    {booking.status.replaceAll('_', ' ').replace(/^./, value => value.toUpperCase())}
                  </span>
                  
                  {/* Action Menu - Always Rendered */}
                  <BookingActionMenu
                    booking={booking}
                    onEdit={() => {
                      setSelectedBooking(booking);
                      setShowEditForm(true);
                    }}
                    onDelete={() => handleDeleteBooking(booking)}
                    onLogFlight={() => {
                      setSelectedBooking(booking);
                      setShowFlightLogForm(true);
                    }}
                    onViewTrainingRecord={() => onOpenTrainingRecord && onOpenTrainingRecord(booking)}
                    onApprove={onApproveBooking ? () => onApproveBooking(booking.id) : undefined}
                    onReject={onRejectBooking ? () => onRejectBooking(booking.id) : undefined}
                    hasTrainingRecord={!!booking.flightLog}
                    canDelete={canCancelOwnBookings}
                    canApprove={user?.role === 'admin' || user?.role === 'instructor'}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">{formatBookingDate(startTime)}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">
                    {formatBookingTime(startTime)} - {formatBookingTime(endTime)}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">
                    {booking.instructorId ? 'With Instructor' : 'Solo Flight'}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">{duration.toFixed(portalSettings.flight_time_decimals)} hours</span>
                </div>
              </div>

              <div className="mt-4 flex justify-between items-center">
                <div className="text-sm">
                  <span className="text-gray-500">Payment: </span>
                  <span className="font-medium text-gray-900">{formatPaymentType(booking.paymentType)}</span>
                  {aircraft && (
                    <>
                      <span className="text-gray-500 ml-4">Est. Cost: </span>
                      <span className="font-medium text-gray-900">
                        ${(duration * aircraft.hourlyRate + (booking.instructorId ? duration * 85 : 0)).toFixed(portalSettings.currency_decimals)}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  {!isPastBooking(booking) && (
                    /* Quick Action Buttons for Future Bookings */
                    booking.status === 'confirmed' && (
                    <>
                      <button onClick={() => { setSelectedBooking(booking); setShowEditForm(true); }} className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors">
                        Modify
                      </button>
                      {canCancelOwnBookings && (
                        <button onClick={() => handleDeleteBooking(booking)} className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors">
                          Cancel
                        </button>
                      )}
                    </>
                    )
                  )}
                  {booking.status === 'completed' && !booking.flightLog && (
                    <button className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">
                      Log Flight
                    </button>
                  )}
                </div>
              </div>
              {booking.supervisingInstructorId && (
                <p className="mt-2 text-[11px] font-medium text-gray-500">Supervising senior instructor: {getPersonName(booking.supervisingInstructorId)}</p>
              )}
              {booking.supervisionRequired && booking.supervisionStatus === 'pending' && (
                <p className="mt-2 text-xs font-semibold text-orange-700">Pending — no authorised senior instructor is currently available.</p>
              )}
              {booking.membershipOverrideReason && (
                <p className="mt-2 text-[11px] font-medium text-amber-700" title={booking.membershipOverrideReason}>
                  BFC membership override recorded: {booking.membershipOverrideReason}
                </p>
              )}
              
              {booking.status === 'completed' && (
                <button 
                  onClick={() => onOpenTrainingRecord && onOpenTrainingRecord(booking)}
                  className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors mt-2"
                >
                  Submit Training Record
                </button>
              )}
            </div>
          );
        })}

        {filteredBookings.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg shadow-md border border-gray-200">
            <Calendar className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {userBookings.length === 0 ? 'No bookings found' : 'No bookings match these filters'}
            </h3>
            <p className="text-gray-600">
              {userBookings.length === 0
                ? "You don't have any bookings yet. Create your first booking to get started!"
                : 'Adjust the search or clear filters to see more bookings.'}
            </p>
          </div>
        )}
      </div>

      {/* Flight Log Form */}
      {selectedBooking && (
        <FlightLogForm
          isOpen={showFlightLogForm}
          onClose={() => {
            setShowFlightLogForm(false);
            setSelectedBooking(null);
          }}
          onSubmit={handleFlightLog}
          booking={selectedBooking}
        />
      )}

      {/* Edit Booking Form */}
      {selectedBooking && (
        <BookingForm
          isOpen={showEditForm}
          onClose={() => {
            setShowEditForm(false);
            setSelectedBooking(null);
          }}
          onSubmit={handleEditBooking}
          booking={selectedBooking}
          isEdit={true}
        />
      )}
    </div>
  );
};
