import React, { useState, useMemo } from 'react';
import { Download, Search, ChevronUp, ChevronDown, ChevronsUpDown, Loader, CheckCircle, AlertTriangle } from 'lucide-react';
import { useReportsData } from '../../hooks/useReportsData';

interface AircraftStats {
  id: string;
  registration: string;
  makeModel: string;
  status: string;
  totalHours: number;
  dualHours: number;
  soloHours: number;
  totalLandings: number;
  totalTakeoffs: number;
  totalBookings: number;
  completedFlights: number;
}

type SortField = keyof Omit<AircraftStats, 'id' | 'makeModel' | 'status'>;

export const AircraftStatisticsTab: React.FC = () => {
  const { flightLogs, bookings, users, aircraft, loading, error } = useReportsData();

  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [instructorFilter, setInstructorFilter] = useState('');
  const [pilotFilter, setPilotFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('registration');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const instructors = useMemo(() => users.filter(u => u.roles.includes('instructor') || u.roles.includes('senior_instructor')), [users]);
  const pilots = useMemo(() => users.filter(u => u.roles.includes('student') || u.roles.includes('pilot')), [users]);

  const stats = useMemo((): AircraftStats[] => {
    const map = new Map<string, AircraftStats>();

    aircraft.forEach(a => {
      map.set(a.id, {
        id: a.id,
        registration: a.registration,
        makeModel: `${a.make} ${a.model}`.trim(),
        status: a.status,
        totalHours: 0,
        dualHours: 0,
        soloHours: 0,
        totalLandings: 0,
        totalTakeoffs: 0,
        totalBookings: 0,
        completedFlights: 0,
      });
    });

    // Tally bookings
    bookings.forEach(b => {
      if (!map.has(b.aircraft_id)) return;
      const start = new Date(b.start_time);
      if (dateRange.start && start < new Date(dateRange.start)) return;
      if (dateRange.end && start > new Date(dateRange.end + 'T23:59:59')) return;
      if (instructorFilter && b.instructor_id !== instructorFilter) return;
      if (pilotFilter && b.student_id !== pilotFilter) return;

      const s = map.get(b.aircraft_id)!;
      s.totalBookings++;
      if (b.status === 'completed') s.completedFlights++;
    });

    // Tally hours from flight logs
    flightLogs.forEach(log => {
      if (!map.has(log.aircraft_id)) return;
      const start = new Date(log.start_time);
      if (dateRange.start && start < new Date(dateRange.start)) return;
      if (dateRange.end && start > new Date(dateRange.end + 'T23:59:59')) return;
      if (instructorFilter && log.instructor_id !== instructorFilter) return;
      if (pilotFilter && log.student_id !== pilotFilter) return;

      const s = map.get(log.aircraft_id)!;
      const dual = parseFloat(log.dual_time as any) || 0;
      const solo = parseFloat(log.solo_time as any) || 0;
      const total = parseFloat(log.flight_duration as any) || (dual + solo);
      s.dualHours += dual;
      s.soloHours += solo;
      s.totalHours += total;
      s.totalLandings += log.landings || 0;
      s.totalTakeoffs += log.takeoffs || 0;
    });

    return Array.from(map.values());
  }, [aircraft, bookings, flightLogs, dateRange, instructorFilter, pilotFilter]);

  const filtered = useMemo(() =>
    stats.filter(s => s.registration.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.makeModel.toLowerCase().includes(searchTerm.toLowerCase())),
    [stats, searchTerm]
  );

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const exportCsv = () => {
    const headers = ['Registration', 'Make/Model', 'Status', 'Total Bookings', 'Completed', 'Total Hours', 'Dual Hours', 'Solo Hours', 'Landings', 'Takeoffs'];
    const rows = sorted.map(s => [
      s.registration, s.makeModel, s.status, s.totalBookings, s.completedFlights,
      s.totalHours.toFixed(1), s.dualHours.toFixed(1), s.soloHours.toFixed(1),
      s.totalLandings, s.totalTakeoffs
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aircraft-statistics.csv';
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
        <span className="text-gray-500">Loading aircraft statistics...</span>
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

  const totalFleetHours = sorted.reduce((s, a) => s + a.totalHours, 0);
  const serviceableCount = aircraft.filter(a => a.status === 'serviceable').length;

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Search Aircraft</label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Registration or make..."
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

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Pilot</label>
            <select
              value={pilotFilter}
              onChange={e => setPilotFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Pilots</option>
              {pilots.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-100">
          <p className="text-sm text-gray-500">
            Showing <span className="font-semibold text-gray-800">{sorted.length}</span> aircraft
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
          { label: 'Total Aircraft', value: aircraft.length, color: 'bg-blue-50 text-blue-700 border-blue-100' },
          { label: 'Serviceable', value: serviceableCount, color: 'bg-green-50 text-green-700 border-green-100' },
          { label: 'Fleet Hours (filtered)', value: totalFleetHours.toFixed(1), color: 'bg-sky-50 text-sky-700 border-sky-100' },
          { label: 'Total Bookings', value: sorted.reduce((s, a) => s + a.totalBookings, 0), color: 'bg-amber-50 text-amber-700 border-amber-100' },
        ].map(card => (
          <div key={card.label} className={`rounded-xl border p-4 ${card.color}`}>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{card.label}</p>
            <p className="text-2xl font-bold mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                <Th field="registration" label="Aircraft" />
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Status</th>
                <Th field="totalBookings" label="Bookings" />
                <Th field="completedFlights" label="Completed" />
                <Th field="totalHours" label="Total Hours" />
                <Th field="dualHours" label="Dual Hours" />
                <Th field="soloHours" label="Solo Hours" />
                <Th field="totalLandings" label="Landings" />
                <Th field="totalTakeoffs" label="Takeoffs" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <div className="text-sm font-semibold text-gray-900">{s.registration}</div>
                    <div className="text-xs text-gray-400">{s.makeModel}</div>
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    {s.status === 'serviceable' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        <CheckCircle className="h-3 w-3" />
                        Serviceable
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        <AlertTriangle className="h-3 w-3" />
                        {s.status}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-700">{s.totalBookings}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-700">{s.completedFlights}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm font-semibold text-gray-900">{s.totalHours.toFixed(1)}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-700">{s.dualHours.toFixed(1)}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-700">{s.soloHours.toFixed(1)}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-700">{s.totalLandings}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-700">{s.totalTakeoffs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No aircraft data found for the selected filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};
