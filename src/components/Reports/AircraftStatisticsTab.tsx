import React, { useState } from 'react';
import { mockBookings, mockStudents, mockAircraft } from '../../data/mockData';
import { Download, Search } from 'lucide-react';
import toast from 'react-hot-toast';

interface AircraftStats {
  id: string;
  registration: string;
  soloHours: number;
  dualHours: number;
  trialFlightHours: number;
  totalLandings: number;
  unpaidFlightHours: number;
  totalHours: number;
  totalBookings: number;
}

export const AircraftStatisticsTab: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [instructorFilter, setInstructorFilter] = useState('');
  const [studentFilter, setStudentFilter] = useState('');
  const [sortField, setSortField] = useState<keyof AircraftStats>('registration');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Calculate aircraft statistics from bookings
  const calculateAircraftStats = (): AircraftStats[] => {
    const stats: { [key: string]: AircraftStats } = {};

    // Initialize stats for all aircraft
    mockAircraft.forEach(aircraft => {
      stats[aircraft.id] = {
        id: aircraft.id,
        registration: aircraft.registration,
        soloHours: 0,
        dualHours: 0,
        trialFlightHours: 0,
        totalLandings: 0,
        unpaidFlightHours: 0,
        totalHours: 0,
        totalBookings: 0
      };
    });

    // Process bookings
    mockBookings.forEach(booking => {
      if (!stats[booking.aircraftId]) return;

      const startTime = new Date(booking.startTime);
      const endTime = new Date(booking.endTime);
      const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

      // Apply filters
      if (dateRange.start && startTime < new Date(dateRange.start)) return;
      if (dateRange.end && startTime > new Date(dateRange.end)) return;
      if (instructorFilter && booking.instructorId !== instructorFilter) return;
      if (studentFilter && booking.studentId !== studentFilter) return;

      const aircraftStat = stats[booking.aircraftId];
      aircraftStat.totalBookings++;

      if (booking.status === 'completed') {
        aircraftStat.totalHours += duration;

        if (booking.instructorId) {
          aircraftStat.dualHours += duration;
          
          // Check if it's a trial flight (first lesson or specific notes)
          if (booking.notes?.toLowerCase().includes('trial') || booking.notes?.toLowerCase().includes('first')) {
            aircraftStat.trialFlightHours += duration;
          }
        } else {
          aircraftStat.soloHours += duration;
        }

        // Estimate landings (rough calculation: 1 landing per 0.5 hours for training flights)
        if (booking.notes?.toLowerCase().includes('circuit') || booking.notes?.toLowerCase().includes('landing')) {
          aircraftStat.totalLandings += Math.ceil(duration * 2);
        } else {
          aircraftStat.totalLandings += Math.ceil(duration);
        }

        // Check for maintenance/unpaid flights
        if (booking.notes?.toLowerCase().includes('maintenance') || booking.notes?.toLowerCase().includes('test')) {
          aircraftStat.unpaidFlightHours += duration;
        }
      }
    });

    return Object.values(stats);
  };

  const aircraftStats = calculateAircraftStats();

  const filteredStats = aircraftStats.filter(stat =>
    stat.registration.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedStats = [...filteredStats].sort((a, b) => {
    let aValue = a[sortField];
    let bValue = b[sortField];

    if (typeof aValue === 'string') {
      aValue = aValue.toLowerCase();
      bValue = (bValue as string).toLowerCase();
    }

    if (sortDirection === 'asc') {
      return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
    } else {
      return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
    }
  });

  const handleSort = (field: keyof AircraftStats) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleExport = (format: 'csv' | 'xlsx') => {
    toast.success(`Exporting aircraft statistics to ${format.toUpperCase()}...`);
  };

  const getSortIcon = (field: keyof AircraftStats) => {
    if (sortField !== field) return '↕️';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search Aircraft</label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search by registration..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Instructor</label>
            <select
              value={instructorFilter}
              onChange={(e) => setInstructorFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Instructors</option>
              {mockStudents.filter(s => s.role === 'instructor').map(instructor => (
                <option key={instructor.id} value={instructor.id}>
                  {instructor.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Student</label>
            <select
              value={studentFilter}
              onChange={(e) => setStudentFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Students</option>
              {mockStudents.filter(s => s.role === 'student').map(student => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-between items-center mt-4">
          <div className="text-sm text-gray-600">
            Showing {sortedStats.length} aircraft
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => handleExport('csv')}
              className="flex items-center space-x-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              <span>CSV</span>
            </button>
            <button
              onClick={() => handleExport('xlsx')}
              className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              <span>XLSX</span>
            </button>
          </div>
        </div>
      </div>

      {/* Statistics Table */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('registration')}
                >
                  Aircraft Registration {getSortIcon('registration')}
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('soloHours')}
                >
                  Solo Hours {getSortIcon('soloHours')}
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('dualHours')}
                >
                  Dual Hours {getSortIcon('dualHours')}
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('trialFlightHours')}
                >
                  Trial Flight Hours {getSortIcon('trialFlightHours')}
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('totalLandings')}
                >
                  Landings {getSortIcon('totalLandings')}
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('unpaidFlightHours')}
                >
                  Unpaid Hours {getSortIcon('unpaidFlightHours')}
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('totalHours')}
                >
                  Total Hours {getSortIcon('totalHours')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedStats.map(stat => (
                <tr key={stat.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {stat.registration}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {stat.soloHours.toFixed(1)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {stat.dualHours.toFixed(1)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {stat.trialFlightHours.toFixed(1)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {stat.totalLandings}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {stat.unpaidFlightHours.toFixed(1)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {stat.totalHours.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sortedStats.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No aircraft statistics found for the selected filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};