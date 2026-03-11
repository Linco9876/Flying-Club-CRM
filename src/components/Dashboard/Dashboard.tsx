import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import {
  Calendar,
  Plane,
  Users,
  AlertTriangle,
  Clock,
  DollarSign,
  TrendingUp,
  CheckCircle,
  XCircle,
  Info,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';

const StatCard: React.FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  iconBg: string;
  subtitle?: string;
  trend?: string;
}> = ({ title, value, icon, iconBg, subtitle, trend }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
    <div className="flex items-start justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-500 truncate">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        {trend && <p className="text-xs text-green-600 mt-1 font-medium">{trend}</p>}
      </div>
      <div className={`flex-shrink-0 p-3 rounded-xl ${iconBg}`}>
        {icon}
      </div>
    </div>
  </div>
);

const AlertItem: React.FC<{
  type: 'error' | 'warning' | 'info';
  message: string;
  detail?: string;
}> = ({ type, message, detail }) => {
  const config = {
    error: {
      bg: 'bg-red-50 border-red-200',
      icon: <XCircle className="h-4 w-4 text-red-600 flex-shrink-0" />,
      text: 'text-red-900',
      subtext: 'text-red-700',
    },
    warning: {
      bg: 'bg-amber-50 border-amber-200',
      icon: <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />,
      text: 'text-amber-900',
      subtext: 'text-amber-700',
    },
    info: {
      bg: 'bg-blue-50 border-blue-200',
      icon: <Info className="h-4 w-4 text-blue-600 flex-shrink-0" />,
      text: 'text-blue-900',
      subtext: 'text-blue-700',
    },
  };
  const c = config[type];
  return (
    <div className={`p-3 border rounded-lg ${c.bg}`}>
      <div className="flex items-center gap-2">
        {c.icon}
        <p className={`text-sm font-medium ${c.text}`}>{message}</p>
      </div>
      {detail && <p className={`text-xs mt-1 ml-6 ${c.subtext}`}>{detail}</p>}
    </div>
  );
};

const statusColors: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-800',
  pending_approval: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-red-100 text-red-800',
  completed: 'bg-blue-100 text-blue-800',
};

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { stats, loading } = useDashboardStats(user?.id, user?.role);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(amount);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {getGreeting()}, {user?.name}
        </h1>
        <p className="text-gray-500 mt-1">Here's what's happening at the flying club today.</p>
      </div>

      {(user?.role === 'admin') && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard
              title="Total Students"
              value={stats.totalStudents}
              icon={<Users className="h-6 w-6 text-blue-600" />}
              iconBg="bg-blue-100"
              subtitle="Registered members"
            />
            <StatCard
              title="Active Aircraft"
              value={`${stats.serviceableAircraft} / ${stats.totalAircraft}`}
              icon={<Plane className="h-6 w-6 text-emerald-600" />}
              iconBg="bg-emerald-100"
              subtitle={stats.unserviceableAircraft > 0 ? `${stats.unserviceableAircraft} unserviceable` : 'All serviceable'}
            />
            <StatCard
              title="Bookings Today"
              value={stats.bookingsToday}
              icon={<Calendar className="h-6 w-6 text-sky-600" />}
              iconBg="bg-sky-100"
              subtitle="Scheduled flights"
            />
            <StatCard
              title="Monthly Revenue"
              value={formatCurrency(stats.monthlyRevenue)}
              icon={<DollarSign className="h-6 w-6 text-orange-600" />}
              iconBg="bg-orange-100"
              subtitle={`${format(new Date(), 'MMMM yyyy')}`}
            />
            <StatCard
              title="Fleet Utilisation"
              value={`${stats.fleetUtilizationPercent}%`}
              icon={<TrendingUp className="h-6 w-6 text-teal-600" />}
              iconBg="bg-teal-100"
              subtitle="Based on 8 hrs/day availability"
            />
            <StatCard
              title="Open Defects"
              value={stats.openDefects}
              icon={<AlertTriangle className="h-6 w-6 text-red-600" />}
              iconBg="bg-red-100"
              subtitle={stats.openDefects === 0 ? 'No open issues' : 'Require attention'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gray-500" />
                Today's Schedule
              </h3>
              {stats.recentBookingsToday.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Calendar className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No bookings scheduled for today</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.recentBookingsToday.map(booking => (
                    <div
                      key={booking.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {format(booking.startTime, 'HH:mm')} – {format(booking.endTime, 'HH:mm')}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {booking.studentName} · {booking.aircraftRegistration}
                          {booking.instructorName && ` · ${booking.instructorName}`}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColors[booking.status] || 'bg-gray-100 text-gray-700'}`}>
                        {booking.status === 'pending_approval' ? 'Pending' : booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-gray-500" />
                Alerts & Notices
              </h3>
              {stats.alerts.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <CheckCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No active alerts</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.alerts.map((alert, i) => (
                    <AlertItem key={i} type={alert.type} message={alert.message} detail={alert.detail} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {(user?.role === 'instructor' || user?.role === 'senior_instructor') && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="My Students"
              value={stats.myStudentsCount}
              icon={<Users className="h-6 w-6 text-blue-600" />}
              iconBg="bg-blue-100"
              subtitle="Assigned students"
            />
            <StatCard
              title="Today's Lessons"
              value={stats.myBookingsToday}
              icon={<Clock className="h-6 w-6 text-emerald-600" />}
              iconBg="bg-emerald-100"
              subtitle="Scheduled for today"
            />
            <StatCard
              title="Total Flight Hours"
              value={stats.myFlightHours.toFixed(1)}
              icon={<Plane className="h-6 w-6 text-sky-600" />}
              iconBg="bg-sky-100"
              subtitle="Hours instructed"
            />
            <StatCard
              title="Fleet Status"
              value={`${stats.serviceableAircraft} / ${stats.totalAircraft}`}
              icon={<Plane className="h-6 w-6 text-teal-600" />}
              iconBg="bg-teal-100"
              subtitle="Serviceable aircraft"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gray-500" />
                Today's Schedule
              </h3>
              {stats.recentBookingsToday.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Calendar className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No bookings scheduled for today</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.recentBookingsToday.map(booking => (
                    <div key={booking.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {format(booking.startTime, 'HH:mm')} – {format(booking.endTime, 'HH:mm')}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {booking.studentName} · {booking.aircraftRegistration}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColors[booking.status] || 'bg-gray-100 text-gray-700'}`}>
                        {booking.status === 'pending_approval' ? 'Pending' : booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-gray-500" />
                Alerts & Notices
              </h3>
              {stats.alerts.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <CheckCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No active alerts</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.alerts.map((alert, i) => (
                    <AlertItem key={i} type={alert.type} message={alert.message} detail={alert.detail} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {(user?.role === 'student' || user?.role === 'pilot') && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Flight Hours"
              value={stats.myFlightHours.toFixed(1)}
              icon={<Clock className="h-6 w-6 text-blue-600" />}
              iconBg="bg-blue-100"
              subtitle="Total logged"
            />
            <StatCard
              title="Next Booking"
              value={stats.nextBooking ? format(stats.nextBooking.startTime, 'dd MMM') : 'None'}
              icon={<Calendar className="h-6 w-6 text-emerald-600" />}
              iconBg="bg-emerald-100"
              subtitle={stats.nextBooking ? `${format(stats.nextBooking.startTime, 'HH:mm')} · ${stats.nextBooking.aircraftRegistration}` : 'No upcoming bookings'}
            />
            <StatCard
              title="Prepaid Balance"
              value={formatCurrency(stats.myPrepaidBalance)}
              icon={<DollarSign className="h-6 w-6 text-orange-600" />}
              iconBg="bg-orange-100"
              subtitle="Account balance"
            />
            <StatCard
              title="Available Aircraft"
              value={stats.serviceableAircraft}
              icon={<Plane className="h-6 w-6 text-teal-600" />}
              iconBg="bg-teal-100"
              subtitle={`of ${stats.totalAircraft} in fleet`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gray-500" />
                Today's Schedule
              </h3>
              {stats.recentBookingsToday.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Calendar className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No bookings scheduled for today</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.recentBookingsToday.map(booking => (
                    <div key={booking.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {format(booking.startTime, 'HH:mm')} – {format(booking.endTime, 'HH:mm')}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {booking.aircraftRegistration}
                          {booking.instructorName && ` · ${booking.instructorName}`}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColors[booking.status] || 'bg-gray-100 text-gray-700'}`}>
                        {booking.status === 'pending_approval' ? 'Pending' : booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-gray-500" />
                Fleet Status
              </h3>
              {stats.alerts.filter(a => a.type === 'error').length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <CheckCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">All aircraft serviceable</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.alerts.filter(a => a.type === 'error').map((alert, i) => (
                    <AlertItem key={i} type={alert.type} message={alert.message} detail={alert.detail} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
