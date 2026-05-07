import React, { useState, useMemo } from 'react';
import { Download, Search, ChevronUp, ChevronDown, ChevronsUpDown, Loader } from 'lucide-react';
import { useReportsData } from '../../hooks/useReportsData';

interface InstructorStats {
  id: string;
  name: string;
  email: string;
  totalBookings: number;
  completedFlights: number;
  cancelledFlights: number;
  totalHoursInstructed: number;
  uniqueStudents: number;
}

type SortField = keyof Omit<InstructorStats, 'id' | 'email'>;

export const InstructorStatisticsTab: React.FC = () => {
  const { flightLogs, bookings, users, aircraft, loading, error } = useReportsData();

  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [aircraftFilter, setAircraftFilter] = useState('');
  const [studentFilter, setStudentFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const instructors = useMemo(() => users.filter(u => u.roles.includes('instructor') || u.roles.includes('senior_instructor')), [users]);
  const pilots = useMemo(() => users.filter(u => u.roles.includes('student') || u.roles.includes('pilot')), [users]);

  const stats = useMemo((): InstructorStats[] => {
    const map = new Map<string, InstructorStats & { studentSet: Set<string> }>();

    instructors.forEach(i => {
      map.set(i.id, {
        id: i.id,
        name: i.name,
        email: i.email,
        totalBookings: 0,
        completedFlights: 0,
        cancelledFlights: 0,
        totalHoursInstructed: 0,
        uniqueStudents: 0,
        studentSet: new Set(),
      });
    });

    // Tally bookings
    bookings.forEach(b => {
      if (!b.instructor_id || !map.has(b.instructor_id)) return;
      const start = new Date(b.start_time);
      if (dateRange.start && start < new Date(dateRange.start)) return;
      if (dateRange.end && start > new Date(dateRange.end + 'T23:59:59')) return;
      if (aircraftFilter && b.aircraft_id !== aircraftFilter) return;
      if (studentFilter && b.student_id !== studentFilter) return;

      const s = map.get(b.instructor_id)!;
      s.totalBookings++;
      s.studentSet.add(b.student_id);
      if (b.status === 'cancelled') s.cancelledFlights++;
      else if (b.status === 'completed') s.completedFlights++;
    });

    // Tally hours from flight logs
    flightLogs.forEach(log => {
      if (!log.instructor_id || !map.has(log.instructor_id)) return;
      const start = new Date(log.start_time);
      if (dateRange.start && start < new Date(dateRange.start)) return;
      if (dateRange.end && start > new Date(dateRange.end + 'T23:59:59')) return;
      if (aircraftFilter && log.aircraft_id !== aircraftFilter) return;
      if (studentFilter && log.student_id !== studentFilter) return;

      const s = map.get(log.instructor_id)!;
      const dual = parseFloat(log.dual_time as any) || 0;
      const total = parseFloat(log.flight_duration as any) || dual;
      s.totalHoursInstructed += total;
      s.studentSet.add(log.student_id);
    });

    return Array.from(map.values()).map(({ studentSet, ...rest }) => ({
      ...rest,
      uniqueStudents: studentSet.size,
    }));
  }, [instructors, bookings, flightLogs, dateRange, aircraftFilter, studentFilter]);

  const filtered = useMemo(() =>
    stats.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase())),
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
    const headers = ['Name', 'Email', 'Total Bookings', 'Completed', 'Cancelled', 'Hours Instructed', 'Students Taught'];
    const rows = sorted.map(s => [
      s.name, s.email, s.totalBookings, s.completedFlights, s.cancelledFlights,
      s.totalHoursInstructed.toFixed(1), s.uniqueStudents
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'instructor-statistics.csv';
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
        <span className="text-gray-500">Loading instructor statistics...</span>
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
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Search Instructor</label>
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
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Student</label>
            <select
              value={studentFilter}
              onChange={e => setStudentFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Students</option>
              {pilots.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-100">
          <p className="text-sm text-gray-500">
            Showing <span className="font-semibold text-gray-800">{sorted.length}</span> instructors
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
          { label: 'Total Instructors', value: sorted.length, color: 'bg-blue-50 text-blue-700 border-blue-100' },
          { label: 'Total Bookings', value: sorted.reduce((s, i) => s + i.totalBookings, 0), color: 'bg-sky-50 text-sky-700 border-sky-100' },
          { label: 'Hours Instructed', value: sorted.reduce((s, i) => s + i.totalHoursInstructed, 0).toFixed(1), color: 'bg-green-50 text-green-700 border-green-100' },
          { label: 'Students Taught', value: sorted.reduce((s, i) => s + i.uniqueStudents, 0), color: 'bg-teal-50 text-teal-700 border-teal-100' },
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
                <Th field="name" label="Instructor Name" />
                <Th field="totalBookings" label="Bookings" />
                <Th field="completedFlights" label="Completed" />
                <Th field="totalHoursInstructed" label="Hours Instructed" />
                <Th field="uniqueStudents" label="Students Taught" />
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
                  <td className="px-5 py-3.5 whitespace-nowrap text-sm font-semibold text-gray-900">{s.totalHoursInstructed.toFixed(1)}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                      {s.uniqueStudents} students
                    </span>
                  </td>
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
            <p className="text-gray-400 text-sm">No instructor data found for the selected filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};
