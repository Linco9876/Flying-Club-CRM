export interface RpcFlightDetails {
  id: string;
  aircraftId?: string;
  aircraftType?: string;
  registration?: string;
  reviewDate?: string;
  flightMinutes?: number;
}

/** Fill blanks only. Saved assessment values (including zero) remain authoritative. */
export function prefillRpcDetails<T extends Record<string, unknown>>(
  current: T,
  defaults: Record<string, unknown>,
): T {
  const result = { ...current };
  for (const [key, value] of Object.entries(defaults)) {
    if (
      key in current &&
      (current[key] === "" ||
        current[key] === null ||
        current[key] === undefined) &&
      value !== null &&
      value !== undefined
    ) {
      (result as Record<string, unknown>)[key] = String(value);
    }
  }
  return result;
}

export const rpcRetestWithinWindow = (firstDate: string, nextDate: string) => {
  const days =
    (Date.parse(`${nextDate}T00:00:00Z`) -
      Date.parse(`${firstDate}T00:00:00Z`)) /
    86400000;
  return Number.isFinite(days) && days >= 0 && days <= 30;
};

export const rpcRetestDeadline = (firstDate: string) => {
  const date = new Date(`${firstDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
};

type RetestRecord = {
  id: string;
  candidateId: string;
  reviewType: string;
  status: string;
  reviewDate: string;
  createdAt: string;
  flightLogId?: string;
  retestOfId?: string;
  retestRootId?: string;
};

/** Offer the latest unsuccessful attempt, retaining the first attempt's deadline. */
export function recentRpcRetest<T extends RetestRecord>(
  records: T[],
  candidateId: string,
  flightDate: string,
  flightLogId?: string,
): T | undefined {
  return records
    .filter((record) => {
      if (
        record.candidateId !== candidateId ||
        record.reviewType !== "raaus_rpc_flight_test" ||
        record.status !== "further_training_required" ||
        !record.flightLogId ||
        record.flightLogId === flightLogId ||
        record.reviewDate > flightDate
      )
        return false;
      const root = record.retestRootId
        ? records.find((item) => item.id === record.retestRootId)
        : record;
      if (!root || !rpcRetestWithinWindow(root.reviewDate, flightDate))
        return false;
      return !records.some(
        (item) =>
          item.candidateId === candidateId &&
          item.reviewType === record.reviewType &&
          ((item.retestOfId === record.id &&
            ["completed", "further_training_required"].includes(item.status)) ||
            (item.status === "completed" &&
              (item.reviewDate > record.reviewDate ||
                (item.reviewDate === record.reviewDate &&
                  item.createdAt >= record.createdAt)))),
      );
    })
    .sort(
      (a, b) =>
        b.reviewDate.localeCompare(a.reviewDate) ||
        b.createdAt.localeCompare(a.createdAt),
    )[0];
}

type RetestItem = {
  code: string;
  templateItemKey: string;
  section: string;
  result: string;
  required: boolean;
  carriedFromItemId?: string;
};
export const isRpcCompletionItem = (item: RetestItem) =>
  /^RPC-CMP-/i.test(item.code || item.templateItemKey) ||
  /completion|administration|paperwork/i.test(item.section);

export function rpcRetestGroups<T extends RetestItem>(items: T[]) {
  const carried = items.filter((item) => item.carriedFromItemId);
  const outstanding = items.filter((item) => !item.carriedFromItemId);
  const competencies = outstanding.filter((item) => !isRpcCompletionItem(item));
  return {
    carried,
    competencies,
    completion: outstanding.filter(isRpcCompletionItem),
    reassessed: competencies.filter(
      (item) =>
        ["satisfactory", "further_training"].includes(item.result) ||
        (!item.required && item.result === "not_applicable"),
    ).length,
  };
}
