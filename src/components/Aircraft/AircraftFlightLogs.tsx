import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plane, ArrowLeft, Calendar, Clock, User, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAircraft } from '../../hooks/useAircraft';

interface FlightLog {
  id: string;
  booking_id: string;
  tach_start: number;
  tach_end: number;
  duration: number;
  landings: number;
  total_cost: number;
  notes: string;
  created_at: string;
  booking: {
    start_time: string;
    end_time: string;
    student: {
      id: string;
      name: string;
    };
    instructor: {
      id: string;
      name: string;
    } | null;
  };
}

export const AircraftFlightLogs: React.FC = () => {
  const { aircraftId } = useParams<{ aircraftId: string }>();
  const navigate = useNavigate();
  const { aircraft: allAircraft } = useAircraft();
  const [flightLogs, setFlightLogs] = useState<FlightLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const aircraft = allAircraft.find(a => a.id === aircraftId);

  useEffect(() => {
    if (!aircraftId) return;

    const fetchFlightLogs = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: bookingsData, error: bookingsError } = await supabase
          .from('bookings')
          .select('id, start_time, end_time, aircraft_id, student_id, instructor_id')
          .eq('aircraft_id', aircraftId)
          .not('flight_logged', 'is', null);

        if (bookingsError) throw bookingsError;

        const bookingIds = bookingsData?.map(b => b.id) || [];

        if (bookingIds.length === 0) {
          setFlightLogs([]);
          setLoading(false);
          return;
        }

        const { data: logsData, error: logsError } = await supabase
          .from('flight_logs')
          .select('*')
          .in('booking_id', bookingIds)
          .order('created_at', { ascending: false });

        if (logsError) throw logsError;

        const studentIds = [...new Set(bookingsData?.map(b => b.student_id) || [])];
        const instructorIds = [...new Set(bookingsData?.map(b => b.instructor_id).filter(Boolean) || [])];

        const { data: studentsData } = await supabase
          .from('students')
          .select('id, name')
          .in('id', studentIds);

        const { data: instructorsData } = await supabase
          .from('students')
          .select('id, name')
          .in('id', instructorIds);

        const studentsMap = new Map(studentsData?.map(s => [s.id, s]) || []);
        const instructorsMap = new Map(instructorsData?.map(i => [i.id, i]) || []);

        const combinedLogs: FlightLog[] = (logsData || []).map(log => {
          const booking = bookingsData?.find(b => b.id === log.booking_id);
          return {
            id: log.id,
            booking_id: log.booking_id,
            tach_start: parseFloat(log.tach_start),
            tach_end: parseFloat(log.tach_end),
            duration: parseFloat(log.duration),
            landings: log.landings,
            total_cost: parseFloat(log.total_cost),
            notes: log.notes,
            created_at: log.created_at,
            booking: {
              start_time: booking?.start_time || '',
              end_time: booking?.end_time || '',
              student: studentsMap.get(booking?.student_id || '') || { id: '', name: 'Unknown' },
              instructor: booking?.instructor_id ? instructorsMap.get(booking.instructor_id) || null : null
            }
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

  const totalFlightHours = flightLogs.reduce((sum, log) => sum + log.duration, 0);
  const totalLandings = flightLogs.reduce((sum, log) => sum + log.landings, 0);
  const totalRevenue = flightLogs.reduce((sum, log) => sum + log.total_cost, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/aircraft')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center">
              <Plane className="h-6 w-6 mr-2 text-blue-600" />
              {aircraft.registration} Flight Logs
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              {aircraft.make} {aircraft.model}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Flight Hours</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{totalFlightHours.toFixed(1)}</p>
            </div>
            <Clock className="h-8 w-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Landings</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{totalLandings}</p>
            </div>
            <Plane className="h-8 w-8 text-green-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Revenue</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">${totalRevenue.toFixed(2)}</p>
            </div>
            <FileText className="h-8 w-8 text-yellow-600" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Flight History</h2>
          <p className="text-sm text-gray-600 mt-1">{flightLogs.length} total flights</p>
        </div>

        {flightLogs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No flight logs found for this aircraft
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {flightLogs.map((log) => (
              <div key={log.id} className="p-6 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-4 mb-3">
                      <div className="flex items-center text-sm text-gray-600">
                        <Calendar className="h-4 w-4 mr-1" />
                        {new Date(log.booking.start_time).toLocaleDateString()}
                      </div>
                      <div className="flex items-center text-sm text-gray-600">
                        <Clock className="h-4 w-4 mr-1" />
                        {new Date(log.booking.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -
                        {new Date(log.booking.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                      <div>
                        <p className="text-xs text-gray-500">Student</p>
                        <div className="flex items-center mt-1">
                          <User className="h-3 w-3 mr-1 text-gray-400" />
                          <p className="text-sm font-medium text-gray-900">{log.booking.student.name}</p>
                        </div>
                      </div>

                      {log.booking.instructor && (
                        <div>
                          <p className="text-xs text-gray-500">Instructor</p>
                          <div className="flex items-center mt-1">
                            <User className="h-3 w-3 mr-1 text-gray-400" />
                            <p className="text-sm font-medium text-gray-900">{log.booking.instructor.name}</p>
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="text-xs text-gray-500">Tach Time</p>
                        <p className="text-sm font-medium text-gray-900 mt-1">
                          {log.tach_start.toFixed(1)} - {log.tach_end.toFixed(1)}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-gray-500">Duration</p>
                        <p className="text-sm font-medium text-gray-900 mt-1">{log.duration.toFixed(1)} hrs</p>
                      </div>

                      <div>
                        <p className="text-xs text-gray-500">Landings</p>
                        <p className="text-sm font-medium text-gray-900 mt-1">{log.landings}</p>
                      </div>

                      <div>
                        <p className="text-xs text-gray-500">Cost</p>
                        <p className="text-sm font-medium text-gray-900 mt-1">${log.total_cost.toFixed(2)}</p>
                      </div>
                    </div>

                    {log.notes && (
                      <div className="mt-3">
                        <p className="text-xs text-gray-500">Notes</p>
                        <p className="text-sm text-gray-700 mt-1">{log.notes}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
