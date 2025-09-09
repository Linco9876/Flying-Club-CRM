import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
  Calendar, 
  Plane, 
  Users, 
  AlertTriangle, 
  Clock,
  DollarSign,
  TrendingUp
} from 'lucide-react';

interface DashboardCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
}

const DashboardCard: React.FC<DashboardCardProps> = ({ title, value, icon, color, subtitle }) => (
  <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-600">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
      <div className={`p-3 rounded-full ${color}`}>
        {icon}
      </div>
    </div>
  </div>
);

export const Dashboard: React.FC = () => {
  const { user } = useAuth();

  const getStatsForRole = () => {
    switch (user?.role) {
      case 'admin':
        return [
          { title: 'Total Students', value: 45, icon: <Users className="h-6 w-6 text-blue-600" />, color: 'bg-blue-100' },
          { title: 'Active Aircraft', value: '3/4', icon: <Plane className="h-6 w-6 text-green-600" />, color: 'bg-green-100', subtitle: '1 unserviceable' },
          { title: 'Today\'s Bookings', value: 8, icon: <Calendar className="h-6 w-6 text-purple-600" />, color: 'bg-purple-100' },
          { title: 'Monthly Revenue', value: '$23,450', icon: <DollarSign className="h-6 w-6 text-orange-600" />, color: 'bg-orange-100' },
          { title: 'Fleet Utilization', value: '78%', icon: <TrendingUp className="h-6 w-6 text-indigo-600" />, color: 'bg-indigo-100' },
          { title: 'Open Defects', value: 2, icon: <AlertTriangle className="h-6 w-6 text-red-600" />, color: 'bg-red-100' }
        ];
      case 'instructor':
        return [
          { title: 'My Students', value: 12, icon: <Users className="h-6 w-6 text-blue-600" />, color: 'bg-blue-100' },
          { title: 'Today\'s Lessons', value: 4, icon: <Clock className="h-6 w-6 text-green-600" />, color: 'bg-green-100' },
          { title: 'This Week', value: 18, icon: <Calendar className="h-6 w-6 text-purple-600" />, color: 'bg-purple-100', subtitle: 'total lessons' },
          { title: 'Available Aircraft', value: 3, icon: <Plane className="h-6 w-6 text-indigo-600" />, color: 'bg-indigo-100' }
        ];
      case 'student':
        return [
          { title: 'Flight Hours', value: 28.5, icon: <Clock className="h-6 w-6 text-blue-600" />, color: 'bg-blue-100', subtitle: 'total logged' },
          { title: 'Next Lesson', value: 'Tomorrow', icon: <Calendar className="h-6 w-6 text-green-600" />, color: 'bg-green-100', subtitle: '09:00 - VH-ABC' },
          { title: 'Prepaid Balance', value: '$1,250', icon: <DollarSign className="h-6 w-6 text-orange-600" />, color: 'bg-orange-100' },
          { title: 'Progress', value: '65%', icon: <TrendingUp className="h-6 w-6 text-purple-600" />, color: 'bg-purple-100', subtitle: 'to RPL' }
        ];
      default:
        return [];
    }
  };

  const stats = getStatsForRole();

  const getWelcomeMessage = () => {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return `${greeting}, ${user?.name}`;
  };

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{getWelcomeMessage()}</h1>
        <p className="text-gray-600">Here's what's happening at the flying club today.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {stats.map((stat, index) => (
          <DashboardCard
            key={index}
            title={stat.title}
            value={stat.value}
            icon={stat.icon}
            color={stat.color}
            subtitle={stat.subtitle}
          />
        ))}
      </div>

      {user?.role === 'student' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Currency Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">Medical Certificate</span>
                <span className="text-sm text-green-600 font-medium">Valid until Aug 2024</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">RPL Licence</span>
                <span className="text-sm text-green-600 font-medium">Valid until Mar 2026</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-yellow-50 rounded-lg">
                <span className="text-sm font-medium text-gray-700">BFR Currency</span>
                <span className="text-sm text-yellow-600 font-medium">Due in 45 days</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
            <div className="space-y-3">
              <div className="border-l-4 border-blue-500 pl-4 py-2">
                <p className="text-sm font-medium text-gray-900">Lesson 14 Completed</p>
                <p className="text-xs text-gray-500">Jan 20, 2024 - Forced landings practice</p>
              </div>
              <div className="border-l-4 border-green-500 pl-4 py-2">
                <p className="text-sm font-medium text-gray-900">Solo Flight Logged</p>
                <p className="text-xs text-gray-500">Jan 18, 2024 - Circuit practice (1.2 hrs)</p>
              </div>
              <div className="border-l-4 border-orange-500 pl-4 py-2">
                <p className="text-sm font-medium text-gray-900">Invoice Paid</p>
                <p className="text-xs text-gray-500">Jan 20, 2024 - $547.50</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {(user?.role === 'admin' || user?.role === 'instructor') && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Today's Schedule</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-900">09:00 - 11:00</p>
                  <p className="text-xs text-gray-600">John Pilot - VH-ABC - Lesson 15</p>
                </div>
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">Confirmed</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-900">14:00 - 16:00</p>
                  <p className="text-xs text-gray-600">Sarah Wings - VH-DEF - Solo Practice</p>
                </div>
                <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Confirmed</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Alerts & Notices</h3>
            <div className="space-y-3">
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center">
                  <AlertTriangle className="h-4 w-4 text-red-600 mr-2" />
                  <p className="text-sm font-medium text-red-900">VH-GHI Unserviceable</p>
                </div>
                <p className="text-xs text-red-700 mt-1">Radio intermittent - grounded pending repair</p>
              </div>
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center">
                  <Clock className="h-4 w-4 text-yellow-600 mr-2" />
                  <p className="text-sm font-medium text-yellow-900">3 Students BFR Due</p>
                </div>
                <p className="text-xs text-yellow-700 mt-1">Within next 30 days</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};