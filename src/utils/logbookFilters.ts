export type LogbookFlightMode = 'all' | 'dual' | 'solo';
export type LogbookSort =
  | 'date_desc'
  | 'date_asc'
  | 'duration_desc'
  | 'duration_asc'
  | 'aircraft_asc'
  | 'aircraft_desc'
  | 'pic_asc';

export interface LogbookFilterState {
  search: string;
  aircraftKey: string;
  flightMode: LogbookFlightMode;
  dateFrom: string;
  dateTo: string;
  sortBy: LogbookSort;
}

export interface LogbookFilterableEntry {
  start_time: string;
  flight_duration?: number | null;
  dual_time?: number | null;
  solo_time?: number | null;
  hoursDual?: number | null;
  hoursPic?: number | null;
  comments?: string | null;
  lessonName?: string | null;
  bookingDescription?: string | null;
  personalNote?: string | null;
  payment_type?: string | null;
  pilotInCommand?: string | null;
  otherPilotOrCrew?: string | null;
  aircraft?: {
    id?: string | null;
    registration?: string | null;
    make?: string | null;
    model?: string | null;
  } | null;
}

export const DEFAULT_LOGBOOK_FILTERS: LogbookFilterState = {
  search: '',
  aircraftKey: '',
  flightMode: 'all',
  dateFrom: '',
  dateTo: '',
  sortBy: 'date_desc',
};

export const getLogbookAircraftKey = (entry: LogbookFilterableEntry) =>
  entry.aircraft?.id || entry.aircraft?.registration || '';

const getLocalDateKey = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalise = (value: unknown) => String(value || '').trim().toLocaleLowerCase();

const getAircraftLabel = (entry: LogbookFilterableEntry) =>
  [
    entry.aircraft?.registration,
    entry.aircraft?.make,
    entry.aircraft?.model,
  ].filter(Boolean).join(' ');

export const hasActiveLogbookFilters = (filters: LogbookFilterState) =>
  Boolean(
    filters.search.trim()
    || filters.aircraftKey
    || filters.flightMode !== 'all'
    || filters.dateFrom
    || filters.dateTo,
  );

export const filterAndSortLogbookEntries = <T extends LogbookFilterableEntry>(
  entries: T[],
  filters: LogbookFilterState,
) => {
  const search = normalise(filters.search);
  const filtered = entries.filter(entry => {
    if (filters.aircraftKey && getLogbookAircraftKey(entry) !== filters.aircraftKey) return false;

    const dateKey = getLocalDateKey(entry.start_time);
    if (filters.dateFrom && (!dateKey || dateKey < filters.dateFrom)) return false;
    if (filters.dateTo && (!dateKey || dateKey > filters.dateTo)) return false;

    const dualHours = entry.hoursDual ?? entry.dual_time;
    const picHours = entry.hoursPic ?? entry.solo_time;
    if (filters.flightMode === 'dual' && Number(dualHours || 0) <= 0) return false;
    if (filters.flightMode === 'solo' && Number(picHours || 0) <= 0) return false;

    if (search) {
      const searchable = normalise([
        getAircraftLabel(entry),
        entry.pilotInCommand,
        entry.otherPilotOrCrew,
        entry.lessonName,
        entry.bookingDescription,
        entry.personalNote,
        entry.comments,
        entry.payment_type,
      ].filter(Boolean).join(' '));
      if (!searchable.includes(search)) return false;
    }

    return true;
  });

  return filtered
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftEntry = left.entry;
      const rightEntry = right.entry;
      let result = 0;

      switch (filters.sortBy) {
        case 'date_asc':
          result = new Date(leftEntry.start_time).getTime() - new Date(rightEntry.start_time).getTime();
          break;
        case 'duration_desc':
          result = Number(rightEntry.flight_duration || 0) - Number(leftEntry.flight_duration || 0);
          break;
        case 'duration_asc':
          result = Number(leftEntry.flight_duration || 0) - Number(rightEntry.flight_duration || 0);
          break;
        case 'aircraft_asc':
          result = getAircraftLabel(leftEntry).localeCompare(getAircraftLabel(rightEntry), undefined, { sensitivity: 'base' });
          break;
        case 'aircraft_desc':
          result = getAircraftLabel(rightEntry).localeCompare(getAircraftLabel(leftEntry), undefined, { sensitivity: 'base' });
          break;
        case 'pic_asc':
          result = String(leftEntry.pilotInCommand || '').localeCompare(
            String(rightEntry.pilotInCommand || ''),
            undefined,
            { sensitivity: 'base' },
          );
          break;
        case 'date_desc':
        default:
          result = new Date(rightEntry.start_time).getTime() - new Date(leftEntry.start_time).getTime();
          break;
      }

      return result || left.index - right.index;
    })
    .map(({ entry }) => entry);
};
