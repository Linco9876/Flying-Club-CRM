import React, { useState, useMemo } from 'react';
import { Download, Search, ChevronUp, ChevronDown, ChevronsUpDown, Loader } from 'lucide-react';
import { useReportsData } from '../../hooks/useReportsData';

interface PilotStats {
  id: string;
  name: string;
  email: string;
  totalBookings: number;
  completedFlights: number;
  cancelledFlights: number;
  totalHours: number;
  dualHours: number;
  soloHours: number;
  balance: number;
}

type SortField = keyof Omit<PilotStats, 'id' | 'email'>;

export const PilotStatisticsTab: React.FC = () => {
  const { flightLogs, bookings, users, aircraft, loading, error } = useReportsData();

  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [aircraftFilter, setAircraftFilter] = useState('');
  const [instructorFilter, setInstructorFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const pilots = useMemo(() => users.filter(u => u.roles.includes('student') || u.roles.includes('pilot')), [users]);
  const instructors = useMemo(() => users.filter(u => u.roles.includes('instructor') || u.roles.includes('senior_instructor')), [users]);

  const stats = useMemo((): PilotStats[] => {
    const map = new Map<string, PilotStats>();

    pilots.forEach(p => {
      map.set(p.id, {
        id: p.id,
        name: p.name,
        email: p.email,
        totalBookings: 0,
        completedFlights: 0,
        cancelledFlights: 0,
        totalHours: 0,
        dualHours: 0,
        soloHours: 0,
        balance: 0,
      });
    });

    // Tally bookings
    bookings.forEach(b => {
      if (!map.has(b.student_id)) return;
      const start = new Date(b.start_time);
      if (dateRange.start && start < new Date(dateRange.start)) return;
      if (dateRange.end && start > new Date(dateRange.end + 'T23:59:59')) return;
      if (aircraftFilter && b.aircraft_id !== aircraftFilter) return;
      if (instructorFilter && b.instructor_id !== instructorFilter) return;

      const s = map.get(b.student_id)!;
      s.totalBookings++;
      if (b.status === 'cancelled') s.cancelledFlights++;
      else if (b.status === 'completed') s.completedFlights++;
    });

    // Tally hours from flight logs (source of truth for hours)
    flightLogs.forEach(log => {
      if (!map.has(log.student_id)) return;
      const start = new Date(log.start_time);
      if (dateRange.start && start < new Date(dateRange.start)) return;
      if (dateRange.end && start > new Date(dateRange.end + 'T23:59:59')) return;
      if (aircraftFilter && log.aircraft_id !== aircraftFilter) return;
      if (instructorFilter && log.instructor_id !== instructorFilter) return;

      const s = map.get(log.student_id)!;
      const dual = parseFloat(log.dual_time as any) || 0;
      const solo = parseFloat(log.solo_time as any) || 0;
      const total = parseFloat(log.flight_duration as any) || (dual + solo);
      s.dualHours += dual;
      s.soloHours += solo;
      s.totalHours += total || dual + solo;
    });

    return Array.from(map.values());
  }, [pilots, bookings, flightLogs, dateRange, aircraftFilter, instructorFilter]);

  const filtered = useMemo(() =>
    stats.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [stats, searchTerm]
  );

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const cmp = typeof av === 'string'
        ? av.localeCompare(bv as string)
        : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const exportCsv = () => {
    const headers = ['Name', 'Email', 'Total Bookings', 'Completed', 'Cancelled', 'Total Hours', 'Dual Hours', 'Solo Hours'];
    const rows = sorted.map(s => [
      s.name, s.email, s.totalBookings, s.completedFlights, s.cancelledFlights,
      s.totalHours.toFixed(1), s.dualHours.toFixed(1), s.soloHours.toFixed(1)
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pilot-statistics.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400 inline ml-1" />;
    return sortDir === 'asc'
      ? <ChevronUp className="h-3.5 w-3.5 text-blue-500 inline ml-1" />
      : <ChevronDown className="h-3.5 w-3.5 text-blue-500 inline ml-1" />;
  };

  const Th = ({ field, label }: { field: SortField; label: string }) => (
    <th
      className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap"
      onClick={() => handleSort(field)}
    >
      {label}<SortIcon field={field} />
    </th>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="h-6 w-6 animate-spin text-blue-500 mr-2" />
        <span className="text-gray-500">Loading pilot statistics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        Failed to load data: {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Search Pilot</label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Search by name..."
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">From Date</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={e => setDateRange(p => ({ ...p, start: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">To Date</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={e => setDateRange(p => ({ ...p, end: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Aircraft</label>
            <select
              value={aircraftFilter}
              onChange={e => setAircraftFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Aircraft</option>
              {aircraft.map(a => (
                <option key={a.id} value={a.id}>{a.registration}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Instructor</label>
            <select
              value={instructorFilter}
              onChange={e => setInstructorFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Instructors</option>
              {instructors.map(i => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-100">
          <p className="text-sm text-gray-500">
            Showing <span className="font-semibold text-gray-800">{sorted.length}</span> pilots
          </p>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Pilots', value: sorted.length, color: 'bg-blue-50 text-blue-700 border-blue-100' },
          { label: 'Total Bookings', value: sorted.reduce((s, p) => s + p.totalBookings, 0), color: 'bg-sky-50 text-sky-700 border-sky-100' },
          { label: 'Total Hours', value: sorted.reduce((s, p) => s + p.totalHours, 0).toFixed(1), color: 'bg-green-50 text-green-700 border-green-100' },
          { label: 'Cancelled Flights', value: sorted.reduce((s, p) => s + p.cancelledFlights, 0), color: 'bg-amber-50 text-amber-700 border-amber-100' },
        ].map(card => (
          <div key={card.label} className={`rounded-xl border p-4 ${card.color}`}>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{card.label}</p>
            <p className="text-2xl font-bold mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="space-y-3 p-4 md:hidden">
          {sorted.map(s => (
            <article key={s.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-gray-900">{s.name}</h3>
                  <p className="truncate text-xs text-gray-500">{s.email}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold text-gray-900">{s.totalHours.toFixed(1)}</p>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">hours</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-blue-50 p-2">
                  <p className="text-xs text-blue-700">Bookings</p>
                  <p className="font-bold text-blue-900">{s.totalBookings}</p>
                </div>
                <div className="rounded-lg bg-green-50 p-2">
                  <p className="text-xs text-green-700">Dual</p>
                  <p className="font-bold text-green-900">{s.dualHours.toFixed(1)}</p>
                </div>
                <div className="rounded-lg bg-sky-50 p-2">
                  <p className="text-xs text-sky-700">Solo</p>
                  <p className="font-bold text-sky-900">{s.soloHours.toFixed(1)}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
                <span>{s.completedFlights} completed</span>
                <span className={s.cancelledFlights > 0 ? 'font-semibold text-red-600' : 'text-gray-400'}>{s.cancelledFlights} cancelled</span>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                <Th field="name" label="Pilot Name" />
                <Th field="totalBookings" label="Bookings" />
                <Th field="completedFlights" label="Completed" />
                <Th field="totalHours" label="Total Hours" />
                <Th field="dualHours" label="Dual Hours" />
                <Th field="soloHours" label="Solo Hours" />
                <Th field="cancelledFlights" label="Cancelled" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <div className="text-sm font-semibold text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-400">{s.email}</div>
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-700">{s.totalBookings}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-700">{s.completedFlights}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm font-semibold text-gray-900">{s.totalHours.toFixed(1)}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-700">{s.dualHours.toFixed(1)}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-700">{s.soloHours.toFixed(1)}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    {s.cancelledFlights > 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        {s.cancelledFlights}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No pilot data found for the selected filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};
