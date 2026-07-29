import {
  assertTenantBoundConnection,
  assertTenantBoundQueueItem,
  gstInclusiveImpact,
  isConnectionIndependentXeroAction,
  organisationConfirmationPhrase,
} from "./xeroSafety.ts";

Deno.test("requires explicit organisation name in the confirmation phrase", () => {
  if (organisationConfirmationPhrase("Bendigo Flying Club") !== "CONNECT BENDIGO FLYING CLUB") {
    throw new Error("Unexpected confirmation phrase");
  }
});

Deno.test("inventory permits an unpinned legacy tenant but posting does not", () => {
  const legacy = { tenant_id: "horizon", expected_tenant_id: null, posting_enabled: false };
  assertTenantBoundConnection(legacy, { allowInventory: true });
  let blocked = false;
  try {
    assertTenantBoundConnection(legacy);
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error("Unpinned posting should be blocked");
});

Deno.test("rejects an active tenant that differs from the immutable tenant", () => {
  let blocked = false;
  try {
    assertTenantBoundConnection(
      { tenant_id: "wrong", expected_tenant_id: "bfc", posting_enabled: true },
    );
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error("Tenant mismatch should be blocked");
});

Deno.test("requires queue tenant, operation and mapping snapshots", () => {
  const connection = {
    tenant_id: "bfc",
    expected_tenant_id: "bfc",
    posting_enabled: true,
  };
  assertTenantBoundQueueItem(connection, {
    tenant_id_snapshot: "bfc",
    origin_verified: true,
    operation_id: "flight:123",
    mapping_version_id: "mapping:1",
  });
  let blocked = false;
  try {
    assertTenantBoundQueueItem(connection, {
      tenant_id_snapshot: "other",
      origin_verified: true,
      operation_id: "flight:123",
      mapping_version_id: "mapping:1",
    });
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error("Mismatched queue tenant should be blocked");
});

Deno.test("calculates Australian GST from tax-inclusive pricing", () => {
  const impact = gstInclusiveImpact(110, "OUTPUT");
  if (
    impact.lineAmountType !== "Inclusive" ||
    impact.grossAmount !== 110 ||
    impact.netAmount !== 100 ||
    impact.gstAmount !== 10
  ) {
    throw new Error(`Unexpected impact: ${JSON.stringify(impact)}`);
  }
});

Deno.test("read-only queue inspection is connection-independent", () => {
  if (!isConnectionIndependentXeroAction("list-queue")) {
    throw new Error("Queue inspection should not require an active Xero connection");
  }
  if (isConnectionIndependentXeroAction("process-next")) {
    throw new Error("Queue processing must retain active Xero connection checks");
  }
});
