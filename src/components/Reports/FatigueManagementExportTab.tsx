import { SearchableSelect } from '../common/SearchableSelect';
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CalendarDays, FileSpreadsheet, FileText, Loader, ShieldCheck, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { useReportsData, ReportUser } from '../../hooks/useReportsData';
import { supabase } from '../../lib/supabase';
import { useBookingRulesSettings } from '../../hooks/useSettings';
import { downloadDutyTimeReportPdf } from '../../utils/dutyTimeReportPdf';
import {
  buildDutyTrendSeries,
  calculateDutyTimeSummary,
  dutyReportFilename,
  type DutyTimeDay,
  type DutyTimePeriod,
  type DutyTrendPoint,
} from '../../utils/dutyTimeReport';

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

type DutyRecordRow = {
  id: string;
  actual_start?: string | null;
  planned_start?: string | null;
  actual_end?: string | null;
  planned_end?: string | null;
  status: string;
  flight_minutes?: number | null;
  location?: string | null;
  is_external?: boolean;
  duty_breaks?: Array<{ id: string }>;
};

const isInstructor = (user: ReportUser) =>
  user.roles?.includes('instructor') || user.roles?.includes('senior_instructor');

const DutyTrendPreview: React.FC<{ points: DutyTrendPoint[] }> = ({ points }) => {
  const chartPoints = points.length > 48 ? points.slice(-48) : points;
  const maxHours = Math.max(10, ...chartPoints.flatMap(point => [point.dutyHours, point.flightHours]));
  const maxRolling = Math.max(60, ...chartPoints.map(point => point.rolling7DutyHours));
  const chartWidth = 720;
  const chartHeight = 150;
  const plotTop = 12;
  const plotBottom = 126;
  const plotHeight = plotBottom - plotTop;
  const groupWidth = chartWidth / Math.max(1, chartPoints.length);
  const linePath = chartPoints.map((point, index) => {
    const x = groupWidth * index + groupWidth / 2;
    const y = plotBottom - (point.rolling7DutyHours / maxRolling) * plotHeight;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  if (!points.length) {
    return <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">No duty data to graph for this period.</div>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">{points[0]?.rangeLabel.includes(' - ') ? 'Weekly' : 'Daily'} duty profile</h4>
            <p className="text-xs text-gray-500">Duty and flight/supervision hours shown separately</p>
          </div>
          <div className="flex shrink-0 gap-3 text-[11px] text-gray-600">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />Duty</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-cyan-500" />Flight</span>
          </div>
        </div>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-40 w-full" role="img" aria-label="Duty and flight hours trend">
          {[0, 0.5, 1].map(value => (
            <g key={value}>
              <line x1="0" x2={chartWidth} y1={plotBottom - value * plotHeight} y2={plotBottom - value * plotHeight} stroke="#e5e7eb" strokeWidth="1" />
              <text x="2" y={plotBottom - value * plotHeight - 4} fill="#6b7280" fontSize="9">{(maxHours * value).toFixed(0)}h</text>
            </g>
          ))}
          {chartPoints.map((point, index) => {
            const centre = groupWidth * index + groupWidth / 2;
            const barWidth = Math.max(2, Math.min(9, groupWidth * 0.32));
            const dutyHeight = (point.dutyHours / maxHours) * plotHeight;
            const flightHeight = (point.flightHours / maxHours) * plotHeight;
            return (
              <g key={`${point.rangeLabel}-${index}`}>
                <title>{`${point.rangeLabel}: ${point.dutyHours.toFixed(1)}h duty, ${point.flightHours.toFixed(1)}h flight/supervision`}</title>
                <rect x={centre - barWidth - 1} y={plotBottom - dutyHeight} width={barWidth} height={dutyHeight} rx="1" fill="#2563eb" />
                <rect x={centre + 1} y={plotBottom - flightHeight} width={barWidth} height={flightHeight} rx="1" fill="#06b6d4" />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-gray-900">Rolling 7-day duty</h4>
          <p className="text-xs text-gray-500">Recorded duty against the 60-hour planning limit</p>
        </div>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-40 w-full" role="img" aria-label="Rolling 7-day duty hours trend">
          {[0, 30, 60].map(value => {
            const y = plotBottom - (value / maxRolling) * plotHeight;
            return (
              <g key={value}>
                <line x1="0" x2={chartWidth} y1={y} y2={y} stroke={value === 60 ? '#dc2626' : '#e5e7eb'} strokeWidth={value === 60 ? 2 : 1} strokeDasharray={value === 60 ? '6 4' : undefined} />
                <text x="2" y={y - 4} fill={value === 60 ? '#dc2626' : '#6b7280'} fontSize="9">{value}h</text>
              </g>
            );
          })}
          <path d={linePath} fill="none" stroke="#059669" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          {chartPoints.filter((_, index) => chartPoints.length < 20 || index % 3 === 0).map((point, filteredIndex) => {
            const originalIndex = chartPoints.indexOf(point);
            const x = groupWidth * originalIndex + groupWidth / 2;
            const y = plotBottom - (point.rolling7DutyHours / maxRolling) * plotHeight;
            return <circle key={`${point.rangeLabel}-${filteredIndex}`} cx={x} cy={y} r="3" fill={point.rolling7DutyHours > 60 ? '#dc2626' : '#059669'} />;
          })}
        </svg>
      </div>
    </div>
  );
};

export const FatigueManagementExportTab: React.FC = () => {
  const { users, loading, error } = useReportsData();
  const { settings: bookingRules } = useBookingRulesSettings();
  const [dutyRecords, setDutyRecords] = useState<DutyRecordRow[]>([]);
  const [dutyLoading, setDutyLoading] = useState(false);
  const [dutyLoadError, setDutyLoadError] = useState('');
  const [pdfExporting, setPdfExporting] = useState(false);
  const instructors = useMemo(() => users.filter(isInstructor), [users]);
  const [instructorId, setInstructorId] = useState('');
  const [dateRange, setDateRange] = useState({
    start: formatDateInput(defaultStart),
    end: formatDateInput(today),
  });

  const selectedInstructor = instructors.find(instructor => instructor.id === instructorId) || instructors[0];
  const effectiveInstructorId = instructorId || selectedInstructor?.id || '';

  useEffect(() => {
    if (!effectiveInstructorId || !dateRange.start || !dateRange.end || dateRange.start > dateRange.end) {
      setDutyRecords([]);
      setDutyLoadError('');
      return;
    }
    let cancelled = false;
    const loadDuty = async () => {
      setDutyLoading(true);
      setDutyLoadError('');
      try {
        const rollingStart = addDays(new Date(`${dateRange.start}T00:00:00`), -364);
        const { data, error: dutyError } = await supabase.from('duty_periods').select('*,duty_breaks(id)').eq('instructor_id', effectiveInstructorId).gte('duty_date', formatDateInput(rollingStart)).lte('duty_date', dateRange.end).in('status', ['active', 'completed']).order('duty_date');
        if (dutyError) throw dutyError;
        if (!cancelled) setDutyRecords(data || []);
      } catch (loadError) {
        console.error('Failed to load duty report records', loadError);
        if (!cancelled) {
          setDutyRecords([]);
          setDutyLoadError(loadError instanceof Error ? loadError.message : 'The duty records could not be loaded.');
        }
      } finally {
        if (!cancelled) setDutyLoading(false);
      }
    };
    void loadDuty();
    return () => {
      cancelled = true;
    };
  }, [dateRange.end, dateRange.start, effectiveInstructorId]);

  const report = useMemo(() => {
    if (!effectiveInstructorId || !dateRange.start || !dateRange.end) {
      return { rows: [] as DutyTimeDay[], duties: [] as DutyTimePeriod[], issues: [] as string[] };
    }

    const rangeStart = startOfLocalDay(new Date(`${dateRange.start}T00:00:00`));
    const rangeEnd = endOfLocalDay(new Date(`${dateRange.end}T00:00:00`));
    const rollingStart = addDays(rangeStart, -364);

    const instructorBookings: DutyTimePeriod[] = dutyRecords
      .map(record => {
        const startValue = record.actual_start || record.planned_start;
        const endValue = record.actual_end || record.planned_end;
        if (!startValue || !endValue) return null;
        const start = new Date(startValue);
        const end = new Date(endValue);
        return {
          id: record.id,
          status: record.status,
          start,
          end,
          durationHours: hoursBetween(start, end),
          flightHours: Number(record.flight_minutes || 0) / 60,
          location: record.location || 'Bendigo',
          isExternal: Boolean(record.is_external),
          breakCount: record.duty_breaks?.length || 0,
        };
      })
      .filter(Boolean) as DutyTimePeriod[];
    const filteredInstructorBookings = instructorBookings
      .filter(row => row.end >= rollingStart && row.start <= rangeEnd)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const visibleDuties = filteredInstructorBookings.filter(row => row.end >= rangeStart && row.start <= rangeEnd);
    const rows: DutyTimeDay[] = [];
    const allIssues: string[] = [];

    for (let day = new Date(rangeStart); day <= rangeEnd; day = addDays(day, 1)) {
      const dayStart = startOfLocalDay(day);
      const dayEnd = endOfLocalDay(day);
      const duties = visibleDuties.filter(row => row.start <= dayEnd && row.end >= dayStart);
      const rollingHours = (days: number) => {
        const start = addDays(dayStart, -(days - 1));
        return filteredInstructorBookings.reduce((total, row) => {
          if (row.end <= start || row.start > dayEnd) return total;
          const overlapStart = row.start < start ? start : row.start;
          const overlapEnd = row.end > dayEnd ? dayEnd : row.end;
          return total + hoursBetween(overlapStart, overlapEnd);
        }, 0);
      };
      const duty7 = rollingHours(7);
      const duty14 = rollingHours(14);
      const flight28Start = addDays(dayStart, -27);
      const flight28 = filteredInstructorBookings.filter(row => row.end > flight28Start && row.start <= dayEnd).reduce((total, row) => total + row.flightHours, 0);
      const flight365Start = addDays(dayStart, -364);
      const flight365 = filteredInstructorBookings.filter(row => row.end > flight365Start && row.start <= dayEnd).reduce((total, row) => total + row.flightHours, 0);
      if (duties.length === 0) {
        rows.push({
          date: formatDate(dayStart),
          dateKey: formatDateInput(dayStart),
          duties: [],
          dutySpanHours: 0,
          bookedHours: 0,
          fdpLimitHours: 0,
          rolling7DutyHours: duty7,
          rolling14DutyHours: duty14,
          rolling28FlightHours: flight28,
          rolling365FlightHours: flight365,
          status: 'ok',
          issues: [],
        });
        continue;
      }

      const firstStart = new Date(Math.min(...duties.map(row => row.start.getTime())));
      const lastEnd = new Date(Math.max(...duties.map(row => row.end.getTime())));
      const dutySpanHours = hoursBetween(firstStart, lastEnd);
      const bookedHours = duties.reduce((total, row) => total + row.flightHours, 0);
      const fdpLimitHours = getCasaAppendix6FdpLimitHours(firstStart);
      const latestFinish = getLatestCasaAppendix6Finish(firstStart);
      const issues: string[] = [];
      let restBeforeHours: number | undefined;

      if (dutySpanHours > fdpLimitHours) {
        issues.push(`Daily FDP span ${dutySpanHours.toFixed(1)}h exceeds Appendix 6 limit ${fdpLimitHours}h`);
      }
      if (bookedHours > Number(bookingRules?.fatigue_max_flight_hours_per_day || 7)) {
        issues.push(`Recorded flight time ${bookedHours.toFixed(1)}h exceeds ${bookingRules?.fatigue_max_flight_hours_per_day || 7}h daily control`);
      }
      if (lastEnd > latestFinish) {
        issues.push('Duty finishes after 01:00 local time following duty start');
      }

      const sortedAll = filteredInstructorBookings.filter(row => row.end <= firstStart).sort((a, b) => b.end.getTime() - a.end.getTime());
      const previousDuty = sortedAll[0];
      if (previousDuty) {
        const restHours = hoursBetween(previousDuty.end, firstStart);
        restBeforeHours = restHours;
        const minimumRest = Number(bookingRules?.fatigue_min_rest_hours || 12);
        if (restHours < minimumRest) {
          issues.push(`Only ${restHours.toFixed(1)}h off-duty before first duty; minimum is ${minimumRest}h`);
        }
      }

      if (duty7 > 60) issues.push(`Rolling 7-day CRM duty ${duty7.toFixed(1)}h exceeds 60h`);
      if (duty14 > 100) issues.push(`Rolling 14-day CRM duty ${duty14.toFixed(1)}h exceeds 100h`);
      if (flight28 > 100) issues.push(`Rolling 28-day CRM flight/supervision ${flight28.toFixed(1)}h exceeds 100h`);
      if (flight365 > 1000) issues.push(`Rolling 365-day CRM flight/supervision ${flight365.toFixed(1)}h exceeds 1000h`);

      rows.push({
        date: formatDate(dayStart),
        dateKey: formatDateInput(dayStart),
        duties,
        firstStart,
        lastEnd,
        dutySpanHours,
        bookedHours,
        fdpLimitHours,
        latestFinish,
        restBeforeHours,
        rolling7DutyHours: duty7,
        rolling14DutyHours: duty14,
        rolling28FlightHours: flight28,
        rolling365FlightHours: flight365,
        status: issues.length ? 'attention' : 'ok',
        issues,
      });
      allIssues.push(...issues.map(issue => `${formatDate(dayStart)}: ${issue}`));
    }

    return { rows, duties: visibleDuties, issues: allIssues };
  }, [bookingRules?.fatigue_max_flight_hours_per_day, bookingRules?.fatigue_min_rest_hours, dateRange.end, dateRange.start, dutyRecords, effectiveInstructorId]);

  const summary = useMemo(() => calculateDutyTimeSummary(report.duties, report.rows), [report.duties, report.rows]);
  const trend = useMemo(() => buildDutyTrendSeries(report.rows), [report.rows]);
  const validRange = Boolean(dateRange.start && dateRange.end && dateRange.start <= dateRange.end);

  const exportPdf = async () => {
    if (!selectedInstructor || !validRange) return;
    setPdfExporting(true);
    try {
      await downloadDutyTimeReportPdf({
        instructor: { name: selectedInstructor.name, email: selectedInstructor.email },
        period: dateRange,
        rows: report.rows,
        duties: report.duties,
        maxDailyFlightHours: Number(bookingRules?.fatigue_max_flight_hours_per_day || 7),
        minimumRestHours: Number(bookingRules?.fatigue_min_rest_hours || 12),
      });
      toast.success('Duty time PDF downloaded');
    } catch (pdfError) {
      console.error('Failed to export duty time PDF', pdfError);
      toast.error(pdfError instanceof Error ? pdfError.message : 'Failed to export duty time PDF');
    } finally {
      setPdfExporting(false);
    }
  };

  const exportCsv = () => {
    if (!selectedInstructor) return;
    const summaryRows = [
      ['Fatigue management export'],
      ['Instructor', selectedInstructor.name, selectedInstructor.email],
      ['Period', dateRange.start, dateRange.end],
      ['Generated', new Date().toLocaleString()],
      ['Basis', 'CASA CAO 48.1 Appendix 6 flight training planning checks, based on recorded Duty periods'],
      [],
      ['Summary'],
      ['Total recorded duty periods', report.duties.length],
      ['Total recorded duty hours', summary.totalDutyHours.toFixed(1)],
      ['Active duty days', summary.activeDays],
      ['Days requiring attention', report.rows.filter(row => row.status === 'attention').length],
      ['Total recorded flight/supervision hours', summary.totalFlightHours.toFixed(1)],
      ['Average duty period hours', summary.averageDutyHours.toFixed(1)],
      ['Longest duty period hours', summary.longestDutyHours.toFixed(1)],
      ['External duty hours', summary.externalDutyHours.toFixed(1)],
      [],
      ['Daily fatigue review'],
      ['Date', 'First duty', 'Last duty', 'FDP limit hours', 'Duty span hours', 'Recorded flight/supervision hours', 'Rest before hours', 'Rolling 7 duty hours', 'Rolling 14 duty hours', 'Rolling 28 flight hours', 'Rolling 365 flight hours', 'Status', 'Issues'],
      ...report.rows.map(row => [
        row.date,
        row.firstStart ? formatTime(row.firstStart) : '',
        row.lastEnd ? formatTime(row.lastEnd) : '',
        row.fdpLimitHours || '',
        row.dutySpanHours.toFixed(1),
        row.bookedHours.toFixed(1),
        row.restBeforeHours?.toFixed(1) || '',
        row.rolling7DutyHours.toFixed(1),
        row.rolling14DutyHours.toFixed(1),
        row.rolling28FlightHours.toFixed(1),
        row.rolling365FlightHours.toFixed(1),
        row.status === 'attention' ? 'Needs review' : 'OK',
        row.issues.join('; '),
      ]),
      [],
      ['Duty-period detail'],
      ['Date', 'Start', 'End', 'Duty hours', 'Flight hours', 'Location', 'External duty', 'Breaks', 'Status'],
      ...report.duties.map(row => [
        formatDate(row.start),
        formatTime(row.start),
        formatTime(row.end),
        row.durationHours.toFixed(1),
        row.flightHours.toFixed(1),
        row.location,
        row.isExternal ? 'Yes' : 'No',
        row.breakCount,
        row.status,
      ]),
      [],
      ['Limitations'],
      ['This export uses completed or active Duty records, including external duty entered in the portal. Confirm that all relevant external and non-flying duty has been entered before relying on the report.'],
    ];

    const csv = summaryRows.map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dutyReportFilename(selectedInstructor.name, dateRange.start, dateRange.end, 'csv');
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  if (loading || dutyLoading) {
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

  if (!instructors.length) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-8 w-8 text-gray-400" />
        <h3 className="mt-3 font-semibold text-gray-900">No instructors available</h3>
        <p className="mt-1 text-sm text-gray-500">Add an instructor or senior instructor before creating a duty time report.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">Instructor</label>
            <SearchableSelect
              value={effectiveInstructorId}
              onChange={event => setInstructorId(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {instructors.map(instructor => (
                <option key={instructor.id} value={instructor.id}>
                  {instructor.name} ({instructor.email})
                </option>
              ))}
            </SearchableSelect>
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
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void exportPdf()}
              disabled={!selectedInstructor || !validRange || Boolean(dutyLoadError) || pdfExporting}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pdfExporting ? <Loader className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {pdfExporting ? 'Building PDF...' : 'Export visual PDF'}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!selectedInstructor || !validRange || Boolean(dutyLoadError)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export data CSV
            </button>
          </div>
        </div>
        {!validRange && dateRange.start && dateRange.end && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">The From date must be on or before the To date.</p>
        )}
        <p className="mt-3 text-xs leading-5 text-gray-500">
          The PDF includes a management dashboard, graphs, exception register, daily review, full duty log and plain-language definitions. The CSV contains the underlying data for filtering and independent checks. Both use CASA Appendix 6 flight-training planning limits and actual records from the Duty tab.
        </p>
      </div>

      {dutyLoadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Duty records could not be loaded</p>
          <p className="mt-1">{dutyLoadError}</p>
          <p className="mt-1 text-red-700">Exports are unavailable until the report data loads successfully.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-600">
            <CalendarDays className="h-4 w-4" />
            Duty periods
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">{summary.periodCount}</p>
          <p className="mt-1 text-xs text-gray-500">Across {summary.activeDays} active days</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-600">
            <TrendingUp className="h-4 w-4" />
            Total duty hours
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">{summary.totalDutyHours.toFixed(1)}</p>
          <p className="mt-1 text-xs text-gray-500">Average {summary.averageDutyHours.toFixed(1)}h per period</p>
        </div>
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-800">
            <ShieldCheck className="h-4 w-4" />
            Flight / supervision
          </div>
          <p className="mt-2 text-2xl font-bold text-cyan-950">{summary.totalFlightHours.toFixed(1)}</p>
          <p className="mt-1 text-xs text-cyan-700">Separate from total duty time</p>
        </div>
        <div className={`rounded-xl border p-4 shadow-sm ${report.issues.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <div className={`flex items-center gap-2 text-sm font-semibold ${report.issues.length ? 'text-amber-800' : 'text-emerald-800'}`}>
            <AlertTriangle className="h-4 w-4" />
            Days to review
          </div>
          <p className={`mt-2 text-2xl font-bold ${report.issues.length ? 'text-amber-900' : 'text-emerald-900'}`}>
            {summary.attentionDays}
          </p>
          <p className={`mt-1 text-xs ${report.issues.length ? 'text-amber-700' : 'text-emerald-700'}`}>
            {summary.compliancePercent == null ? 'No active duty in range' : `${summary.compliancePercent}% of active days clear`}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-600" />
          <div>
            <h3 className="font-semibold text-gray-900">Duty trends</h3>
            <p className="text-sm text-gray-500">Long ranges automatically group into weeks so the report stays readable.</p>
          </div>
        </div>
        <DutyTrendPreview points={trend} />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="font-semibold text-gray-900">Daily fatigue review</h3>
          <p className="mt-1 text-sm text-gray-500">Days without a Duty record remain visible on screen and in CSV; the visual PDF omits them from its table while retaining them in rolling graphs.</p>
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
                    {row.bookedHours.toFixed(1)} flight / {row.dutySpanHours.toFixed(1)} duty
                  </td>
                  <td className="whitespace-nowrap px-5 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === 'attention' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {row.status === 'attention' ? 'Needs review' : 'OK'}
                    </span>
                  </td>
                  <td className="min-w-[260px] px-5 py-3 text-sm text-gray-600">
                    {row.issues.length ? row.issues.join('; ') : row.duties.length ? 'No recorded-duty fatigue issue.' : 'No Duty record entered.'}
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
