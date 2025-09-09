import React, { useState } from 'react';
import { X, Save, Calculator, Plane, Clock, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { mockAircraft, mockStudents } from '../../data/mockData';
import { Booking, FlightLog } from '../../types';
import toast from 'react-hot-toast';

interface FlightLogFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (flightLogData: Omit<FlightLog, 'id'>) => void;
  booking: Booking;
}

export const FlightLogForm: React.FC<FlightLogFormProps> = ({
  isOpen,
  onClose,
  onSubmit,
  booking
}) => {
  const { user } = useAuth();
  
  // Get booking details
  const aircraft = mockAircraft.find(a => a.id === booking.aircraftId);
  const student = mockStudents.find(s => s.id === booking.studentId);
  const instructor = mockStudents.find(s => s.id === booking.instructorId);
  
  const [formData, setFormData] = useState({
    date: booking.startTime.toISOString().split('T')[0],
    dualTime: booking.instructorId ? 0.0 : 0.0,
    soloTime: !booking.instructorId ? 0.0 : 0.0,
    tachStart: 0.0,
    tachEnd: 0.0,
    landings: 0,
    notes: ''
  });

  const calculateDuration = () => {
    return Math.max(0, formData.tachEnd - formData.tachStart);
  };

  const calculateCost = () => {
    const duration = calculateDuration();
    const aircraftCost = duration * (aircraft?.hourlyRate || 0);
    const instructorCost = booking.instructorId ? duration * 85 : 0; // $85/hr instructor rate
    return aircraftCost + instructorCost;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (formData.tachEnd <= formData.tachStart) {
      toast.error('End tach must be greater than start tach');
      return;
    }

    if (formData.dualTime === 0 && formData.soloTime === 0) {
      toast.error('Please enter either dual or solo time');
      return;
    }

    const duration = calculateDuration();
    const totalCost = calculateCost();

    const flightLogData: Omit<FlightLog, 'id'> = {
      bookingId: booking.id,
      landings: formData.landings,
      duration: duration,
      tachStart: formData.tachStart,
      tachEnd: formData.tachEnd,
      totalCost: totalCost,
      notes: formData.notes
    };

    onSubmit(flightLogData);
    toast.success(`Flight logged! $${totalCost.toFixed(2)} deducted from student account`);
    onClose();
  };

  if (!isOpen) return null;

  const duration = calculateDuration();
  const totalCost = calculateCost();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <Plane className="h-5 w-5 mr-2 text-blue-600" />
            Log Flight
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Header Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Date *
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Aircraft
              </label>
              <input
                type="text"
                value={`${aircraft?.registration} - ${aircraft?.make} ${aircraft?.model}`}
                disabled
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
              />
            </div>
          </div>

          {/* Student and Instructor */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <User className="h-4 w-4 inline mr-2" />
                Student (Locked)
              </label>
              <input
                type="text"
                value={student?.name || 'Unknown Student'}
                disabled
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Instructor
              </label>
              {user?.role === 'admin' ? (
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  defaultValue={booking.instructorId || ''}
                >
                  <option value="">Solo Flight</option>
                  {mockStudents.filter(s => s.role === 'instructor').map(inst => (
                    <option key={inst.id} value={inst.id}>{inst.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={instructor?.name || 'Solo Flight'}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
                />
              )}
            </div>
          </div>

          {/* Flight Times */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Dual Time "D:" (hours)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formData.dualTime}
                onChange={(e) => setFormData(prev => ({ ...prev, dualTime: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Solo Time "S:" (hours)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formData.soloTime}
                onChange={(e) => setFormData(prev => ({ ...prev, soloTime: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.0"
              />
            </div>
          </div>

          {/* Tach Times */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Start Tach *
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formData.tachStart}
                onChange={(e) => setFormData(prev => ({ ...prev, tachStart: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.0"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                End Tach *
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formData.tachEnd}
                onChange={(e) => setFormData(prev => ({ ...prev, tachEnd: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.0"
                required
              />
            </div>
          </div>

          {/* Landings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Total Landings
              </label>
              <input
                type="number"
                min="0"
                value={formData.landings}
                onChange={(e) => setFormData(prev => ({ ...prev, landings: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>

            <div className="flex items-end">
              <div className="bg-blue-50 p-4 rounded-lg w-full">
                <div className="flex items-center mb-2">
                  <Calculator className="h-4 w-4 text-blue-600 mr-2" />
                  <span className="text-sm font-medium text-blue-900">Flight Duration</span>
                </div>
                <p className="text-lg font-bold text-blue-600">
                  {duration.toFixed(1)} hours
                </p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Flight Notes (Optional)
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Any additional notes about the flight..."
            />
          </div>

          {/* Cost Summary */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-lg font-medium text-gray-900 mb-3 flex items-center">
              <Calculator className="h-5 w-5 mr-2" />
              Cost Breakdown
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Aircraft ({duration.toFixed(1)} hrs @ ${aircraft?.hourlyRate}/hr):</span>
                <span>${(duration * (aircraft?.hourlyRate || 0)).toFixed(2)}</span>
              </div>
              {booking.instructorId && (
                <div className="flex justify-between">
                  <span>Instructor ({duration.toFixed(1)} hrs @ $85/hr):</span>
                  <span>${(duration * 85).toFixed(2)}</span>
                </div>
              )}
              <div className="border-t border-gray-300 pt-2 flex justify-between font-semibold">
                <span>Total Cost:</span>
                <span className="text-lg text-blue-600">${totalCost.toFixed(2)}</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              This amount will be deducted from the student's prepaid balance.
            </p>
          </div>

          {/* Submit Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Save className="h-4 w-4" />
              <span>Log Flight</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};