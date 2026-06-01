import React, { useState } from 'react';
import { PilotStatisticsTab } from './PilotStatisticsTab';
import { InstructorStatisticsTab } from './InstructorStatisticsTab';
import { AircraftStatisticsTab } from './AircraftStatisticsTab';
import { Users, User, Plane } from 'lucide-react';

export const ReportsDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('pilot');

  const tabs = [
    { id: 'pilot', label: 'Pilot Statistics', icon: <Users className="h-4 w-4" /> },
    { id: 'instructor', label: 'Instructor Statistics', icon: <User className="h-4 w-4" /> },
    { id: 'aircraft', label: 'Aircraft Statistics', icon: <Plane className="h-4 w-4" /> }
  ];

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Reports</h1>
        <p className="text-gray-600">View statistics and analytics</p>
      </div>

      {/* Tab Navigation */}
      <div className="app-tab-scroller">
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
        {activeTab === 'pilot' && <PilotStatisticsTab />}
        {activeTab === 'instructor' && <InstructorStatisticsTab />}
        {activeTab === 'aircraft' && <AircraftStatisticsTab />}
      </div>
    </div>
  );
};
