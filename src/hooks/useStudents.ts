import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Student, Endorsement, UserRole } from '../types';
import toast from 'react-hot-toast';
import { fetchPilotStatusEndorsementTypes, reconcilePilotStatusForUser } from '../utils/pilotStatus';

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

export const useStudents = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('*');

      if (usersError) throw usersError;

      const { data: studentsData, error: studentsError } = await supabase
        .from('students')
        .select('*');

      if (studentsError) throw studentsError;

      const { data: endorsementsData, error: endorsementsError } = await supabase
        .from('endorsements')
        .select('*');

      if (endorsementsError) throw endorsementsError;

      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('user_id, role');

      const rolesMap = new Map<string, string[]>();
      (rolesData || []).forEach((r: any) => {
        if (!rolesMap.has(r.user_id)) rolesMap.set(r.user_id, []);
        rolesMap.get(r.user_id)!.push(r.role);
      });

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
        const userRoles = rolesMap.get(user.id) || [user.role || 'student'];
        const primaryRole = userRoles.includes('admin') ? 'admin'
                          : userRoles.includes('senior_instructor') ? 'senior_instructor'
                          : userRoles.includes('instructor') ? 'instructor'
                          : userRoles.includes('pilot') ? 'pilot'
                          : 'student';
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
          licenceExpiry: studentData?.licence_expiry ? new Date(studentData.licence_expiry) : undefined,
          lastFlightReview: studentData?.last_flight_review ? new Date(studentData.last_flight_review) : undefined,
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
          dateOfBirth: studentData?.date_of_birth ? new Date(studentData.date_of_birth) : user.date_of_birth ? new Date(user.date_of_birth) : undefined,
          preferredAircraftId: user.preferred_aircraft_id,
          isActive: user.is_active ?? true,
          portalAccessScope: user.portal_access_scope || 'full',
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
        last_flight_review: studentData.lastFlightReview,
        occupation: studentData.occupation,
        alternate_phone: studentData.alternatePhone,
        date_of_birth: studentData.dateOfBirth,
        prepaid_balance: studentData.prepaidBalance,
        emergency_contact_name: studentData.emergencyContact?.name,
        emergency_contact_phone: studentData.emergencyContact?.phone,
        emergency_contact_relationship: studentData.emergencyContact?.relationship
      });

      if (studentError) throw studentError;

      const { data: { user: currentAuthUser } } = await supabase.auth.getUser();
      const pilotStatusEndorsementTypes = await fetchPilotStatusEndorsementTypes();

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

      await reconcilePilotStatusForUser({
        userId: userData.id,
        endorsements: studentData.endorsements || [],
        pilotStatusEndorsementTypes,
        currentRole: 'student',
        currentRoles: ['student'],
      });

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

      if (nextEmail && nextEmail !== currentEmail) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');

        const redirectOrigin = import.meta.env.VITE_AUTH_REDIRECT_ORIGIN?.trim() || window.location.origin;
        const redirectBase = redirectOrigin.replace(/\/$/, '');
        const appBasePath = import.meta.env.VITE_AUTH_REDIRECT_ORIGIN ? '/' : import.meta.env.BASE_URL;
        const redirectTo = `${redirectBase}${appBasePath}`;

        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/change-user-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            userId: id,
            newEmail: nextEmail,
            redirectTo,
          }),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || result.message || 'Failed to request login email change');
        }

        emailChangeRequested = Boolean(result.changed);
        emailChangeLink = result.manualLink;
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
        last_flight_review: studentData.lastFlightReview,
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
      const pilotStatusEndorsementTypes = await fetchPilotStatusEndorsementTypes();

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

      await reconcilePilotStatusForUser({
        userId: id,
        endorsements: studentData.endorsements || [],
        pilotStatusEndorsementTypes,
        currentRole: studentData.role,
        currentRoles: studentData.roles,
      });

      await fetchStudents();
      if (emailChangeRequested) {
        toast.success('User updated. Email change requires verification before login changes.');
        if (emailChangeLink) {
          window.prompt('Send this email verification link to the member if they did not receive the Supabase email:', emailChangeLink);
        }
      } else {
        toast.success('User updated successfully');
      }
    } catch (err) {
      console.error('Error updating student:', err);
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
    fetchStudents();
  }, []);

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
