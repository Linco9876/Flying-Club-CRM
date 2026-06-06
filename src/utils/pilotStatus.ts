import { Endorsement, UserRole } from '../types';
import { supabase } from '../lib/supabase';

export const DEFAULT_PILOT_STATUS_ENDORSEMENTS = [
  'Pilot Certificate',
  'Recreational Pilots Licence RPL (A)',
  'RPL(A) Aeroplane Category Rating',
];

export const DEFAULT_ENDORSEMENT_TYPES = [
  ...DEFAULT_PILOT_STATUS_ENDORSEMENTS,
  'Passenger Carrying',
  'Flight Radio',
  'Cross Country',
  'Low Level',
  'Formation',
  'Tailwheel',
];

const STAFF_ROLES: UserRole[] = ['admin', 'senior_instructor', 'instructor'];

export const normaliseEndorsementType = (value: string) => value.trim().toLowerCase();

export const uniqueEndorsementTypes = (types: string[]) => {
  const seen = new Set<string>();
  return types
    .map(type => type.trim())
    .filter(type => {
      if (!type) return false;
      const key = normaliseEndorsementType(type);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const endorsementGrantsPilotStatus = (
  endorsement: Pick<Endorsement, 'type' | 'expiryDate' | 'isActive'>,
  pilotStatusEndorsementTypes: string[],
  at = new Date()
) => {
  if (!endorsement.isActive) return false;
  if (endorsement.expiryDate && endorsement.expiryDate < at) return false;

  const allowed = new Set(uniqueEndorsementTypes(pilotStatusEndorsementTypes).map(normaliseEndorsementType));
  return allowed.has(normaliseEndorsementType(endorsement.type));
};

export const endorsementsGrantPilotStatus = (
  endorsements: Pick<Endorsement, 'type' | 'expiryDate' | 'isActive'>[],
  pilotStatusEndorsementTypes: string[]
) => endorsements.some(endorsement => endorsementGrantsPilotStatus(endorsement, pilotStatusEndorsementTypes));

export const fetchPilotStatusEndorsementTypes = async () => {
  const { data, error } = await supabase
    .from('training_syllabus_settings')
    .select('pilot_status_endorsement_types')
    .maybeSingle();

  if (error) {
    console.warn('Failed to load pilot status endorsement settings, using defaults:', error);
    return DEFAULT_PILOT_STATUS_ENDORSEMENTS;
  }

  return uniqueEndorsementTypes(data?.pilot_status_endorsement_types || DEFAULT_PILOT_STATUS_ENDORSEMENTS);
};

const getPrimaryRole = (roles: UserRole[], currentRole?: UserRole): UserRole => {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('senior_instructor')) return 'senior_instructor';
  if (roles.includes('instructor')) return 'instructor';
  if (roles.includes('pilot')) return 'pilot';
  return currentRole || 'student';
};

export const reconcilePilotStatusForUser = async ({
  userId,
  endorsements,
  pilotStatusEndorsementTypes,
  currentRole,
  currentRoles,
}: {
  userId: string;
  endorsements: Pick<Endorsement, 'type' | 'expiryDate' | 'isActive'>[];
  pilotStatusEndorsementTypes?: string[];
  currentRole?: UserRole;
  currentRoles?: UserRole[];
}) => {
  let roles = currentRoles || [];
  let role = currentRole;

  if (roles.length === 0 || !role) {
    const [{ data: rolesData }, { data: userData }] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', userId),
      supabase.from('users').select('role').eq('id', userId).maybeSingle(),
    ]);

    roles = ((rolesData || []).map(row => row.role).filter(Boolean) as UserRole[]);
    role = (userData?.role as UserRole | undefined) || role;
  }

  if (roles.some(userRole => STAFF_ROLES.includes(userRole)) || (role && STAFF_ROLES.includes(role))) {
    return { changed: false, role: getPrimaryRole(roles, role) };
  }

  const statusTypes = pilotStatusEndorsementTypes || await fetchPilotStatusEndorsementTypes();
  const shouldBePilot = endorsementsGrantPilotStatus(endorsements, statusTypes);
  const hasPilotRole = roles.includes('pilot') || role === 'pilot';

  if (shouldBePilot && !hasPilotRole) {
    await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', 'student');
    const { error: insertError } = await supabase.from('user_roles').insert({ user_id: userId, role: 'pilot' });
    if (insertError && insertError.code !== '23505') throw insertError;
    const { error: updateError } = await supabase.from('users').update({ role: 'pilot' }).eq('id', userId);
    if (updateError) throw updateError;
    return { changed: true, role: 'pilot' as UserRole };
  }

  if (!shouldBePilot && hasPilotRole) {
    await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', 'pilot');
    const { error: insertError } = await supabase.from('user_roles').insert({ user_id: userId, role: 'student' });
    if (insertError && insertError.code !== '23505') throw insertError;
    const { error: updateError } = await supabase.from('users').update({ role: 'student' }).eq('id', userId);
    if (updateError) throw updateError;
    return { changed: true, role: 'student' as UserRole };
  }

  return { changed: false, role: getPrimaryRole(roles, role) };
};

export const reconcileAllPilotStatuses = async (pilotStatusEndorsementTypes: string[]) => {
  const [
    { data: usersData, error: usersError },
    { data: rolesData, error: rolesError },
    { data: endorsementsData, error: endorsementsError },
  ] = await Promise.all([
    supabase.from('users').select('id, role'),
    supabase.from('user_roles').select('user_id, role'),
    supabase.from('endorsements').select('student_id, type, date_obtained, expiry_date, is_active'),
  ]);

  if (usersError) throw usersError;
  if (rolesError) throw rolesError;
  if (endorsementsError) throw endorsementsError;

  const rolesByUser = new Map<string, UserRole[]>();
  (rolesData || []).forEach(row => {
    const role = row.role as UserRole;
    if (!rolesByUser.has(row.user_id)) rolesByUser.set(row.user_id, []);
    rolesByUser.get(row.user_id)!.push(role);
  });

  const endorsementsByUser = new Map<string, Pick<Endorsement, 'type' | 'expiryDate' | 'isActive'>[]>();
  (endorsementsData || []).forEach(row => {
    const userEndorsements = endorsementsByUser.get(row.student_id) || [];
    userEndorsements.push({
      type: row.type,
      expiryDate: row.expiry_date ? new Date(row.expiry_date) : undefined,
      isActive: Boolean(row.is_active),
    });
    endorsementsByUser.set(row.student_id, userEndorsements);
  });

  let changed = 0;
  for (const userRow of usersData || []) {
    const result = await reconcilePilotStatusForUser({
      userId: userRow.id,
      endorsements: endorsementsByUser.get(userRow.id) || [],
      pilotStatusEndorsementTypes,
      currentRole: userRow.role as UserRole,
      currentRoles: rolesByUser.get(userRow.id) || [],
    });
    if (result.changed) changed += 1;
  }

  return changed;
};
