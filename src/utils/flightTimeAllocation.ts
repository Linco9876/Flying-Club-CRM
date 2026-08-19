export interface FlightTimeAllocation {
  dualTime: number;
  soloTime: number;
}

export interface FlightTimeAllocationInput extends FlightTimeAllocation {
  durationHours: number;
  hasInstructor: boolean;
}

const ALLOCATION_TOLERANCE_HOURS = 0.051;

export const roundAllocatedFlightTime = (value: number) =>
  Math.round((value + Number.EPSILON) * 10) / 10;

const nonNegativeTime = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, roundAllocatedFlightTime(parsed)) : 0;
};

export const defaultFlightTimeAllocation = (
  durationHours: number,
  hasInstructor: boolean,
): FlightTimeAllocation => {
  const duration = nonNegativeTime(durationHours);
  return hasInstructor
    ? { dualTime: duration, soloTime: 0 }
    : { dualTime: 0, soloTime: duration };
};

export const updateFlightTimeAllocation = ({
  durationHours,
  changedField,
  value,
}: {
  durationHours: number;
  changedField: "dualTime" | "soloTime";
  value: number;
}): FlightTimeAllocation => {
  const duration = nonNegativeTime(durationHours);
  const changedValue = nonNegativeTime(value);
  const remaining = roundAllocatedFlightTime(Math.max(0, duration - changedValue));

  return changedField === "dualTime"
    ? { dualTime: changedValue, soloTime: remaining }
    : { dualTime: remaining, soloTime: changedValue };
};

export const validateFlightTimeAllocation = ({
  durationHours,
  dualTime,
  soloTime,
  hasInstructor,
}: FlightTimeAllocationInput): string | null => {
  const values = [durationHours, dualTime, soloTime];
  if (!values.every((value) => Number.isFinite(value))) {
    return "Flight duration, dual time and solo time must be valid numbers";
  }
  if (durationHours <= 0) return "Flight duration must be positive";
  if (dualTime < 0 || soloTime < 0) return "Dual and solo time cannot be negative";
  if (!hasInstructor && dualTime > ALLOCATION_TOLERANCE_HOURS) {
    return "Dual time requires an instructor on the booking";
  }

  const allocated = dualTime + soloTime;
  if (Math.abs(allocated - durationHours) > ALLOCATION_TOLERANCE_HOURS) {
    return `Dual and solo time must add up to the ${durationHours.toFixed(1)} hour flight duration`;
  }
  return null;
};

export const getFlightTimeAllocationLabel = ({
  dualTime,
  soloTime,
}: FlightTimeAllocation) => {
  if (dualTime > 0 && soloTime > 0) return "Mixed dual / solo";
  if (dualTime > 0) return "Dual";
  if (soloTime > 0) return "Solo";
  return "Not allocated";
};
