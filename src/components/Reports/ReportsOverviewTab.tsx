import React, { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle,
  Clock,
  Loader,
  Plane,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { addDays, differenceInMinutes, endOfDay, format, isWithinInterval, startOfDay } from 'date-fns';
import { useReportsData } from '../../hooks/useReportsData';

const CAPACITY_HOURS_PER_DAY = 8;

const hoursBetween = (start: string, end: string) => {
  const minutes = differenceInMinutes(new Date(end), new Date(start));
  return Math.max(0, minutes / 60);
};

const formatHours = (value: number) => value.toFixed(value >= 10 ? 0 : 1);

const statusLabel = (status: string) =>
  status
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const StatCard: React.FC<{
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  tone: string;
}> = ({ label, value, detail, icon, tone }) => (
  <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        <p className="mt-2 text-2xl font-bold text-gray-950 tabular-nums">{value}</p>
        <p className="mt-1 text-sm text-gray-500">{detail}</p>
      </div>
      <div className={`rounded-xl p-3 ${tone}`}>{icon}</div>
    </div>
  </div>
);

const ProgressBar: React.FC<{ value: number; tone?: string }> = ({ value, tone = 'bg-blue-600' }) => (
  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
    <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>
);

export const ReportsOverviewTab: React.FC = () => {
  const { flightLogs, bookings, users, aircraft, loading, error } = useReportsData();

  const data = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const weekEnd = endOfDay(addDays(now, 6));
    const monthStart = startOfDay(addDays(now, -29));

    const pilots = users.filter(user => user.roles.includes('student') || user.roles.includes('pilot'));
    const instructors = users.filter(user => user.roles.includes('instructor') || user.roles.includes('senior_instructor'));
    const serviceableAircraft = aircraft.filter(item => item.status === 'serviceable');
    const nonServiceableAircraft = aircraft.filter(item => item.status !== 'serviceable');

    const activeBookings = bookings.filter(booking => booking.status !== 'cancelled');
    const todayBookings = activeBookings.filter(booking =>
      isWithinInterval(new Date(booking.start_time), { start: todayStart, end: todayEnd })
    );
    const weekBookings = activeBookings.filter(booking =>
      isWithinInterval(new Date(booking.start_time), { start: todayStart, end: weekEnd })
    );
    const monthLogs = flightLogs.filter(log =>
      isWithinInterval(new Date(log.start_time), { start: monthStart, end: todayEnd })
    );

    const todayBookedHours = todayBookings.reduce((sum, booking) => sum + hoursBetween(booking.start_time, booking.end_time), 0);
    const weekBookedHours = weekBookings.reduce((sum, booking) => sum + hoursBetween(booking.start_time, booking.end_time), 0);
    const todayCapacityHours = serviceableAircraft.length * CAPACITY_HOURS_PER_DAY;
    const weekCapacityHours = serviceableAircraft.length * CAPACITY_HOURS_PER_DAY * 7;
    const todayUtilisation = todayCapacityHours ? (todayBookedHours / todayCapacityHours) * 100 : 0;
    const weekUtilisation = weekCapacityHours ? (weekBookedHours / weekCapacityHours) * 100 : 0;

    const activePilotIds = new Set(monthLogs.map(log => log.student_id));
    const activeInstructorIds = new Set(monthLogs.map(log => log.instructor_id).filter(Boolean));

    const pilotHours = new Map<string, number>();
    const instructorHours = new Map<string, number>();
    const aircraftHours = new Map<string, number>();
    const aircraftBookedHours = new Map<string, number>();

    monthLogs.forEach(log => {
      const total = Number(log.flight_duration) || Number(log.dual_time) + Number(log.solo_time) || 0;
      pilotHours.set(log.student_id, (pilotHours.get(log.student_id) || 0) + total);
      if (log.instructor_id) instructorHours.set(log.instructor_id, (instructorHours.get(log.instructor_id) || 0) + total);
      aircraftHours.set(log.aircraft_id, (aircraftHours.get(log.aircraft_id) || 0) + total);
    });

    weekBookings.forEach(booking => {
      aircraftBookedHours.set(booking.aircraft_id, (aircraftBookedHours.get(booking.aircraft_id) || 0) + hoursBetween(booking.start_time, booking.end_time));
    });

    const usersById = new Map(users.map(user => [user.id, user]));
    const aircraftById = new Map(aircraft.map(item => [item.id, item]));

    const topPilots = Array.from(pilotHours.entries())
      .map(([id, hours]) => ({ id, name: usersById.get(id)?.name || 'Unknown pilot', hours }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 5);

    const topInstructors = Array.from(instructorHours.entries())
      .map(([id, hours]) => ({ id, name: usersById.get(id)?.name || 'Unknown instructor', hours }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 5);

    const aircraftUsage = aircraft
      .map(item => {
        const booked = aircraftBookedHours.get(item.id) || 0;
        const capacity = item.status === 'serviceable' ? CAPACITY_HOURS_PER_DAY * 7 : 0;
        return {
          id: item.id,
          registration: item.registration,
          label: `${item.make} ${item.model}`.trim(),
          status: item.status,
          loggedHours: aircraftHours.get(item.id) || 0,
          bookedHours: booked,
          availability: Math.max(0, capacity - booked),
          utilisation: capacity ? (booked / capacity) * 100 : 0,
        };
      })
      .sort((a, b) => b.bookedHours - a.bookedHours);

    const aircraftNeedingAttention = nonServiceableAircraft.slice(0, 4);
    const pendingBookings = bookings.filter(booking => booking.status === 'pending_approval').length;
    const unloggedPastBookings = bookings.filter(booking =>
      booking.status !== 'cancelled' && !booking.flight_logged && new Date(booking.end_time) < now
    ).length;

    return {
      pilots,
      instructors,
      serviceableAircraft,
      nonServiceableAircraft,
      activePilotIds,
      activeInstructorIds,
      todayBookings,
      weekBookings,
      todayBookedHours,
      weekBookedHours,
      todayCapacityHours,
      weekCapacityHours,
      todayUtilisation,
      weekUtilisation,
      topPilots,
      topInstructors,
      aircraftUsage,
      aircraftNeedingAttention,
      pendingBookings,
      unloggedPastBookings,
    };
  }, [aircraft, bookings, flightLogs, users]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-gray-200 bg-white">
        <Loader className="mr-2 h-6 w-6 animate-spin text-blue-600" />
        <span className="text-sm text-gray-500">Loading reports overview...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load report data: {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pilots & Students"
          value={`${data.activePilotIds.size}/${data.pilots.length}`}
          detail="Active in the last 30 days"
          icon={<Users className="h-5 w-5 text-blue-700" />}
          tone="bg-blue-50"
        />
        <StatCard
          label="Instructors"
          value={`${data.activeInstructorIds.size}/${data.instructors.length}`}
          detail="Logged instructing in the last 30 days"
          icon={<UserCheck className="h-5 w-5 text-emerald-700" />}
          tone="bg-emerald-50"
        />
        <StatCard
          label="Aircraft Available"
          value={`${data.serviceableAircraft.length}/${data.serviceableAircraft.length + data.nonServiceableAircraft.length}`}
          detail={data.nonServiceableAircraft.length ? `${data.nonServiceableAircraft.length} not serviceable` : 'All aircraft serviceable'}
          icon={<Plane className="h-5 w-5 text-sky-700" />}
          tone="bg-sky-50"
        />
        <StatCard
          label="Open Ops Items"
          value={data.pendingBookings + data.unloggedPastBookings}
          detail={`${data.pendingBookings} pending, ${data.unloggedPastBookings} unlogged`}
          icon={<AlertTriangle className="h-5 w-5 text-amber-700" />}
          tone="bg-amber-50"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <CalendarDays className="h-4 w-4 text-blue-600" />
                Booking Capacity
              </div>
              <p className="mt-1 text-sm text-gray-500">Based on serviceable aircraft and an 8 hour operating day.</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2 text-right text-xs text-gray-500">
              <span className="font-semibold text-gray-900">{format(new Date(), 'EEE d MMM')}</span>
              <br />
              Today snapshot
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">Today</p>
                <p className="text-sm font-bold text-gray-950">{data.todayUtilisation.toFixed(0)}%</p>
              </div>
              <div className="mt-3">
                <ProgressBar value={data.todayUtilisation} tone="bg-blue-600" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <p className="font-bold text-gray-950">{data.todayBookings.length}</p>
                  <p className="text-gray-500">Bookings</p>
                </div>
                <div>
                  <p className="font-bold text-gray-950">{formatHours(data.todayBookedHours)}</p>
                  <p className="text-gray-500">Booked hrs</p>
                </div>
                <div>
                  <p className="font-bold text-gray-950">{formatHours(Math.max(0, data.todayCapacityHours - data.todayBookedHours))}</p>
                  <p className="text-gray-500">Free hrs</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">Next 7 days</p>
                <p className="text-sm font-bold text-gray-950">{data.weekUtilisation.toFixed(0)}%</p>
              </div>
              <div className="mt-3">
                <ProgressBar value={data.weekUtilisation} tone="bg-emerald-600" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <p className="font-bold text-gray-950">{data.weekBookings.length}</p>
                  <p className="text-gray-500">Bookings</p>
                </div>
                <div>
                  <p className="font-bold text-gray-950">{formatHours(data.weekBookedHours)}</p>
                  <p className="text-gray-500">Booked hrs</p>
                </div>
                <div>
                  <p className="font-bold text-gray-950">{formatHours(Math.max(0, data.weekCapacityHours - data.weekBookedHours))}</p>
                  <p className="text-gray-500">Free hrs</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Activity className="h-4 w-4 text-amber-600" />
            Availability Watch
          </div>
          <div className="mt-4 space-y-3">
            {data.aircraftNeedingAttention.length > 0 ? (
              data.aircraftNeedingAttention.map(item => (
                <div key={item.id} className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-red-950">{item.registration}</p>
                    <p className="text-xs text-red-700">{statusLabel(item.status)}</p>
                  </div>
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-green-100 bg-green-50 p-4 text-center">
                <CheckCircle className="mx-auto h-7 w-7 text-green-600" />
                <p className="mt-2 text-sm font-semibold text-green-950">All aircraft serviceable</p>
                <p className="text-xs text-green-700">No aircraft availability blockers recorded.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <TrendingUp className="h-4 w-4 text-blue-600" />
            Busiest Pilots
          </div>
          <div className="mt-4 space-y-3">
            {data.topPilots.length ? data.topPilots.map((pilot, index) => (
              <div key={pilot.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{index + 1}. {pilot.name}</p>
                  <ProgressBar value={(pilot.hours / Math.max(data.topPilots[0].hours, 1)) * 100} />
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums text-gray-950">{formatHours(pilot.hours)} h</p>
              </div>
            )) : <p className="text-sm text-gray-500">No pilot hours logged in the last 30 days.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Clock className="h-4 w-4 text-emerald-600" />
            Instructor Load
          </div>
          <div className="mt-4 space-y-3">
            {data.topInstructors.length ? data.topInstructors.map((instructor, index) => (
              <div key={instructor.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{index + 1}. {instructor.name}</p>
                  <ProgressBar value={(instructor.hours / Math.max(data.topInstructors[0].hours, 1)) * 100} tone="bg-emerald-600" />
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums text-gray-950">{formatHours(instructor.hours)} h</p>
              </div>
            )) : <p className="text-sm text-gray-500">No instructor hours logged in the last 30 days.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Plane className="h-4 w-4 text-sky-600" />
            Aircraft Usage
          </div>
          <div className="mt-4 space-y-3">
            {data.aircraftUsage.slice(0, 5).map(item => (
              <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{item.registration}</p>
                    <p className="truncate text-xs text-gray-500">{item.label || statusLabel(item.status)}</p>
                  </div>
                  <p className="text-sm font-bold tabular-nums text-gray-950">{item.utilisation.toFixed(0)}%</p>
                </div>
                <div className="mt-2">
                  <ProgressBar value={item.utilisation} tone={item.status === 'serviceable' ? 'bg-sky-600' : 'bg-red-500'} />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {formatHours(item.bookedHours)} booked hrs next 7 days, {formatHours(item.availability)} free
                </p>
              </div>
            ))}
            {data.aircraftUsage.length === 0 && <p className="text-sm text-gray-500">No aircraft records found.</p>}
          </div>
        </section>
      </div>
    </div>
  );
};
