import React, { useState } from 'react';
import { DefectReportForm } from './DefectReportForm';
import { AlertTriangle, Wrench, CheckCircle, Plus, Camera, Loader2 } from 'lucide-react';
import { useAircraft } from '../../hooks/useAircraft';
import { Defect } from '../../types';

export const MaintenanceBoard: React.FC = () => {
  const { aircraft, loading, reportDefect } = useAircraft();
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [showDefectForm, setShowDefectForm] = useState(false);

  const allDefects = aircraft.flatMap(a =>
    a.defects.map(d => ({ ...d, aircraftId: a.id }))
  );

  const filteredDefects = selectedStatus === 'all'
    ? allDefects
    : allDefects.filter(defect => defect.status === selectedStatus);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'mel':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'fixed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'deferred':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open':
        return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'mel':
        return <Wrench className="h-4 w-4 text-yellow-600" />;
      case 'fixed':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-600" />;
    }
  };

  const getAircraftRegistration = (aircraftId: string) => {
    const a = aircraft.find(a => a.id === aircraftId);
    return a?.registration || 'Unknown';
  };

  const handleDefectSubmit = async (defectData: Omit<Defect, 'id'>) => {
    try {
      await reportDefect(defectData);
      setShowDefectForm(false);
    } catch (error) {
      console.error('Error reporting defect:', error);
      throw error;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Maintenance Board</h1>
        <button 
          onClick={() => setShowDefectForm(true)}
          className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>Report Defect</span>
        </button>
      </div>

      <div className="mb-6">
        <div className="flex space-x-2">
          {['all', 'open', 'mel', 'fixed', 'deferred'].map(status => (
            <button
              key={status}
              onClick={() => setSelectedStatus(status)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                selectedStatus === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredDefects.map(defect => (
          <div key={defect.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3">
                {getStatusIcon(defect.status)}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {getAircraftRegistration(defect.aircraftId)}
                  </h3>
                  <p className="text-sm text-gray-600">
                    Reported by {defect.reportedBy}
                  </p>
                </div>
              </div>
              <span className={`inline-flex px-3 py-1 text-xs font-medium rounded-full border ${getStatusColor(defect.status)}`}>
                {defect.status.toUpperCase()}
              </span>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-900 mb-2">{defect.description}</p>
              <p className="text-xs text-gray-500">
                Reported: {defect.dateReported.toLocaleDateString()}
              </p>
            </div>

            {defect.melNotes && (
              <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg mb-4">
                <p className="text-xs font-medium text-yellow-900">MEL Notes:</p>
                <p className="text-xs text-yellow-800 mt-1">{defect.melNotes}</p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Camera className="h-4 w-4 text-gray-400" />
                <span className="text-xs text-gray-500">
                  {defect.photos?.length || 0} photos
                </span>
              </div>
              <div className="flex space-x-2">
                <button className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors">
                  View Details
                </button>
                {defect.status === 'open' && (
                  <button className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">
                    Update Status
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredDefects.length === 0 && (
        <div className="text-center py-12">
          <CheckCircle className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No defects found</h3>
          <p className="text-gray-600">
            {selectedStatus === 'all' 
              ? 'All aircraft are in good condition!'
              : `No defects with status: ${selectedStatus}`
            }
          </p>
        </div>
      )}

      <DefectReportForm
        isOpen={showDefectForm}
        onClose={() => setShowDefectForm(false)}
        onSubmit={handleDefectSubmit}
      />
    </div>
  );
};