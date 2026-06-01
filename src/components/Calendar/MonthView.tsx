import React, { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, isSameDay, startOfWeek, endOfWeek } from 'date-fns';
import { Booking } from '../../types';
import { Plane, User } from 'lucide-react';

interface MonthViewProps {
  currentDate: Date;
  bookings: Booking[];
  aircraft: Array<{ id: string; registration: string; make: string; model: string }>;
  instructors: Array<{ id: string; name: string }>;
  defaultAircraftId?: string;
  onDayClick: (date: Date) => void;
  weekStartsOn: 0 | 1;
  showWeekends: boolean;
  availableHours: number;
}

export const MonthView: React.FC<MonthViewProps> = ({
  currentDate,
  bookings,
  aircraft,
  instructors,
  defaultAircraftId,
  onDayClick,
  weekStartsOn,
  showWeekends,
  availableHours,
}) => {
  const [selectedResourceType, setSelectedResourceType] = useState<'aircraft' | 'instructor'>('aircraft');
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');

  React.useEffect(() => {
    if (selectedResourceId) return;

    if (selectedResourceType === 'aircraft' && aircraft.length > 0) {
      const preferredAircraft = aircraft.find(a => a.id === defaultAircraftId);
      setSelectedResourceId(preferredAircraft?.id || aircraft[0].id);
    } else if (selectedResourceType === 'instructor' && instructors.length > 0) {
      setSelectedResourceId(instructors[0].id);
    }
  }, [aircraft, defaultAircraftId, instructors, selectedResourceId, selectedResourceType]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn });

  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd })
    .filter(day => showWeekends || (day.getDay() !== 0 && day.getDay() !== 6));

  const getBookingsForDay = (date: Date): Booking[] => {
    if (!selectedResourceId) return [];

    return bookings.filter(booking => {
      if (booking.status === 'cancelled' || booking.hasConflict) return false;

      const isSameDate = isSameDay(new Date(booking.startTime), date);
      if (!isSameDate) return false;

      if (selectedResourceType === 'aircraft') {
        return booking.aircraftId === selectedResourceId;
      } else {
        return booking.instructorId === selectedResourceId;
      }
    });
  };

  const getTotalBookingDuration = (date: Date): number => {
    const dayBookings = getBookingsForDay(date);
    return dayBookings.reduce((total, booking) => {
      const start = new Date(booking.startTime);
      const end = new Date(booking.endTime);
      const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      return total + durationHours;
    }, 0);
  };

  const getAvailabilityStatus = (date: Date): 'available' | 'limited' | 'unavailable' => {
    const totalHours = getTotalBookingDuration(date);
    if (totalHours === 0) return 'available';
    if (totalHours >= availableHours) return 'unavailable';
    if (totalHours >= availableHours * 0.75) return 'limited';
    return 'available';
  };

  const getStatusColor = (status: 'available' | 'limited' | 'unavailable'): string => {
    switch (status) {
      case 'available':
        return 'bg-white hover:bg-gray-50';
      case 'limited':
        return 'bg-yellow-50 hover:bg-yellow-100';
      case 'unavailable':
        return 'bg-gray-200 hover:bg-gray-300';
    }
  };

  const weekDays = weekStartsOn === 0
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const visibleWeekDays = showWeekends ? weekDays : weekDays.filter(day => day !== 'Sat' && day !== 'Sun');
  const columnCount = showWeekends ? 7 : 5;

  return (
    <div className="p-6">
      <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Resource Type</label>
            <select
              value={selectedResourceType}
              onChange={(e) => {
                setSelectedResourceType(e.target.value as 'aircraft' | 'instructor');
                setSelectedResourceId('');
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="aircraft">Aircraft</option>
              <option value="instructor">Instructor</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {selectedResourceType === 'aircraft' ? 'Select Aircraft' : 'Select Instructor'}
            </label>
            <select
              value={selectedResourceId}
              onChange={(e) => setSelectedResourceId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select {selectedResourceType === 'aircraft' ? 'an aircraft' : 'an instructor'}</option>
              {selectedResourceType === 'aircraft'
                ? aircraft.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.registration} - {a.make} {a.model}
                    </option>
                  ))
                : instructors.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center space-x-6 text-sm">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-white border border-gray-300 rounded"></div>
            <span className="text-gray-600">Available</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-yellow-50 border border-gray-300 rounded"></div>
            <span className="text-gray-600">Limited</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-gray-200 border border-gray-300 rounded"></div>
            <span className="text-gray-600">Unavailable</span>
          </div>
        </div>
      </div>

      {!selectedResourceId ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <div className="text-gray-400 mb-4">
            {selectedResourceType === 'aircraft' ? (
              <Plane className="h-16 w-16 mx-auto mb-2" />
            ) : (
              <User className="h-16 w-16 mx-auto mb-2" />
            )}
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Resource</h3>
          <p className="text-gray-600">
            Please select {selectedResourceType === 'aircraft' ? 'an aircraft' : 'an instructor'} to view availability
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="grid bg-gray-50 border-b border-gray-200" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
            {visibleWeekDays.map(day => (
              <div
                key={day}
                className="p-3 text-center text-sm font-semibold text-gray-700 border-r border-gray-200 last:border-r-0"
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
            {calendarDays.map((day, index) => {
              const dayBookings = getBookingsForDay(day);
              const bookingCount = dayBookings.length;
              const availabilityStatus = getAvailabilityStatus(day);
              const isCurrentMonth = isSameMonth(day, currentDate);
              const isTodayDate = isToday(day);

              return (
                <div
                  key={day.toISOString()}
                  className={`
                    min-h-[100px] p-2 border-r border-b border-gray-200 cursor-pointer transition-colors
                    ${getStatusColor(availabilityStatus)}
                    ${!isCurrentMonth ? 'opacity-40' : ''}
                    ${isTodayDate ? 'ring-2 ring-blue-500 ring-inset' : ''}
                    ${(index + 1) % columnCount === 0 ? 'border-r-0' : ''}
                  `}
                  onClick={() => onDayClick(day)}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span
                      className={`text-sm font-medium ${
                        isTodayDate
                          ? 'bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center'
                          : isCurrentMonth
                          ? 'text-gray-900'
                          : 'text-gray-400'
                      }`}
                    >
                      {format(day, 'd')}
                    </span>
                    {bookingCount > 0 && (
                      <span className="bg-blue-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
                        {bookingCount}
                      </span>
                    )}
                  </div>

                  {bookingCount > 0 && (
                    <div className="space-y-1 mt-2">
                      {dayBookings.slice(0, 2).map(booking => (
                        <div
                          key={booking.id}
                          className="text-xs bg-blue-100 text-blue-800 px-1 py-0.5 rounded truncate"
                          title={`${format(new Date(booking.startTime), 'HH:mm')} - ${format(new Date(booking.endTime), 'HH:mm')}`}
                        >
                          {format(new Date(booking.startTime), 'HH:mm')}
                        </div>
                      ))}
                      {bookingCount > 2 && (
                        <div className="text-xs text-gray-600 font-medium">
                          +{bookingCount - 2} more
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
