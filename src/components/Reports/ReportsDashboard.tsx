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
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-600">View statistics and analytics</p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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