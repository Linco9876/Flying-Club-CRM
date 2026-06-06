import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';

export interface StudentCourseEnrolment {
  id: string;
  studentId: string;
  courseId: string;
  enrolledBy: string | null;
  status: 'active' | 'completed' | 'withdrawn';
  notes: string;
  enrolledAt: Date;
  updatedAt: Date;
}

export const useStudentCourseEnrolments = (studentId?: string) => {
  const [enrolments, setEnrolments] = useState<StudentCourseEnrolment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEnrolments = useCallback(async () => {
    if (!studentId) {
      setEnrolments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('student_course_enrolments')
        .select('*')
        .eq('student_id', studentId)
        .order('enrolled_at', { ascending: false });

      if (error) throw error;

      setEnrolments((data || []).map((row: any) => ({
        id: row.id,
        studentId: row.student_id,
        courseId: row.course_id,
        enrolledBy: row.enrolled_by,
        status: row.status || 'active',
        notes: row.notes || '',
        enrolledAt: row.enrolled_at ? new Date(row.enrolled_at) : new Date(),
        updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
      })));
    } catch (error) {
      console.error('Failed to load course enrolments:', error);
      toast.error('Failed to load course enrolments');
      setEnrolments([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void fetchEnrolments();
  }, [fetchEnrolments]);

  const enrolInCourse = async (courseId: string, enrolledBy?: string, notes = '') => {
    if (!studentId) throw new Error('Student is not loaded');

    const { error } = await supabase
      .from('student_course_enrolments')
      .upsert({
        student_id: studentId,
        course_id: courseId,
        enrolled_by: enrolledBy || null,
        status: 'active',
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'student_id,course_id' });

    if (error) {
      console.error('Failed to enrol student in course:', error);
      toast.error('Failed to enrol student in course');
      throw error;
    }

    await fetchEnrolments();
    toast.success('Student enrolled in course');
  };

  const updateEnrolmentStatus = async (id: string, status: StudentCourseEnrolment['status']) => {
    const { error } = await supabase
      .from('student_course_enrolments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('Failed to update course enrolment:', error);
      toast.error('Failed to update course enrolment');
      throw error;
    }

    await fetchEnrolments();
    toast.success('Course enrolment updated');
  };

  return {
    enrolments,
    loading,
    enrolInCourse,
    updateEnrolmentStatus,
    refetch: fetchEnrolments,
  };
};
