import React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mockTrainingRecords } from '../../data/mockData';
import { StudentForm } from './StudentForm';
import { StudentDetails } from './StudentDetails';
import { InviteUserModal } from './InviteUserModal';
import { Student } from '../../types';
import { User, Phone, Mail, Clock, Award, AlertTriangle, CheckCircle, Loader2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStudents } from '../../hooks/useStudents';
import { useInvitations } from '../../hooks/useInvitations';

export const StudentList: React.FC = () => {
  const navigate = useNavigate();
  const { students, loading, addStudent, updateStudent, refetch } = useStudents();
  const { inviteUser } = useInvitations();
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showStudentDetails, setShowStudentDetails] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [viewingStudent, setViewingStudent] = useState<Student | null>(null);

  const getStudentStats = (studentId: string) => {
    const records = mockTrainingRecords.filter(r => r.studentId === studentId);
    const totalHours = records.reduce((sum, r) => sum + r.soloTime + r.dualTime, 0);
    return { totalHours, lessonCount: records.length };
  };

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

  const closeStudentForm = () => {
    setShowStudentForm(false);
    setEditingStudent(null);
  };

  const closeStudentDetails = () => {
    setShowStudentDetails(false);
    setViewingStudent(null);
  };

  const handleInviteUser = async (data: {
    email: string;
    name: string;
    phone?: string;
    role?: 'student' | 'instructor' | 'admin';
  }) => {
    const password = await inviteUser(data);
    if (password) {
      await refetch();
    }
    return password;
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
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Students/Pilots</h1>
          <p className="mt-1 text-sm text-gray-500 lg:hidden">
            {students.length} active file{students.length === 1 ? '' : 's'}
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

      <div className="space-y-3 lg:hidden">
        {students.map(student => {
          const stats = getStudentStats(student.id);
          const medicalNearExpiry = isExpiryNear(student.medicalExpiry);
          const licenceNearExpiry = isExpiryNear(student.licenceExpiry);
          const activeEndorsements = student.endorsements.filter(e => e.isActive).length;

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
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-blue-600">
                    <User className="h-5 w-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-gray-900">{student.name}</h2>
                        <p className="truncate text-xs text-gray-500">{student.email}</p>
                      </div>
                      <span className={`flex-shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${
                        student.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                        student.role === 'instructor' ? 'bg-green-100 text-green-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {student.role}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl bg-gray-50 px-3 py-2">
                        <p className="font-medium text-gray-500">Hours</p>
                        <p className="mt-0.5 text-sm font-semibold text-gray-900">{stats.totalHours.toFixed(1)}</p>
                      </div>
                      <div className="rounded-xl bg-gray-50 px-3 py-2">
                        <p className="font-medium text-gray-500">Balance</p>
                        <p className="mt-0.5 text-sm font-semibold text-gray-900">${student.prepaidBalance.toFixed(2)}</p>
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
              </div>
            </article>
          );
        })}
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
              {students.map(student => {
                const stats = getStudentStats(student.id);
                const medicalNearExpiry = isExpiryNear(student.medicalExpiry);
                const licenceNearExpiry = isExpiryNear(student.licenceExpiry);

                return (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="h-10 w-10 bg-blue-600 rounded-full flex items-center justify-center">
                          <User className="h-5 w-5 text-white" />
                        </div>
                        <div className="ml-4">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-gray-900">{student.name}</div>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              student.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                              student.role === 'instructor' ? 'bg-green-100 text-green-800' :
                              'bg-blue-100 text-blue-800'
                            }`}>
                              {student.role}
                            </span>
                          </div>
                          <div className="text-sm text-gray-500">
                            {student.raausId && `RAAus: ${student.raausId}`}
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
                        onClick={() => openEditForm(student)}
                        className="text-gray-600 hover:text-gray-900"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
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

      {viewingStudent && (
        <StudentDetails
          isOpen={showStudentDetails}
          onClose={closeStudentDetails}
          student={viewingStudent}
        />
      )}

      <InviteUserModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onInvite={handleInviteUser}
      />
    </div>
  );
};
