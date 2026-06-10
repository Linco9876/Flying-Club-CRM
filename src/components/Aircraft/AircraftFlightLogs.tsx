import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plane, ArrowLeft, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAircraft } from '../../hooks/useAircraft';

interface FlightLog {
  id: string;
  booking_id: string | null;
  aircraft_id: string;
  student_id: string;
  instructor_id: string | null;
  start_time: string;
  end_time: string;
  start_tach: number;
  end_tach: number;
  flight_duration: number;
  landings: number;
  payment_type: string | null;
  observations: string | null;
  created_at: string;
  student_name: string;
  instructor_name: string | null;
  total_cost: number;
}

export const AircraftFlightLogs: React.FC = () => {
  const { aircraftId } = useParams<{ aircraftId: string }>();
  const navigate = useNavigate();
  const { aircraft: allAircraft } = useAircraft();
  const [flightLogs, setFlightLogs] = useState<FlightLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(
    new Date().toISOString().slice(0, 7)
  );

  const aircraft = allAircraft.find(a => a.id === aircraftId);

  useEffect(() => {
    if (!aircraftId) return;

    const fetchFlightLogs = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: logsData, error: logsError } = await supabase
          .from('flight_logs')
          .select('*')
          .eq('aircraft_id', aircraftId)
          .order('created_at', { ascending: false });

        if (logsError) throw logsError;

        const studentIds = [...new Set(logsData?.map((log: any) => log.student_id) || [])];
        const instructorIds = [...new Set(
          logsData
            ?.map((log: any) => log.instructor_id)
            .filter((id): id is string => id !== null) || []
        )];

        const allUserIds = [...new Set([...studentIds, ...instructorIds])];

        const { data: usersData } = await supabase
          .from('users')
          .select('id, name')
          .in('id', allUserIds);

        const usersMap = new Map(usersData?.map(u => [u.id, u.name]) || []);

        const { data: ratesData } = await supabase
          .from('aircraft_rates')
          .select('*')
          .eq('aircraft_id', aircraftId);

        const tachRate = ratesData?.find(r => r.rate_type === 'tach')?.amount || 0;

        const combinedLogs: FlightLog[] = (logsData || []).map((log: any) => {
          const tachTime = parseFloat(log.end_tach) - parseFloat(log.start_tach);
          const calculatedCost = tachTime * parseFloat(tachRate);

          return {
            id: log.id,
            booking_id: log.booking_id,
            aircraft_id: log.aircraft_id,
            student_id: log.student_id,
            instructor_id: log.instructor_id,
            start_time: log.start_time,
            end_time: log.end_time,
            start_tach: parseFloat(log.start_tach),
            end_tach: parseFloat(log.end_tach),
            flight_duration: parseFloat(log.flight_duration),
            landings: log.landings || 0,
            payment_type: log.payment_type,
            observations: log.observations,
            created_at: log.created_at,
            student_name: usersMap.get(log.student_id) || 'Unknown',
            instructor_name: log.instructor_id ? usersMap.get(log.instructor_id) || 'Unknown' : null,
            total_cost: calculatedCost
          };
        });

        setFlightLogs(combinedLogs);
      } catch (err) {
        console.error('Error fetching flight logs:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch flight logs');
      } finally {
        setLoading(false);
      }
    };

    fetchFlightLogs();
  }, [aircraftId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading flight logs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  if (!aircraft) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Aircraft not found</div>
      </div>
    );
  }

  const filteredLogs = flightLogs.filter(log => {
    const logDate = new Date(log.start_time);
    const logMonth = logDate.toISOString().slice(0, 7);
    return logMonth === selectedMonth;
  });

  const totalFlightHours = filteredLogs.reduce((sum, log) => sum + log.flight_duration, 0);
  const totalLandings = filteredLogs.reduce((sum, log) => sum + log.landings, 0);
  const totalRevenue = filteredLogs.reduce((sum, log) => sum + log.total_cost, 0);

  const availableMonths = Array.from(
    new Set(
      flightLogs.map(log => new Date(log.start_time).toISOString().slice(0, 7))
    )
  ).sort().reverse();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigate('/aircraft')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center">
              <Plane className="h-5 w-5 mr-2 text-blue-600" />
              Aircraft flight log for {aircraft.registration}
            </h1>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-600">
            Below, the logs for
          </div>
          <div className="flex items-center space-x-2">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1"
            >
              {availableMonths.map(month => {
                const [year, monthNum] = month.split('-');
                const date = new Date(parseInt(year), parseInt(monthNum) - 1);
                const monthName = date.toLocaleDateString('en-US', { month: 'long' });
                return (
                  <option key={month} value={month}>
                    {monthName} {year}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="py-8 text-center text-gray-500 text-sm">
            No flight logs found for this period
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">Date</th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">Crew</th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">Duration</th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">Flight type</th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">Landings</th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">Observation</th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">Tach</th>
                  <th className="text-center py-2 px-2 font-semibold text-gray-700">Price</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log, index) => {
                  const startDate = new Date(log.start_time);
                  const endDate = new Date(log.end_time);
                  const isAlternateRow = index % 2 === 1;

                  return (
                    <tr key={log.id} className={`border-b border-gray-200 ${isAlternateRow ? 'bg-blue-50' : 'bg-white'}`}>
                      <td className="py-3 px-2 text-center align-middle">
                        <div className="flex flex-col items-center justify-center space-y-1">
                          <div className="flex items-center space-x-1">
                            <Calendar className="h-3 w-3 text-gray-400" />
                            <span>{startDate.toLocaleDateString('en-GB')}</span>
                          </div>
                          <div className="flex items-center space-x-1 text-gray-500">
                            <Calendar className="h-3 w-3 text-gray-400" />
                            <span>{endDate.toLocaleDateString('en-GB')}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center align-middle">
                        <div className="flex flex-col items-center justify-center space-y-1">
                          <div className="flex items-center space-x-1">
                            <span className="inline-block w-3 h-3 bg-blue-500 rounded-full"></span>
                            <span className="text-gray-600">Pilot:</span>
                            <span className="text-blue-600">{log.student_name}</span>
                          </div>
                          {log.instructor_name && (
                            <div className="flex items-center space-x-1">
                              <span className="inline-block w-3 h-3 bg-green-500 rounded-full"></span>
                              <span className="text-gray-600">Instructor:</span>
                              <span className="text-blue-600">{log.instructor_name}</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center align-middle">
                        <div>{log.flight_duration.toFixed(2)}</div>
                        <div className="text-gray-500 text-xs">hours</div>
                      </td>
                      <td className="py-3 px-2 text-center align-middle">
                        <div>{log.payment_type || 'Pre-Paid'}</div>
                      </td>
                      <td className="py-3 px-2 text-center align-middle">
                        <div>{log.landings}</div>
                      </td>
                      <td className="py-3 px-2 text-center align-middle">
                        {log.observations && (
                          <div className="text-gray-700">{log.observations}</div>
                        )}
                      </td>
                      <td className="py-3 px-2 text-center align-middle">
                        <div className="flex flex-col items-center justify-center space-y-3">
                          <div className="text-center">
                            <div className="flex items-center justify-center space-x-1">
                              {log.start_tach.toFixed(1).split('.')[0].split('').map((digit, i) => (
                                <span key={`start-${i}`} className="inline-block border border-gray-400 px-1 min-w-[20px] text-center">{digit}</span>
                              ))}
                              <span className="inline-block border border-red-400 bg-red-100 px-1 min-w-[20px] text-center">{log.start_tach.toFixed(1).split('.')[1]}</span>
                            </div>
                            <div className="text-gray-500 text-xs mt-1">hours/hundredths</div>
                          </div>
                          <div className="text-center">
                            <div className="flex items-center justify-center space-x-1">
                              {log.end_tach.toFixed(1).split('.')[0].split('').map((digit, i) => (
                                <span key={`end-${i}`} className="inline-block border border-gray-400 px-1 min-w-[20px] text-center">{digit}</span>
                              ))}
                              <span className="inline-block border border-red-400 bg-red-100 px-1 min-w-[20px] text-center">{log.end_tach.toFixed(1).split('.')[1]}</span>
                            </div>
                            <div className="text-gray-500 text-xs mt-1">hours/hundredths</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center align-middle">
                        <div className="flex flex-col items-center justify-center space-y-1">
                          <div className="font-medium">AUD{log.total_cost.toFixed(2)}</div>
                          <div className="text-gray-500 text-xs">Paid AUD{log.total_cost.toFixed(2)}</div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-600">Total Flight Hours</p>
            <p className="text-lg font-bold text-gray-900">{totalFlightHours.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-gray-600">Total Landings</p>
            <p className="text-lg font-bold text-gray-900">{totalLandings}</p>
          </div>
          <div>
            <p className="text-gray-600">Total Revenue</p>
            <p className="text-lg font-bold text-gray-900">AUD{totalRevenue.toFixed(2)}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
