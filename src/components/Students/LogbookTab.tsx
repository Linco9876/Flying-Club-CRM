import React, { useMemo } from 'react';
import { BookOpen, Clock, TrendingUp, Navigation } from 'lucide-react';
import { useFlightLogs, FlightLog } from '../../hooks/useFlightLogs';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';

interface LogbookTabProps {
  userId: string;
  userName: string;
  isInstructor: boolean;
}

export const LogbookTab: React.FC<LogbookTabProps> = ({ userId, userName, isInstructor }) => {
  const { flightLogs, loading } = useFlightLogs(userId);
  const { aircraft: aircraftList } = useAircraft();
  const { users } = useUsers();

  const enrichedLogs = useMemo(() => {
    return flightLogs.map(log => {
      const aircraft = aircraftList.find(a => a.id === log.aircraft_id);
      const student = users.find(u => u.id === log.student_id);
      const instructor = log.instructor_id ? users.find(u => u.id === log.instructor_id) : null;

      const isDual = !!log.instructor_id;

      const pilotInCommand = instructor ? instructor.name : (student?.name || 'Unknown');
      let otherPilotOrCrew: string;
      if (isInstructor) {
        otherPilotOrCrew = student?.name || 'Unknown';
      } else {
        otherPilotOrCrew = isDual ? 'Self' : 'Self';
      }

      const hoursAsPIC = isInstructor ? (log.solo_time || 0) : (isDual ? 0 : (log.solo_time || 0));
      const hoursInstructor = isInstructor ? (log.dual_time || 0) : 0;
      const hoursDual = !isInstructor ? (log.dual_time || 0) : 0;
      const hoursSolo = !isInstructor ? (log.solo_time || 0) : 0;

      return {
        ...log,
        aircraft,
        student,
        instructor,
        pilotInCommand,
        otherPilotOrCrew,
        hoursAsPIC,
        hoursInstructor,
        hoursDual,
        hoursSolo,
      };
    });
  }, [flightLogs, aircraftList, users, isInstructor]);

  const totals = useMemo(() => {
    return enrichedLogs.reduce(
      (acc, log) => ({
        totalHours: acc.totalHours + (log.flight_duration || 0),
        dualHours: acc.dualHours + (log.dual_time || 0),
        soloHours: acc.soloHours + (log.solo_time || 0),
        takeoffs: acc.takeoffs + (log.takeoffs || 0),
        landings: acc.landings + (log.landings || 0),
      }),
      { totalHours: 0, dualHours: 0, soloHours: 0, takeoffs: 0, landings: 0 }
    );
  }, [enrichedLogs]);

  const formatHours = (hours: number) => hours.toFixed(1);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '–';
    return new Date(dateStr).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-gray-200 rounded-lg h-20"></div>
            ))}
          </div>
          <div className="bg-gray-200 rounded-lg h-64"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Hours</p>
              <p className="text-xl font-bold text-gray-900">{formatHours(totals.totalHours)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {isInstructor ? 'Instructed' : 'Dual'}
              </p>
              <p className="text-xl font-bold text-gray-900">{formatHours(totals.dualHours)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <BookOpen className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Solo / PIC</p>
              <p className="text-xl font-bold text-gray-900">{formatHours(totals.soloHours)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-sky-100 rounded-lg">
              <Navigation className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Landings</p>
              <p className="text-xl font-bold text-gray-900">{totals.landings}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Logbook Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900 flex items-center space-x-2">
            <BookOpen className="h-5 w-5 text-gray-600" />
            <span>Flight Logbook — {userName}</span>
          </h3>
          <p className="text-sm text-gray-500 mt-1">{enrichedLogs.length} entries</p>
        </div>

        {enrichedLogs.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="h-14 w-14 text-gray-300 mx-auto mb-4" />
            <h4 className="text-lg font-medium text-gray-900 mb-1">No logbook entries yet</h4>
            <p className="text-gray-500 text-sm">Entries will appear here after flights are logged.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Aircraft Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Rego
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Pilot in Command
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    {isInstructor ? 'Student' : 'Other / Crew'}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Dual (hrs)
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Solo (hrs)
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    T/O
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                    Ldg
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Comments
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {enrichedLogs.map((log, index) => (
                  <tr
                    key={log.id}
                    className={`hover:bg-gray-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                  >
                    <td className="px-4 py-3 text-gray-900 whitespace-nowrap font-medium">
                      {formatDate(log.start_time)}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {log.aircraft ? `${log.aircraft.make} ${log.aircraft.model}` : '–'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        {log.aircraft?.registration || '–'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-900 whitespace-nowrap">
                      {log.pilotInCommand}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {log.otherPilotOrCrew}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(log.dual_time || 0) > 0 ? (
                        <span className="inline-flex items-center justify-center w-14 py-0.5 rounded text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                          {formatHours(log.dual_time || 0)}
                        </span>
                      ) : (
                        <span className="text-gray-400">–</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(log.solo_time || 0) > 0 ? (
                        <span className="inline-flex items-center justify-center w-14 py-0.5 rounded text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
                          {formatHours(log.solo_time || 0)}
                        </span>
                      ) : (
                        <span className="text-gray-400">–</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 font-medium">
                      {log.takeoffs ?? '–'}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 font-medium">
                      {log.landings ?? '–'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs">
                      <span className="line-clamp-2 text-sm">
                        {log.comments || '–'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals Row */}
              <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-xs font-bold text-gray-700 uppercase tracking-wide">
                    Totals ({enrichedLogs.length} flights)
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center justify-center w-14 py-0.5 rounded text-xs font-bold bg-green-100 text-green-800 border border-green-300">
                      {formatHours(totals.dualHours)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center justify-center w-14 py-0.5 rounded text-xs font-bold bg-orange-100 text-orange-800 border border-orange-300">
                      {formatHours(totals.soloHours)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-gray-800">{totals.takeoffs}</td>
                  <td className="px-4 py-3 text-center font-bold text-gray-800">{totals.landings}</td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
