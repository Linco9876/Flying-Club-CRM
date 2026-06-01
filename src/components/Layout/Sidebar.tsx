import React from 'react';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAuthorizedMenuItems } from '../../utils/rbac';
import { usePortalUxSettings } from '../../hooks/useSettings';
import {
  Calendar,
  Users,
  Plane,
  FileText,
  Settings,
  BarChart3,
  Wrench,
  CreditCard,
  BookOpen,
  Shield,
  AlertCircle,
  Menu,
  X
} from 'lucide-react';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const { user } = useAuth();
  const { settings: portalSettings } = usePortalUxSettings();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const allMenuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, roles: ['admin', 'instructor', 'student'] },
    { id: 'calendar', label: 'Calendar', icon: Calendar, roles: ['admin', 'instructor', 'student'] },
    { id: 'students', label: 'Students/Pilots', icon: Users, roles: ['admin', 'instructor'] },
    { id: 'aircraft', label: 'Aircraft', icon: Plane, roles: ['admin', 'instructor', 'student'] },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench, roles: ['admin', 'instructor'] },
    { id: 'training', label: 'Training Records', icon: BookOpen, roles: ['admin', 'instructor'] },
    { id: 'outstanding-records', label: 'Outstanding Records', icon: AlertCircle, roles: ['admin', 'instructor'] },
    { id: 'syllabus-management', label: 'Syllabus Management', icon: BookOpen, roles: ['admin', 'instructor'] },
    { id: 'profile', label: 'My Profile', icon: Users, roles: ['student'] },
    { id: 'mylogbook', label: 'My Logbook', icon: BookOpen, roles: ['instructor', 'admin'] },
    { id: 'billing', label: 'Billing', icon: CreditCard, roles: ['admin', 'instructor', 'student'] },
    { id: 'reports', label: 'Reports', icon: FileText, roles: ['admin', 'instructor'] },
    { id: 'safety', label: 'Safety', icon: Shield, roles: ['admin', 'instructor', 'student'] },
    { id: 'settings', label: 'Settings', icon: Settings, roles: ['admin'] }
  ];

  // Get authorized menu items using RBAC
  const authorizedItems = getAuthorizedMenuItems(user);
  const filteredMenuItems = allMenuItems.filter(item => {
    if (
      item.id === 'billing' &&
      (user?.role === 'student' || user?.role === 'pilot') &&
      !portalSettings.show_invoices_in_portal
    ) {
      return false;
    }
    return authorizedItems.some(authItem => authItem.id === item.id);
  });

  const handleMenuItemClick = (itemId: string) => {
    onViewChange(itemId);
    setIsMobileMenuOpen(false);
  };

  const renderMenuItems = () => (
    <ul className="space-y-2">
      {filteredMenuItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeView === item.id;
        
        return (
          <li key={item.id}>
            <button
              onClick={() => handleMenuItemClick(item.id)}
              className={`w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon className={`mr-3 h-5 w-5 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
              {item.label}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileMenuOpen(true)}
        className="fixed left-4 top-4 z-50 rounded-lg border border-gray-200 bg-white p-2 shadow-md lg:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="h-6 w-6 text-gray-600" />
      </button>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block bg-white shadow-md border-r border-gray-200 w-64 min-h-screen">
        <nav className="mt-8 px-4">
          {renderMenuItems()}
        </nav>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          
          {/* Sidebar */}
          <div className="relative flex min-h-screen w-[min(18rem,85vw)] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <nav className="mt-4 flex-1 overflow-y-auto px-4 pb-6">
              {renderMenuItems()}
            </nav>
          </div>
        </div>
      )}
    </>
  );
};
