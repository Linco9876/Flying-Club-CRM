import React, { useState } from 'react';
import { mockStudents } from '../../data/mockData';
import { Download, Search, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

interface InstructorApproval {
  id: string;
  name: string;
  standardsCheckDue: Date;
  proficiencyCheckDue: Date;
  flightRestrictions: string[];
  supervisionRequired: boolean;
  daysUntilStandardsCheck: number;
  daysUntilProficiencyCheck: number;
  urgencyLevel: 'overdue' | 'urgent' | 'warning' | 'current';
}

export const InstructorApprovalsTab: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');

  // Calculate instructor approval data
  const calculateInstructorApprovals = (): InstructorApproval[] => {
    const instructors = mockStudents.filter(s => s.role === 'instructor');
    const today = new Date();

    return instructors.map(instructor => {
      // Mock dates - in real app these would come from instructor records
      const standardsCheckDue = new Date(today.getTime() + (Math.random() * 365 - 180) * 24 * 60 * 60 * 1000);
      const proficiencyCheckDue = new Date(today.getTime() + (Math.random() * 365 - 180) * 24 * 60 * 60 * 1000);

      // Calculate days until due
      const daysUntilStandardsCheck = Math.ceil((standardsCheckDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const daysUntilProficiencyCheck = Math.ceil((proficiencyCheckDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Determine urgency level
      const minDays = Math.min(daysUntilStandardsCheck, daysUntilProficiencyCheck);
      let urgencyLevel: 'overdue' | 'urgent' | 'warning' | 'current';
      
      if (minDays < 0) urgencyLevel = 'overdue';
      else if (minDays <= 30) urgencyLevel = 'urgent';
      else if (minDays <= 60) urgencyLevel = 'warning';
      else urgencyLevel = 'current';

      // Mock restrictions and supervision requirements
      const flightRestrictions: string[] = [];
      const supervisionRequired = Math.random() > 0.8; // 20% chance

      if (Math.random() > 0.9) flightRestrictions.push('No night flying');
      if (Math.random() > 0.95) flightRestrictions.push('Local area only');
      if (supervisionRequired) flightRestrictions.push('Requires supervision');

      return {
        id: instructor.id,
        name: instructor.name,
        standardsCheckDue,
        proficiencyCheckDue,
        flightRestrictions,
        supervisionRequired,
        daysUntilStandardsCheck,
        daysUntilProficiencyCheck,
        urgencyLevel
      };
    });
  };

  const instructorApprovals = calculateInstructorApprovals();

  // Apply filters
  const filteredInstructors = instructorApprovals.filter(instructor =>
    instructor.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Sort by urgency (most urgent first)
  const sortedInstructors = [...filteredInstructors].sort((a, b) => {
    const urgencyOrder = { 'overdue': 0, 'urgent': 1, 'warning': 2, 'current': 3 };
    if (urgencyOrder[a.urgencyLevel] !== urgencyOrder[b.urgencyLevel]) {
      return urgencyOrder[a.urgencyLevel] - urgencyOrder[b.urgencyLevel];
    }
    
    // Within same urgency, sort by soonest expiry
    const aMinDays = Math.min(a.daysUntilStandardsCheck, a.daysUntilProficiencyCheck);
    const bMinDays = Math.min(b.daysUntilStandardsCheck, b.daysUntilProficiencyCheck);
    return aMinDays - bMinDays;
  });

  const handleExport = (format: 'csv' | 'xlsx') => {
    toast.success(`Exporting instructor approvals to ${format.toUpperCase()}...`);
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

  const formatDate = (date: Date) => {
    return date.toLocaleDateString();
  };

  const formatDaysUntil = (days: number) => {
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    return `${days} days`;
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search Instructor</label>
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
        </div>

        <div className="flex justify-between items-center mt-4">
          <div className="text-sm text-gray-600">
            Showing {sortedInstructors.length} instructors
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

      {/* Approvals Table */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Instructor Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Standards Check Due
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Proficiency Check Due
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Flight Restrictions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Supervision Required
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedInstructors.map(instructor => (
                <tr key={instructor.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      {getUrgencyIcon(instructor.urgencyLevel)}
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getUrgencyColor(instructor.urgencyLevel)}`}>
                        {instructor.urgencyLevel.charAt(0).toUpperCase() + instructor.urgencyLevel.slice(1)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {instructor.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div>
                      <div>{formatDate(instructor.standardsCheckDue)}</div>
                      <div className="text-xs text-gray-500">
                        {formatDaysUntil(instructor.daysUntilStandardsCheck)}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div>
                      <div>{formatDate(instructor.proficiencyCheckDue)}</div>
                      <div className="text-xs text-gray-500">
                        {formatDaysUntil(instructor.daysUntilProficiencyCheck)}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div className="flex flex-wrap gap-1">
                      {instructor.flightRestrictions.map(restriction => (
                        <span
                          key={restriction}
                          className="inline-flex px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full"
                        >
                          {restriction}
                        </span>
                      ))}
                      {instructor.flightRestrictions.length === 0 && (
                        <span className="text-green-600">None</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {instructor.supervisionRequired ? (
                      <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                        Required
                      </span>
                    ) : (
                      <span className="text-green-600">No</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sortedInstructors.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No instructors found matching the selected filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};