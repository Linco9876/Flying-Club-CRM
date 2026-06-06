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
  declarationSignedAt?: Date;
  declarationSignedName?: string;
  declarationMemberNumber?: string;
  declarationTextSnapshot?: string;
  declarationVersion?: number;
  guardianDeclarationSignedAt?: Date;
  guardianDeclarationSignedName?: string;
  guardianDeclarationRelationship?: string;
  guardianDeclarationEmail?: string;
  guardianDeclarationPhone?: string;
  guardianDeclarationTextSnapshot?: string;
  guardianDeclarationVersion?: number;
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
        declarationSignedAt: row.declaration_signed_at ? new Date(row.declaration_signed_at) : undefined,
        declarationSignedName: row.declaration_signed_name || undefined,
        declarationMemberNumber: row.declaration_member_number || undefined,
        declarationTextSnapshot: row.declaration_text_snapshot || undefined,
        declarationVersion: row.declaration_version ?? undefined,
        guardianDeclarationSignedAt: row.guardian_declaration_signed_at ? new Date(row.guardian_declaration_signed_at) : undefined,
        guardianDeclarationSignedName: row.guardian_declaration_signed_name || undefined,
        guardianDeclarationRelationship: row.guardian_declaration_relationship || undefined,
        guardianDeclarationEmail: row.guardian_declaration_email || undefined,
        guardianDeclarationPhone: row.guardian_declaration_phone || undefined,
        guardianDeclarationTextSnapshot: row.guardian_declaration_text_snapshot || undefined,
        guardianDeclarationVersion: row.guardian_declaration_version ?? undefined,
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

  const signCourseDeclaration = async ({
    enrolmentId,
    signatureName,
    memberNumber,
    declarationText,
    declarationVersion,
    guardianSignatureName,
    guardianRelationship,
    guardianEmail,
    guardianPhone,
    guardianDeclarationText,
    guardianDeclarationVersion,
  }: {
    enrolmentId: string;
    signatureName: string;
    memberNumber: string;
    declarationText: string;
    declarationVersion: number;
    guardianSignatureName?: string;
    guardianRelationship?: string;
    guardianEmail?: string;
    guardianPhone?: string;
    guardianDeclarationText?: string;
    guardianDeclarationVersion?: number;
  }) => {
    const signedAt = new Date();
    const updateData: Record<string, unknown> = {
      declaration_signed_at: signedAt.toISOString(),
      declaration_signed_name: signatureName.trim(),
      declaration_member_number: memberNumber.trim() || null,
      declaration_text_snapshot: declarationText,
      declaration_version: declarationVersion,
      updated_at: signedAt.toISOString(),
    };

    if (guardianSignatureName?.trim() && guardianDeclarationText?.trim()) {
      updateData.guardian_declaration_signed_at = signedAt.toISOString();
      updateData.guardian_declaration_signed_name = guardianSignatureName.trim();
      updateData.guardian_declaration_relationship = guardianRelationship?.trim() || null;
      updateData.guardian_declaration_email = guardianEmail?.trim() || null;
      updateData.guardian_declaration_phone = guardianPhone?.trim() || null;
      updateData.guardian_declaration_text_snapshot = guardianDeclarationText;
      updateData.guardian_declaration_version = guardianDeclarationVersion ?? declarationVersion;
    }

    const { error } = await supabase
      .from('student_course_enrolments')
      .update(updateData)
      .eq('id', enrolmentId);

    if (error) {
      console.error('Failed to sign course declaration:', error);
      toast.error('Failed to save declaration signature');
      throw error;
    }

    await fetchEnrolments();
    toast.success('Flying declaration signed');
  };

  return {
    enrolments,
    loading,
    enrolInCourse,
    updateEnrolmentStatus,
    signCourseDeclaration,
    refetch: fetchEnrolments,
  };
};
