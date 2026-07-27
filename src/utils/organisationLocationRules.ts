export interface LocationRuleInput {
  name: string;
  latitude: number;
  longitude: number;
  isPrimary: boolean;
  isActive: boolean;
}

export const getOrganisationLocationValidationError = (
  locations: LocationRuleInput[]
): string | null => {
  const active = locations.filter((location) => location.isActive);
  if (active.length === 0) return 'Keep at least one business location active';
  if (active.filter((location) => location.isPrimary).length !== 1) {
    return 'Choose one active primary business location';
  }
  if (new Set(active.map((location) => location.name.trim().toLocaleLowerCase())).size !== active.length) {
    return 'Each active business location needs a unique name';
  }

  for (const location of locations) {
    const name = location.name.trim();
    if (!name) return 'Every business location needs a name';
    if (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90) {
      return `${name}: enter a valid latitude`;
    }
    if (!Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180) {
      return `${name}: enter a valid longitude`;
    }
  }

  return null;
};

export const hasMultipleOrganisationLocations = (activeLocationCount: number) =>
  activeLocationCount > 1;
