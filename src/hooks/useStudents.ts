import { useCallback, useState, useEffect } from 'react';
import { publicSupabaseKey, publicSupabaseUrl, supabase } from '../lib/supabase';
import { Student, Endorsement, Licence, UserRole } from '../types';
import toast from 'react-hot-toast';
import { usePageLoadState } from '../context/PageLoadContext';
import {
  isReconcileableOrphanEmailConflict,
  orphanEmailReconciliationPrompt,
} from '../utils/accountEmailConflict';
import {
  DEFAULT_MEDICAL_TYPES,
  findMedicalTypeDefinition,
  normaliseMedicalTypes,
  resolveMedicalRequirement,
} from '../utils/medicalRequirements';

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

const isSchemaCacheError = (error: unknown) => {
  const message = getErrorMessage(error, '').toLowerCase();
  return message.includes('schema cache') || message.includes('could not find');
};

interface UseStudentsOptions {
  participateInPageLoad?: boolean;
  scopeStudentId?: string;
}

let studentsCache: Student[] | null = null;

export const useStudents = (options?: UseStudentsOptions) => {
  const participateInPageLoad = options?.participateInPageLoad ?? true;
  const scopeStudentId = options?.scopeStudentId;
  const [students, setStudents] = useState<Student[]>(() =>
    scopeStudentId
      ? (studentsCache || []).filter(student => student.id === scopeStudentId)
      : studentsCache || []
  );
  const [loading, setLoading] = useState(() =>
    scopeStudentId
      ? !studentsCache?.some(student => student.id === scopeStudentId)
      : !studentsCache
  );
  const [error, setError] = useState<string | null>(null);
  usePageLoadState(
    participateInPageLoad && loading,
    'Loading members',
    'Preparing member profiles, roles, endorsements and contact details...'
  );

  const writeStudentRow = async (
    mode: 'insert' | 'update',
    payload: Record<string, unknown>,
    id?: string
  ) => {
    const runWrite = async (nextPayload: Record<string, unknown>) => {
      if (mode === 'insert') {
        return supabase.from('students').insert(nextPayload);
      }

      const updateResult = await supabase
        .from('students')
        .update(nextPayload)
        .eq('id', id)
        .select('id');

      if (updateResult.error) return updateResult;
      if (updateResult.data && updateResult.data.length > 0) return updateResult;

      return supabase.from('students').insert({ id, ...nextPayload });
    };

    const result = await runWrite(payload);
    if (result.error && isSchemaCacheError(result.error)) {
      await new Promise(resolve => setTimeout(resolve, 750));
      return runWrite(payload);
    }

    return result;
  };

  const fetchStudents = useCallback(async () => {
    try {
      if (!studentsCache || (scopeStudentId && !studentsCache.some(student => student.id === scopeStudentId))) {
        setLoading(true);
      }

      let usersQuery = supabase.from('users').select('*');
      let studentsQuery = supabase.from('students').select('*');
      let endorsementsQuery = supabase.from('endorsements').select('*');
      let licencesQuery = supabase.from('licences').select('*');
      let rolesQuery = supabase.from('user_roles').select('user_id, role');
      let courseEnrolmentsQuery = supabase
        .from('student_course_enrolments')
        .select('student_id,status,training_courses!inner(title,medical_requirement_mode,medical_requirement_age)')
        .eq('status', 'active');
      if (scopeStudentId) {
        usersQuery = usersQuery.eq('id', scopeStudentId);
        studentsQuery = studentsQuery.eq('id', scopeStudentId);
        endorsementsQuery = endorsementsQuery.eq('student_id', scopeStudentId);
        licencesQuery = licencesQuery.eq('student_id', scopeStudentId);
        rolesQuery = rolesQuery.eq('user_id', scopeStudentId);
        courseEnrolmentsQuery = courseEnrolmentsQuery.eq('student_id', scopeStudentId);
      }

      const [
        usersResult,
        studentsResult,
        endorsementsResult,
        licencesResult,
        rolesResult,
        courseEnrolmentsResult,
        trainingSettingsResult,
      ] = await Promise.all([
        usersQuery,
        studentsQuery,
        endorsementsQuery,
        licencesQuery,
        rolesQuery,
        courseEnrolmentsQuery,
        supabase.from('training_syllabus_settings').select('medical_types').maybeSingle(),
      ]);

      const { data: usersData, error: usersError } = usersResult;
      const { data: studentsData, error: studentsError } = studentsResult;
      const { data: endorsementsData, error: endorsementsError } = endorsementsResult;
      const { data: licencesData, error: licencesError } = licencesResult;
      const { data: rolesData, error: rolesError } = rolesResult;
      const { data: courseEnrolmentsData, error: courseEnrolmentsError } = courseEnrolmentsResult;
      const { data: trainingSettingsData, error: trainingSettingsError } = trainingSettingsResult;

      if (usersError) throw usersError;
      if (studentsError) throw studentsError;
      if (endorsementsError) throw endorsementsError;
      if (licencesError) throw licencesError;
      if (rolesError) {
        console.warn('Could not load member role assignments; falling back to primary roles.', rolesError);
      }
      if (courseEnrolmentsError) {
        console.warn('Could not load course medical requirements; student medical warnings will remain suppressed.', courseEnrolmentsError);
      }
      if (trainingSettingsError) {
        console.warn('Could not load medical type settings; using safe defaults.', trainingSettingsError);
      }

      const rolesMap = new Map<string, string[]>();
      (rolesData || []).forEach((r: any) => {
        if (!rolesMap.has(r.user_id)) rolesMap.set(r.user_id, []);
        rolesMap.get(r.user_id)!.push(r.role);
      });

      const studentsMap = new Map(studentsData?.map(s => [s.id, s]) || []);
      const endorsementsMap = new Map<string, Endorsement[]>();
      const licencesMap = new Map<string, Licence[]>();
      const activeMedicalCoursesByStudent = new Map<string, Array<{
        title: string;
        medicalRequirementMode: 'none' | 'required' | 'age_threshold';
        medicalRequirementAge: number | null;
      }>>();
      const medicalTypes = normaliseMedicalTypes(trainingSettingsData?.medical_types || DEFAULT_MEDICAL_TYPES);

      (courseEnrolmentsData || []).forEach((row: any) => {
        const rawCourse = Array.isArray(row.training_courses)
          ? row.training_courses[0]
          : row.training_courses;
        if (!rawCourse || !row.student_id) return;
        const courses = activeMedicalCoursesByStudent.get(row.student_id) || [];
        courses.push({
          title: String(rawCourse.title || 'Active course'),
          medicalRequirementMode: rawCourse.medical_requirement_mode || 'none',
          medicalRequirementAge: rawCourse.medical_requirement_age === null || rawCourse.medical_requirement_age === undefined
            ? null
            : Number(rawCourse.medical_requirement_age),
        });
        activeMedicalCoursesByStudent.set(row.student_id, courses);
      });

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

      licencesData?.forEach(licence => {
        const memberLicences = licencesMap.get(licence.student_id) || [];
        memberLicences.push({
          id: licence.id,
          type: licence.type,
          licenceNumber: licence.licence_number || undefined,
          dateObtained: licence.date_obtained ? new Date(licence.date_obtained) : undefined,
          expiryDate: licence.expiry_date ? new Date(licence.expiry_date) : undefined,
          issuingAuthority: licence.issuing_authority || undefined,
          instructorId: licence.instructor_id,
          sourceCourseId: licence.source_course_id,
          isActive: Boolean(licence.is_active),
          verificationStatus: licence.verification_status || 'verified',
          proofDocumentId: licence.proof_document_id || null,
          submittedBy: licence.submitted_by || null,
          verifiedBy: licence.verified_by || null,
          verifiedAt: licence.verified_at ? new Date(licence.verified_at) : undefined,
          rejectionReason: licence.rejection_reason || null,
        });
        licencesMap.set(licence.student_id, memberLicences);
      });

      const combinedStudents: Student[] = (usersData || [])
        .filter((user: any) => (user.portal_access_scope || 'full') !== 'guest_placeholder')
        .map(user => {
        const studentData = studentsMap.get(user.id);
        const userRoles = rolesMap.get(user.id) || [user.role || 'student'];
        const primaryRole = userRoles.includes('admin') ? 'admin'
                          : userRoles.includes('senior_instructor') ? 'senior_instructor'
                          : userRoles.includes('instructor') ? 'instructor'
                          : userRoles.includes('pilot') ? 'pilot'
                          : 'student';
        const dateOfBirth = studentData?.date_of_birth
          ? new Date(studentData.date_of_birth)
          : user.date_of_birth
            ? new Date(user.date_of_birth)
            : undefined;
        const medicalRequirement = resolveMedicalRequirement({
          roles: userRoles as UserRole[],
          dateOfBirth,
          activeCourses: activeMedicalCoursesByStudent.get(user.id) || [],
        });
        const medicalDefinition = findMedicalTypeDefinition(studentData?.medical_type, medicalTypes);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: primaryRole as UserRole,
          roles: userRoles as UserRole[],
          phone: user.phone,
          mobilePhone: user.mobile_phone,
          homePhone: user.home_phone,
          workPhone: user.work_phone,
          address: user.address,
          avatar: user.avatar_url,
          coverPhoto: user.cover_url,
          raausId: studentData?.raaus_id,
          casaId: studentData?.casa_id,
          medicalType: studentData?.medical_type,
          medicalExpiry: studentData?.medical_expiry ? new Date(studentData.medical_expiry) : undefined,
          medicalRequired: medicalRequirement.required,
          medicalRequirementReason: medicalRequirement.reason,
          medicalRequirementCourseTitle: medicalRequirement.courseTitle,
          medicalValidityMode: medicalDefinition?.validityMode,
          medicalValidUntilAge: medicalDefinition?.validUntilAge,
          licenceExpiry: studentData?.licence_expiry ? new Date(studentData.licence_expiry) : undefined,
          lastRaausBfrDate: studentData?.last_raaus_bfr_date ? new Date(studentData.last_raaus_bfr_date) : studentData?.last_flight_review ? new Date(studentData.last_flight_review) : undefined,
          lastCasaAfrDate: studentData?.last_casa_afr_date ? new Date(studentData.last_casa_afr_date) : undefined,
          lastFlightReview: studentData?.last_raaus_bfr_date ? new Date(studentData.last_raaus_bfr_date) : studentData?.last_flight_review ? new Date(studentData.last_flight_review) : undefined,
          occupation: studentData?.occupation,
          alternatePhone: studentData?.alternate_phone,
          emergencyContact: studentData?.emergency_contact_name ? {
            name: studentData.emergency_contact_name,
            phone: studentData.emergency_contact_phone || '',
            relationship: studentData.emergency_contact_relationship || ''
          } : user.emergency_contact_name ? {
            name: user.emergency_contact_name,
            phone: user.emergency_contact_phone || '',
            relationship: user.emergency_contact_relationship || ''
          } : undefined,
          dateOfBirth,
          preferredAircraftId: user.preferred_aircraft_id,
          isSeniorInstructor: user.is_senior_instructor || userRoles.includes('senior_instructor'),
          isActive: user.is_active ?? true,
          portalAccessScope: user.portal_access_scope || 'full',
          xeroContactId: user.xero_contact_id || undefined,
          xeroContactName: user.xero_contact_name || undefined,
          xeroContactEmail: user.xero_contact_email || undefined,
          xeroContactSyncStatus: user.xero_contact_sync_status || 'not_linked',
          xeroContactSyncError: user.xero_contact_sync_error || null,
          xeroContactLastSyncedAt: user.xero_contact_last_synced_at || null,
          endorsements: endorsementsMap.get(user.id) || [],
          licences: licencesMap.get(user.id) || []
        };
      });

      if (scopeStudentId) {
        if (studentsCache) {
          const nextStudent = combinedStudents[0];
          if (nextStudent) {
            studentsCache = studentsCache.some(existing => existing.id === nextStudent.id)
              ? studentsCache.map(existing => existing.id === nextStudent.id ? nextStudent : existing)
              : [...studentsCache, nextStudent];
          }
        }
      } else {
        studentsCache = combinedStudents;
      }
      setStudents(combinedStudents);
      setError(null);
    } catch (err) {
      console.error('Error fetching students:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch students');
      toast.error(scopeStudentId ? 'Failed to load member profile' : 'Failed to load students');
    } finally {
      setLoading(false);
    }
  }, [scopeStudentId]);

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

      const randomBytes = crypto.getRandomValues(new Uint8Array(18));
      const randomPart = Array.from(randomBytes, byte => byte.toString(36).padStart(2, '0')).join('');
      const tempPassword = `${randomPart}A1!`;

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
          mobile_phone: studentData.mobilePhone,
          home_phone: studentData.homePhone,
          work_phone: studentData.workPhone,
          address: studentData.address,
          date_of_birth: studentData.dateOfBirth,
          emergency_contact_name: studentData.emergencyContact?.name,
          emergency_contact_phone: studentData.emergencyContact?.phone,
          emergency_contact_relationship: studentData.emergencyContact?.relationship,
          preferred_aircraft_id: studentData.preferredAircraftId,
          avatar_url: studentData.avatar,
          cover_url: studentData.coverPhoto
        });

      if (userError) throw userError;

      const userData = { id: authData.user.id };

      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({ user_id: userData.id, role: 'student' });

      if (roleError) throw roleError;

      const { error: studentError } = await writeStudentRow('insert', {
        id: userData.id,
        raaus_id: studentData.raausId,
        casa_id: studentData.casaId,
        medical_type: studentData.medicalType,
        medical_expiry: studentData.medicalExpiry,
        licence_expiry: studentData.licenceExpiry,
        last_raaus_bfr_date: studentData.lastRaausBfrDate || studentData.lastFlightReview,
        last_casa_afr_date: studentData.lastCasaAfrDate,
        occupation: studentData.occupation,
        alternate_phone: studentData.alternatePhone,
        date_of_birth: studentData.dateOfBirth,
        emergency_contact_name: studentData.emergencyContact?.name,
        emergency_contact_phone: studentData.emergencyContact?.phone,
        emergency_contact_relationship: studentData.emergencyContact?.relationship
      });

      if (studentError) throw studentError;

      const { data: { user: currentAuthUser } } = await supabase.auth.getUser();
      if (studentData.endorsements && studentData.endorsements.length > 0) {
        const endorsementsToInsert = studentData.endorsements.map(e => ({
          student_id: userData.id,
          type: e.type,
          date_obtained: e.dateObtained,
          expiry_date: e.expiryDate,
          instructor_id: e.instructorId || currentAuthUser?.id || null,
          is_active: e.isActive
        }));

        const { error: endorsementsError } = await supabase
          .from('endorsements')
          .insert(endorsementsToInsert);

        if (endorsementsError) throw endorsementsError;
      }

      if (studentData.licences?.length) {
        const { error: licencesError } = await supabase.from('licences').insert(studentData.licences.map(licence => ({
          student_id: userData.id,
          type: licence.type,
          licence_number: licence.licenceNumber || null,
          date_obtained: licence.dateObtained || null,
          expiry_date: licence.expiryDate || null,
          issuing_authority: licence.issuingAuthority || null,
          instructor_id: (licence.verificationStatus || 'verified') === 'verified'
            ? licence.instructorId || currentAuthUser?.id || null
            : licence.instructorId || null,
          source_course_id: licence.sourceCourseId || null,
          is_active: (licence.verificationStatus || 'verified') === 'verified' && licence.isActive,
          verification_status: licence.verificationStatus || 'verified',
          proof_document_id: licence.proofDocumentId || null,
          submitted_by: licence.submittedBy || null,
          verified_by: (licence.verificationStatus || 'verified') !== 'pending'
            ? licence.verifiedBy || currentAuthUser?.id || null
            : null,
          verified_at: (licence.verificationStatus || 'verified') !== 'pending'
            ? licence.verifiedAt?.toISOString() || new Date().toISOString()
            : null,
          rejection_reason: licence.rejectionReason || null,
        })));
        if (licencesError) throw licencesError;
      }

      await fetchStudents();
      toast.success('User added successfully');
    } catch (err) {
      console.error('Error adding student:', err);
      if (err instanceof Error && err.message.includes('already exists')) {
        return;
      }
      toast.error('Failed to add user');
      throw err;
    }
  };

  const updateStudent = async (id: string, studentData: Omit<Student, 'id'>) => {
    try {
      const { data: existingUser, error: existingUserError } = await supabase
        .from('users')
        .select('email')
        .eq('id', id)
        .single();

      if (existingUserError) throw existingUserError;

      const currentEmail = String(existingUser?.email || '').trim().toLowerCase();
      const nextEmail = String(studentData.email || '').trim().toLowerCase();
      let emailChangeLink: string | undefined;
      let emailChangeRequested = false;
      let reconciledOrphanAuth = false;
      let passwordResetEmailQueued = false;

      if (nextEmail && nextEmail !== currentEmail) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');

        const redirectOrigin = import.meta.env.VITE_AUTH_REDIRECT_ORIGIN?.trim() || window.location.origin;
        const redirectBase = redirectOrigin.replace(/\/$/, '');
        const appBasePath = import.meta.env.VITE_AUTH_REDIRECT_ORIGIN ? '/' : import.meta.env.BASE_URL;
        const redirectTo = `${redirectBase}${appBasePath}`;

        const resetRedirectTo = `${redirectBase}/reset-password`;
        const requestEmailChange = async (reconcileOrphanAuth = false) => {
          const response = await fetch(`${publicSupabaseUrl}/functions/v1/change-user-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
              Apikey: publicSupabaseKey,
            },
            body: JSON.stringify({
              action: reconcileOrphanAuth ? 'reconcile_orphan_auth' : undefined,
              confirmOrphanReplacement: reconcileOrphanAuth || undefined,
              userId: id,
              newEmail: nextEmail,
              redirectTo,
              resetRedirectTo,
            }),
          });
          const result = await response.json().catch(() => ({}));
          return { response, result };
        };

        let { response, result } = await requestEmailChange();
        if (!response.ok && isReconcileableOrphanEmailConflict(result)) {
          const confirmed = window.confirm(orphanEmailReconciliationPrompt(nextEmail));
          if (!confirmed) throw new Error('EMAIL_CHANGE_CANCELLED');
          ({ response, result } = await requestEmailChange(true));
        }
        if (!response.ok) {
          throw new Error(result.error || result.message || 'Failed to request login email change');
        }

        emailChangeRequested = Boolean(result.changed);
        emailChangeLink = result.manualLink;
        reconciledOrphanAuth = Boolean(result.reconciledOrphanAuth);
        passwordResetEmailQueued = Boolean(result.emailQueued);
      }

      const { data: updatedUsers, error: userError } = await supabase
        .from('users')
        .update({
          name: studentData.name,
          phone: studentData.phone,
          mobile_phone: studentData.mobilePhone,
          home_phone: studentData.homePhone,
          work_phone: studentData.workPhone,
          address: studentData.address,
          date_of_birth: studentData.dateOfBirth,
          emergency_contact_name: studentData.emergencyContact?.name,
          emergency_contact_phone: studentData.emergencyContact?.phone,
          emergency_contact_relationship: studentData.emergencyContact?.relationship,
          preferred_aircraft_id: studentData.preferredAircraftId,
          avatar_url: studentData.avatar,
          cover_url: studentData.coverPhoto
        })
        .eq('id', id)
        .select('id');

      if (userError) throw userError;
      if (!updatedUsers || updatedUsers.length === 0) {
        throw new Error('You do not have permission to update this member.');
      }

      const { error: studentError } = await writeStudentRow('update', {
        raaus_id: studentData.raausId,
        casa_id: studentData.casaId,
        medical_type: studentData.medicalType,
        medical_expiry: studentData.medicalExpiry,
        licence_expiry: studentData.licenceExpiry,
        last_raaus_bfr_date: studentData.lastRaausBfrDate || studentData.lastFlightReview,
        last_casa_afr_date: studentData.lastCasaAfrDate,
        occupation: studentData.occupation,
        alternate_phone: studentData.alternatePhone,
        date_of_birth: studentData.dateOfBirth,
        emergency_contact_name: studentData.emergencyContact?.name,
        emergency_contact_phone: studentData.emergencyContact?.phone,
        emergency_contact_relationship: studentData.emergencyContact?.relationship
      }, id);

      if (studentError) throw studentError;

      const { error: deleteEndorsementsError } = await supabase
        .from('endorsements')
        .delete()
        .eq('student_id', id);

      if (deleteEndorsementsError) throw deleteEndorsementsError;

      const { data: { user: currentAuthUser } } = await supabase.auth.getUser();

      if (studentData.endorsements && studentData.endorsements.length > 0) {
        const endorsementsToInsert = studentData.endorsements.map(e => ({
          student_id: id,
          type: e.type,
          date_obtained: e.dateObtained,
          expiry_date: e.expiryDate,
          instructor_id: e.instructorId || currentAuthUser?.id || null,
          is_active: e.isActive
        }));

        const { error: endorsementsError } = await supabase
          .from('endorsements')
          .insert(endorsementsToInsert);

        if (endorsementsError) throw endorsementsError;
      }

      const { error: deleteLicencesError } = await supabase.from('licences').delete().eq('student_id', id);
      if (deleteLicencesError) throw deleteLicencesError;

      if (studentData.licences?.length) {
        const { error: licencesError } = await supabase.from('licences').insert(studentData.licences.map(licence => ({
          student_id: id,
          type: licence.type,
          licence_number: licence.licenceNumber || null,
          date_obtained: licence.dateObtained || null,
          expiry_date: licence.expiryDate || null,
          issuing_authority: licence.issuingAuthority || null,
          instructor_id: (licence.verificationStatus || 'verified') === 'verified'
            ? licence.instructorId || currentAuthUser?.id || null
            : licence.instructorId || null,
          source_course_id: licence.sourceCourseId || null,
          is_active: (licence.verificationStatus || 'verified') === 'verified' && licence.isActive,
          verification_status: licence.verificationStatus || 'verified',
          proof_document_id: licence.proofDocumentId || null,
          submitted_by: licence.submittedBy || null,
          verified_by: (licence.verificationStatus || 'verified') !== 'pending'
            ? licence.verifiedBy || currentAuthUser?.id || null
            : null,
          verified_at: (licence.verificationStatus || 'verified') !== 'pending'
            ? licence.verifiedAt?.toISOString() || new Date().toISOString()
            : null,
          rejection_reason: licence.rejectionReason || null,
        })));
        if (licencesError) throw licencesError;
      }

      await fetchStudents();
      if (reconciledOrphanAuth) {
        toast.success(passwordResetEmailQueued
          ? 'Login linked to this member. A password reset email has been queued.'
          : 'Login linked to this member. Send them the generated password reset link.');
        if (emailChangeLink) {
          window.prompt(
            'The unused login was replaced safely. Keep this password reset link as a fallback if the email does not arrive:',
            emailChangeLink,
          );
        }
      } else if (emailChangeRequested) {
        toast.success('User updated. Email change requires verification before login changes.');
        if (emailChangeLink) {
          window.prompt('Send this email verification link to the member if they did not receive the Supabase email:', emailChangeLink);
        }
      } else {
        toast.success('User updated successfully');
      }
    } catch (err) {
      console.error('Error updating student:', err);
      if (err instanceof Error && err.message === 'EMAIL_CHANGE_CANCELLED') {
        toast('Email change cancelled. No member details were changed.');
        throw err;
      }
      toast.error(`Failed to update user: ${getErrorMessage(err, 'Unknown error')}`);
      throw err;
    }
  };

  const deleteStudent = async (id: string) => {
    try {
      const { error: rolesError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', id);

      if (rolesError) throw rolesError;

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

      const { data: deletedUsers, error: userError } = await supabase
        .from('users')
        .delete()
        .eq('id', id)
        .select('id');

      if (userError) throw userError;
      if (!deletedUsers || deletedUsers.length === 0) {
        throw new Error('Member was not removed');
      }

      await fetchStudents();
      toast.success('Member removed successfully');
    } catch (err) {
      console.error('Error deleting student:', err);
      toast.error('Failed to remove member');
      throw err;
    }
  };

  const setStudentActive = async (
    id: string,
    isActive: boolean,
    options?: { restoreAsFullStudent?: boolean }
  ) => {
    try {
      const updateData: Record<string, unknown> = {
        is_active: isActive,
        updated_at: new Date().toISOString()
      };

      if (isActive && options?.restoreAsFullStudent) {
        updateData.portal_access_scope = 'full';
        updateData.role = 'student';
      }

      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      const { data: updatedMember, error: verifyError } = await supabase
        .from('users')
        .select('id, is_active, portal_access_scope')
        .eq('id', id)
        .maybeSingle();

      if (verifyError) throw verifyError;
      if (
        !updatedMember ||
        updatedMember.is_active !== isActive ||
        (isActive && options?.restoreAsFullStudent && updatedMember.portal_access_scope !== 'full')
      ) {
        throw new Error(isActive
          ? 'Member restore was blocked or did not apply'
          : 'Member archive was blocked or did not apply'
        );
      }

      await fetchStudents();
      toast.success(isActive ? 'Member restored' : 'Member archived');
    } catch (err) {
      console.error('Error updating member active status:', err);
      toast.error(isActive ? 'Failed to restore member' : 'Failed to archive member');
      throw err;
    }
  };

  useEffect(() => {
    void fetchStudents();
  }, [fetchStudents]);

  return {
    students,
    loading,
    error,
    addStudent,
    updateStudent,
    deleteStudent,
    setStudentActive,
    refetch: fetchStudents
  };
};
