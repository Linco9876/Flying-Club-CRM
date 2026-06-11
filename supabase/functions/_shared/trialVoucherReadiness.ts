const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const normaliseEndorsementType = (value: unknown) => String(value || "").trim().toLowerCase();

export const aircraftMatchesTrialVoucherProduct = (aircraft: any, product: any) => {
  const attachedIds = new Set<string>(product.aircraft_ids || []);
  if (attachedIds.size > 0) return attachedIds.has(aircraft.id);

  const label = `${aircraft.registration || ""} ${aircraft.make || ""} ${aircraft.model || ""}`.toLowerCase();
  const compactLabel = label.replace(/[^a-z0-9]/g, "");
  if (product.aircraft_mode === "specific") return false;
  if (product.aircraft_mode === "tecnam") return label.includes("tecnam");
  if (product.aircraft_mode === "archer") {
    return label.includes("archer") || compactLabel.includes("pa28") || compactLabel.includes("piperpa28");
  }
  return false;
};

export const instructorHasTrialVoucherAircraftEndorsement = (
  instructorId: string,
  aircraft: any,
  endorsementsByInstructor: Map<string, any[]>,
) => {
  const requiredType = normaliseEndorsementType(aircraft.required_endorsement_type);
  if (!requiredType) return true;

  const today = dateKey(new Date());
  return (endorsementsByInstructor.get(instructorId) || []).some((endorsement: any) =>
    endorsement.is_active !== false &&
    normaliseEndorsementType(endorsement.type) === requiredType &&
    (!endorsement.expiry_date || String(endorsement.expiry_date) >= today)
  );
};

export const trialVoucherProductBookingSetup = (
  product: any,
  aircraftRows: any[] = [],
  endorsementRows: any[] = [],
) => {
  const matchingAircraft = aircraftRows.filter((aircraft: any) =>
    aircraftMatchesTrialVoucherProduct(aircraft, product)
  );
  const serviceableAircraft = matchingAircraft.filter((aircraft: any) => aircraft.status === "serviceable");
  const instructorIds = product.instructor_ids || [];
  const endorsementsByInstructor = new Map<string, any[]>();
  endorsementRows.forEach((endorsement: any) => {
    const instructorEndorsements = endorsementsByInstructor.get(endorsement.student_id) || [];
    instructorEndorsements.push(endorsement);
    endorsementsByInstructor.set(endorsement.student_id, instructorEndorsements);
  });
  const qualifiedInstructorIds = instructorIds.filter((instructorId: string) =>
    serviceableAircraft.some((aircraft: any) =>
      instructorHasTrialVoucherAircraftEndorsement(instructorId, aircraft, endorsementsByInstructor)
    )
  );
  const issues = [
    ...(matchingAircraft.length === 0 ? ["No eligible aircraft are configured for this voucher"] : []),
    ...(matchingAircraft.length > 0 && serviceableAircraft.length === 0 ? ["No eligible aircraft are currently serviceable"] : []),
    ...(instructorIds.length === 0 ? ["No eligible instructors are selected for this voucher"] : []),
    ...(serviceableAircraft.length > 0 && instructorIds.length > 0 && qualifiedInstructorIds.length === 0
      ? ["No selected instructor currently holds the required aircraft endorsement for the serviceable aircraft"]
      : []),
  ];

  return {
    bookingAvailable: issues.length === 0,
    aircraftCount: matchingAircraft.length,
    serviceableAircraftCount: serviceableAircraft.length,
    instructorCount: instructorIds.length,
    qualifiedInstructorCount: qualifiedInstructorIds.length,
    issue: issues.join(". "),
  };
};
