import React, { useState } from 'react';
import { mockBookings, mockStudents, mockAircraft } from '../../data/mockData';
import { Download, Search, Filter } from 'lucide-react';
import toast from 'react-hot-toast';

interface PilotStats {
  id: string;
  name: string;
  totalBookings: number;
  totalHours: number;
  cancelledFlights: number;
  soloHours: number;
  dualHours: number;
}

export const PilotStatisticsTab: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [aircraftFilter, setAircraftFilter] = useState('');
  const [instructorFilter, setInstructorFilter] = useState('');
  const [sortField, setSortField] = useState<keyof PilotStats>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Calculate pilot statistics from bookings
  const calculatePilotStats = (): PilotStats[] => {
    const stats: { [key: string]: PilotStats } = {};

    // Initialize stats for all students
    mockStudents.filter(s => s.role === 'student').forEach(student => {
      stats[student.id] = {
        id: student.id,
        name: student.name,
        totalBookings: 0,
        totalHours: 0,
        cancelledFlights: 0,
        soloHours: 0,
        dualHours: 0
      };
    });

    // Process bookings
    mockBookings.forEach(booking => {
      if (!stats[booking.studentId]) return;

      const startTime = new Date(booking.startTime);
      const endTime = new Date(booking.endTime);
      const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

      // Apply filters
      if (dateRange.start && startTime < new Date(dateRange.start)) return;
      if (dateRange.end && startTime > new Date(dateRange.end)) return;
      if (aircraftFilter && booking.aircraftId !== aircraftFilter) return;
      if (instructorFilter && booking.instructorId !== instructorFilter) return;

      stats[booking.studentId].totalBookings++;

      if (booking.status === 'cancelled') {
        stats[booking.studentId].cancelledFlights++;
      } else if (booking.status === 'completed') {
        stats[booking.studentId].totalHours += duration;
        
        if (booking.instructorId) {
          stats[booking.studentId].dualHours += duration;
        } else {
          stats[booking.studentId].soloHours += duration;
        }
      }
    });

    return Object.values(stats);
  };

  const pilotStats = calculatePilotStats();

  const filteredStats = pilotStats.filter(stat =>
    stat.name.toLowerCase().includes(searchTerm.toLowerCase())
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

  const handleSort = (field: keyof PilotStats) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleExport = (format: 'csv' | 'xlsx') => {
    toast.success(`Exporting pilot statistics to ${format.toUpperCase()}...`);
  };

  const getSortIcon = (field: keyof PilotStats) => {
    if (sortField !== field) return '↕️';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search Pilot</label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search by name..."
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Aircraft</label>
            <select
              value={aircraftFilter}
              onChange={(e) => setAircraftFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Aircraft</option>
              {mockAircraft.map(aircraft => (
                <option key={aircraft.id} value={aircraft.id}>
                  {aircraft.registration}
                </option>
              ))}
            </select>
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
        </div>

        <div className="flex justify-between items-center mt-4">
          <div className="text-sm text-gray-600">
            Showing {sortedStats.length} pilots
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
                  onClick={() => handleSort('name')}
                >
                  Pilot Name {getSortIcon('name')}
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('totalBookings')}
                >
                  Total Bookings {getSortIcon('totalBookings')}
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('totalHours')}
                >
                  Total Hours {getSortIcon('totalHours')}
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('dualHours')}
                >
                  Dual Hours {getSortIcon('dualHours')}
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('soloHours')}
                >
                  Solo Hours {getSortIcon('soloHours')}
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('cancelledFlights')}
                >
                  Cancelled Flights {getSortIcon('cancelledFlights')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedStats.map(stat => (
                <tr key={stat.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {stat.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {stat.totalBookings}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {stat.totalHours.toFixed(1)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {stat.dualHours.toFixed(1)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {stat.soloHours.toFixed(1)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {stat.cancelledFlights}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sortedStats.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No pilot statistics found for the selected filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};