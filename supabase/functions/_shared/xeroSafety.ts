export const cleanXeroValue = (value: unknown) => String(value || "").trim();

export const organisationConfirmationPhrase = (tenantName: unknown) =>
  `CONNECT ${cleanXeroValue(tenantName).toUpperCase()}`;

const connectionIndependentActions = new Set(["list-queue"]);

export const isConnectionIndependentXeroAction = (action: unknown) =>
  connectionIndependentActions.has(cleanXeroValue(action).toLowerCase());

export const assertTenantBoundConnection = (
  connection: any,
  options: { allowInventory?: boolean } = {},
) => {
  const tenantId = cleanXeroValue(connection?.tenant_id);
  const expectedTenantId = cleanXeroValue(connection?.expected_tenant_id);
  if (!tenantId) throw new Error("Xero is not connected.");
  if (options.allowInventory) {
    if (expectedTenantId && tenantId !== expectedTenantId) {
      throw new Error("The active Xero tenant does not match the immutable expected tenant.");
    }
    return;
  }
  if (!expectedTenantId) throw new Error("The expected BFC Xero tenant is not pinned.");
  if (tenantId !== expectedTenantId) {
    throw new Error("The active Xero tenant does not match the immutable expected tenant.");
  }
  if (connection?.posting_enabled !== true) {
    throw new Error("Xero posting is contained.");
  }
};

export const assertTenantBoundQueueItem = (connection: any, item: any) => {
  assertTenantBoundConnection(connection);
  const tenantId = cleanXeroValue(connection.tenant_id);
  if (
    cleanXeroValue(item?.tenant_id_snapshot) !== tenantId ||
    item?.origin_verified !== true
  ) {
    throw new Error("The queue tenant snapshot is not verified for the active Xero tenant.");
  }
  if (!cleanXeroValue(item?.operation_id)) {
    throw new Error("The queue item has no persistent operation ID.");
  }
  if (!cleanXeroValue(item?.mapping_version_id)) {
    throw new Error("The queue item has no approved mapping snapshot.");
  }
};

export const gstInclusiveImpact = (amount: unknown, taxType: unknown) => {
  const grossAmount = Math.round(Number(amount || 0) * 100) / 100;
  const taxable = ["OUTPUT", "INPUT", "OUTPUT2", "INPUT2"].includes(
    cleanXeroValue(taxType).toUpperCase(),
  );
  const gstAmount = taxable
    ? Math.round((grossAmount / 11 + Number.EPSILON) * 100) / 100
    : 0;
  return {
    lineAmountType: "Inclusive" as const,
    grossAmount,
    netAmount: Math.round((grossAmount - gstAmount + Number.EPSILON) * 100) / 100,
    gstAmount,
  };
};
