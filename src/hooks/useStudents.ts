import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Student, Endorsement } from '../types';
import toast from 'react-hot-toast';

export const useStudents = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('*')
        .eq('role', 'student');

      if (usersError) throw usersError;

      const { data: studentsData, error: studentsError } = await supabase
        .from('students')
        .select('*');

      if (studentsError) throw studentsError;

      const { data: endorsementsData, error: endorsementsError } = await supabase
        .from('endorsements')
        .select('*');

      if (endorsementsError) throw endorsementsError;

      const studentsMap = new Map(studentsData?.map(s => [s.id, s]) || []);
      const endorsementsMap = new Map<string, Endorsement[]>();

      endorsementsData?.forEach(e => {
        const studentEndorsements = endorsementsMap.get(e.student_id) || [];
        studentEndorsements.push({
          id: e.id,
          type: e.type,
          dateObtained: new Date(e.date_obtained),
          expiryDate: e.expiry_date ? new Date(e.expiry_date) : undefined,
          instructorId: e.instructor_id,
          isActive: e.is_active
        });
        endorsementsMap.set(e.student_id, studentEndorsements);
      });

      const combinedStudents: Student[] = (usersData || []).map(user => {
        const studentData = studentsMap.get(user.id);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: 'student' as const,
          phone: user.phone,
          avatar: user.avatar_url,
          raausId: studentData?.raaus_id,
          casaId: studentData?.casa_id,
          medicalType: studentData?.medical_type,
          medicalExpiry: studentData?.medical_expiry ? new Date(studentData.medical_expiry) : undefined,
          licenceExpiry: studentData?.licence_expiry ? new Date(studentData.licence_expiry) : undefined,
          occupation: studentData?.occupation,
          alternatePhone: studentData?.alternate_phone,
          emergencyContact: studentData?.emergency_contact_name ? {
            name: studentData.emergency_contact_name,
            phone: studentData.emergency_contact_phone || '',
            relationship: studentData.emergency_contact_relationship || ''
          } : undefined,
          dateOfBirth: studentData?.date_of_birth ? new Date(studentData.date_of_birth) : undefined,
          prepaidBalance: studentData?.prepaid_balance ? parseFloat(studentData.prepaid_balance) : 0,
          endorsements: endorsementsMap.get(user.id) || []
        };
      });

      setStudents(combinedStudents);
      setError(null);
    } catch (err) {
      console.error('Error fetching students:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch students');
      toast.error('Failed to load students');
    } finally {
      setLoading(false);
    }
  };

  const addStudent = async (studentData: Omit<Student, 'id'>) => {
    try {
      const { data: existingUser } = await supabase
        .from('users')
        .select('email')
        .eq('email', studentData.email)
        .maybeSingle();

      if (existingUser) {
        toast.error('A user with this email already exists');
        throw new Error('User with this email already exists');
      }

      const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: studentData.email,
        password: tempPassword,
        options: {
          data: {
            name: studentData.name,
            role: 'student'
          },
          emailRedirectTo: undefined
        }
      });

      if (authError) {
        if (authError.message.includes('already registered')) {
          toast.error('A user with this email already exists');
          throw new Error('User with this email already exists');
        }
        throw authError;
      }
      if (!authData.user) throw new Error('Failed to create user');

      const { error: userError } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          email: studentData.email,
          name: studentData.name,
          role: 'student',
          phone: studentData.phone,
          avatar_url: studentData.avatar
        });

      if (userError) throw userError;

      const userData = { id: authData.user.id };

      const { error: studentError } = await supabase
        .from('students')
        .insert({
          id: userData.id,
          raaus_id: studentData.raausId,
          casa_id: studentData.casaId,
          medical_type: studentData.medicalType,
          medical_expiry: studentData.medicalExpiry,
          licence_expiry: studentData.licenceExpiry,
          occupation: studentData.occupation,
          alternate_phone: studentData.alternatePhone,
          date_of_birth: studentData.dateOfBirth,
          prepaid_balance: studentData.prepaidBalance,
          emergency_contact_name: studentData.emergencyContact?.name,
          emergency_contact_phone: studentData.emergencyContact?.phone,
          emergency_contact_relationship: studentData.emergencyContact?.relationship
        });

      if (studentError) throw studentError;

      if (studentData.endorsements && studentData.endorsements.length > 0) {
        const endorsementsToInsert = studentData.endorsements.map(e => ({
          student_id: userData.id,
          type: e.type,
          date_obtained: e.dateObtained,
          expiry_date: e.expiryDate,
          instructor_id: e.instructorId,
          is_active: e.isActive
        }));

        const { error: endorsementsError } = await supabase
          .from('endorsements')
          .insert(endorsementsToInsert);

        if (endorsementsError) throw endorsementsError;
      }

      await fetchStudents();
      toast.success('Student added successfully');
    } catch (err) {
      console.error('Error adding student:', err);
      if (err instanceof Error && err.message.includes('already exists')) {
        return;
      }
      toast.error('Failed to add student');
      throw err;
    }
  };

  const updateStudent = async (id: string, studentData: Omit<Student, 'id'>) => {
    try {
      const { error: userError } = await supabase
        .from('users')
        .update({
          email: studentData.email,
          name: studentData.name,
          phone: studentData.phone,
          avatar_url: studentData.avatar
        })
        .eq('id', id);

      if (userError) throw userError;

      const { error: studentError } = await supabase
        .from('students')
        .update({
          raaus_id: studentData.raausId,
          casa_id: studentData.casaId,
          medical_type: studentData.medicalType,
          medical_expiry: studentData.medicalExpiry,
          licence_expiry: studentData.licenceExpiry,
          occupation: studentData.occupation,
          alternate_phone: studentData.alternatePhone,
          date_of_birth: studentData.dateOfBirth,
          prepaid_balance: studentData.prepaidBalance,
          emergency_contact_name: studentData.emergencyContact?.name,
          emergency_contact_phone: studentData.emergencyContact?.phone,
          emergency_contact_relationship: studentData.emergencyContact?.relationship
        })
        .eq('id', id);

      if (studentError) throw studentError;

      const { error: deleteEndorsementsError } = await supabase
        .from('endorsements')
        .delete()
        .eq('student_id', id);

      if (deleteEndorsementsError) throw deleteEndorsementsError;

      if (studentData.endorsements && studentData.endorsements.length > 0) {
        const endorsementsToInsert = studentData.endorsements.map(e => ({
          student_id: id,
          type: e.type,
          date_obtained: e.dateObtained,
          expiry_date: e.expiryDate,
          instructor_id: e.instructorId,
          is_active: e.isActive
        }));

        const { error: endorsementsError } = await supabase
          .from('endorsements')
          .insert(endorsementsToInsert);

        if (endorsementsError) throw endorsementsError;
      }

      await fetchStudents();
      toast.success('Student updated successfully');
    } catch (err) {
      console.error('Error updating student:', err);
      toast.error('Failed to update student');
      throw err;
    }
  };

  const deleteStudent = async (id: string) => {
    try {
      const { error: endorsementsError } = await supabase
        .from('endorsements')
        .delete()
        .eq('student_id', id);

      if (endorsementsError) throw endorsementsError;

      const { error: studentError } = await supabase
        .from('students')
        .delete()
        .eq('id', id);

      if (studentError) throw studentError;

      const { error: userError } = await supabase
        .from('users')
        .delete()
        .eq('id', id);

      if (userError) throw userError;

      await fetchStudents();
      toast.success('Student deleted successfully');
    } catch (err) {
      console.error('Error deleting student:', err);
      toast.error('Failed to delete student');
      throw err;
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  return {
    students,
    loading,
    error,
    addStudent,
    updateStudent,
    deleteStudent,
    refetch: fetchStudents
  };
};
