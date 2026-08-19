import { SearchableSelect } from '../common/SearchableSelect';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  BookOpen,
  Check,
  Clock,
  Download,
  ExternalLink,
  Filter,
  Navigation,
  Pencil,
  RefreshCw,
  Save,
  Search,
  TrendingUp,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { useLogbookDetails } from '../../hooks/useLogbookDetails';
import { useExternalLogbook } from '../../hooks/useExternalLogbook';
import {
  ExternalLogbookDialog,
  type ExternalLogbookEditorState,
} from './ExternalLogbookPanel';
import {
  DEFAULT_LOGBOOK_FILTERS,
  filterAndSortLogbookEntries,
  getLogbookAircraftKey,
  hasActiveLogbookFilters,
  type LogbookFilterState,
} from '../../utils/logbookFilters';
import {
  buildLogbookLessonDestination,
  calculateLogbookRoleHours,
  toLogbookDateKey,
} from '../../utils/logbookEntries';
import {
  calculateLifetimeLogbookTotals,
  isIncludedInLogbookBaseline,
} from '../../utils/externalLogbook';

interface LogbookTabProps {
  userId: string;
  userName: string;
  isInstructor: boolean;
}

interface NotesEditorProps {
  flightLogId: string;
  savedValue: string;
  onSave: (flightLogId: string, note: string) => Promise<void>;
  compact?: boolean;
}

const NotesEditor: React.FC<NotesEditorProps> = ({ flightLogId, savedValue, onSave, compact = false }) => {
  const [draft, setDraft] = useState(savedValue);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setDraft(savedValue);
    setStatus('idle');
  }, [savedValue]);

  const dirty = draft.trim() !== savedValue.trim();

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setStatus('idle');
    try {
      await onSave(flightLogId, draft);
      setDraft(draft.trim());
      setStatus('saved');
    } catch (error) {
      console.error('Could not save logbook note:', error);
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={compact ? 'min-w-0' : 'min-w-56'}>
      <div className="flex items-start gap-2">
        <textarea
          value={draft}
          onChange={event => {
            setDraft(event.target.value);
            setStatus('idle');
          }}
          maxLength={2000}
          rows={compact ? 2 : 2}
          placeholder="Add a logbook note"
          aria-label="Logbook note"
          className="logbook-note-input min-h-16 w-full resize-y rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          aria-label="Save logbook note"
          title="Save note"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <div className="mt-1 min-h-4 text-xs" aria-live="polite">
        {status === 'saved' && (
          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
            <Check className="h-3 w-3" aria-hidden="true" /> Saved
          </span>
        )}
        {status === 'error' && <span className="font-medium text-red-700">Could not save. Please retry.</span>}
        {status === 'idle' && dirty && <span className="text-amber-700">Unsaved change</span>}
        {status === 'idle' && !dirty && savedValue && <span className="text-gray-400">Visible to authorised staff</span>}
      </div>
    </div>
  );
};

const ReadOnlyNote: React.FC<{ value: string }> = ({ value }) => (
  <p className="max-w-sm whitespace-pre-wrap text-sm leading-5 text-gray-700">
    {value || <span className="text-gray-400">—</span>}
  </p>
);

const linkClass = 'rounded-sm font-semibold text-blue-700 no-underline transition hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:text-blue-300 dark:hover:text-blue-100';

interface LogbookPerson {
  id: string | null;
  name: string;
  portion?: 'dual' | 'solo';
}

const PersonLinkList: React.FC<{ people: LogbookPerson[] }> = ({ people }) => (
  <>
    {people.map((person, index) => (
      <React.Fragment key={`${person.id || person.name}:${person.portion || 'all'}`}>
        {index > 0 && <span className="text-gray-400"> / </span>}
        {person.id
          ? <Link to={`/students/${encodeURIComponent(person.id)}?tab=profile`} className={linkClass}>{person.name}</Link>
          : person.name}
        {person.portion && <span className="ml-1 text-xs text-gray-500">({person.portion})</span>}
      </React.Fragment>
    ))}
  </>
);

export const LogbookTab: React.FC<LogbookTabProps> = ({ userId, userName, isInstructor }) => {
  const { flightLogs, loading, error: flightLogError, refetch } = useFlightLogs(userId);
  const {
    baseline,
    entries: externalEntries,
    canEdit: canEditExternalLogbook,
    loading: externalLogbookLoading,
    error: externalLogbookError,
    refresh: refreshExternalLogbook,
    saveBaseline,
    deleteBaseline,
    saveExternalEntry,
    deleteExternalEntry,
  } = useExternalLogbook(userId);
  const { aircraft: aircraftList } = useAircraft();
  const { users } = useUsers();
  const {
    contextByFlightId,
    emptyContext,
    notesByFlightId,
    saveNote,
    canEditNotes,
    loading: detailsLoading,
    error: detailsError,
    refresh: refreshDetails,
  } = useLogbookDetails(flightLogs, userId);
  const [filters, setFilters] = useState<LogbookFilterState>(DEFAULT_LOGBOOK_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [externalLogbookOpen, setExternalLogbookOpen] = useState(false);
  const [externalEditor, setExternalEditor] = useState<ExternalLogbookEditorState>(null);

  const updateFilter = <Key extends keyof LogbookFilterState>(key: Key, value: LogbookFilterState[Key]) => {
    setFilters(current => ({ ...current, [key]: value }));
  };

  const enrichedLogs = useMemo(() => flightLogs.map(log => {
    const aircraft = log.aircraft || aircraftList.find(item => item.id === log.aircraft_id);
    const student = log.student || users.find(item => item.id === log.student_id);
    const instructor = log.instructor || (log.instructor_id ? users.find(item => item.id === log.instructor_id) : null);
    const context = contextByFlightId[log.id] || emptyContext;
    const roleHours = calculateLogbookRoleHours(log, userId);
    const recordedDual = Number(log.dual_time || 0);
    const recordedSolo = Number(log.solo_time || 0);
    const hasMixedAllocation = Boolean(instructor && recordedDual > 0 && recordedSolo > 0);
    const pilotInCommandPeople: LogbookPerson[] = instructor
      ? [
          ...(recordedDual > 0 || recordedSolo <= 0
            ? [{ id: instructor.id || null, name: instructor.name || 'Instructor not recorded', portion: hasMixedAllocation ? 'dual' as const : undefined }]
            : []),
          ...(recordedSolo > 0
            ? [{ id: student?.id || null, name: student?.name || 'Student not recorded', portion: hasMixedAllocation ? 'solo' as const : undefined }]
            : []),
        ]
      : [{ id: student?.id || null, name: student?.name || 'Not recorded' }];
    const pilotInCommand = pilotInCommandPeople
      .map(person => `${person.name}${person.portion ? ` (${person.portion})` : ''}`)
      .join(' / ');
    const otherPilotOrCrew = instructor ? (student?.name || 'Not recorded') : '';

    return {
      ...log,
      source: 'portal' as const,
      externalEntry: null,
      includedInBaseline: isIncludedInLogbookBaseline(log.start_time, baseline),
      aircraft,
      student,
      instructor,
      pilotInCommand,
      pilotInCommandPeople,
      otherPilotOrCrew,
      otherPilotOrCrewId: instructor ? (student?.id || null) : null,
      hoursDual: roleHours.dualHours,
      hoursPic: roleHours.picHours,
      lessonName: context.lessonName,
      bookingDescription: context.bookingDescription,
      flightTypeName: context.flightTypeName,
      courseTitle: context.courseTitle,
      lessonDestination: buildLogbookLessonDestination({
        studentId: log.student_id,
        courseId: context.courseId,
        lessonId: context.lessonId,
        trainingRecordId: context.trainingRecordId,
      }),
      personalNote: notesByFlightId[log.id] || '',
    };
  }), [aircraftList, baseline, contextByFlightId, emptyContext, flightLogs, notesByFlightId, userId, users]);

  const externalLogs = useMemo(() => externalEntries.map(entry => {
    const hasMixedAllocation = entry.dual_hours > 0 && entry.pic_hours > 0;
    const pilotInCommandPeople: LogbookPerson[] = [
      ...(entry.dual_hours > 0
        ? [{ id: null, name: entry.pilot_in_command_name || 'Instructor / PIC not recorded', portion: hasMixedAllocation ? 'dual' as const : undefined }]
        : []),
      ...(entry.pic_hours > 0
        ? [{ id: userId, name: userName, portion: hasMixedAllocation ? 'solo' as const : undefined }]
        : []),
    ];
    const pilotInCommand = pilotInCommandPeople
      .map(person => `${person.name}${person.portion ? ` (${person.portion})` : ''}`)
      .join(' / ');
    const otherPilotOrCrew = entry.other_crew_name || (entry.dual_hours > 0 ? userName : '');

    return {
      id: `external:${entry.id}`,
      source: 'external' as const,
      externalEntry: entry,
      includedInBaseline: isIncludedInLogbookBaseline(entry.flight_date, baseline),
      booking_id: undefined,
      aircraft_id: '',
      student_id: userId,
      instructor_id: undefined,
      start_time: `${entry.flight_date}T12:00:00`,
      end_time: `${entry.flight_date}T12:00:00`,
      start_tach: 0,
      end_tach: 0,
      flight_duration: Number(entry.dual_hours || 0) + Number(entry.pic_hours || 0),
      dual_time: Number(entry.dual_hours || 0),
      solo_time: Number(entry.pic_hours || 0),
      takeoffs: entry.takeoffs,
      landings: entry.landings,
      comments: entry.comments,
      payment_type: 'external',
      created_at: entry.created_at || `${entry.flight_date}T12:00:00`,
      aircraft: {
        id: '',
        registration: entry.aircraft_registration,
        make: '',
        model: entry.aircraft_type,
      },
      student: { id: userId, name: userName, email: '' },
      instructor: null,
      pilotInCommand,
      pilotInCommandPeople,
      otherPilotOrCrew,
      otherPilotOrCrewId: entry.dual_hours > 0 ? userId : null,
      hoursDual: Number(entry.dual_hours || 0),
      hoursPic: Number(entry.pic_hours || 0),
      lessonName: entry.comments || 'External flight',
      bookingDescription: entry.description,
      flightTypeName: 'External flight',
      courseTitle: '',
      lessonDestination: null,
      personalNote: entry.notes,
    };
  }), [baseline, externalEntries, userId, userName]);

  const allLogs = useMemo(() => [...enrichedLogs, ...externalLogs], [enrichedLogs, externalLogs]);

  const aircraftOptions = useMemo(() => {
    const unique = new Map<string, string>();
    for (const log of allLogs) {
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
  }, [allLogs]);

  const visibleLogs = useMemo(
    () => filterAndSortLogbookEntries(allLogs, filters),
    [allLogs, filters],
  );
  const filtersActive = hasActiveLogbookFilters(filters);
  const advancedFilterCount = [
    filters.aircraftKey,
    filters.flightMode !== 'all' ? filters.flightMode : '',
    filters.dateFrom,
    filters.dateTo,
    filters.sortBy !== DEFAULT_LOGBOOK_FILTERS.sortBy ? filters.sortBy : '',
  ].filter(Boolean).length;
  const filterControlsAdjusted = filtersActive || filters.sortBy !== DEFAULT_LOGBOOK_FILTERS.sortBy;

  const visibleTotals = useMemo(() => visibleLogs.reduce(
    (total, log) => ({
      totalHours: total.totalHours + log.hoursDual + log.hoursPic,
      dualHours: total.dualHours + log.hoursDual,
      picHours: total.picHours + log.hoursPic,
      takeoffs: total.takeoffs + (log.takeoffs || 0),
      landings: total.landings + (log.landings || 0),
    }),
    { totalHours: 0, dualHours: 0, picHours: 0, takeoffs: 0, landings: 0 },
  ), [visibleLogs]);

  const totals = useMemo(() => calculateLifetimeLogbookTotals(
    baseline,
    allLogs.map(log => ({
      date: log.start_time,
      totalHours: log.hoursDual + log.hoursPic,
      dualHours: log.hoursDual,
      picHours: log.hoursPic,
      takeoffs: log.takeoffs || 0,
      landings: log.landings || 0,
    })),
  ), [allLogs, baseline]);

  const formatHours = (hours: number) => hours.toFixed(1);
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const exportCsv = () => {
    const rows: Array<Record<string, string | number>> = visibleLogs.map(log => ({
      Source: log.source === 'external' ? 'External flight' : 'Portal flight',
      Date: formatDate(log.start_time),
      'Aircraft Type': log.aircraft ? `${log.aircraft.make} ${log.aircraft.model}`.trim() : '',
      'Aircraft Registration': log.aircraft?.registration || '',
      'Pilot in Command': log.pilotInCommand,
      'Other Pilot or Crew': log.otherPilotOrCrew,
      'Total Hours': Number(formatHours(log.hoursDual + log.hoursPic)),
      'Dual Hours': Number(formatHours(log.hoursDual)),
      'PIC Hours': Number(formatHours(log.hoursPic)),
      Takeoffs: log.takeoffs ?? '',
      Landings: log.landings ?? '',
      Comments: log.lessonName || log.comments || '',
      Description: log.bookingDescription || '',
      Notes: log.personalNote || '',
      'Included in Opening Balance': log.includedInBaseline ? 'Yes' : 'No',
    }));

    if (baseline && !filtersActive) {
      rows.unshift({
        Source: 'Opening balance',
        Date: formatDate(`${baseline.as_of_date}T12:00:00`),
        'Aircraft Type': '',
        'Aircraft Registration': '',
        'Pilot in Command': '',
        'Other Pilot or Crew': '',
        'Total Hours': Number(formatHours(baseline.total_hours)),
        'Dual Hours': Number(formatHours(baseline.dual_hours)),
        'PIC Hours': Number(formatHours(baseline.pic_hours)),
        Takeoffs: baseline.takeoffs,
        Landings: baseline.landings,
        Comments: 'Cumulative external logbook opening balance',
        Description: baseline.last_flight_date ? `Last actual flight included: ${formatDate(`${baseline.last_flight_date}T12:00:00`)}` : '',
        Notes: '',
        'Included in Opening Balance': '',
      });
    }
    rows.push({
      Source: 'Visible entry totals',
      Date: `${visibleLogs.length} flights`,
      'Aircraft Type': '',
      'Aircraft Registration': '',
      'Pilot in Command': '',
      'Other Pilot or Crew': '',
      'Total Hours': Number(formatHours(visibleTotals.totalHours)),
      'Dual Hours': Number(formatHours(visibleTotals.dualHours)),
      'PIC Hours': Number(formatHours(visibleTotals.picHours)),
      Takeoffs: visibleTotals.takeoffs,
      Landings: visibleTotals.landings,
      Comments: '',
      Description: '',
      Notes: '',
      'Included in Opening Balance': '',
    });
    rows.push({
      Source: 'Current logbook totals',
      Date: baseline ? `Opening balance plus activity after ${formatDate(`${baseline.as_of_date}T12:00:00`)}` : 'All recorded activity',
      'Aircraft Type': '',
      'Aircraft Registration': '',
      'Pilot in Command': '',
      'Other Pilot or Crew': '',
      'Total Hours': Number(formatHours(totals.totalHours)),
      'Dual Hours': Number(formatHours(totals.dualHours)),
      'PIC Hours': Number(formatHours(totals.picHours)),
      Takeoffs: totals.takeoffs,
      Landings: totals.landings,
      Comments: '',
      Description: '',
      Notes: '',
      'Included in Opening Balance': '',
    });

    const headers = Object.keys(rows[0] || {});
    const escapeCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [
      headers.map(escapeCell).join(','),
      ...rows.map(row => headers.map(header => escapeCell(row[header])).join(',')),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${userName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'logbook'}-logbook.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const retry = () => {
    void refetch();
    refreshDetails();
    refreshExternalLogbook();
  };

  if (loading || externalLogbookLoading) {
    return (
      <div className="pilot-logbook w-full space-y-4">
        <div className="grid animate-pulse grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map(item => <div key={item} className="logbook-skeleton h-24 rounded-xl bg-gray-200" />)}
        </div>
        <div className="logbook-skeleton h-72 rounded-xl bg-gray-200" />
      </div>
    );
  }

  return (
    <div className="pilot-logbook w-full max-w-none space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total hours', value: formatHours(totals.totalHours), icon: Clock, style: 'blue' },
          { label: 'Dual', value: formatHours(totals.dualHours), icon: TrendingUp, style: 'green' },
          { label: 'PIC', value: formatHours(totals.picHours), icon: BookOpen, style: 'orange' },
          { label: 'Landings', value: String(totals.landings), icon: Navigation, style: 'sky' },
        ].map(item => (
          <div key={item.label} className={`logbook-summary-card logbook-summary-card--${item.style} rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4`}>
            <div className="flex items-center gap-3">
              <div className="logbook-stat-icon rounded-lg bg-blue-100 p-2">
                <item.icon className="h-5 w-5 text-blue-600" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:text-xs">{item.label}</p>
                <p className="text-xl font-bold text-gray-900">{item.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(flightLogError || detailsError || externalLogbookError) && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div>
            <p className="font-semibold">Some logbook information could not be loaded.</p>
            <p className="mt-0.5 text-amber-800">{flightLogError || detailsError || externalLogbookError}</p>
          </div>
          <button type="button" onClick={retry} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-900 px-3 py-2 font-semibold text-white hover:bg-amber-950">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      <div className="logbook-panel w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="logbook-panel-header flex flex-col gap-3 border-b border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <BookOpen className="h-5 w-5 shrink-0 text-gray-600" aria-hidden="true" />
              <span className="truncate">Flight Logbook — {userName}</span>
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {visibleLogs.length === allLogs.length
                ? `${allLogs.length} entries`
                : `Showing ${visibleLogs.length} of ${allLogs.length} entries`}
              {detailsLoading ? ' · Loading lesson details…' : ''}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {isInstructor
                ? 'The instructed portion is PIC in your logbook; any student solo portion is excluded.'
                : 'Mixed training flights are split between dual and solo/PIC using the recorded allocation.'}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setExternalLogbookOpen(true)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" /> External logbook hours
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={visibleLogs.length === 0 && !baseline}
              className="logbook-export-button inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" aria-hidden="true" /> Export visible entries
            </button>
          </div>
        </div>

        {allLogs.length > 0 && (
          <div className="logbook-filters border-b border-gray-200 bg-gray-50/70 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Search logbook</span>
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" aria-hidden="true" />
                <input
                  type="search"
                  value={filters.search}
                  onChange={event => updateFilter('search', event.target.value)}
                  placeholder="Search logbook"
                  className="logbook-control h-9 w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <button
                type="button"
                onClick={() => setFiltersOpen(open => !open)}
                aria-expanded={filtersOpen}
                aria-controls="logbook-advanced-filters"
                className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition ${filtersOpen || advancedFilterCount > 0 ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'}`}
              >
                <Filter className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Filters</span>
                {advancedFilterCount > 0 && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{advancedFilterCount}</span>}
              </button>
              {filterControlsAdjusted && (
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_LOGBOOK_FILTERS)}
                  aria-label="Clear logbook filters"
                  title="Clear filters"
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                >
                  <X className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Clear</span>
                </button>
              )}
              {filtersActive && <span className="hidden shrink-0 text-xs font-medium text-gray-500 lg:inline">{visibleLogs.length} of {allLogs.length}</span>}
            </div>

            {filtersOpen && (
              <div id="logbook-advanced-filters" className="mt-2 grid grid-cols-2 gap-2 border-t border-gray-200 pt-2 sm:grid-cols-5">
                <label className="min-w-0">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Aircraft</span>
                  <SearchableSelect value={filters.aircraftKey} onChange={event => updateFilter('aircraftKey', event.target.value)} className="logbook-control h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
                    <option value="">All aircraft</option>
                    {aircraftOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </SearchableSelect>
                </label>
                <label className="min-w-0">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Flight time</span>
                  <SearchableSelect value={filters.flightMode} onChange={event => updateFilter('flightMode', event.target.value as LogbookFilterState['flightMode'])} className="logbook-control h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
                    <option value="all">All time</option>
                    <option value="dual">Dual</option>
                    <option value="solo">PIC</option>
                  </SearchableSelect>
                </label>
                <label className="min-w-0">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">From</span>
                  <input type="date" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={event => updateFilter('dateFrom', event.target.value)} className="logbook-control h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="min-w-0">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">To</span>
                  <input type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={event => updateFilter('dateTo', event.target.value)} className="logbook-control h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="col-span-2 min-w-0 sm:col-span-1">
                  <span className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500"><ArrowUpDown className="h-3 w-3" aria-hidden="true" /> Sort</span>
                  <SearchableSelect value={filters.sortBy} onChange={event => updateFilter('sortBy', event.target.value as LogbookFilterState['sortBy'])} className="logbook-control h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
                    <option value="date_desc">Date — newest</option>
                    <option value="date_asc">Date — oldest</option>
                    <option value="duration_desc">Time — longest</option>
                    <option value="duration_asc">Time — shortest</option>
                    <option value="aircraft_asc">Aircraft — A to Z</option>
                    <option value="aircraft_desc">Aircraft — Z to A</option>
                    <option value="pic_asc">PIC — A to Z</option>
                  </SearchableSelect>
                </label>
              </div>
            )}
          </div>
        )}

        {allLogs.length === 0 ? (
          <div className="logbook-empty-state px-4 py-16 text-center">
            <BookOpen className="logbook-empty-icon mx-auto mb-4 h-14 w-14 text-gray-300" aria-hidden="true" />
            <h3 className="text-lg font-medium text-gray-900">No logbook entries yet</h3>
            <p className="mt-1 text-sm text-gray-500">Entries will appear here after portal or external flights are logged.</p>
          </div>
        ) : visibleLogs.length === 0 ? (
          <div className="logbook-empty-state px-4 py-14 text-center">
            <Search className="logbook-empty-icon mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden="true" />
            <h3 className="text-base font-semibold text-gray-900">No flights match these filters</h3>
            <p className="mt-1 text-sm text-gray-500">Try changing the dates, aircraft or search terms.</p>
            <button type="button" onClick={() => setFilters(DEFAULT_LOGBOOK_FILTERS)} className="mt-4 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">Clear filters</button>
          </div>
        ) : (
          <>
            <div className="divide-y divide-gray-200 lg:hidden">
              {visibleLogs.map(log => {
                const calendarDestination = `/calendar?date=${toLogbookDateKey(log.start_time)}`;
                return (
                  <article key={log.id} className={`logbook-mobile-card space-y-4 p-4 ${log.source === 'external' ? 'bg-indigo-50/30' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          {log.source === 'portal'
                            ? <Link to={calendarDestination} className={linkClass}>{formatDate(log.start_time)}</Link>
                            : <span className="font-semibold text-gray-900">{formatDate(log.start_time)}</span>}
                          {log.source === 'external' && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">External</span>}
                          {log.includedInBaseline && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">Included in opening balance</span>}
                        </div>
                        <p className="mt-1 text-sm text-gray-600">{log.aircraft ? `${log.aircraft.make} ${log.aircraft.model}`.trim() : 'Aircraft not recorded'}</p>
                      </div>
                      {log.aircraft?.id ? (
                        <Link to={`/aircraft/${encodeURIComponent(log.aircraft.id)}`} className={`${linkClass} logbook-registration inline-flex rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs`}>
                          {log.aircraft.registration || 'Aircraft'}
                        </Link>
                      ) : log.aircraft?.registration
                        ? <span className="inline-flex rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-800">{log.aircraft.registration}</span>
                        : <span className="text-sm text-gray-400">—</span>}
                    </div>

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pilot in command</dt><dd className="mt-0.5"><PersonLinkList people={log.pilotInCommandPeople} /></dd></div>
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Other pilot / crew</dt><dd className="mt-0.5">{log.otherPilotOrCrewId ? <Link to={`/students/${encodeURIComponent(log.otherPilotOrCrewId)}?tab=profile`} className={linkClass}>{log.otherPilotOrCrew}</Link> : (log.otherPilotOrCrew || '—')}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Dual</dt><dd className="mt-0.5 font-bold text-emerald-700">{log.hoursDual > 0 ? formatHours(log.hoursDual) : '—'}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">PIC</dt><dd className="mt-0.5 font-bold text-amber-700">{log.hoursPic > 0 ? formatHours(log.hoursPic) : '—'}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Take-offs</dt><dd className="mt-0.5 font-semibold text-gray-800">{log.takeoffs ?? '—'}</dd></div>
                      <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Landings</dt><dd className="mt-0.5 font-semibold text-gray-800">{log.landings ?? '—'}</dd></div>
                    </dl>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Comments</p><div className="mt-1 text-sm text-gray-800">{log.lessonDestination ? <Link to={log.lessonDestination} className={`${linkClass} inline-flex items-center gap-1`}>{log.lessonName || log.comments || 'Open lesson'}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></Link> : (log.lessonName || log.comments || '—')}{log.courseTitle && <p className="mt-0.5 text-xs text-gray-500">{log.courseTitle}</p>}</div></div>
                      <div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Description</p><p className="mt-1 text-sm text-gray-800">{log.bookingDescription || '—'}</p></div>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</p>
                      {log.source === 'portal' && canEditNotes
                        ? <NotesEditor flightLogId={log.id} savedValue={log.personalNote} onSave={saveNote} compact />
                        : <ReadOnlyNote value={log.personalNote} />}
                    </div>
                    {log.source === 'external' && log.externalEntry && canEditExternalLogbook && (
                      <button type="button" onClick={() => setExternalEditor({ mode: 'edit', entry: log.externalEntry! })} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-50">
                        <Pencil className="h-4 w-4" /> Edit external flight
                      </button>
                    )}
                  </article>
                );
              })}
              <div className="grid grid-cols-2 gap-3 bg-gray-100 p-4 text-sm font-bold text-gray-800">
                <span>Visible entries ({visibleLogs.length})</span><span className="text-right">{formatHours(visibleTotals.totalHours)} hrs</span>
                <span>Dual {formatHours(visibleTotals.dualHours)}</span><span className="text-right">PIC {formatHours(visibleTotals.picHours)}</span>
              </div>
            </div>

            <div className="logbook-table-scroll hidden w-full overflow-x-auto overscroll-x-contain lg:block">
              <table className="logbook-table w-full min-w-[100rem] table-auto text-sm">
                <thead className="logbook-table-head border-b border-gray-200 bg-gray-50">
                  <tr>
                    {['Date', 'Aircraft type', 'Registration', 'Pilot in command', 'Other pilot / crew', 'Dual (hrs)', 'PIC (hrs)', 'T/O', 'Ldg', 'Comments', 'Description', 'Notes', 'Actions'].map((heading, index) => (
                      <th key={heading} className={`${index === 0 ? 'sticky left-0 z-10 bg-gray-50' : ''} ${index >= 5 && index <= 8 ? 'text-center' : 'text-left'} whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600`}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleLogs.map((log, index) => (
                    <tr key={log.id} className={`logbook-table-row transition-colors hover:bg-blue-50/50 ${log.source === 'external' ? 'bg-indigo-50/40' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                      <td className="sticky left-0 z-[1] bg-inherit px-3 py-3 font-medium whitespace-nowrap">
                        {log.source === 'portal' ? <Link to={`/calendar?date=${toLogbookDateKey(log.start_time)}`} className={linkClass}>{formatDate(log.start_time)}</Link> : formatDate(log.start_time)}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {log.source === 'external' && <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-700">External</span>}
                          {log.includedInBaseline && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">In opening balance</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{log.aircraft ? `${log.aircraft.make} ${log.aircraft.model}`.trim() : '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{log.aircraft?.id ? <Link to={`/aircraft/${encodeURIComponent(log.aircraft.id)}`} className={`${linkClass} logbook-registration inline-flex rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs`}>{log.aircraft.registration || 'Aircraft'}</Link> : (log.aircraft?.registration || '—')}</td>
                      <td className="px-3 py-3 text-gray-900 whitespace-nowrap"><PersonLinkList people={log.pilotInCommandPeople} /></td>
                      <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{log.otherPilotOrCrewId ? <Link to={`/students/${encodeURIComponent(log.otherPilotOrCrewId)}?tab=profile`} className={linkClass}>{log.otherPilotOrCrew}</Link> : (log.otherPilotOrCrew || '—')}</td>
                      <td className="px-3 py-3 text-center">{log.hoursDual > 0 ? <span className="logbook-hours-badge logbook-hours-badge--dual inline-flex w-14 items-center justify-center rounded border border-green-200 bg-green-50 py-0.5 text-xs font-semibold text-green-700">{formatHours(log.hoursDual)}</span> : <span className="text-gray-400">—</span>}</td>
                      <td className="px-3 py-3 text-center">{log.hoursPic > 0 ? <span className="logbook-hours-badge logbook-hours-badge--solo inline-flex w-14 items-center justify-center rounded border border-orange-200 bg-orange-50 py-0.5 text-xs font-semibold text-orange-700">{formatHours(log.hoursPic)}</span> : <span className="text-gray-400">—</span>}</td>
                      <td className="px-3 py-3 text-center font-medium text-gray-700">{log.takeoffs ?? '—'}</td>
                      <td className="px-3 py-3 text-center font-medium text-gray-700">{log.landings ?? '—'}</td>
                      <td className="max-w-64 px-3 py-3 text-gray-700">{log.lessonDestination ? <Link to={log.lessonDestination} className={`${linkClass} inline-flex items-start gap-1`}>{log.lessonName || log.comments || 'Open lesson'}<ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /></Link> : (log.lessonName || log.comments || '—')}{log.courseTitle && <span className="mt-0.5 block text-xs text-gray-500">{log.courseTitle}</span>}</td>
                      <td className="max-w-64 px-3 py-3 text-gray-600"><span className="line-clamp-3">{log.bookingDescription || '—'}</span></td>
                      <td className="px-3 py-3">
                        {log.source === 'portal' && canEditNotes
                          ? <NotesEditor flightLogId={log.id} savedValue={log.personalNote} onSave={saveNote} />
                          : <ReadOnlyNote value={log.personalNote} />}
                      </td>
                      <td className="px-3 py-3">
                        {log.source === 'external' && log.externalEntry && canEditExternalLogbook
                          ? <button type="button" onClick={() => setExternalEditor({ mode: 'edit', entry: log.externalEntry! })} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-50"><Pencil className="h-3.5 w-3.5" /> Edit</button>
                          : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="logbook-table-footer border-t-2 border-gray-300 bg-gray-100">
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-xs font-bold uppercase tracking-wide text-gray-700">Visible entry totals ({visibleLogs.length} flights)</td>
                    <td className="px-3 py-3 text-center"><span className="logbook-hours-badge logbook-hours-badge--dual inline-flex w-14 items-center justify-center rounded border border-green-300 bg-green-100 py-0.5 text-xs font-bold text-green-800">{formatHours(visibleTotals.dualHours)}</span></td>
                    <td className="px-3 py-3 text-center"><span className="logbook-hours-badge logbook-hours-badge--solo inline-flex w-14 items-center justify-center rounded border border-orange-300 bg-orange-100 py-0.5 text-xs font-bold text-orange-800">{formatHours(visibleTotals.picHours)}</span></td>
                    <td className="px-3 py-3 text-center font-bold text-gray-800">{visibleTotals.takeoffs}</td>
                    <td className="px-3 py-3 text-center font-bold text-gray-800">{visibleTotals.landings}</td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>

      <ExternalLogbookDialog
        isOpen={externalLogbookOpen}
        onClose={() => {
          setExternalLogbookOpen(false);
          setExternalEditor(null);
        }}
        userName={userName}
        baseline={baseline}
        entries={externalEntries}
        canEdit={canEditExternalLogbook}
        editor={externalEditor}
        onEditorChange={setExternalEditor}
        onSaveBaseline={saveBaseline}
        onDeleteBaseline={deleteBaseline}
        onSaveEntry={saveExternalEntry}
        onDeleteEntry={deleteExternalEntry}
      />
    </div>
  );
};
