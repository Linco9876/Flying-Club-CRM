export interface SafetyWarningGateInput {
  userId?: string;
  dataReady: boolean;
  dismissed: boolean;
  displayedUserId?: string;
  concernCount: number;
}

export const shouldOpenSafetyWarning = ({
  userId,
  dataReady,
  dismissed,
  displayedUserId,
  concernCount,
}: SafetyWarningGateInput) => Boolean(
  userId
  && dataReady
  && !dismissed
  && displayedUserId !== userId
  && concernCount > 0
);
