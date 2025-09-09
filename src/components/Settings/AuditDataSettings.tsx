import React, { useState } from 'react';
import { Database, Download, Search, Filter } from 'lucide-react';
import toast from 'react-hot-toast';

interface AuditDataSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

interface AuditLogEntry {
  id: string;
  timestamp: Date;
  userId: string;
  userName: string;
  action: string;
  resource: string;
  details: string;
  ipAddress: string;
}

export const AuditDataSettings: React.FC<AuditDataSettingsProps> = ({ canEdit, onFormChange }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');

  // Mock audit log data
  const auditLog: AuditLogEntry[] = [
    {
      id: '1',
      timestamp: new Date('2024-01-25T14:30:00'),
      userId: '1',
      userName: 'Club Administrator',
      action: 'CREATE',
      resource: 'booking',
      details: 'Created booking for John Pilot - VH-ABC',
      ipAddress: '192.168.1.100'
    },
    {
      id: '2',
      timestamp: new Date('2024-01-25T14:25:00'),
      userId: '2',
      userName: 'Chief Flying Instructor',
      action: 'UPDATE',
      resource: 'training-record',
      details: 'Updated training record TR-001',
      ipAddress: '192.168.1.101'
    },
    {
      id: '3',
      timestamp: new Date('2024-01-25T14:20:00'),
      userId: '3',
      userName: 'John Pilot',
      action: 'LOGIN',
      resource: 'auth',
      details: 'User logged in successfully',
      ipAddress: '192.168.1.102'
    },
    {
      id: '4',
      timestamp: new Date('2024-01-25T14:15:00'),
      userId: '1',
      userName: 'Club Administrator',
      action: 'DELETE',
      resource: 'booking',
      details: 'Deleted cancelled booking BK-123',
      ipAddress: '192.168.1.100'
    }
  ];

  const filteredAuditLog = auditLog.filter(entry => {
    const matchesSearch = entry.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         entry.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         entry.resource.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         entry.details.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesDateRange = (!dateRange.start || entry.timestamp >= new Date(dateRange.start)) &&
                            (!dateRange.end || entry.timestamp <= new Date(dateRange.end));
    
    const matchesAction = !actionFilter || entry.action === actionFilter;
    const matchesUser = !userFilter || entry.userId === userFilter;
    
    return matchesSearch && matchesDateRange && matchesAction && matchesUser;
  });

  const handleExportData = (format: 'csv' | 'json') => {
    toast.success(`Exporting system data to ${format.toUpperCase()}...`);
    // In real app, would trigger actual export
  };

  const handleExportAuditLog = (format: 'csv' | 'xlsx') => {
    toast.success(`Exporting audit log to ${format.toUpperCase()}...`);
    // In real app, would trigger actual export
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'bg-green-100 text-green-800';
      case 'UPDATE': return 'bg-blue-100 text-blue-800';
      case 'DELETE': return 'bg-red-100 text-red-800';
      case 'LOGIN': return 'bg-gray-100 text-gray-800';
      case 'LOGOUT': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Database className="h-5 w-5 mr-2" />
          Audit & Data
        </h2>
        <p className="text-gray-600">View audit logs and export system data</p>
      </div>

      {/* Data Export */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Data Export</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-gray-900 mb-2">Complete System Data</h4>
              <p className="text-xs text-gray-600 mb-3">
                Export all students, bookings, aircraft, and training records
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleExportData('csv')}
                  className="flex items-center space-x-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  <span>CSV</span>
                </button>
                <button
                  onClick={() => handleExportData('json')}
                  className="flex items-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  <span>JSON</span>
                </button>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-gray-900 mb-2">Audit Log</h4>
              <p className="text-xs text-gray-600 mb-3">
                Export system activity and user actions
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleExportAuditLog('csv')}
                  className="flex items-center space-x-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  <span>CSV</span>
                </button>
                <button
                  onClick={() => handleExportAuditLog('xlsx')}
                  className="flex items-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  <span>XLSX</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Audit Log Viewer */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Audit Log</h3>
          
          {/* Filters */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Search audit log..."
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Action</label>
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Actions</option>
                  <option value="CREATE">Create</option>
                  <option value="UPDATE">Update</option>
                  <option value="DELETE">Delete</option>
                  <option value="LOGIN">Login</option>
                  <option value="LOGOUT">Logout</option>
                </select>
              </div>
            </div>

            <div className="mt-4 text-sm text-gray-600">
              Showing {filteredAuditLog.length} entries
            </div>
          </div>

          {/* Audit Log Table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Timestamp
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Action
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Resource
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Details
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      IP Address
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredAuditLog.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {entry.timestamp.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {entry.userName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getActionColor(entry.action)}`}>
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {entry.resource}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                        {entry.details}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {entry.ipAddress}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredAuditLog.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500">No audit log entries found matching the selected filters.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};