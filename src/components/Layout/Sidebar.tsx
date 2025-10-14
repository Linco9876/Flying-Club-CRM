import React from 'react';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAuthorizedMenuItems } from '../../utils/rbac';
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
  ClipboardList,
  Menu,
  X
} from 'lucide-react';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const { user } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const allMenuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, roles: ['admin', 'instructor', 'student'] },
    { id: 'calendar', label: 'Calendar', icon: Calendar, roles: ['admin', 'instructor', 'student'] },
    { id: 'bookings', label: 'My Bookings', icon: ClipboardList, roles: ['student'] },
    { id: 'students', label: 'Students', icon: Users, roles: ['admin', 'instructor'] },
    { id: 'aircraft', label: 'Aircraft', icon: Plane, roles: ['admin', 'instructor'] },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench, roles: ['admin', 'instructor'] },
    { id: 'training', label: 'Training Records', icon: BookOpen, roles: ['admin', 'instructor'] },
    { id: 'syllabus-management', label: 'Syllabus Management', icon: BookOpen, roles: ['admin', 'instructor'] },
    { id: 'profile', label: 'My Profile', icon: Users, roles: ['student'] },
    { id: 'billing', label: 'Billing', icon: CreditCard, roles: ['admin', 'instructor'] },
    { id: 'reports', label: 'Reports', icon: FileText, roles: ['admin', 'instructor'] },
    { id: 'safety', label: 'Safety', icon: Shield, roles: ['admin', 'instructor', 'student'] },
    { id: 'settings', label: 'Settings', icon: Settings, roles: ['admin'] }
  ];

  // Get authorized menu items using RBAC
  const authorizedItems = getAuthorizedMenuItems(user);
  const filteredMenuItems = allMenuItems.filter(item => 
    authorizedItems.some(authItem => authItem.id === item.id)
  );

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
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md border border-gray-200"
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
          <div className="relative bg-white w-64 min-h-screen shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <nav className="mt-4 px-4">
              {renderMenuItems()}
            </nav>
          </div>
        </div>
      )}
    </>
  );
};