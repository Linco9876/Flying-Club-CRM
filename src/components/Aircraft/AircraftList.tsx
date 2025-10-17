import React from 'react';
import { useState } from 'react';
import { AircraftForm } from './AircraftForm';
import { DefectReportForm } from '../Maintenance/DefectReportForm';
import { Aircraft, Defect } from '../../types';
import { Plane, Wrench, AlertTriangle, CheckCircle, Flag, Loader2, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAircraft } from '../../hooks/useAircraft';

export const AircraftList: React.FC = () => {
  const { aircraft, loading, addAircraft, updateAircraft, reportDefect } = useAircraft();
  const [showAircraftForm, setShowAircraftForm] = useState(false);
  const [showDefectForm, setShowDefectForm] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [editingAircraft, setEditingAircraft] = useState<Aircraft | null>(null);
  const [viewingAircraft, setViewingAircraft] = useState<Aircraft | null>(null);
  const [selectedAircraftForDefect, setSelectedAircraftForDefect] = useState<string>('');

  const handleAddAircraft = async (aircraftData: Omit<Aircraft, 'id' | 'defects'>) => {
    await addAircraft(aircraftData);
    setShowAircraftForm(false);
  };

  const handleEditAircraft = async (aircraftData: Omit<Aircraft, 'id' | 'defects'>) => {
    if (editingAircraft) {
      await updateAircraft(editingAircraft.id, aircraftData);
      setEditingAircraft(null);
      setShowAircraftForm(false);
    }
  };

  const openEditForm = (aircraft: Aircraft) => {
    setEditingAircraft(aircraft);
    setShowAircraftForm(true);
  };

  const closeAircraftForm = () => {
    setShowAircraftForm(false);
    setEditingAircraft(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const handleReportDefect = (aircraftId: string) => {
    setSelectedAircraftForDefect(aircraftId);
    setShowDefectForm(true);
  };

  const handleDefectSubmit = async (defectData: Omit<Defect, 'id'>) => {
    try {
      await reportDefect(defectData);
      setSelectedAircraftForDefect('');
    } catch (error) {
      console.error('Error reporting defect:', error);
      throw error;
    }
  };

  const openViewModal = (aircraft: Aircraft) => {
    setViewingAircraft(aircraft);
    setShowViewModal(true);
  };
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'serviceable':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'unserviceable':
        return <AlertTriangle className="h-5 w-5 text-red-600" />;
      case 'maintenance':
        return <Wrench className="h-5 w-5 text-yellow-600" />;
      default:
        return <Plane className="h-5 w-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'serviceable':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'unserviceable':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'maintenance':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Aircraft Fleet</h1>
        <button 
          onClick={() => setShowAircraftForm(true)}
          className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plane className="h-4 w-4" />
          <span>Add Aircraft</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {aircraft.map(aircraftItem => (
          <div key={aircraftItem.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Plane className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{aircraftItem.registration}</h3>
                  <p className="text-sm text-gray-600">{aircraftItem.make} {aircraftItem.model}</p>
                </div>
              </div>
              {getStatusIcon(aircraftItem.status)}
            </div>

            <div className="space-y-3">
              <div className={`px-3 py-2 rounded-lg border ${getStatusColor(aircraftItem.status)}`}>
                <span className="text-xs font-medium uppercase tracking-wide">
                  {aircraftItem.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Hourly Rate</p>
                  <p className="font-semibold text-gray-900">${aircraftItem.hourlyRate}</p>
                </div>
                <div>
                  <p className="text-gray-500">Total Hours</p>
                  <p className="font-semibold text-gray-900">{aircraftItem.totalHours}</p>
                </div>
              </div>

              {aircraftItem.nextMaintenance && (
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Next Maintenance</p>
                  <p className="text-sm font-medium text-gray-900">
                    {aircraftItem.nextMaintenance.toLocaleDateString()}
                  </p>
                </div>
              )}

              {aircraftItem.defects.length > 0 && (
                <div className="bg-red-50 border border-red-200 p-3 rounded-lg">
                  <p className="text-xs text-red-600 font-medium">Open Defects: {aircraftItem.defects.length}</p>
                  <p className="text-xs text-red-700 mt-1">
                    {aircraftItem.defects[0].summary || aircraftItem.defects[0].description}
                  </p>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  onClick={() => openViewModal(aircraftItem)}
                  className="flex items-center space-x-1 px-3 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
                >
                  <Eye className="h-3 w-3" />
                  <span>View</span>
                </button>
                <button
                  onClick={() => openEditForm(aircraftItem)}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleReportDefect(aircraftItem.id)}
                  className="flex items-center space-x-1 px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors"
                >
                  <Flag className="h-3 w-3" />
                  <span>Report Defect</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <AircraftForm
        isOpen={showAircraftForm}
        onClose={closeAircraftForm}
        onSubmit={editingAircraft ? handleEditAircraft : handleAddAircraft}
        aircraft={editingAircraft || undefined}
        isEdit={!!editingAircraft}
      />

      <DefectReportForm
        isOpen={showDefectForm}
        onClose={() => {
          setShowDefectForm(false);
          setSelectedAircraftForDefect('');
        }}
        onSubmit={handleDefectSubmit}
        preSelectedAircraftId={selectedAircraftForDefect}
      />

      {showViewModal && viewingAircraft && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900 flex items-center">
                <Plane className="h-5 w-5 mr-2" />
                Aircraft Details
              </h2>
              <button
                onClick={() => setShowViewModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <span className="text-2xl">&times;</span>
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Registration</h3>
                  <p className="text-lg font-semibold text-gray-900">{viewingAircraft.registration}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Status</h3>
                  <span className={`inline-flex px-3 py-1 text-xs font-medium rounded-full border ${getStatusColor(viewingAircraft.status)}`}>
                    {viewingAircraft.status.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Make</h3>
                  <p className="text-gray-900">{viewingAircraft.make}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Model</h3>
                  <p className="text-gray-900">{viewingAircraft.model}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Type</h3>
                  <p className="text-gray-900 capitalize">{viewingAircraft.type.replace('-', ' ')}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Seat Capacity</h3>
                  <p className="text-gray-900">{viewingAircraft.seatCapacity || 'N/A'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Hourly Rate</h3>
                  <p className="text-gray-900">${viewingAircraft.hourlyRate}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">Total Hours</h3>
                  <p className="text-gray-900">{viewingAircraft.totalHours}</p>
                </div>
              </div>

              {(viewingAircraft.fuelCapacity || viewingAircraft.emptyWeight || viewingAircraft.maxWeight) && (
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Fuel Capacity</h3>
                    <p className="text-gray-900">{viewingAircraft.fuelCapacity ? `${viewingAircraft.fuelCapacity} L` : 'N/A'}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Empty Weight</h3>
                    <p className="text-gray-900">{viewingAircraft.emptyWeight ? `${viewingAircraft.emptyWeight} kg` : 'N/A'}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Max Weight</h3>
                    <p className="text-gray-900">{viewingAircraft.maxWeight ? `${viewingAircraft.maxWeight} kg` : 'N/A'}</p>
                  </div>
                </div>
              )}

              {viewingAircraft.lastMaintenance && (
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Last Maintenance</h3>
                    <p className="text-gray-900">{viewingAircraft.lastMaintenance.toLocaleDateString()}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Next Maintenance</h3>
                    <p className="text-gray-900">{viewingAircraft.nextMaintenance?.toLocaleDateString() || 'Not scheduled'}</p>
                  </div>
                </div>
              )}

              {viewingAircraft.defects.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-3">Open Defects</h3>
                  <div className="space-y-2">
                    {viewingAircraft.defects.map((defect, index) => (
                      <div key={index} className="bg-red-50 border border-red-200 p-3 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-medium text-red-900">
                              {defect.summary || defect.description}
                            </p>
                            <p className="text-xs text-red-800 mt-1 leading-snug">
                              {defect.description}
                            </p>
                            <p className="text-xs text-red-700 mt-1">
                              Reported: {defect.dateReported.toLocaleDateString()} by {defect.reportedBy}
                            </p>
                          </div>
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full border ${getStatusColor(defect.status)}`}>
                            {defect.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
                <button
                  onClick={() => setShowViewModal(false)}
                  className="px-6 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    setShowViewModal(false);
                    openEditForm(viewingAircraft);
                  }}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Edit Aircraft
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};