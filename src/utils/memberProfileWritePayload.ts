import type { Student } from '../types';

const nullableText = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const nullableDate = (value: Date | undefined) =>
  value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : null;

export const buildEmergencyContactWriteFields = (contact?: {
  name?: unknown;
  phone?: unknown;
  relationship?: unknown;
}) => ({
  emergency_contact_name: nullableText(contact?.name),
  emergency_contact_phone: nullableText(contact?.phone),
  emergency_contact_relationship: nullableText(contact?.relationship),
});

export const buildMemberProfileWritePayloads = (student: Omit<Student, 'id'>) => {
  const user: Record<string, unknown> = {
    name: student.name.trim(),
    phone: nullableText(student.phone),
    mobile_phone: nullableText(student.mobilePhone),
    home_phone: nullableText(student.homePhone),
    work_phone: nullableText(student.workPhone),
    address: nullableText(student.address),
    date_of_birth: nullableDate(student.dateOfBirth),
    ...buildEmergencyContactWriteFields(student.emergencyContact),
    preferred_aircraft_id: nullableText(student.preferredAircraftId),
  };

  // These images are managed outside the member information form. Omitting
  // them must preserve the existing image; an explicit blank value clears it.
  if (student.avatar !== undefined) user.avatar_url = nullableText(student.avatar);
  if (student.coverPhoto !== undefined) user.cover_url = nullableText(student.coverPhoto);

  const studentProfile: Record<string, unknown> = {
    raaus_id: nullableText(student.raausId),
    casa_id: nullableText(student.casaId),
    medical_type: nullableText(student.medicalType),
    medical_expiry: nullableDate(student.medicalExpiry),
    licence_expiry: nullableDate(student.licenceExpiry),
    last_raaus_bfr_date: nullableDate(student.lastRaausBfrDate || student.lastFlightReview),
    last_casa_afr_date: nullableDate(student.lastCasaAfrDate),
    occupation: nullableText(student.occupation),
    alternate_phone: nullableText(student.alternatePhone),
    date_of_birth: nullableDate(student.dateOfBirth),
    ...buildEmergencyContactWriteFields(student.emergencyContact),
  };

  return { user, studentProfile };
};
