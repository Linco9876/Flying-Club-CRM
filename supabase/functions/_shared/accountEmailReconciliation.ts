const canonicalAccountName = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export type OrphanAuthReconciliationAssessment = {
  allowed: boolean;
  code:
    | "READY"
    | "AUTH_ACCOUNT_HAS_PROFILE"
    | "ACCOUNT_OWNER_MISMATCH"
    | "ACCOUNT_OWNER_UNKNOWN";
  error?: string;
};

export const assessOrphanAuthReconciliation = ({
  targetProfileName,
  orphanAuthName,
  orphanHasProfile,
}: {
  targetProfileName: unknown;
  orphanAuthName: unknown;
  orphanHasProfile: boolean;
}): OrphanAuthReconciliationAssessment => {
  if (orphanHasProfile) {
    return {
      allowed: false,
      code: "AUTH_ACCOUNT_HAS_PROFILE",
      error:
        "That email belongs to another CRM member and cannot be automatically linked.",
    };
  }

  const targetName = canonicalAccountName(targetProfileName);
  const orphanName = canonicalAccountName(orphanAuthName);
  if (!targetName || !orphanName) {
    return {
      allowed: false,
      code: "ACCOUNT_OWNER_UNKNOWN",
      error:
        "The unlinked login does not contain enough identity information for an automatic repair.",
    };
  }

  if (targetName !== orphanName) {
    return {
      allowed: false,
      code: "ACCOUNT_OWNER_MISMATCH",
      error:
        "The unlinked login appears to belong to a different person and cannot be automatically linked.",
    };
  }

  return { allowed: true, code: "READY" };
};
