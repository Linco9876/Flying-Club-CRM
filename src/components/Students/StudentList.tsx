import React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mockStudents, mockTrainingRecords } from '../../data/mockData';
import { StudentForm } from './StudentForm';
import { StudentDetails } from './StudentDetails';
import { Student } from '../../types';
import { User, Phone, Mail, Clock, Award, AlertTriangle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export const StudentList: React.FC = () => {
  const navigate = useNavigate();
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showStudentDetails, setShowStudentDetails] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [viewingStudent, setViewingStudent] = useState<Student | null>(null);
  const [students, setStudents] = useState(mockStudents);

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

  const handleAddStudent = (studentData: Omit<Student, 'id'>) => {
    const newStudent: Student = {
      ...studentData,
      id: (students.length + 1).toString()
    };
    setStudents(prev => [...prev, newStudent]);
  };

  const handleEditStudent = (studentData: Omit<Student, 'id'>) => {
    if (editingStudent) {
      const updatedStudent: Student = {
        ...studentData,
        id: editingStudent.id
      };
      setStudents(prev => prev.map(s => s.id === editingStudent.id ? updatedStudent : s));
      setEditingStudent(null);
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

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Students</h1>
        <button 
          onClick={() => setShowStudentForm(true)}
          className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <User className="h-4 w-4" />
          <span>Add Student</span>
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Student
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
                          <div className="text-sm font-medium text-gray-900">{student.name}</div>
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
                          Licence: {student.licenceExpiry?.toLocaleDateString()}
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
    </div>
  );
};