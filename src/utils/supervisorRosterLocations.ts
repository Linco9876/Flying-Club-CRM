export const toggleSupervisorLocation = (
  currentLocationIds: string[],
  locationId: string,
): string[] => (
  currentLocationIds.includes(locationId)
    ? currentLocationIds.filter((id) => id !== locationId)
    : [...currentLocationIds, locationId]
);

export const getSupervisorLocationValidationError = ({
  isAuthorisedSupervisor,
  isAvailable,
  supervisionLocationIds,
  dayLabel,
}: {
  isAuthorisedSupervisor: boolean;
  isAvailable: boolean;
  supervisionLocationIds: string[];
  dayLabel: string;
}): string | null => {
  if (!isAuthorisedSupervisor || !isAvailable || supervisionLocationIds.length > 0) {
    return null;
  }

  return `${dayLabel}: choose at least one supervision location`;
};
