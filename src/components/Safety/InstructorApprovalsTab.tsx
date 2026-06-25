import React, { useMemo, useState } from 'react';
import { useStudents } from '../../hooks/useStudents';
import { useSafetySettings } from '../../hooks/useSafetySettings';
import { Download, Search, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

interface InstructorApproval {
  id: string;
  name: string;
  level: 'Instructor' | 'Senior Instructor';
  spCheckDue: Date;
  intervalMonths: number;
  flightRestrictions: string[];
  supervisionRequired: boolean;
  daysUntilSpCheck: number;
  urgencyLevel: 'overdue' | 'urgent' | 'warning' | 'current';
}

export const InstructorApprovalsTab: React.FC = () => {
  const { students } = useStudents();
  const { settings } = useSafetySettings();
  const [searchTerm, setSearchTerm] = useState('');

  const instructorApprovals = useMemo<InstructorApproval[]>(() => {
    const instructors = students.filter((student) =>
      student.role === 'instructor' ||
      student.role === 'senior_instructor' ||
      student.roles?.includes('instructor') ||
      student.roles?.includes('senior_instructor')
    );

    const today = new Date();

    return instructors.map((instructor) => {
      const isSeniorInstructor =
        instructor.role === 'senior_instructor' ||
        instructor.roles?.includes('senior_instructor') ||
        instructor.isSeniorInstructor === true;

      const level: InstructorApproval['level'] = isSeniorInstructor ? 'Senior Instructor' : 'Instructor';
      const intervalMonths = isSeniorInstructor
        ? settings.seniorInstructorSopCheckMonths
        : settings.instructorSopCheckMonths;

      const lastCheck = instructor.lastFlightReview || new Date(0);
      const spCheckDue = new Date(lastCheck);
      spCheckDue.setMonth(spCheckDue.getMonth() + intervalMonths);

      const daysUntilSpCheck = Math.ceil((spCheckDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      let urgencyLevel: InstructorApproval['urgencyLevel'];
      if (daysUntilSpCheck < 0) urgencyLevel = 'overdue';
      else if (daysUntilSpCheck <= 30) urgencyLevel = 'urgent';
      else if (daysUntilSpCheck <= 60) urgencyLevel = 'warning';
      else urgencyLevel = 'current';

      const flightRestrictions: string[] = [];
      const supervisionRequired = !instructor.lastFlightReview || daysUntilSpCheck < 0;
      if (!instructor.lastFlightReview) {
        flightRestrictions.push('No S&P check date recorded');
      } else if (daysUntilSpCheck < 0) {
        flightRestrictions.push('S&P check overdue');
      }
      if (supervisionRequired) {
        flightRestrictions.push('Senior instructor supervision required');
      }

      return {
        id: instructor.id,
        name: instructor.name,
        level,
        spCheckDue,
        intervalMonths,
        flightRestrictions,
        supervisionRequired,
        daysUntilSpCheck,
        urgencyLevel,
      };
    });
  }, [settings.instructorSopCheckMonths, settings.seniorInstructorSopCheckMonths, students]);

  const filteredInstructors = instructorApprovals.filter((instructor) =>
    instructor.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedInstructors = [...filteredInstructors].sort((a, b) => {
    const urgencyOrder = { overdue: 0, urgent: 1, warning: 2, current: 3 };
    if (urgencyOrder[a.urgencyLevel] !== urgencyOrder[b.urgencyLevel]) {
      return urgencyOrder[a.urgencyLevel] - urgencyOrder[b.urgencyLevel];
    }
    return a.daysUntilSpCheck - b.daysUntilSpCheck;
  });

  const handleExport = () => {
    const rows = sortedInstructors.map((instructor) => [
      instructor.name,
      instructor.level,
      instructor.urgencyLevel,
      formatDate(instructor.spCheckDue),
      `${instructor.intervalMonths} month${instructor.intervalMonths === 1 ? '' : 's'}`,
      instructor.flightRestrictions.join('; '),
      instructor.supervisionRequired ? 'Yes' : 'No',
    ]);

    const csv = [[
      'Instructor',
      'Level',
      'Status',
      'S&P Check Due',
      'Interval',
      'Restrictions',
      'Supervision Required',
    ], ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'instructor-approvals.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const getUrgencyColor = (urgencyLevel: string) => {
    switch (urgencyLevel) {
      case 'overdue':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'urgent':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'current':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getUrgencyIcon = (urgencyLevel: string) => {
    switch (urgencyLevel) {
      case 'overdue':
        return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'urgent':
        return <Clock className="h-4 w-4 text-orange-600" />;
      case 'warning':
        return <Clock className="h-4 w-4 text-yellow-600" />;
      case 'current':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      default:
        return null;
    }
  };

  const formatDate = (date: Date) => date.toLocaleDateString();

  const formatDaysUntil = (days: number) => {
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    return `${days} days`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search instructor</label>
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
          <button
            onClick={handleExport}
            className="flex items-center space-x-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

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
                  Level
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  S&amp;P Check Due
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Check Interval
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
              {sortedInstructors.map((instructor) => (
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
                    {instructor.level}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div>
                      <div>{formatDate(instructor.spCheckDue)}</div>
                      <div className="text-xs text-gray-500">
                        {formatDaysUntil(instructor.daysUntilSpCheck)}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {instructor.intervalMonths} month{instructor.intervalMonths === 1 ? '' : 's'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div className="flex flex-wrap gap-1">
                      {instructor.flightRestrictions.map((restriction) => (
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
                        Senior required
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
