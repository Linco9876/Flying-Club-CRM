import React from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StudentForm } from './StudentForm';
import { InviteUserModal } from './InviteUserModal';
import { Student, UserRole } from '../../types';
import { User, Phone, Mail, Clock, Award, AlertTriangle, CheckCircle, Loader2, Search, UserPlus } from 'lucide-react';
import { useStudents } from '../../hooks/useStudents';
import { InviteUserResult, useInvitations } from '../../hooks/useInvitations';
import { useTrainingRecords } from '../../hooks/useTrainingRecords';
import { useFlightLogs } from '../../hooks/useFlightLogs';

export const StudentList: React.FC = () => {
  const navigate = useNavigate();
  const { students, loading, addStudent, updateStudent, refetch } = useStudents();
  const { inviteUser } = useInvitations();
  const { trainingRecords } = useTrainingRecords();
  const { flightLogs } = useFlightLogs();
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'instructor' | 'pilot' | 'student'>('all');

  const normaliseSearch = (value?: string | null) =>
    (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const getMemberRoles = (student: Student): UserRole[] =>
    student.roles && student.roles.length > 0 ? student.roles : [student.role as UserRole];

  const matchesRoleFilter = (student: Student) => {
    if (roleFilter === 'all') return true;
    const roles = getMemberRoles(student);
    if (roleFilter === 'instructor') return roles.includes('instructor') || roles.includes('senior_instructor');
    return roles.includes(roleFilter);
  };

  const visibleMembers = useMemo(() => {
    const terms = normaliseSearch(searchTerm).split(/\s+/).filter(Boolean);

    return students.filter(student => {
      if (!matchesRoleFilter(student)) return false;
      if (terms.length === 0) return true;

      const haystack = normaliseSearch([
        student.name,
        student.email,
        student.phone,
        student.mobilePhone,
        student.homePhone,
        student.workPhone,
        student.raausId,
        student.casaId
      ].filter(Boolean).join(' '));

      return terms.every(term => haystack.includes(term));
    });
  }, [roleFilter, searchTerm, students]);

  const roleFilters: { id: typeof roleFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'admin', label: 'Admin' },
    { id: 'instructor', label: 'Instructor' },
    { id: 'pilot', label: 'Pilot' },
    { id: 'student', label: 'Student' }
  ];

  const roleLabels: Record<UserRole, string> = {
    admin: 'Admin',
    senior_instructor: 'Senior Instructor',
    instructor: 'Instructor',
    pilot: 'Pilot',
    student: 'Student'
  };

  const roleBadgeClass = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'bg-red-100 text-red-800';
      case 'senior_instructor':
        return 'bg-indigo-100 text-indigo-800';
      case 'instructor':
        return 'bg-green-100 text-green-800';
      case 'pilot':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-blue-100 text-blue-800';
    }
  };

  const renderAvatar = (student: Student, sizeClass: string, iconClass: string) => (
    <div className={`${sizeClass} flex-shrink-0 overflow-hidden rounded-full bg-blue-600 shadow-sm ring-2 ring-white`}>
      {student.avatar ? (
        <img
          src={student.avatar}
          alt={`${student.name || 'Member'} avatar`}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <User className={`${iconClass} text-white`} />
        </div>
      )}
    </div>
  );

  const statsByStudent = useMemo(() => {
    const stats = new Map<string, { totalHours: number; lessonCount: number; lastFlight?: Date }>();

    visibleMembers.forEach(student => {
      stats.set(student.id, { totalHours: 0, lessonCount: 0 });
    });

    flightLogs.forEach(log => {
      if (!stats.has(log.student_id)) return;
      const current = stats.get(log.student_id)!;
      const flightDate = log.start_time ? new Date(log.start_time) : undefined;
      stats.set(log.student_id, {
        ...current,
        totalHours: current.totalHours + Number(log.flight_duration || 0),
        lastFlight: flightDate && (!current.lastFlight || flightDate > current.lastFlight) ? flightDate : current.lastFlight
      });
    });

    trainingRecords.forEach(record => {
      if (!stats.has(record.studentId)) return;
      const current = stats.get(record.studentId)!;
      stats.set(record.studentId, {
        ...current,
        lessonCount: current.lessonCount + 1
      });
    });

    return stats;
  }, [flightLogs, trainingRecords, visibleMembers]);

  const getStudentStats = (studentId: string) => statsByStudent.get(studentId) || { totalHours: 0, lessonCount: 0 };

  const isExpiryNear = (date?: Date) => {
    if (!date) return false;
    const daysUntilExpiry = Math.ceil((date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 60;
  };

  const handleAddStudent = async (studentData: Omit<Student, 'id'>) => {
    await addStudent(studentData);
    setShowStudentForm(false);
  };

  const handleEditStudent = async (studentData: Omit<Student, 'id'>) => {
    if (editingStudent) {
      await updateStudent(editingStudent.id, studentData);
      setEditingStudent(null);
      setShowStudentForm(false);
    }
  };

  const openEditForm = (student: Student) => {
    setEditingStudent(student);
    setShowStudentForm(true);
  };

  const openViewDetails = (student: Student) => {
    navigate(`/students/${student.id}`);
  };

  const openStudentTab = (student: Student, tab: string) => {
    navigate(`/students/${student.id}?tab=${tab}`);
  };

  const closeStudentForm = () => {
    setShowStudentForm(false);
    setEditingStudent(null);
  };

  const handleInviteUser = async (data: {
    email: string;
    name: string;
    phone?: string;
    roles?: UserRole[];
  }): Promise<InviteUserResult | undefined> => {
    const result = await inviteUser(data);
    if (result?.tempPassword || result?.emailSent) {
      await refetch();
    }
    return result;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Members</h1>
          <p className="mt-1 text-sm text-gray-500 lg:hidden">
            {visibleMembers.length} member{visibleMembers.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="flex items-center justify-center space-x-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 sm:w-auto sm:py-2 lg:rounded-lg"
        >
          <UserPlus className="h-4 w-4" />
          <span>Invite User</span>
        </button>
      </div>

      <div className="mb-4 grid gap-3 lg:mb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Search name, email, RAAus or CASA..."
            className="w-full rounded-xl border border-gray-300 bg-white py-3 pl-10 pr-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 lg:rounded-lg lg:py-2"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
          {roleFilters.map(filter => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setRoleFilter(filter.id)}
              className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                roleFilter === filter.id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 lg:hidden">
        {visibleMembers.map(student => {
          const stats = getStudentStats(student.id);
          const medicalNearExpiry = isExpiryNear(student.medicalExpiry);
          const licenceNearExpiry = isExpiryNear(student.licenceExpiry);
          const activeEndorsements = student.endorsements.filter(e => e.isActive).length;
          const memberRoles = getMemberRoles(student);

          return (
            <article
              key={student.id}
              className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
            >
              <button
                type="button"
                onClick={() => openViewDetails(student)}
                className="block w-full px-4 py-4 text-left transition-colors hover:bg-gray-50"
              >
                <div className="flex items-start gap-3">
                  {renderAvatar(student, 'h-11 w-11', 'h-5 w-5')}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-gray-900">{student.name}</h2>
                        <p className="truncate text-xs text-gray-500">{student.email}</p>
                      </div>
                      <div className="flex flex-shrink-0 flex-wrap justify-end gap-1">
                        {memberRoles.slice(0, 2).map(role => (
                          <span key={role} className={`rounded-full px-2 py-1 text-[11px] font-semibold ${roleBadgeClass(role)}`}>
                            {roleLabels[role]}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl bg-gray-50 px-3 py-2">
                        <p className="font-medium text-gray-500">Hours</p>
                        <p className="mt-0.5 text-sm font-semibold text-gray-900">{stats.totalHours.toFixed(1)}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 px-3 py-2">
                        <p className="font-medium text-gray-500">Lessons</p>
                        <p className="mt-0.5 text-sm font-semibold text-gray-900">{stats.lessonCount}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </button>

              <div className="space-y-2 border-t border-gray-100 px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {student.raausId && (
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                      RAAus {student.raausId}
                    </span>
                  )}
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                    {stats.lessonCount} lesson{stats.lessonCount === 1 ? '' : 's'}
                  </span>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                    {activeEndorsements} endorsement{activeEndorsements === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="grid gap-2 text-xs">
                  <div className={`flex items-center ${medicalNearExpiry ? 'text-yellow-700' : 'text-green-700'}`}>
                    {medicalNearExpiry ? <AlertTriangle className="mr-1.5 h-3.5 w-3.5" /> : <CheckCircle className="mr-1.5 h-3.5 w-3.5" />}
                    Medical: {student.medicalExpiry?.toLocaleDateString() || 'Not recorded'}
                  </div>
                  <div className={`flex items-center ${licenceNearExpiry ? 'text-yellow-700' : 'text-green-700'}`}>
                    {licenceNearExpiry ? <AlertTriangle className="mr-1.5 h-3.5 w-3.5" /> : <CheckCircle className="mr-1.5 h-3.5 w-3.5" />}
                    Membership: {student.licenceExpiry?.toLocaleDateString() || 'Not recorded'}
                  </div>
                  {student.phone && (
                    <div className="flex items-center text-gray-600">
                      <Phone className="mr-1.5 h-3.5 w-3.5 text-gray-400" />
                      {student.phone}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => openViewDetails(student)}
                    className="rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                  >
                    View file
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditForm(student)}
                    className="rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Edit
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => openStudentTab(student, 'training')}
                    className="rounded-xl border border-blue-100 bg-blue-50 px-2 py-2 text-xs font-semibold text-blue-700"
                  >
                    Training
                  </button>
                  <button
                    type="button"
                    onClick={() => openStudentTab(student, 'logbook')}
                    className="rounded-xl border border-green-100 bg-green-50 px-2 py-2 text-xs font-semibold text-green-700"
                  >
                    Logbook
                  </button>
                  <button
                    type="button"
                    onClick={() => openStudentTab(student, 'documents')}
                    className="rounded-xl border border-gray-200 bg-gray-50 px-2 py-2 text-xs font-semibold text-gray-700"
                  >
                    Docs
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {visibleMembers.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            No members match your filters.
          </div>
        )}
      </div>

      <div className="hidden bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden lg:block">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Flight Hours
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Currency Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Balance
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {visibleMembers.map(student => {
                const stats = getStudentStats(student.id);
                const medicalNearExpiry = isExpiryNear(student.medicalExpiry);
                const licenceNearExpiry = isExpiryNear(student.licenceExpiry);
                const memberRoles = getMemberRoles(student);

                return (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {renderAvatar(student, 'h-10 w-10', 'h-5 w-5')}
                        <div className="ml-4">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-gray-900">{student.name}</div>
                            {memberRoles.map(role => (
                              <span key={role} className={`px-2 py-1 text-xs font-medium rounded-full ${roleBadgeClass(role)}`}>
                                {roleLabels[role]}
                              </span>
                            ))}
                          </div>
                          <div className="text-sm text-gray-500">
                            {[
                              student.raausId ? `RAAus: ${student.raausId}` : '',
                              student.casaId ? `CASA: ${student.casaId}` : ''
                            ].filter(Boolean).join(' | ')}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        <div className="flex items-center mb-1">
                          <Mail className="h-3 w-3 text-gray-400 mr-2" />
                          {student.email}
                        </div>
                        {student.phone && (
                          <div className="flex items-center">
                            <Phone className="h-3 w-3 text-gray-400 mr-2" />
                            {student.phone}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        <div className="flex items-center mb-1">
                          <Clock className="h-3 w-3 text-gray-400 mr-2" />
                          {stats.totalHours.toFixed(1)} hrs
                        </div>
                        <div className="text-xs text-gray-500">{stats.lessonCount} lessons</div>
                        {stats.lastFlight && (
                          <div className="text-xs text-gray-500">Last flight {stats.lastFlight.toLocaleDateString()}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        <div className={`flex items-center text-xs ${medicalNearExpiry ? 'text-yellow-600' : 'text-green-600'}`}>
                          {medicalNearExpiry ? <AlertTriangle className="h-3 w-3 mr-1" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                          Medical: {student.medicalExpiry?.toLocaleDateString()}
                        </div>
                        <div className={`flex items-center text-xs ${licenceNearExpiry ? 'text-yellow-600' : 'text-green-600'}`}>
                          {licenceNearExpiry ? <AlertTriangle className="h-3 w-3 mr-1" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                          Membership: {student.licenceExpiry?.toLocaleDateString()}
                        </div>
                        <div className="flex items-center text-xs text-blue-600">
                          <Award className="h-3 w-3 mr-1" />
                          {student.endorsements.filter(e => e.isActive).length} endorsements
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-gray-900">
                        ${student.prepaidBalance.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => openViewDetails(student)}
                        className="text-blue-600 hover:text-blue-900 mr-3"
                      >
                        View
                      </button>
                      <button
                        onClick={() => openStudentTab(student, 'training')}
                        className="text-green-600 hover:text-green-900 mr-3"
                      >
                        Training
                      </button>
                      <button
                        onClick={() => openStudentTab(student, 'logbook')}
                        className="text-indigo-600 hover:text-indigo-900 mr-3"
                      >
                        Logbook
                      </button>
                      <button
                        onClick={() => openStudentTab(student, 'documents')}
                        className="text-gray-600 hover:text-gray-900 mr-3"
                      >
                        Docs
                      </button>
                      <button 
                        onClick={() => openEditForm(student)}
                        className="text-gray-600 hover:text-gray-900"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visibleMembers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-500">
                    No members match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <StudentForm
        isOpen={showStudentForm}
        onClose={closeStudentForm}
        onSubmit={editingStudent ? handleEditStudent : handleAddStudent}
        student={editingStudent || undefined}
        isEdit={!!editingStudent}
      />

      <InviteUserModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onInvite={handleInviteUser}
      />
    </div>
  );
};
