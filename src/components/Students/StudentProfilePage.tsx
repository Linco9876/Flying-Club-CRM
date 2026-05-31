import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { TrainingRecord, TrainingModule, LessonGradingSystem } from '../../types';
import { ArrowLeft, User, Phone, Mail, Calendar, Award, Clock, FileText, Plus, CreditCard as Edit, CheckCircle, AlertTriangle, BookOpen, GraduationCap, Shield, Wallet, History } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStudents } from '../../hooks/useStudents';
import { useTrainingRecords } from '../../hooks/useTrainingRecords';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { LogbookTab } from './LogbookTab';
import { useTrainingModules } from '../../context/TrainingModulesContext';
import { usePortalUxSettings } from '../../hooks/useSettings';
import { useSafetyReports } from '../../hooks/useSafetyReports';
import { useTrainingSettings } from '../../hooks/useTrainingSettings';

interface StudentProfilePageProps {
  onOpenTrainingRecord?: (booking: any) => void;
}

export const StudentProfilePage: React.FC<StudentProfilePageProps> = ({ onOpenTrainingRecord }) => {
  const { studentId: routeStudentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const studentId = routeStudentId || user?.id;
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'profile');
  const [showMatrixView, setShowMatrixView] = useState(true);
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [aircraftFilter, setAircraftFilter] = useState('');
  const [instructorFilter, setInstructorFilter] = useState('');

  const { students, loading: studentsLoading } = useStudents();
  const { trainingRecords, loading: trainingRecordsLoading, updateTrainingRecord } = useTrainingRecords();
  const { aircraft: aircraftList } = useAircraft();
  const { users } = useUsers();
  const { modules: trainingCourses } = useTrainingModules();
  const { settings: portalSettings } = usePortalUxSettings();
  const { reports: safetyReports } = useSafetyReports();
  const { settings: trainingSettings } = useTrainingSettings();
  const isOwnStudentPortal = (user?.role === 'student' || user?.role === 'pilot') && studentId === user.id;

  const student = useMemo(() => {
    if (!studentId) {
      return null;
    }
    return students.find(s => s.id === studentId) ?? null;
  }, [students, studentId]);

  const studentTrainingRecords = useMemo(
    () => trainingRecords.filter(record => record.studentId === studentId),
    [trainingRecords, studentId]
  );
  const linkedSafetyReports = useMemo(
    () => safetyReports.filter(report => report.reporterId === studentId || report.involvedUserIds.includes(studentId || '')),
    [safetyReports, studentId]
  );

  useEffect(() => {
    if (!studentsLoading && routeStudentId && !student) {
      toast.error('Student not found');
      navigate('/students');
    }
  }, [studentsLoading, routeStudentId, student, navigate]);

  const loading = studentsLoading;
  const recordsLoading = trainingRecordsLoading;

const handleAddTrainingRecord = () => {
    if (onOpenTrainingRecord && student) {
      // Create a mock booking for the training record form
      const mockBooking = {
        id: 'new-record',
        studentId: student.id,
        instructorId: user?.id,
        aircraftId: aircraftList[0]?.id || '',
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

  const formatDecimalTime = (minutes: number) => {
    return (minutes / 60).toFixed(1);
  };

  const canAddRecord = user?.role === 'instructor' || user?.role === 'admin';
  const canEditRecord = (record: TrainingRecord) => {
    return (user?.role === 'instructor' || user?.role === 'admin')
      && (record.status === 'draft' || (trainingSettings.allowSubmittedRecordEditing && record.status === 'submitted'));
  };

  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const handleAcknowledge = useCallback(async (recordId: string) => {
    if (!student) return;
    setAcknowledgingId(recordId);
    try {
      await updateTrainingRecord(recordId, {
        studentAck: true,
        studentAckName: student.name,
        studentAckTimestamp: new Date(),
        status: trainingSettings.lockRecordAfterStudentAck ? 'locked' : 'submitted',
      });
      toast.success('Record acknowledged');
    } catch {
      // error already toasted
    } finally {
      setAcknowledgingId(null);
    }
  }, [student, trainingSettings.lockRecordAfterStudentAck, updateTrainingRecord]);

  // Apply filters to training records
  const filteredRecords = studentTrainingRecords.filter(record => {
    const matchesDateRange = (!dateFilter.start || record.date >= new Date(dateFilter.start)) &&
                            (!dateFilter.end || record.date <= new Date(dateFilter.end));
    const matchesAircraft = !aircraftFilter || record.registration === aircraftFilter;
    const matchesInstructor = !instructorFilter || record.instructorId === instructorFilter;

    return matchesDateRange && matchesAircraft && matchesInstructor;
  });

  const sortedRecords = [...filteredRecords].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  if (loading) {
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

  const totalDualTime = studentTrainingRecords.reduce((sum, record) => sum + record.dualTimeMin, 0);
  const totalSoloTime = studentTrainingRecords.reduce((sum, record) => sum + record.soloTimeMin, 0);
  const totalFlightTime = totalDualTime + totalSoloTime;
  const lastFlightDate = studentTrainingRecords.length > 0
    ? new Date(Math.max(...studentTrainingRecords.map(r => r.date.getTime())))
    : null;

  const isExpiryNear = (date?: Date) => {
    if (!date) return false;
    const daysUntilExpiry = Math.ceil((date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 60;
  };

  const complianceItems = [
    { label: 'RAAus membership', value: student.licenceExpiry?.toLocaleDateString() || 'Not recorded', warn: isExpiryNear(student.licenceExpiry) },
    { label: 'Medical', value: student.medicalExpiry?.toLocaleDateString() || 'Not recorded', warn: isExpiryNear(student.medicalExpiry) },
    { label: 'Flight review', value: student.lastFlightReview ? new Date(student.lastFlightReview).toLocaleDateString() : 'Not recorded', warn: false },
    { label: 'Endorsements', value: `${student.endorsements.filter(e => e.isActive).length} active`, warn: false },
  ];

  const tabs = [
    { id: 'profile', label: 'Overview', icon: <User className="h-4 w-4" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="h-4 w-4" /> },
    { id: 'logbook', label: 'Logbook', icon: <BookOpen className="h-4 w-4" /> },
    { id: 'training', label: 'Training Records', icon: <FileText className="h-4 w-4" /> },
    { id: 'courses', label: 'Courses', icon: <GraduationCap className="h-4 w-4" /> },
    { id: 'billing', label: 'Billing', icon: <Wallet className="h-4 w-4" /> },
    { id: 'safety', label: 'Safety', icon: <Shield className="h-4 w-4" /> },
    { id: 'timeline', label: 'Timeline', icon: <History className="h-4 w-4" /> },
  ].filter(tab => {
    if (!isOwnStudentPortal) return true;
    if (!portalSettings.show_progress_tracking && (tab.id === 'training' || tab.id === 'courses')) return false;
    if (!portalSettings.show_invoices_in_portal && tab.id === 'billing') return false;
    return true;
  });

  useEffect(() => {
    if (!tabs.some(tab => tab.id === activeTab)) {
      setActiveTab('profile');
    }
  }, [activeTab, tabs]);

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
            <p className="text-gray-600">Student File</p>
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
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Ra-Aus Membership Expiry</label>
                    <p className={`text-sm ${isExpiryNear(student.licenceExpiry) ? 'text-yellow-600' : 'text-gray-900'}`}>
                      {student.licenceExpiry.toLocaleDateString()}
                    </p>
                  </div>
                )}

                {student.lastFlightReview && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Last Flight Review</label>
                    <p className={`text-sm ${(() => {
                      const reviewDate = new Date(student.lastFlightReview);
                      const twoYearsLater = new Date(reviewDate);
                      twoYearsLater.setFullYear(twoYearsLater.getFullYear() + 2);
                      const now = new Date();
                      const threeMonthsBefore = new Date(twoYearsLater);
                      threeMonthsBefore.setMonth(threeMonthsBefore.getMonth() - 3);

                      if (now >= twoYearsLater) return 'text-red-600';
                      if (now >= threeMonthsBefore) return 'text-yellow-600';
                      return 'text-gray-900';
                    })()}`}>
                      {(() => {
                        const reviewDate = new Date(student.lastFlightReview);
                        const twoYearsLater = new Date(reviewDate);
                        twoYearsLater.setFullYear(twoYearsLater.getFullYear() + 2);
                        const now = new Date();
                        const threeMonthsBefore = new Date(twoYearsLater);
                        threeMonthsBefore.setMonth(threeMonthsBefore.getMonth() - 3);

                        if (now >= twoYearsLater) {
                          return `${reviewDate.toLocaleDateString()} (Overdue)`;
                        }
                        if (now >= threeMonthsBefore) {
                          return `${reviewDate.toLocaleDateString()} (Due ${twoYearsLater.toLocaleDateString()})`;
                        }
                        return reviewDate.toLocaleDateString();
                      })()}
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

            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Shield className="h-5 w-5 mr-2" />
                Compliance Snapshot
              </h2>
              <div className="space-y-3">
                {complianceItems.map(item => (
                  <div key={item.label} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-600">{item.label}</span>
                    <span className={`text-sm font-medium ${item.warn ? 'text-amber-700' : 'text-gray-900'}`}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
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
            {(!isOwnStudentPortal || portalSettings.show_progress_tracking) ? (
              <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Training Progress Overview</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-blue-900">Lessons Completed</p>
                  <p className="text-2xl font-bold text-blue-600">{studentTrainingRecords.length}</p>
                </div>

                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-green-900">Competent Sequences</p>
                  <p className="text-2xl font-bold text-green-600">
                    {studentTrainingRecords.reduce((sum, r) => sum + r.sequences.filter(s => s.competence === 'C').length, 0)}
                  </p>
                </div>
                
                <div className="bg-orange-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-orange-900">Progress to RPL</p>
                  <p className="text-2xl font-bold text-orange-600">
                    {Math.min(100, Math.round((totalFlightTime / 60) / 20 * 100))}%
                  </p>
                </div>
              </div>

              {studentTrainingRecords.length === 0 ? (
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
                    {studentTrainingRecords.slice(0, 5).map(record => {
                      const instructor = users.find(u => u.id === record.instructorId);
                      return (
                        <div key={record.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {record.date.toLocaleDateString()} - {record.registration}
                            </p>
                            <p className="text-xs text-gray-600">
                              {instructor?.name || 'Unknown'} | {formatDecimalTime(record.dualTimeMin + record.soloTimeMin)}h
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
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-md">
                Training progress tracking is not shown in the student portal.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <FileText className="h-5 w-5 mr-2" />
                Documents & Credentials
              </h2>
              <p className="text-sm text-gray-500 mt-1">Licence, medical, membership, ID and club paperwork for this student file.</p>
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              <Plus className="h-4 w-4" />
              Add Document
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ['RAAus Membership', student.licenceExpiry?.toLocaleDateString() || 'Expiry not recorded'],
              ['Medical Certificate', student.medicalExpiry?.toLocaleDateString() || 'Expiry not recorded'],
              ['CASA / RAAus ID', student.casaId || student.raausId || 'ID not recorded'],
              ['Emergency Contact Form', student.emergencyContact ? 'Recorded' : 'Missing'],
            ].map(([title, detail]) => (
              <div key={title} className="border border-gray-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-gray-900">{title}</p>
                <p className="text-sm text-gray-500 mt-1">{detail}</p>
                <p className="text-xs text-gray-400 mt-3">File upload and verification workflow pending</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'logbook' && student && (
        <LogbookTab
          userId={student.id}
          userName={student.name}
          isInstructor={false}
        />
      )}

      {activeTab === 'courses' && (
        <CourseProgressTab
          studentId={studentId!}
          trainingRecords={studentTrainingRecords}
          courses={trainingCourses}
        />
      )}

      {activeTab === 'billing' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Account Balance</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">${student.prepaidBalance.toFixed(2)}</p>
            <p className="text-sm text-gray-500 mt-1">Pre-paid account balance</p>
          </div>
          <div className="lg:col-span-2 bg-white rounded-lg shadow-md border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center">
              <Wallet className="h-5 w-5 mr-2" />
              Billing File
            </h2>
            <p className="text-sm text-gray-600">
              This area should become the student-specific ledger: top-ups, flight charges, invoices, receipts and future Xero sync status.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'safety' && (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center">
            <Shield className="h-5 w-5 mr-2" />
            Safety & Incident Links
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            Safety reports involving this pilot or student should appear here, including hazards, incidents, accidents and corrective actions.
          </p>
          {linkedSafetyReports.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-gray-300 rounded-lg">
              <AlertTriangle className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900">No linked safety reports</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg">
              {linkedSafetyReports.map(report => (
                <div key={report.id} className="p-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{report.title}</p>
                    <p className="text-xs text-gray-500 mt-1">{report.createdAt.toLocaleDateString()} · {report.reportType.replace('_', ' ')}</p>
                  </div>
                  <span className="text-xs font-medium text-gray-600 capitalize">{report.status.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'timeline' && (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center">
            <History className="h-5 w-5 mr-2" />
            Student File Timeline
          </h2>
          <div className="space-y-5">
            <div className="flex gap-4">
              <div className="w-2 h-2 rounded-full bg-blue-600 mt-2" />
              <div>
                <p className="text-sm font-medium text-gray-900">Student file opened</p>
                <p className="text-xs text-gray-500">{student.email}</p>
              </div>
            </div>
            {lastFlightDate && (
              <div className="flex gap-4">
                <div className="w-2 h-2 rounded-full bg-emerald-600 mt-2" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Last recorded flight</p>
                  <p className="text-xs text-gray-500">{lastFlightDate.toLocaleDateString()} · {formatDecimalTime(totalFlightTime)} total hours in training records</p>
                </div>
              </div>
            )}
            <div className="flex gap-4">
              <div className="w-2 h-2 rounded-full bg-gray-300 mt-2" />
              <div>
                <p className="text-sm font-medium text-gray-900">Audit events pending</p>
                <p className="text-xs text-gray-500">Profile edits, document uploads, billing changes and safety links should be logged here.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'training' && (
        <div className="space-y-6">
          {/* Pending sign-off banner — shown to the student whose profile this is */}
          {user?.id === studentId && (() => {
            const pendingAck = studentTrainingRecords.filter(r => r.status === 'submitted' && !r.studentAck);
            if (pendingAck.length === 0) return null;
            return (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    {pendingAck.length} record{pendingAck.length > 1 ? 's require' : ' requires'} your acknowledgement
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Review your instructor's comments below and sign off that you have read and agree.
                  </p>
                </div>
              </div>
            );
          })()}

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
                  {Array.from(new Set(studentTrainingRecords.map(r => r.registration))).map(reg => (
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
                  {users.filter(u => u.role === 'instructor' || u.role === 'admin').map(instructor => (
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
              {showMatrixView && (() => {
                // Build the set of criteria from all courses used in these records
                const criteriaMap = new Map<string, { id: string; name: string; shortName: string }>();
                sortedRecords.forEach(record => {
                  const course = trainingCourses.find(c => c.id === record.courseId);
                  if (!course) return;
                  course.assessmentCriteria.forEach(crit => {
                    if (!criteriaMap.has(crit.id)) {
                      criteriaMap.set(crit.id, {
                        id: crit.id,
                        name: crit.name,
                        shortName: crit.name.length > 8 ? crit.name.slice(0, 8) : crit.name,
                      });
                    }
                  });
                });
                const matrixCriteria = Array.from(criteriaMap.values());

                const getGrade = (record: TrainingRecord, critId: string) => {
                  const g = record.criteriaGrades?.[critId];
                  return g && g !== '-' ? g : '–';
                };

                const gradeColor = (g: string) => {
                  if (g === 'C' || g === 'Pass') return 'bg-green-500 text-white';
                  if (g === 'S') return 'bg-yellow-400 text-white';
                  if (g === 'NC' || g === 'Fail') return 'bg-red-500 text-white';
                  return 'bg-gray-100 text-gray-400';
                };

                return (
                  <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
                    <div className="p-4 border-b border-gray-200">
                      <h3 className="text-lg font-medium text-gray-900">Competency Overview Matrix</h3>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs">
                        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500 rounded"></span><span>C / Pass = Pilot Ready</span></div>
                        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-400 rounded"></span><span>S = Solo Ready</span></div>
                        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 rounded"></span><span>NC / Fail = Not competent</span></div>
                        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-gray-100 border border-gray-300 rounded"></span><span>– = Not Assessed</span></div>
                      </div>
                    </div>

                    {matrixCriteria.length === 0 ? (
                      <div className="p-6 text-center text-sm text-gray-500">No graded criteria found in these records.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full border-collapse">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase border-r border-b border-gray-200 min-w-[80px]">Date</th>
                              <th className="sticky left-20 z-10 bg-gray-50 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase border-r border-b border-gray-200 min-w-[110px]">Instructor</th>
                              <th className="sticky left-[186px] z-10 bg-gray-50 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase border-r border-b border-gray-200 min-w-[80px]">Aircraft</th>
                              {matrixCriteria.map(crit => (
                                <th
                                  key={crit.id}
                                  title={crit.name}
                                  className="px-1 py-2 text-center text-xs font-medium text-gray-600 border-r border-b border-gray-200 min-w-[40px]"
                                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: '110px' }}
                                >
                                  {crit.name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {sortedRecords.map(record => {
                              const instructor = users.find(u => u.id === record.instructorId);
                              return (
                                <tr key={record.id} className="hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2.5 text-xs text-gray-800 border-r border-gray-200 whitespace-nowrap">
                                    {record.date.toLocaleDateString()}
                                  </td>
                                  <td className="sticky left-20 z-10 bg-white px-3 py-2.5 text-xs text-gray-800 border-r border-gray-200 whitespace-nowrap max-w-[110px] truncate">
                                    {instructor?.name || 'Unknown'}
                                  </td>
                                  <td className="sticky left-[186px] z-10 bg-white px-3 py-2.5 text-xs text-gray-800 border-r border-gray-200 whitespace-nowrap">
                                    {record.registration || record.aircraftType}
                                  </td>
                                  {matrixCriteria.map(crit => {
                                    const grade = getGrade(record, crit.id);
                                    return (
                                      <td key={crit.id} className="px-1 py-2 text-center border-r border-gray-100">
                                        <span className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs font-bold ${gradeColor(grade)}`}>
                                          {grade}
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
                    )}
                  </div>
                );
              })()}

              {/* Lesson Cards */}
              {!showMatrixView && (
                <div className="space-y-4">
                  {sortedRecords.map(record => {
                    const instructor = users.find(u => u.id === record.instructorId);
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

                        {/* Briefing Comments (if any) */}
                        {record.briefingComments && (
                          <div className="mb-4">
                            <label className="block text-xs font-medium text-gray-500 uppercase mb-2">Briefing Comments</label>
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                              <p className="text-sm text-blue-900">{record.briefingComments}</p>
                            </div>
                          </div>
                        )}

                        {/* Criteria Grades (if any) */}
                        {record.criteriaGrades && Object.keys(record.criteriaGrades).length > 0 && (() => {
                          const course = trainingCourses.find(c => c.id === record.courseId);
                          if (!course) return null;
                          return (
                            <div className="mb-4">
                              <label className="block text-xs font-medium text-gray-500 uppercase mb-2">Assessment</label>
                              <div className="flex flex-wrap gap-2">
                                {course.assessmentCriteria.map(crit => {
                                  const grade = record.criteriaGrades[crit.id];
                                  if (!grade || grade === '-') return null;
                                  const isPass = grade === 'C' || grade === 'Pass' || (parseFloat(grade) >= 50);
                                  return (
                                    <span
                                      key={crit.id}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                                        isPass ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200'
                                      }`}
                                    >
                                      {crit.name}: {grade}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Status and Actions */}
                        <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(record.status)}`}>
                              {record.status}
                            </span>

                            <div className="flex items-center space-x-2">
                              {canEditRecord(record) && (
                                <button className="text-gray-600 hover:text-gray-900 flex items-center space-x-1">
                                  <Edit className="h-4 w-4" />
                                  <span>Edit</span>
                                </button>
                              )}
                              {record.status === 'locked' && record.studentAck && (
                                <span className="flex items-center gap-1 text-xs text-emerald-700 font-medium">
                                  <CheckCircle className="h-4 w-4" />
                                  Acknowledged {record.studentAckTimestamp ? `by ${record.studentAckName}` : ''}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Student sign-off prompt */}
                          {record.status === 'submitted' && !record.studentAck && user?.id === studentId && (
                            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                              <p className="text-sm font-semibold text-amber-900 mb-1">Your acknowledgement is required</p>
                              <p className="text-xs text-amber-700 mb-3">
                                By acknowledging, you confirm you have read and agree with the lesson comments and assessment above.
                              </p>
                              <button
                                onClick={() => handleAcknowledge(record.id)}
                                disabled={acknowledgingId === record.id}
                                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                {acknowledgingId === record.id ? (
                                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <CheckCircle className="h-4 w-4" />
                                )}
                                I have read and agree
                              </button>
                            </div>
                          )}
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

// ---------- CourseProgressTab ----------

const GRADE_ORDER: Record<LessonGradingSystem, string[]> = {
  'NC/S/C/-': ['-', 'NC', 'S', 'C'],
  'Pass or Fail': ['Fail', 'Pass'],
  'Out of 100': [],
};

function gradeScore(grade: string, system: LessonGradingSystem): number {
  if (!grade || grade === '-') return 0;
  if (system === 'Out of 100') {
    const n = parseFloat(grade);
    return isNaN(n) ? 0 : n / 100;
  }
  const order = GRADE_ORDER[system];
  const idx = order.indexOf(grade);
  if (idx < 0) return 0;
  return idx / (order.length - 1);
}

function isTopGrade(grade: string, system: LessonGradingSystem): boolean {
  if (!grade || grade === '-') return false;
  if (system === 'Out of 100') {
    return parseFloat(grade) >= 100;
  }
  const order = GRADE_ORDER[system];
  return grade === order[order.length - 1];
}

interface CourseProgressTabProps {
  studentId: string;
  trainingRecords: TrainingRecord[];
  courses: TrainingModule[];
}

const CourseProgressTab: React.FC<CourseProgressTabProps> = ({ trainingRecords, courses }) => {
  const { settings: trainingSettings } = useTrainingSettings();
  const courseProgress = useMemo(() => {
    // Build best result per lesson id from training records
    // Training records don't directly reference lesson ids from courses,
    // so we match via lessonCodes (sequenceCode) stored in training record sequences
    const bestByLessonId: Record<string, Record<string, string>> = {};

    // For each training record, collect the sequence results and look for
    // lessons in courses that match
    for (const record of trainingRecords) {
      for (const seq of record.sequences) {
        const key = seq.sequenceId || seq.sequenceCode;
        if (!key) continue;
        // Track best grade per criterion per lesson sequence
        if (!bestByLessonId[key]) bestByLessonId[key] = {};
        // We don't have per-criterion info in sequences (sequences only have competence)
        // Store the raw competence as a special marker
        const prev = bestByLessonId[key].__competence__;
        const prevScore = prev ? gradeScore(prev, 'NC/S/C/-') : 0;
        const newScore = gradeScore(seq.competence, 'NC/S/C/-');
        if (newScore > prevScore) {
          bestByLessonId[key].__competence__ = seq.competence;
        }
      }
    }

    return courses.map((course) => {
      const criteria = course.assessmentCriteria;
      const lessons = course.lessons;

      if (lessons.length === 0) return null;

      // For each criterion, compute the best mark achieved across all lessons
      const criteriaProgress = criteria.map((criterion) => {
        let bestScore = 0;
        let bestGrade = '';
        let isComplete = false;

        for (const lesson of lessons) {
          const passMarkForLesson = lesson.passMarks?.[criterion.id];
          if (!passMarkForLesson) continue;

          // Check if this lesson has been graded for this student
          // We use sequenceId/sequenceCode to match lesson to training record sequences
          const lessonKey = lesson.sequenceId || lesson.sequenceCode;
          const lessonResult = lessonKey ? bestByLessonId[lessonKey] : undefined;
          if (!lessonResult) continue;

          const rawCompetence = lessonResult.__competence__;
          if (!rawCompetence || rawCompetence === '-') continue;

          // Map NC/S/C competence to pass mark grade system
          const system = criterion.gradingSystem;
          const topGrade = criterion.passingGrade;

          // Use the pass mark defined for this lesson as the actual grade achieved
          // if the student's competence is C (top), otherwise partial
          let achievedGrade = '';
          if (rawCompetence === 'C') {
            achievedGrade = passMarkForLesson;
          } else if (rawCompetence === 'S') {
            // Partial: one level below pass mark in grading system
            const order = GRADE_ORDER[system];
            if (order.length > 0) {
              const pmIdx = order.indexOf(passMarkForLesson);
              achievedGrade = pmIdx > 0 ? order[Math.max(0, pmIdx - 1)] : passMarkForLesson;
            } else if (system === 'Out of 100') {
              const pm = parseFloat(passMarkForLesson);
              achievedGrade = isNaN(pm) ? passMarkForLesson : String(Math.round(pm * 0.7));
            } else {
              achievedGrade = passMarkForLesson;
            }
          } else if (rawCompetence === 'NC') {
            // Below pass mark
            const order = GRADE_ORDER[system];
            if (order.length > 0) {
              achievedGrade = order[1] || order[0]; // second lowest
            } else if (system === 'Out of 100') {
              achievedGrade = '30';
            }
          }

          const score = gradeScore(achievedGrade, system);
          if (score > bestScore) {
            bestScore = score;
            bestGrade = achievedGrade;
            isComplete = isTopGrade(achievedGrade, system) && achievedGrade === topGrade;
          }
        }

        return { criterion, bestGrade, bestScore, isComplete };
      });

      // Overall course percentage
      // top mark = 1 full point, partial = score * 0.5 points, none = 0
      let totalPoints = 0;
      let earnedPoints = 0;

      for (const cp of criteriaProgress) {
        totalPoints += 1;
        if (cp.isComplete) {
          earnedPoints += 1;
        } else if (cp.bestScore > 0) {
          earnedPoints += cp.bestScore * 0.5;
        }
      }

      // Also factor in lesson completion (lessons touched / total)
      const touchedLessons = new Set<string>();
      for (const lesson of lessons) {
        const key = lesson.sequenceId || lesson.sequenceCode;
        if (key && bestByLessonId[key]) touchedLessons.add(key);
      }
      const completedLessons = touchedLessons.size;

      const percentage = totalPoints > 0
        ? Math.min(100, Math.round((earnedPoints / totalPoints) * 100))
        : completedLessons > 0 ? Math.min(100, Math.round((completedLessons / lessons.length) * 100))
        : 0;

      const criteriaComplete = totalPoints > 0 && criteriaProgress.every((cp) => cp.isComplete);
      const lessonsComplete = completedLessons === lessons.length && lessons.length > 0;
      const isComplete = trainingSettings.courseCompletionRule === 'all_lessons_attempted'
        ? lessonsComplete
        : trainingSettings.courseCompletionRule === 'criteria_or_lessons'
          ? criteriaComplete || lessonsComplete
          : totalPoints > 0
            ? criteriaComplete
            : lessonsComplete;

      return {
        course,
        percentage,
        isComplete,
        completedLessons,
        totalLessons: lessons.length,
        criteriaProgress,
        hasCriteria: criteria.length > 0,
      };
    }).filter(Boolean) as NonNullable<ReturnType<typeof courses['map']>[number]>[];
  }, [courses, trainingRecords, trainingSettings.courseCompletionRule]);

  const enrolledCourses = courseProgress.filter((cp) => {
    if (!cp) return false;
    return (cp as any).completedLessons > 0 || (cp as any).percentage > 0;
  }) as Array<{
    course: TrainingModule;
    percentage: number;
    isComplete: boolean;
    completedLessons: number;
    totalLessons: number;
    criteriaProgress: Array<{ criterion: any; bestGrade: string; bestScore: number; isComplete: boolean }>;
    hasCriteria: boolean;
  }>;

  if (enrolledCourses.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-12 text-center">
        <GraduationCap className="h-16 w-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No course progress yet</h3>
        <p className="text-gray-500 text-sm">
          Course progress will appear here once training records with graded lessons are added.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Courses In Progress</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{enrolledCourses.filter(c => !c.isComplete).length}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Courses Completed</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{enrolledCourses.filter(c => c.isComplete).length}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Total Enrolled</p>
          <p className="text-3xl font-bold text-gray-700 mt-1">{enrolledCourses.length}</p>
        </div>
      </div>

      {enrolledCourses.map(({ course, percentage, isComplete, completedLessons, totalLessons, criteriaProgress, hasCriteria }) => (
        <div key={course.id} className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
          <div className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-1">
                  <h3 className="text-lg font-semibold text-gray-900 truncate">{course.title}</h3>
                  {isComplete && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Completed
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">{course.category} &middot; v{course.version}</p>
              </div>
              <div className="text-right ml-4 shrink-0">
                <span className={`text-3xl font-bold ${isComplete ? 'text-emerald-600' : percentage >= 50 ? 'text-blue-600' : 'text-gray-700'}`}>
                  {percentage}%
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>{completedLessons} of {totalLessons} lessons attempted</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all duration-500 ${isComplete ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>

            {/* Criteria breakdown */}
            {hasCriteria && criteriaProgress.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Assessment Criteria</p>
                <div className="flex flex-wrap gap-2">
                  {criteriaProgress.map(({ criterion, bestGrade, bestScore, isComplete: critComplete }) => {
                    let chipClass = 'bg-gray-100 text-gray-600 border-gray-200';
                    if (critComplete) chipClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                    else if (bestScore > 0) chipClass = 'bg-amber-100 text-amber-800 border-amber-200';

                    return (
                      <div
                        key={criterion.id}
                        title={`Best grade: ${bestGrade || 'None'}`}
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${chipClass}`}
                      >
                        {critComplete && <CheckCircle className="h-3 w-3 mr-1" />}
                        {criterion.name}
                        {bestGrade && bestGrade !== '-' && (
                          <span className="ml-1 opacity-70">({bestGrade})</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
