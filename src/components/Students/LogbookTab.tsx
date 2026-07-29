import React, { useMemo, useState } from 'react';
import { ArrowUpDown, BookOpen, Clock, Download, Filter, Navigation, Search, TrendingUp, X } from 'lucide-react';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import {
  DEFAULT_LOGBOOK_FILTERS,
  filterAndSortLogbookEntries,
  getLogbookAircraftKey,
  hasActiveLogbookFilters,
  type LogbookFilterState,
} from '../../utils/logbookFilters';

interface LogbookTabProps {
  userId: string;
  userName: string;
  isInstructor: boolean;
}

export const LogbookTab: React.FC<LogbookTabProps> = ({ userId, userName, isInstructor }) => {
  const { flightLogs, loading } = useFlightLogs(userId);
  const { aircraft: aircraftList } = useAircraft();
  const { users } = useUsers();
  const [filters, setFilters] = useState<LogbookFilterState>(DEFAULT_LOGBOOK_FILTERS);

  const updateFilter = <Key extends keyof LogbookFilterState>(
    key: Key,
    value: LogbookFilterState[Key],
  ) => {
    setFilters(current => ({ ...current, [key]: value }));
  };

  const enrichedLogs = useMemo(() => {
    return flightLogs.map(log => {
      const aircraft = log.aircraft || aircraftList.find(a => a.id === log.aircraft_id);
      const student = log.student || users.find(u => u.id === log.student_id);
      const instructor = log.instructor || (log.instructor_id ? users.find(u => u.id === log.instructor_id) : null);

      const isDual = !!log.instructor_id;

      const pilotInCommand = instructor?.name || student?.name || 'Not recorded';
      const otherPilotOrCrew = isDual ? (student?.name || 'Not recorded') : '';

      const hoursAsPIC = isInstructor ? (log.solo_time || 0) : (isDual ? 0 : (log.solo_time || 0));
      const hoursInstructor = isInstructor ? (log.dual_time || 0) : 0;
      const hoursDual = !isInstructor ? (log.dual_time || 0) : 0;
      const hoursSolo = !isInstructor ? (log.solo_time || 0) : 0;

      return {
        ...log,
        aircraft,
        student,
        instructor,
        pilotInCommand,
        otherPilotOrCrew,
        hoursAsPIC,
        hoursInstructor,
        hoursDual,
        hoursSolo,
      };
    });
  }, [flightLogs, aircraftList, users, isInstructor]);

  const aircraftOptions = useMemo(() => {
    const unique = new Map<string, string>();
    for (const log of enrichedLogs) {
      const key = getLogbookAircraftKey(log);
      if (!key || !log.aircraft) continue;
      const label = [
        log.aircraft.registration,
        [log.aircraft.make, log.aircraft.model].filter(Boolean).join(' '),
      ].filter(Boolean).join(' — ');
      unique.set(key, label || key);
    }
    return [...unique.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
  }, [enrichedLogs]);

  const visibleLogs = useMemo(
    () => filterAndSortLogbookEntries(enrichedLogs, filters),
    [enrichedLogs, filters],
  );
  const filtersActive = hasActiveLogbookFilters(filters);

  const totals = useMemo(() => {
    return visibleLogs.reduce(
      (acc, log) => ({
        totalHours: acc.totalHours + (log.flight_duration || 0),
        dualHours: acc.dualHours + (log.dual_time || 0),
        soloHours: acc.soloHours + (log.solo_time || 0),
        takeoffs: acc.takeoffs + (log.takeoffs || 0),
        landings: acc.landings + (log.landings || 0),
      }),
      { totalHours: 0, dualHours: 0, soloHours: 0, takeoffs: 0, landings: 0 }
    );
  }, [visibleLogs]);

  const formatHours = (hours: number) => hours.toFixed(1);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '–';
    return new Date(dateStr).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const exportCsv = () => {
    const rows = visibleLogs.map(log => ({
      Date: formatDate(log.start_time),
      'Aircraft Type': log.aircraft ? `${log.aircraft.make} ${log.aircraft.model}` : '',
      'Aircraft Registration': log.aircraft?.registration || '',
      'Pilot in Command': log.pilotInCommand,
      'Other Pilot or Crew': log.otherPilotOrCrew,
      'Dual Hours': Number(formatHours(log.dual_time || 0)),
      'Command Hours': Number(formatHours(log.solo_time || 0)),
      Takeoffs: log.takeoffs ?? '',
      Landings: log.landings ?? '',
      Comments: log.comments || '',
    }));

    rows.push({
      Date: `Totals (${visibleLogs.length} flights)`,
      'Aircraft Type': '',
      'Aircraft Registration': '',
      'Pilot in Command': '',
      'Other Pilot or Crew': '',
      'Dual Hours': Number(formatHours(totals.dualHours)),
      'Command Hours': Number(formatHours(totals.soloHours)),
      Takeoffs: totals.takeoffs,
      Landings: totals.landings,
      Comments: '',
    });

    const headers = Object.keys(rows[0] || {});
    const escapeCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [
      headers.map(escapeCell).join(','),
      ...rows.map((row) => headers.map((header) => escapeCell(row[header as keyof typeof row])).join(',')),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${userName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'logbook'}-logbook.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="pilot-logbook space-y-4">
        <div className="animate-pulse">
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="logbook-skeleton bg-gray-200 rounded-lg h-20"></div>
            ))}
          </div>
          <div className="logbook-skeleton bg-gray-200 rounded-lg h-64"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="pilot-logbook space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="logbook-summary-card logbook-summary-card--blue bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="logbook-stat-icon p-2 bg-blue-100 rounded-lg">
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Hours</p>
              <p className="text-xl font-bold text-gray-900">{formatHours(totals.totalHours)}</p>
            </div>
          </div>
        </div>

        <div className="logbook-summary-card logbook-summary-card--green bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="logbook-stat-icon p-2 bg-green-100 rounded-lg">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {isInstructor ? 'Instructed' : 'Dual'}
              </p>
              <p className="text-xl font-bold text-gray-900">{formatHours(totals.dualHours)}</p>
            </div>
          </div>
        </div>

        <div className="logbook-summary-card logbook-summary-card--orange bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="logbook-stat-icon p-2 bg-orange-100 rounded-lg">
              <BookOpen className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{isInstructor ? 'Command' : 'Solo / PIC'}</p>
              <p className="text-xl font-bold text-gray-900">{formatHours(totals.soloHours)}</p>
            </div>
          </div>
        </div>

        <div className="logbook-summary-card logbook-summary-card--sky bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="logbook-stat-icon p-2 bg-sky-100 rounded-lg">
              <Navigation className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Landings</p>
              <p className="text-xl font-bold text-gray-900">{totals.landings}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Logbook Table */}
      <div className="logbook-panel bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="logbook-panel-header p-4 border-b border-gray-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center space-x-2">
            <BookOpen className="h-5 w-5 text-gray-600" />
            <span>Flight Logbook — {userName}</span>
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {visibleLogs.length === enrichedLogs.length
              ? `${enrichedLogs.length} entries`
              : `Showing ${visibleLogs.length} of ${enrichedLogs.length} entries`}
          </p>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={visibleLogs.length === 0}
            className="logbook-export-button inline-flex items-center justify-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        {enrichedLogs.length > 0 && (
          <div className="logbook-filters space-y-3 border-b border-gray-200 bg-gray-50/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500" aria-hidden="true" />
                <p className="text-sm font-semibold text-gray-800">Filter flights</p>
                {filtersActive && (
                  <span className="logbook-filter-count rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                    {visibleLogs.length} matching
                  </span>
                )}
              </div>
              {filtersActive && (
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_LOGBOOK_FILTERS)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Clear filters
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1 xl:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Search</span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden="true" />
                  <input
                    type="search"
                    value={filters.search}
                    onChange={event => updateFilter('search', event.target.value)}
                    placeholder="Aircraft, pilot, crew or comments"
                    className="logbook-control w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </span>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Aircraft</span>
                <select
                  value={filters.aircraftKey}
                  onChange={event => updateFilter('aircraftKey', event.target.value)}
                  className="logbook-control w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">All aircraft</option>
                  {aircraftOptions.map(option => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Flight time</span>
                <select
                  value={filters.flightMode}
                  onChange={event => updateFilter('flightMode', event.target.value as LogbookFilterState['flightMode'])}
                  className="logbook-control w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="all">All flight time</option>
                  <option value="dual">{isInstructor ? 'Instructed' : 'Dual'}</option>
                  <option value="solo">{isInstructor ? 'Command' : 'Solo / PIC'}</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">From</span>
                <input
                  type="date"
                  value={filters.dateFrom}
                  max={filters.dateTo || undefined}
                  onChange={event => updateFilter('dateFrom', event.target.value)}
                  className="logbook-control w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">To</span>
                <input
                  type="date"
                  value={filters.dateTo}
                  min={filters.dateFrom || undefined}
                  onChange={event => updateFilter('dateTo', event.target.value)}
                  className="logbook-control w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                  Sort by
                </span>
                <select
                  value={filters.sortBy}
                  onChange={event => updateFilter('sortBy', event.target.value as LogbookFilterState['sortBy'])}
                  className="logbook-control w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="date_desc">Date — newest first</option>
                  <option value="date_asc">Date — oldest first</option>
                  <option value="duration_desc">Flight time — longest first</option>
                  <option value="duration_asc">Flight time — shortest first</option>
                  <option value="aircraft_asc">Aircraft — A to Z</option>
                  <option value="aircraft_desc">Aircraft — Z to A</option>
                  <option value="pic_asc">Pilot in Command — A to Z</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {enrichedLogs.length === 0 ? (
          <div className="logbook-empty-state text-center py-16">
            <BookOpen className="logbook-empty-icon h-14 w-14 text-gray-300 mx-auto mb-4" />
            <h4 className="text-lg font-medium text-gray-900 mb-1">No logbook entries yet</h4>
            <p className="text-gray-500 text-sm">Entries will appear here after flights are logged.</p>
          </div>
        ) : visibleLogs.length === 0 ? (
          <div className="logbook-empty-state px-4 py-14 text-center">
            <Search className="logbook-empty-icon mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden="true" />
            <h4 className="text-base font-semibold text-gray-900">No flights match these filters</h4>
            <p className="mt-1 text-sm text-gray-500">Try changing the dates, aircraft or search terms.</p>
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_LOGBOOK_FILTERS)}
              className="mt-4 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="logbook-table-scroll overflow-x-auto">
            <table className="logbook-table min-w-full text-sm">
              <thead className="logbook-table-head bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Aircraft Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Registration
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Pilot in Command
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Other Pilot or Crew
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Dual (hrs)
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    {isInstructor ? 'Command (hrs)' : 'Solo (hrs)'}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    T/O
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Ldg
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Comments
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleLogs.map((log, index) => (
                  <tr
                    key={log.id}
                    className={`logbook-table-row hover:bg-gray-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                  >
                    <td className="px-4 py-3 text-gray-900 whitespace-nowrap font-medium">
                      {formatDate(log.start_time)}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {log.aircraft ? `${log.aircraft.make} ${log.aircraft.model}` : '–'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="logbook-registration inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        {log.aircraft?.registration || '–'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-900 whitespace-nowrap">
                      {log.pilotInCommand}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {log.otherPilotOrCrew}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(log.dual_time || 0) > 0 ? (
                        <span className="logbook-hours-badge logbook-hours-badge--dual inline-flex items-center justify-center w-14 py-0.5 rounded text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                          {formatHours(log.dual_time || 0)}
                        </span>
                      ) : (
                        <span className="text-gray-400">–</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(log.solo_time || 0) > 0 ? (
                        <span className="logbook-hours-badge logbook-hours-badge--solo inline-flex items-center justify-center w-14 py-0.5 rounded text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
                          {formatHours(log.solo_time || 0)}
                        </span>
                      ) : (
                        <span className="text-gray-400">–</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 font-medium">
                      {log.takeoffs ?? '–'}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 font-medium">
                      {log.landings ?? '–'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs">
                      <span className="line-clamp-2 text-sm">
                        {log.comments || '–'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals Row */}
              <tfoot className="logbook-table-footer bg-gray-100 border-t-2 border-gray-300">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-xs font-bold text-gray-700 uppercase tracking-wide">
                    Totals ({visibleLogs.length} flights)
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="logbook-hours-badge logbook-hours-badge--dual inline-flex items-center justify-center w-14 py-0.5 rounded text-xs font-bold bg-green-100 text-green-800 border border-green-300">
                      {formatHours(totals.dualHours)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="logbook-hours-badge logbook-hours-badge--solo inline-flex items-center justify-center w-14 py-0.5 rounded text-xs font-bold bg-orange-100 text-orange-800 border border-orange-300">
                      {formatHours(totals.soloHours)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-gray-800">{totals.takeoffs}</td>
                  <td className="px-4 py-3 text-center font-bold text-gray-800">{totals.landings}</td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
