export const toggleSupervisorLocation = (
  currentLocationIds: string[],
  locationId: string,
): string[] => (
  currentLocationIds.includes(locationId)
    ? currentLocationIds.filter((id) => id !== locationId)
    : [...currentLocationIds, locationId]
);
