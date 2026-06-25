import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Download, Loader, ShieldCheck } from 'lucide-react';
import { useReportsData, ReportBooking, ReportUser } from '../../hooks/useReportsData';

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const today = new Date();
const defaultStart = new Date(today);
defaultStart.setDate(defaultStart.getDate() - 27);

const startOfLocalDay = (date: Date) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
};

const endOfLocalDay = (date: Date) => {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
};

const addDays = (date: Date, days: number) => {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
};

const hoursBetween = (start: Date, end: Date) =>
  Math.max(0, (end.getTime() - start.getTime()) / (60 * 60 * 1000));

const minutesSinceMidnight = (date: Date) => date.getHours() * 60 + date.getMinutes();

const getCasaAppendix6FdpLimitHours = (startTime: Date) => {
  const startMinutes = minutesSinceMidnight(startTime);
  if (startMinutes >= 5 * 60 && startMinutes < 6 * 60) return 9;
  if (startMinutes >= 6 * 60 && startMinutes < 8 * 60) return 10;
  if (startMinutes >= 8 * 60 && startMinutes < 11 * 60) return 11;
  if (startMinutes >= 11 * 60 && startMinutes < 14 * 60) return 10;
  if (startMinutes >= 14 * 60 && startMinutes < 23 * 60) return 9;
  return 8;
};

const getLatestCasaAppendix6Finish = (startTime: Date) => {
  const latest = startOfLocalDay(startTime);
  latest.setDate(latest.getDate() + 1);
  latest.setHours(1, 0, 0, 0);
  return latest;
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatDate = (date: Date) =>
  date.toLocaleDateString('en-AU', { year: 'numeric', month: '2-digit', day: '2-digit' });

const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

type DutyRow = {
  booking: ReportBooking;
  start: Date;
  end: Date;
  durationHours: number;
  aircraft: string;
  hirer: string;
};

type DailyFatigueRow = {
  date: string;
  duties: DutyRow[];
  firstStart?: Date;
  lastEnd?: Date;
  dutySpanHours: number;
  bookedHours: number;
  fdpLimitHours: number;
  latestFinish?: Date;
  status: 'ok' | 'attention';
  issues: string[];
};

const isInstructor = (user: ReportUser) =>
  user.roles?.includes('instructor') || user.roles?.includes('senior_instructor');

export const FatigueManagementExportTab: React.FC = () => {
  const { bookings, users, aircraft, loading, error } = useReportsData();
  const instructors = useMemo(() => users.filter(isInstructor), [users]);
  const [instructorId, setInstructorId] = useState('');
  const [dateRange, setDateRange] = useState({
    start: formatDateInput(defaultStart),
    end: formatDateInput(today),
  });

  const selectedInstructor = instructors.find(instructor => instructor.id === instructorId) || instructors[0];
  const effectiveInstructorId = instructorId || selectedInstructor?.id || '';

  const aircraftMap = useMemo(() => new Map(aircraft.map(item => [
    item.id,
    `${item.registration}${item.make || item.model ? ` - ${[item.make, item.model].filter(Boolean).join(' ')}` : ''}`,
  ])), [aircraft]);
  const userMap = useMemo(() => new Map(users.map(user => [user.id, user.name || user.email])), [users]);

  const report = useMemo(() => {
    if (!effectiveInstructorId || !dateRange.start || !dateRange.end) {
      return { rows: [] as DailyFatigueRow[], duties: [] as DutyRow[], issues: [] as string[] };
    }

    const rangeStart = startOfLocalDay(new Date(`${dateRange.start}T00:00:00`));
    const rangeEnd = endOfLocalDay(new Date(`${dateRange.end}T00:00:00`));
    const rollingStart = addDays(rangeStart, -364);

    const instructorBookings: DutyRow[] = bookings
      .filter(booking =>
        booking.instructor_id === effectiveInstructorId &&
        booking.status !== 'cancelled' &&
        booking.status !== 'no-show'
      )
      .map(booking => {
        const start = new Date(booking.start_time);
        const end = new Date(booking.end_time);
        return {
          booking,
          start,
          end,
          durationHours: hoursBetween(start, end),
          aircraft: aircraftMap.get(booking.aircraft_id) || booking.aircraft_id || 'Unknown aircraft',
          hirer: userMap.get(booking.student_id) || 'Guest / unknown hirer',
        };
      })
      .filter(row => row.end >= rollingStart && row.start <= rangeEnd)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const visibleDuties = instructorBookings.filter(row => row.end >= rangeStart && row.start <= rangeEnd);
    const rows: DailyFatigueRow[] = [];
    const allIssues: string[] = [];

    for (let day = new Date(rangeStart); day <= rangeEnd; day = addDays(day, 1)) {
      const dayStart = startOfLocalDay(day);
      const dayEnd = endOfLocalDay(day);
      const duties = visibleDuties.filter(row => row.start <= dayEnd && row.end >= dayStart);
      if (duties.length === 0) {
        rows.push({
          date: formatDate(dayStart),
          duties: [],
          dutySpanHours: 0,
          bookedHours: 0,
          fdpLimitHours: 0,
          status: 'ok',
          issues: [],
        });
        continue;
      }

      const firstStart = new Date(Math.min(...duties.map(row => row.start.getTime())));
      const lastEnd = new Date(Math.max(...duties.map(row => row.end.getTime())));
      const dutySpanHours = hoursBetween(firstStart, lastEnd);
      const bookedHours = duties.reduce((total, row) => total + row.durationHours, 0);
      const fdpLimitHours = getCasaAppendix6FdpLimitHours(firstStart);
      const latestFinish = getLatestCasaAppendix6Finish(firstStart);
      const issues: string[] = [];

      if (dutySpanHours > fdpLimitHours) {
        issues.push(`Daily FDP span ${dutySpanHours.toFixed(1)}h exceeds Appendix 6 limit ${fdpLimitHours}h`);
      }
      if (bookedHours > 7) {
        issues.push(`Booked flight/supervision time ${bookedHours.toFixed(1)}h exceeds 7h daily control`);
      }
      if (lastEnd > latestFinish) {
        issues.push('Duty finishes after 01:00 local time following duty start');
      }

      const sortedAll = instructorBookings.filter(row => row.end <= firstStart).sort((a, b) => b.end.getTime() - a.end.getTime());
      const previousDuty = sortedAll[0];
      if (previousDuty) {
        const restHours = hoursBetween(previousDuty.end, firstStart);
        if (restHours < 12) {
          issues.push(`Only ${restHours.toFixed(1)}h off-duty before first duty; minimum is 12h`);
        }
      }

      const rollingHours = (days: number) => {
        const start = addDays(dayStart, -(days - 1));
        return instructorBookings.reduce((total, row) => {
          if (row.end <= start || row.start > dayEnd) return total;
          const overlapStart = row.start < start ? start : row.start;
          const overlapEnd = row.end > dayEnd ? dayEnd : row.end;
          return total + hoursBetween(overlapStart, overlapEnd);
        }, 0);
      };

      const duty7 = rollingHours(7);
      if (duty7 > 60) issues.push(`Rolling 7-day CRM duty ${duty7.toFixed(1)}h exceeds 60h`);
      const duty14 = rollingHours(14);
      if (duty14 > 100) issues.push(`Rolling 14-day CRM duty ${duty14.toFixed(1)}h exceeds 100h`);
      const flight28 = rollingHours(28);
      if (flight28 > 100) issues.push(`Rolling 28-day CRM flight/supervision ${flight28.toFixed(1)}h exceeds 100h`);
      const flight365 = rollingHours(365);
      if (flight365 > 1000) issues.push(`Rolling 365-day CRM flight/supervision ${flight365.toFixed(1)}h exceeds 1000h`);

      rows.push({
        date: formatDate(dayStart),
        duties,
        firstStart,
        lastEnd,
        dutySpanHours,
        bookedHours,
        fdpLimitHours,
        latestFinish,
        status: issues.length ? 'attention' : 'ok',
        issues,
      });
      allIssues.push(...issues.map(issue => `${formatDate(dayStart)}: ${issue}`));
    }

    return { rows, duties: visibleDuties, issues: allIssues };
  }, [aircraftMap, bookings, dateRange.end, dateRange.start, effectiveInstructorId, userMap]);

  const exportCsv = () => {
    if (!selectedInstructor) return;
    const summaryRows = [
      ['Fatigue management export'],
      ['Instructor', selectedInstructor.name, selectedInstructor.email],
      ['Period', dateRange.start, dateRange.end],
      ['Generated', new Date().toLocaleString()],
      ['Basis', 'CASA CAO 48.1 Appendix 6 flight training planning checks, based on CRM-known bookings only'],
      [],
      ['Summary'],
      ['Total duty rows', report.duties.length],
      ['Days requiring attention', report.rows.filter(row => row.status === 'attention').length],
      ['Total booked flight/supervision hours', report.duties.reduce((total, row) => total + row.durationHours, 0).toFixed(1)],
      [],
      ['Daily fatigue review'],
      ['Date', 'First duty', 'Last duty', 'FDP limit hours', 'Duty span hours', 'Booked hours', 'Status', 'Issues'],
      ...report.rows.map(row => [
        row.date,
        row.firstStart ? formatTime(row.firstStart) : '',
        row.lastEnd ? formatTime(row.lastEnd) : '',
        row.fdpLimitHours || '',
        row.dutySpanHours.toFixed(1),
        row.bookedHours.toFixed(1),
        row.status === 'attention' ? 'Needs review' : 'OK',
        row.issues.join('; '),
      ]),
      [],
      ['Booking detail'],
      ['Date', 'Start', 'End', 'Duration hours', 'Aircraft', 'Hirer', 'Booking status', 'Flight logged'],
      ...report.duties.map(row => [
        formatDate(row.start),
        formatTime(row.start),
        formatTime(row.end),
        row.durationHours.toFixed(1),
        row.aircraft,
        row.hirer,
        row.booking.status,
        row.booking.flight_logged ? 'Yes' : 'No',
      ]),
      [],
      ['Limitations'],
      ['This export only includes duties recorded in the CRM. Confirm outside flying, non-flying aviation duties, commuting, standby, actual sleep opportunity, illness and instructor fitness for duty separately.'],
    ];

    const csv = summaryRows.map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fatigue-management-${selectedInstructor.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${dateRange.start}-to-${dateRange.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader className="mr-2 h-6 w-6 animate-spin text-blue-500" />
        <span className="text-gray-500">Loading fatigue report data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
        Failed to load report data: {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">Instructor</label>
            <select
              value={effectiveInstructorId}
              onChange={event => setInstructorId(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {instructors.map(instructor => (
                <option key={instructor.id} value={instructor.id}>
                  {instructor.name} ({instructor.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">From</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={event => setDateRange(current => ({ ...current, start: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">To</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={event => setDateRange(current => ({ ...current, end: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!selectedInstructor || !dateRange.start || !dateRange.end}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
        <p className="mt-3 text-xs leading-5 text-gray-500">
          This report uses CASA Appendix 6 flight-training planning limits and CRM bookings. It is a rostering aid, not a substitute for confirming outside duties and fitness for duty.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-600">
            <CalendarDays className="h-4 w-4" />
            Booked duties
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">{report.duties.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-600">
            <ShieldCheck className="h-4 w-4" />
            Booked hours
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">
            {report.duties.reduce((total, row) => total + row.durationHours, 0).toFixed(1)}
          </p>
        </div>
        <div className={`rounded-xl border p-4 shadow-sm ${report.issues.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <div className={`flex items-center gap-2 text-sm font-semibold ${report.issues.length ? 'text-amber-800' : 'text-emerald-800'}`}>
            <AlertTriangle className="h-4 w-4" />
            Review items
          </div>
          <p className={`mt-2 text-2xl font-bold ${report.issues.length ? 'text-amber-900' : 'text-emerald-900'}`}>
            {report.issues.length}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="font-semibold text-gray-900">Daily fatigue review</h3>
          <p className="mt-1 text-sm text-gray-500">Days without a CRM booking are included so the off-duty pattern is visible.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Date</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Duty window</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Hours</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {report.rows.map(row => (
                <tr key={row.date} className={row.status === 'attention' ? 'bg-amber-50/60' : ''}>
                  <td className="whitespace-nowrap px-5 py-3 text-sm font-medium text-gray-900">{row.date}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-sm text-gray-700">
                    {row.firstStart && row.lastEnd ? `${formatTime(row.firstStart)} - ${formatTime(row.lastEnd)}` : 'Off duty in CRM'}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-sm text-gray-700">
                    {row.bookedHours.toFixed(1)} booked / {row.dutySpanHours.toFixed(1)} span
                  </td>
                  <td className="whitespace-nowrap px-5 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === 'attention' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {row.status === 'attention' ? 'Needs review' : 'OK'}
                    </span>
                  </td>
                  <td className="min-w-[260px] px-5 py-3 text-sm text-gray-600">
                    {row.issues.length ? row.issues.join('; ') : row.duties.length ? 'No CRM-detected fatigue issue.' : 'No CRM duty recorded.'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
