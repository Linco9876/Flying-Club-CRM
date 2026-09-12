export interface RpcFlightDetails {
  id: string;
  aircraftId?: string;
  aircraftType?: string;
  registration?: string;
  reviewDate?: string;
  flightMinutes?: number;
}

/** Fill blanks only. Saved assessment values (including zero) remain authoritative. */
export function prefillRpcDetails<T extends Record<string, unknown>>(current: T, defaults: Record<string, unknown>): T {
  const result = { ...current };
  for (const [key, value] of Object.entries(defaults)) {
    if (key in current && (current[key] === '' || current[key] === null || current[key] === undefined) && value !== null && value !== undefined) {
      (result as Record<string, unknown>)[key] = String(value);
    }
  }
  return result;
}

export const rpcRetestWithinWindow = (firstDate: string, nextDate: string) => {
  const days = (Date.parse(`${nextDate}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / 86400000;
  return Number.isFinite(days) && days >= 0 && days <= 30;
};
