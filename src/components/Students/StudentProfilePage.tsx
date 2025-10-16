import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { mockTrainingRecords, mockAircraft } from '../../data/mockData';
import { TrainingRecord, Student } from '../../types';
import { useStudents } from '../../hooks/useStudents';
import { 
  ArrowLeft, 
  User, 
  Phone, 
  Mail, 
  Calendar, 
  Award,
  Clock,
  FileText,
  Plus,
  Eye,
  Edit,
  CheckCircle,
  AlertTriangle,
  Filter
} from 'lucide-react';
import toast from 'react-hot-toast';

interface StudentProfilePageProps {
  onOpenTrainingRecord?: (booking: any) => void;
}

export const StudentProfilePage: React.FC<StudentProfilePageProps> = ({ onOpenTrainingRecord }) => {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { students, loading: studentsLoading } = useStudents();
  const [student, setStudent] = useState<Student | null>(null);
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');
  const [showMatrixView, setShowMatrixView] = useState(true);
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [aircraftFilter, setAircraftFilter] = useState('');
  const [instructorFilter, setInstructorFilter] = useState('');

  // Syllabus sequences for competency matrix
  const syllabusSequences = [
    { code: 'HF', label: 'Human Factors' },
    { code: 'FP', label: 'Flight Prep' },
    { code: 'EC', label: 'Effects of Controls' },
    { code: 'SL', label: 'Straight & Level' },
    { code: 'CL', label: 'Climb' },
    { code: 'DS', label: 'Descend' },
    { code: 'BT', label: 'Basic Turning' },
    { code: 'SF', label: 'Slow Flight & Stalls' },
    { code: 'TO', label: 'Take-off' },
    { code: 'LA', label: 'Landing' },
    { code: 'CT', label: 'Circuits' },
    { code: 'EF', label: 'EFIC/EFATO' },
    { code: 'AT', label: 'Advanced Turning' },
    { code: 'ST', label: 'Scenario Stalling' },
    { code: 'FR', label: 'Avionics/Comms/Systems' },
    { code: 'FL', label: 'Forced Landings' },
    { code: 'TA', label: 'Training Area Ops' },
    { code: 'US', label: 'Unexpected/Undesired States' },
    { code: 'CN', label: 'Consolidation' },
    { code: 'PT', label: 'Practice Flight Test / Flight Test' }
  ];

  useEffect(() => {
    if (!studentsLoading && studentId) {
      const foundStudent = students.find(s => s.id === studentId);
      if (foundStudent) {
        setStudent(foundStudent);
      } else {
        toast.error('Student not found');
        navigate('/students');
      }
    }
  }, [studentId, students, studentsLoading, navigate]);

  useEffect(() => {
    const fetchTrainingRecords = async () => {
      setRecordsLoading(true);
      try {
        const records = mockTrainingRecords.filter(r => r.studentId === studentId);
        setTrainingRecords(records);
      } catch (error) {
        toast.error('Failed to load training records');
      } finally {
        setRecordsLoading(false);
      }
    };

    if (studentId) {
      fetchTrainingRecords();
    }
  }, [studentId]);

  const handleAddTrainingRecord = () => {
    if (onOpenTrainingRecord && student) {
      // Create a mock booking for the training record form
      const mockBooking = {
        id: 'new-record',
        studentId: student.id,
        instructorId: user?.id,
        aircraftId: mockAircraft[0]?.id || '1',
        startTime: new Date(),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours later
        paymentType: 'prepaid' as const,
        status: 'completed' as const
      };
      onOpenTrainingRecord(mockBooking);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'submitted':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'draft':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'locked':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getCompetenceForSequence = (record: TrainingRecord, sequenceCode: string) => {
    const sequence = record.sequences.find(s => s.sequenceCode === sequenceCode);
    return sequence?.competence || '–';
  };

  const getCompetenceColor = (competence: string) => {
    switch (competence) {
      case 'C': return 'text-green-600 font-bold';
      case 'S': return 'text-yellow-600 font-bold';
      case 'NC': return 'text-red-600 font-bold';
      default: return 'text-gray-400';
    }
  };

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  };

  const formatDecimalTime = (minutes: number) => {
    return (minutes / 60).toFixed(1);
  };

  const canAddRecord = user?.role === 'instructor' || user?.role === 'admin';
  const canEditRecord = (record: TrainingRecord) => {
    return (user?.role === 'instructor' || user?.role === 'admin') && record.status === 'draft';
  };

  // Apply filters to training records
  const filteredRecords = trainingRecords.filter(record => {
    const matchesDateRange = (!dateFilter.start || record.date >= new Date(dateFilter.start)) &&
                            (!dateFilter.end || record.date <= new Date(dateFilter.end));
    const matchesAircraft = !aircraftFilter || record.registration === aircraftFilter;
    const matchesInstructor = !instructorFilter || record.instructorId === instructorFilter;
    
    return matchesDateRange && matchesAircraft && matchesInstructor;
  });

  const sortedRecords = [...filteredRecords].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  if (studentsLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
                <div className="h-6 bg-gray-200 rounded mb-4"></div>
                <div className="space-y-3">
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            </div>
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
                <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="space-y-3">
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Student not found</h3>
          <button
            onClick={() => navigate('/students')}
            className="text-blue-600 hover:text-blue-800"
          >
            Return to students list
          </button>
        </div>
      </div>
    );
  }

  const totalDualTime = trainingRecords.reduce((sum, record) => sum + record.dualTimeMin, 0);
  const totalSoloTime = trainingRecords.reduce((sum, record) => sum + record.soloTimeMin, 0);
  const totalFlightTime = totalDualTime + totalSoloTime;
  const lastFlightDate = trainingRecords.length > 0 
    ? new Date(Math.max(...trainingRecords.map(r => r.date.getTime())))
    : null;

  const isExpiryNear = (date?: Date) => {
    if (!date) return false;
    const daysUntilExpiry = Math.ceil((date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 60;
  };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: <User className="h-4 w-4" /> },
    { id: 'training', label: 'Training Records', icon: <FileText className="h-4 w-4" /> }
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/students')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{student.name}</h1>
            <p className="text-gray-600">Student Profile</p>
          </div>
        </div>
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
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Student Summary */}
          <div className="lg:col-span-1 space-y-6">
            {/* Personal Information */}
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <User className="h-5 w-5 mr-2" />
                Personal Information
              </h2>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Name</label>
                  <p className="text-sm text-gray-900">{student.name}</p>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Email</label>
                  <div className="flex items-center space-x-2">
                    <Mail className="h-3 w-3 text-gray-400" />
                    <p className="text-sm text-gray-900">{student.email}</p>
                  </div>
                </div>
                
                {student.phone && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Phone</label>
                    <div className="flex items-center space-x-2">
                      <Phone className="h-3 w-3 text-gray-400" />
                      <p className="text-sm text-gray-900">{student.phone}</p>
                    </div>
                  </div>
                )}
                
                {student.dateOfBirth && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Date of Birth</label>
                    <div className="flex items-center space-x-2">
                      <Calendar className="h-3 w-3 text-gray-400" />
                      <p className="text-sm text-gray-900">{student.dateOfBirth.toLocaleDateString()}</p>
                    </div>
                  </div>
                )}

                {student.emergencyContact && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Emergency Contact</label>
                    <div className="text-sm text-gray-900">
                      <p>{student.emergencyContact.name}</p>
                      <p className="text-xs text-gray-600">{student.emergencyContact.phone} ({student.emergencyContact.relationship})</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Aviation Credentials */}
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Aviation Credentials</h2>
              
              <div className="space-y-3">
                {student.raausId && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">RAAus ID</label>
                    <p className="text-sm text-gray-900">{student.raausId}</p>
                  </div>
                )}
                
                {student.casaId && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">CASA ID</label>
                    <p className="text-sm text-gray-900">{student.casaId}</p>
                  </div>
                )}
                
                {student.medicalType && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Medical Certificate</label>
                    <p className="text-sm text-gray-900">{student.medicalType}</p>
                    {student.medicalExpiry && (
                      <p className={`text-xs ${isExpiryNear(student.medicalExpiry) ? 'text-yellow-600' : 'text-gray-500'}`}>
                        Expires: {student.medicalExpiry.toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}
                
                {student.licenceExpiry && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Licence Expiry</label>
                    <p className={`text-sm ${isExpiryNear(student.licenceExpiry) ? 'text-yellow-600' : 'text-gray-900'}`}>
                      {student.licenceExpiry.toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Flight Statistics */}
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Clock className="h-5 w-5 mr-2" />
                Flight Statistics
              </h2>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs font-medium text-blue-900">Total Hours</p>
                  <p className="text-lg font-bold text-blue-600">{formatDecimalTime(totalFlightTime)}</p>
                </div>
                
                <div className="bg-green-50 p-3 rounded-lg">
                  <p className="text-xs font-medium text-green-900">Dual Time</p>
                  <p className="text-lg font-bold text-green-600">{formatDecimalTime(totalDualTime)}</p>
                </div>
                
                <div className="bg-orange-50 p-3 rounded-lg">
                  <p className="text-xs font-medium text-orange-900">Solo Time</p>
                  <p className="text-lg font-bold text-orange-600">{formatDecimalTime(totalSoloTime)}</p>
                </div>
                
                <div className="bg-purple-50 p-3 rounded-lg">
                  <p className="text-xs font-medium text-purple-900">Balance</p>
                  <p className="text-lg font-bold text-purple-600">${student.prepaidBalance.toFixed(2)}</p>
                </div>
              </div>
              
              {lastFlightDate && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Last Flight</p>
                  <p className="text-sm text-gray-900">{lastFlightDate.toLocaleDateString()}</p>
                </div>
              )}
            </div>

            {/* Endorsements */}
            {student.endorsements.filter(e => e.isActive).length > 0 && (
              <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Award className="h-5 w-5 mr-2" />
                  Active Endorsements
                </h2>
                
                <div className="space-y-2">
                  {student.endorsements.filter(e => e.isActive).map(endorsement => (
                    <div key={endorsement.id} className="flex items-center justify-between p-2 bg-blue-50 border border-blue-200 rounded">
                      <span className="text-sm font-medium text-blue-900">
                        {endorsement.type.toUpperCase()}
                      </span>
                      <span className="text-xs text-blue-700">
                        {endorsement.dateObtained?.toLocaleDateString() || 'N/A'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Additional Profile Info */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Training Progress Overview</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-blue-900">Lessons Completed</p>
                  <p className="text-2xl font-bold text-blue-600">{trainingRecords.length}</p>
                </div>
                
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-green-900">Competent Sequences</p>
                  <p className="text-2xl font-bold text-green-600">
                    {trainingRecords.reduce((sum, r) => sum + r.sequences.filter(s => s.competence === 'C').length, 0)}
                  </p>
                </div>
                
                <div className="bg-orange-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-orange-900">Progress to RPL</p>
                  <p className="text-2xl font-bold text-orange-600">
                    {Math.min(100, Math.round((totalFlightTime / 60) / 20 * 100))}%
                  </p>
                </div>
              </div>

              {trainingRecords.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No training records yet</h3>
                  <p className="text-gray-600 mb-4">This student hasn't completed any training sessions.</p>
                  {canAddRecord && (
                    <button
                      onClick={handleAddTrainingRecord}
                      className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors mx-auto"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add First Training Record</span>
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <h3 className="text-md font-medium text-gray-900 mb-3">Recent Training Activity</h3>
                  <div className="space-y-3">
                    {trainingRecords.slice(0, 5).map(record => {
                      const instructor = mockStudents.find(s => s.id === record.instructorId);
                      return (
                        <div key={record.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {record.date.toLocaleDateString()} - {record.registration}
                            </p>
                            <p className="text-xs text-gray-600">
                              {instructor?.name} | {formatDecimalTime(record.dualTimeMin + record.soloTimeMin)}h
                            </p>
                          </div>
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(record.status)}`}>
                            {record.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'training' && (
        <div className="space-y-6">
          {/* Training Records Header */}
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <FileText className="h-5 w-5 mr-2" />
                Training Records
              </h2>
              {canAddRecord && (
                <button
                  onClick={handleAddTrainingRecord}
                  className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add Training Record</span>
                </button>
              )}
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                <input
                  type="date"
                  value={dateFilter.start}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, start: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                <input
                  type="date"
                  value={dateFilter.end}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, end: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Aircraft</label>
                <select
                  value={aircraftFilter}
                  onChange={(e) => setAircraftFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Aircraft</option>
                  {Array.from(new Set(trainingRecords.map(r => r.registration))).map(reg => (
                    <option key={reg} value={reg}>{reg}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Instructor</label>
                <select
                  value={instructorFilter}
                  onChange={(e) => setInstructorFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Instructors</option>
                  {mockStudents.filter(s => s.role === 'instructor').map(instructor => (
                    <option key={instructor.id} value={instructor.id}>{instructor.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* View Toggle */}
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setShowMatrixView(true)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  showMatrixView
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Overview Matrix
              </button>
              <button
                onClick={() => setShowMatrixView(false)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  !showMatrixView
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Lesson Cards
              </button>
            </div>
          </div>

          {recordsLoading ? (
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          ) : sortedRecords.length > 0 ? (
            <>
              {/* Overview Matrix */}
              {showMatrixView && (
                <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
                  <div className="p-4 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900">Competency Overview Matrix</h3>
                    <div className="flex items-center space-x-4 mt-2 text-xs">
                      <div className="flex items-center space-x-1">
                        <span className="w-3 h-3 bg-green-500 rounded"></span>
                        <span>C = Competent</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <span className="w-3 h-3 bg-yellow-500 rounded"></span>
                        <span>S = Satisfactory</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <span className="w-3 h-3 bg-red-500 rounded"></span>
                        <span>NC = Not Competent</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <span className="w-3 h-3 bg-gray-300 rounded"></span>
                        <span>– = Not Assessed</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          {/* Sticky columns */}
                          <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                            Date
                          </th>
                          <th className="sticky left-20 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                            Instructor
                          </th>
                          <th className="sticky left-40 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                            Aircraft
                          </th>
                          
                          {/* Competency columns */}
                          {syllabusSequences.map(sequence => (
                            <th 
                              key={sequence.code}
                              className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200 min-w-[36px]"
                              style={{ 
                                writingMode: 'vertical-rl', 
                                transform: 'rotate(180deg)',
                                height: '120px'
                              }}
                              title={sequence.label}
                            >
                              {sequence.code}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {sortedRecords.map(record => {
                          const instructor = mockStudents.find(s => s.id === record.instructorId);
                          return (
                            <tr key={record.id} className="hover:bg-gray-50">
                              {/* Sticky columns */}
                              <td className="sticky left-0 z-10 bg-white px-4 py-3 text-sm text-gray-900 border-r border-gray-200">
                                {record.date.toLocaleDateString()}
                              </td>
                              <td className="sticky left-20 z-10 bg-white px-4 py-3 text-sm text-gray-900 border-r border-gray-200">
                                {instructor?.name || 'Unknown'}
                              </td>
                              <td className="sticky left-40 z-10 bg-white px-4 py-3 text-sm text-gray-900 border-r border-gray-200">
                                {record.aircraftType}
                              </td>
                              
                              {/* Competency cells */}
                              {syllabusSequences.map(sequence => {
                                const competence = getCompetenceForSequence(record, sequence.code);
                                return (
                                  <td 
                                    key={sequence.code}
                                    className="px-2 py-3 text-center text-sm border-r border-gray-200 min-w-[36px]"
                                  >
                                    <span className={getCompetenceColor(competence)}>
                                      {competence}
                                    </span>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Lesson Cards */}
              {!showMatrixView && (
                <div className="space-y-4">
                  {sortedRecords.map(record => {
                    const instructor = mockStudents.find(s => s.id === record.instructorId);
                    const totalTime = (record.dualTimeMin + record.soloTimeMin) / 60;
                    
                    return (
                      <div key={record.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
                        {/* Top row */}
                        <div className="grid grid-cols-2 md:grid-cols-7 gap-4 mb-4 text-sm">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Date</label>
                            <p className="font-medium text-gray-900">{record.date.toLocaleDateString()}</p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Lesson</label>
                            <p className="font-medium text-gray-900">{record.lessonCodes.join(', ') || '–'}</p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Aircraft Type</label>
                            <p className="font-medium text-gray-900">{record.aircraftType}</p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Aircraft Reg</label>
                            <p className="font-medium text-gray-900">{record.registration}</p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Dual (hrs)</label>
                            <p className="font-medium text-gray-900">{formatDecimalTime(record.dualTimeMin)}</p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Solo (hrs)</label>
                            <p className="font-medium text-gray-900">{formatDecimalTime(record.soloTimeMin)}</p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Total</label>
                            <p className="font-bold text-blue-600">{totalTime.toFixed(1)}</p>
                          </div>
                        </div>

                        {/* Comments */}
                        <div className="mb-4">
                          <label className="block text-xs font-medium text-gray-500 uppercase mb-2">Lesson Comments</label>
                          <div className="bg-gray-50 p-3 rounded-lg">
                            <p className="text-sm text-gray-900">{record.comments}</p>
                          </div>
                        </div>

                        {/* Footer row */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm border-t border-gray-200 pt-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Instructor</label>
                            <p className="text-gray-900">{instructor?.name || 'Unknown'}</p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Student</label>
                            <p className="text-gray-900">{student.name}</p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Formal Brief</label>
                            <p className="text-gray-900">{record.formalBriefing ? 'Yes' : 'No'}</p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase">Next Lesson</label>
                            <p className="text-gray-900">{record.nextLesson || '–'}</p>
                          </div>
                        </div>

                        {/* Status and Actions */}
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                          <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(record.status)}`}>
                            {record.status}
                          </span>
                          
                          <div className="flex items-center space-x-2">
                            {record.status === 'submitted' ? (
                              <button className="text-blue-600 hover:text-blue-900 flex items-center space-x-1">
                                <Eye className="h-4 w-4" />
                                <span>View PDF</span>
                              </button>
                            ) : canEditRecord(record) ? (
                              <button className="text-gray-600 hover:text-gray-900 flex items-center space-x-1">
                                <Edit className="h-4 w-4" />
                                <span>Edit</span>
                              </button>
                            ) : (
                              <span className="text-gray-400">–</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <div className="text-center py-12">
                <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No training records found</h3>
                <p className="text-gray-600 mb-4">No records match the selected filters.</p>
                {canAddRecord && (
                  <button
                    onClick={handleAddTrainingRecord}
                    className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors mx-auto"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add Training Record</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};