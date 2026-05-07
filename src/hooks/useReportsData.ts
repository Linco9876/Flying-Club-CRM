import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface ReportFlightLog {
  id: string;
  booking_id?: string;
  aircraft_id: string;
  student_id: string;
  instructor_id?: string;
  start_time: string;
  end_time: string;
  flight_duration: number;
  dual_time: number;
  solo_time: number;
  landings?: number;
  takeoffs?: number;
  payment_type?: string;
}

export interface ReportBooking {
  id: string;
  student_id: string;
  instructor_id?: string;
  aircraft_id: string;
  start_time: string;
  end_time: string;
  status: string;
  flight_logged: boolean;
}

export interface ReportUser {
  id: string;
  name: string;
  email: string;
  role: string;
  roles: string[];
}

export interface ReportAircraft {
  id: string;
  registration: string;
  make: string;
  model: string;
  status: string;
  total_hours: number;
}

export interface ReportsData {
  flightLogs: ReportFlightLog[];
  bookings: ReportBooking[];
  users: ReportUser[];
  aircraft: ReportAircraft[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useReportsData(): ReportsData {
  const [flightLogs, setFlightLogs] = useState<ReportFlightLog[]>([]);
  const [bookings, setBookings] = useState<ReportBooking[]>([]);
  const [users, setUsers] = useState<ReportUser[]>([]);
  const [aircraft, setAircraft] = useState<ReportAircraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError(null);

      const [logsRes, bookingsRes, usersRes, rolesRes, aircraftRes] = await Promise.all([
        supabase
          .from('flight_logs')
          .select('id,booking_id,aircraft_id,student_id,instructor_id,start_time,end_time,flight_duration,dual_time,solo_time,landings,takeoffs,payment_type')
          .order('start_time', { ascending: false }),
        supabase
          .from('bookings')
          .select('id,student_id,instructor_id,aircraft_id,start_time,end_time,status,flight_logged')
          .is('deleted_at', null)
          .order('start_time', { ascending: false }),
        supabase
          .from('users')
          .select('id,name,email,role')
          .order('name'),
        supabase
          .from('user_roles')
          .select('user_id,role'),
        supabase
          .from('aircraft')
          .select('id,registration,make,model,status,total_hours')
          .order('registration'),
      ]);

      if (logsRes.error) throw logsRes.error;
      if (bookingsRes.error) throw bookingsRes.error;
      if (usersRes.error) throw usersRes.error;
      if (rolesRes.error) throw rolesRes.error;
      if (aircraftRes.error) throw aircraftRes.error;

      const rolesMap = new Map<string, string[]>();
      (rolesRes.data || []).forEach((r: any) => {
        if (!rolesMap.has(r.user_id)) rolesMap.set(r.user_id, []);
        rolesMap.get(r.user_id)!.push(r.role);
      });

      const mappedUsers: ReportUser[] = (usersRes.data || []).map((u: any) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        roles: rolesMap.get(u.id) || [u.role],
      }));

      const mappedAircraft: ReportAircraft[] = (aircraftRes.data || []).map((a: any) => ({
        id: a.id,
        registration: a.registration,
        make: a.make,
        model: a.model,
        status: a.status,
        total_hours: parseFloat(a.total_hours ?? 0),
      }));

      setFlightLogs(logsRes.data || []);
      setBookings(bookingsRes.data || []);
      setUsers(mappedUsers);
      setAircraft(mappedAircraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report data');
      console.error('Error loading reports data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  return { flightLogs, bookings, users, aircraft, loading, error, refetch: fetchAll };
}
