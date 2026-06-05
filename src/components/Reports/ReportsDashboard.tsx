import React, { useState } from 'react';
import { PilotStatisticsTab } from './PilotStatisticsTab';
import { InstructorStatisticsTab } from './InstructorStatisticsTab';
import { AircraftStatisticsTab } from './AircraftStatisticsTab';
import { Dashboard } from '../Dashboard/Dashboard';
import { BarChart3, Users, User, Plane, Download, Filter, Activity } from 'lucide-react';

export const ReportsDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');

  const tabs = [
    { id: 'overview', label: 'Overview', description: 'Operational snapshot', icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'pilot', label: 'Pilot Statistics', description: 'Bookings, hours and activity', icon: <Users className="h-4 w-4" /> },
    { id: 'instructor', label: 'Instructor Statistics', description: 'Instructing hours and students', icon: <User className="h-4 w-4" /> },
    { id: 'aircraft', label: 'Aircraft Statistics', description: 'Fleet utilisation and landings', icon: <Plane className="h-4 w-4" /> }
  ];

  const activeTabMeta = tabs.find(tab => tab.id === activeTab) ?? tabs[0];

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:mb-6 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
              <Activity className="h-3.5 w-3.5" />
              Reports
            </div>
            <h1 className="mt-3 text-xl font-bold text-gray-900 sm:text-2xl">{activeTabMeta.label}</h1>
            <p className="mt-1 text-sm text-gray-600">{activeTabMeta.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Filter className="h-3.5 w-3.5" />
                Filters
              </div>
              <p className="mt-1 text-sm font-semibold text-gray-900">Available per report</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Download className="h-3.5 w-3.5" />
                Export
              </div>
              <p className="mt-1 text-sm font-semibold text-gray-900">CSV on each tab</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="app-tab-scroller mb-5">
        <nav className="app-tab-list">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`app-tab-button ${
                activeTab === tab.id
                  ? 'app-tab-button-active'
                  : ''
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && <Dashboard />}
        {activeTab === 'pilot' && <PilotStatisticsTab />}
        {activeTab === 'instructor' && <InstructorStatisticsTab />}
        {activeTab === 'aircraft' && <AircraftStatisticsTab />}
      </div>
    </div>
  );
};
