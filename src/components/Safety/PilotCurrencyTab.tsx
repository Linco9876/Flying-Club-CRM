import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useStudents } from '../../hooks/useStudents';
import { useBookings } from '../../hooks/useBookings';
import { Download, Search, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

interface PilotCurrency {
  id: string;
  name: string;
  lastFlightDate: Date | null;
  medicalExpiry: Date | null;
  bfrDue: Date | null;
  endorsements: string[];
  daysUntilMedicalExpiry: number;
  daysUntilBfrDue: number;
  urgencyLevel: 'overdue' | 'urgent' | 'warning' | 'current';
}

export const PilotCurrencyTab: React.FC = () => {
  const { user } = useAuth();
  const { students } = useStudents();
  const { bookings } = useBookings();
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [endorsementFilter, setEndorsementFilter] = useState('');

  const calculatePilotCurrency = (): PilotCurrency[] => {
    let pilots = students.filter(s => s.role === 'student');

    if (user?.role === 'student') {
      pilots = pilots.filter(p => p.id === user.id);
    }

    const today = new Date();

    return pilots.map(pilot => {
      const pilotBookings = bookings.filter(b =>
        b.studentId === pilot.id && b.status === 'completed'
      );
      const lastFlightDate = pilotBookings.length > 0 
        ? new Date(Math.max(...pilotBookings.map(b => new Date(b.startTime).getTime())))
        : null;

      // Calculate BFR due date (24 months from last BFR or licence issue)
      const bfrDue = pilot.licenceExpiry 
        ? new Date(pilot.licenceExpiry.getTime() - (365 * 24 * 60 * 60 * 1000)) // 1 year before licence expiry
        : null;

      // Calculate days until expiry
      const daysUntilMedicalExpiry = pilot.medicalExpiry 
        ? Math.ceil((pilot.medicalExpiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        : 999;
      
      const daysUntilBfrDue = bfrDue 
        ? Math.ceil((bfrDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      // Determine urgency level
      const minDays = Math.min(daysUntilMedicalExpiry, daysUntilBfrDue);
      let urgencyLevel: 'overdue' | 'urgent' | 'warning' | 'current';
      
      if (minDays < 0) urgencyLevel = 'overdue';
      else if (minDays <= 30) urgencyLevel = 'urgent';
      else if (minDays <= 60) urgencyLevel = 'warning';
      else urgencyLevel = 'current';

      // Get endorsement labels
      const endorsements = pilot.endorsements
        .filter(e => e.isActive)
        .map(e => e.type.toUpperCase());

      return {
        id: pilot.id,
        name: pilot.name,
        lastFlightDate,
        medicalExpiry: pilot.medicalExpiry || null,
        bfrDue,
        endorsements,
        daysUntilMedicalExpiry,
        daysUntilBfrDue,
        urgencyLevel
      };
    });
  };

  const pilotCurrency = calculatePilotCurrency();

  // Apply filters
  const filteredPilots = pilotCurrency.filter(pilot => {
    const matchesSearch = pilot.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesEndorsement = !endorsementFilter || pilot.endorsements.includes(endorsementFilter);
    
    // Date range filter for last flight
    let matchesDateRange = true;
    if (dateRange.start && pilot.lastFlightDate) {
      matchesDateRange = pilot.lastFlightDate >= new Date(dateRange.start);
    }
    if (dateRange.end && pilot.lastFlightDate) {
      matchesDateRange = matchesDateRange && pilot.lastFlightDate <= new Date(dateRange.end);
    }
    
    return matchesSearch && matchesEndorsement && matchesDateRange;
  });

  // Sort by urgency (most urgent first)
  const sortedPilots = [...filteredPilots].sort((a, b) => {
    const urgencyOrder = { 'overdue': 0, 'urgent': 1, 'warning': 2, 'current': 3 };
    if (urgencyOrder[a.urgencyLevel] !== urgencyOrder[b.urgencyLevel]) {
      return urgencyOrder[a.urgencyLevel] - urgencyOrder[b.urgencyLevel];
    }
    
    // Within same urgency, sort by soonest expiry
    const aMinDays = Math.min(a.daysUntilMedicalExpiry, a.daysUntilBfrDue);
    const bMinDays = Math.min(b.daysUntilMedicalExpiry, b.daysUntilBfrDue);
    return aMinDays - bMinDays;
  });

  const handleExport = (format: 'csv' | 'xlsx') => {
    toast.success(`Exporting pilot currency to ${format.toUpperCase()}...`);
  };

  const getUrgencyColor = (urgencyLevel: string) => {
    switch (urgencyLevel) {
      case 'overdue': return 'bg-red-100 text-red-800 border-red-200';
      case 'urgent': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'current': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getUrgencyIcon = (urgencyLevel: string) => {
    switch (urgencyLevel) {
      case 'overdue': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'urgent': return <Clock className="h-4 w-4 text-orange-600" />;
      case 'warning': return <Clock className="h-4 w-4 text-yellow-600" />;
      case 'current': return <CheckCircle className="h-4 w-4 text-green-600" />;
      default: return null;
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return 'N/A';
    return date.toLocaleDateString();
  };

  const formatDaysUntil = (days: number) => {
    if (days === 999) return 'N/A';
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    return `${days} days`;
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Last Flight From</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Last Flight To</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Endorsement</label>
            <select
              value={endorsementFilter}
              onChange={(e) => setEndorsementFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Endorsements</option>
              <option value="PC">Pilot Certificate</option>
              <option value="PASSENGER">Passenger Carrying</option>
              <option value="CROSS-COUNTRY">Cross Country</option>
              <option value="RADIO">Radio Operator</option>
              <option value="NAVIGATION">Navigation</option>
            </select>
          </div>
        </div>

        <div className="flex justify-between items-center mt-4">
          <div className="text-sm text-gray-600">
            Showing {sortedPilots.length} pilots
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

      {/* Currency Table */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Pilot Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Flight Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Medical Expiry
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  BFR Due Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Endorsements
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedPilots.map(pilot => (
                <tr key={pilot.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      {getUrgencyIcon(pilot.urgencyLevel)}
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getUrgencyColor(pilot.urgencyLevel)}`}>
                        {pilot.urgencyLevel.charAt(0).toUpperCase() + pilot.urgencyLevel.slice(1)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {pilot.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(pilot.lastFlightDate)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div>
                      <div>{formatDate(pilot.medicalExpiry)}</div>
                      {pilot.medicalExpiry && (
                        <div className="text-xs text-gray-500">
                          {formatDaysUntil(pilot.daysUntilMedicalExpiry)}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div>
                      <div>{formatDate(pilot.bfrDue)}</div>
                      {pilot.bfrDue && (
                        <div className="text-xs text-gray-500">
                          {formatDaysUntil(pilot.daysUntilBfrDue)}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div className="flex flex-wrap gap-1">
                      {pilot.endorsements.map(endorsement => (
                        <span
                          key={endorsement}
                          className="inline-flex px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full"
                        >
                          {endorsement}
                        </span>
                      ))}
                      {pilot.endorsements.length === 0 && (
                        <span className="text-gray-500">None</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sortedPilots.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No pilots found matching the selected filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};