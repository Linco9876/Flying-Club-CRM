export const DEFAULT_LICENCE_TYPES = [
  'RAAus Pilot Certificate',
  'CASA Recreational Pilot Licence (RPL)',
  'CASA Private Pilot Licence (PPL)',
  'CASA Commercial Pilot Licence (CPL)',
  'CASA Air Transport Pilot Licence (ATPL)',
];

export const DEFAULT_ENDORSEMENT_TYPES = [
  'Passenger Carrying',
  'Flight Radio',
  'Cross Country',
  'Low Level',
  'Formation',
  'Tailwheel',
];

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

export const uniqueLicenceTypes = uniqueEndorsementTypes;
