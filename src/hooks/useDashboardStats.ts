import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface DashboardStats {
  totalStudents: number;
  totalAircraft: number;
  serviceableAircraft: number;
  unserviceableAircraft: number;
  bookingsToday: number;
  monthlyRevenue: number;
  fleetUtilizationPercent: number;
  openDefects: number;
  pendingApprovals: number;
  recentBookingsToday: Array<{
    id: string;
    studentName: string;
    aircraftRegistration: string;
    startTime: Date;
    endTime: Date;
    status: string;
    instructorName?: string;
  }>;
  alerts: Array<{
    type: 'error' | 'warning' | 'info';
    message: string;
    detail?: string;
  }>;
  myStudentsCount: number;
  myBookingsToday: number;
  myFlightHours: number;
  nextBooking?: {
    startTime: Date;
    aircraftRegistration: string;
    instructorName?: string;
  };
  myPrepaidBalance: number;
}

export function useDashboardStats(userId?: string, userRole?: string) {
  const [stats, setStats] = useState<DashboardStats>({
    totalStudents: 0,
    totalAircraft: 0,
    serviceableAircraft: 0,
    unserviceableAircraft: 0,
    bookingsToday: 0,
    monthlyRevenue: 0,
    fleetUtilizationPercent: 0,
    openDefects: 0,
    pendingApprovals: 0,
    recentBookingsToday: [],
    alerts: [],
    myStudentsCount: 0,
    myBookingsToday: 0,
    myFlightHours: 0,
    myPrepaidBalance: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    if (!userId) return;
    try {
      setLoading(true);

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

      const [
        studentsResult,
        aircraftResult,
        defectsResult,
        bookingsTodayResult,
        monthlyLogsResult,
        pendingBookingsResult,
        allBookingsTodayResult,
      ] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact' }).eq('role', 'student'),
        supabase.from('aircraft').select('id, registration, status, total_hours, hourly_rate'),
        supabase.from('defects').select('id', { count: 'exact' }).eq('status', 'open'),
        supabase
          .from('bookings')
          .select('id', { count: 'exact' })
          .is('deleted_at', null)
          .gte('start_time', todayStart)
          .lt('start_time', todayEnd),
        supabase
          .from('flight_logs')
          .select('flight_duration, aircraft_id')
          .gte('start_time', monthStart)
          .lte('end_time', monthEnd),
        supabase
          .from('bookings')
          .select('id', { count: 'exact' })
          .is('deleted_at', null)
          .eq('status', 'pending_approval'),
        supabase
          .from('bookings')
          .select(`
            id, start_time, end_time, status,
            student:student_id (name),
            instructor:instructor_id (name),
            aircraft:aircraft_id (registration)
          `)
          .is('deleted_at', null)
          .gte('start_time', todayStart)
          .lt('start_time', todayEnd)
          .order('start_time', { ascending: true })
          .limit(5),
      ]);

      const allAircraft = aircraftResult.data || [];
      const serviceableCount = allAircraft.filter(a => a.status === 'serviceable').length;
      const unserviceableCount = allAircraft.filter(a => a.status !== 'serviceable').length;

      const flightLogs = monthlyLogsResult.data || [];
      let monthlyRevenue = 0;
      const aircraftMap = new Map(allAircraft.map(a => [a.id, a]));
      for (const log of flightLogs) {
        const aircraft = aircraftMap.get(log.aircraft_id);
        if (aircraft) {
          monthlyRevenue += (log.flight_duration || 0) * parseFloat(aircraft.hourly_rate || 0);
        }
      }

      const totalMonthlyHours = flightLogs.reduce((sum, log) => sum + (log.flight_duration || 0), 0);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const availableHoursPerDay = 8;
      const totalAvailableHours = serviceableCount * availableHoursPerDay * daysInMonth;
      const fleetUtilization = totalAvailableHours > 0
        ? Math.min(100, Math.round((totalMonthlyHours / totalAvailableHours) * 100))
        : 0;

      const recentBookings = (allBookingsTodayResult.data || []).map((b: any) => ({
        id: b.id,
        studentName: b.student?.name || 'Unknown',
        aircraftRegistration: b.aircraft?.registration || 'Unknown',
        startTime: new Date(b.start_time),
        endTime: new Date(b.end_time),
        status: b.status,
        instructorName: b.instructor?.name,
      }));

      const alerts: DashboardStats['alerts'] = [];

      const groundedAircraft = allAircraft.filter(a => a.status === 'unserviceable');
      for (const aircraft of groundedAircraft) {
        alerts.push({
          type: 'error',
          message: `${aircraft.registration} Unserviceable`,
          detail: 'Grounded pending maintenance',
        });
      }

      const pendingCount = pendingBookingsResult.count || 0;
      if (pendingCount > 0) {
        alerts.push({
          type: 'warning',
          message: `${pendingCount} Booking${pendingCount > 1 ? 's' : ''} Pending Approval`,
          detail: 'Awaiting instructor confirmation',
        });
      }

      const openDefectsCount = defectsResult.count || 0;
      if (openDefectsCount > 0) {
        alerts.push({
          type: 'warning',
          message: `${openDefectsCount} Open Defect${openDefectsCount > 1 ? 's' : ''}`,
          detail: 'Require attention',
        });
      }

      let myStudentsCount = 0;
      let myBookingsToday = 0;
      let myFlightHours = 0;
      let nextBooking: DashboardStats['nextBooking'] = undefined;
      let myPrepaidBalance = 0;

      if (userRole === 'instructor' || userRole === 'senior_instructor') {
        const [myStudentsResult, myBookingsTodayResult, myHoursResult] = await Promise.all([
          supabase
            .from('bookings')
            .select('student_id')
            .is('deleted_at', null)
            .eq('instructor_id', userId),
          supabase
            .from('bookings')
            .select('id', { count: 'exact' })
            .is('deleted_at', null)
            .eq('instructor_id', userId)
            .gte('start_time', todayStart)
            .lt('start_time', todayEnd),
          supabase
            .from('flight_logs')
            .select('flight_duration')
            .eq('instructor_id', userId),
        ]);

        const uniqueStudents = new Set((myStudentsResult.data || []).map(b => b.student_id));
        myStudentsCount = uniqueStudents.size;
        myBookingsToday = myBookingsTodayResult.count || 0;
        myFlightHours = (myHoursResult.data || []).reduce((sum, log) => sum + (log.flight_duration || 0), 0);

        const nextBookingResult = await supabase
          .from('bookings')
          .select(`
            start_time,
            aircraft:aircraft_id (registration),
            student:student_id (name)
          `)
          .is('deleted_at', null)
          .eq('instructor_id', userId)
          .gte('start_time', now.toISOString())
          .order('start_time', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (nextBookingResult.data) {
          const nb = nextBookingResult.data as any;
          nextBooking = {
            startTime: new Date(nb.start_time),
            aircraftRegistration: nb.aircraft?.registration || 'Unknown',
            instructorName: nb.student?.name,
          };
        }
      }

      if (userRole === 'student' || userRole === 'pilot') {
        const [myHoursResult, myNextBookingResult, balanceResult] = await Promise.all([
          supabase
            .from('flight_logs')
            .select('flight_duration')
            .eq('student_id', userId),
          supabase
            .from('bookings')
            .select(`
              start_time,
              aircraft:aircraft_id (registration),
              instructor:instructor_id (name)
            `)
            .is('deleted_at', null)
            .eq('student_id', userId)
            .gte('start_time', now.toISOString())
            .order('start_time', { ascending: true })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('students')
            .select('prepaid_balance')
            .eq('id', userId)
            .maybeSingle(),
        ]);

        myFlightHours = (myHoursResult.data || []).reduce((sum, log) => sum + (log.flight_duration || 0), 0);
        myPrepaidBalance = balanceResult.data ? parseFloat(balanceResult.data.prepaid_balance || 0) : 0;

        if (myNextBookingResult.data) {
          const nb = myNextBookingResult.data as any;
          nextBooking = {
            startTime: new Date(nb.start_time),
            aircraftRegistration: nb.aircraft?.registration || 'Unknown',
            instructorName: nb.instructor?.name,
          };
        }

        myBookingsToday = (bookingsTodayResult.count || 0);
      }

      setStats({
        totalStudents: studentsResult.count || 0,
        totalAircraft: allAircraft.length,
        serviceableAircraft: serviceableCount,
        unserviceableAircraft: unserviceableCount,
        bookingsToday: bookingsTodayResult.count || 0,
        monthlyRevenue,
        fleetUtilizationPercent: fleetUtilization,
        openDefects: openDefectsCount,
        pendingApprovals: pendingCount,
        recentBookingsToday: recentBookings,
        alerts,
        myStudentsCount,
        myBookingsToday,
        myFlightHours,
        nextBooking,
        myPrepaidBalance,
      });
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [userId, userRole]);

  return { stats, loading, refetch: fetchStats };
}
