import { decryptSecret, encryptSecret } from "./secretEncryption.ts";
import { assertTenantBoundConnection } from "./xeroSafety.ts";

const clean = (value: unknown) => String(value || "").trim();

const basicAuthHeader = (clientId: string, clientSecret: string) =>
  `Basic ${btoa(`${clientId}:${clientSecret}`)}`;

export const storeEncryptedXeroTokens = async (
  adminClient: any,
  tokens: {
    accessToken: string;
    refreshToken: string;
    idToken?: string | null;
    tokenType?: string | null;
    scope?: string | null;
    expiresAt?: string | null;
  },
  extra: Record<string, unknown> = {},
) => {
  const payload = {
    access_token: null,
    refresh_token: null,
    id_token: null,
    access_token_ciphertext: await encryptSecret(tokens.accessToken),
    refresh_token_ciphertext: await encryptSecret(tokens.refreshToken),
    id_token_ciphertext: await encryptSecret(tokens.idToken || ""),
    token_encryption_version: 1,
    token_type: clean(tokens.tokenType) || null,
    scope: clean(tokens.scope) || null,
    expires_at: tokens.expiresAt || null,
    updated_at: new Date().toISOString(),
    ...extra,
  };
  const { error } = await adminClient.from("xero_connection_settings")
    .upsert({ id: true, ...payload }, { onConflict: "id" });
  if (error) throw error;
  return payload;
};

const decryptConnection = async (adminClient: any, connection: any) => {
  if (!connection) return null;
  if (
    connection.access_token_ciphertext ||
    connection.refresh_token_ciphertext
  ) {
    return {
      ...connection,
      access_token: await decryptSecret(connection.access_token_ciphertext),
      refresh_token: await decryptSecret(connection.refresh_token_ciphertext),
      id_token: await decryptSecret(connection.id_token_ciphertext),
    };
  }
  if (!connection.access_token && !connection.refresh_token) return connection;

  const encrypted = await storeEncryptedXeroTokens(adminClient, {
    accessToken: clean(connection.access_token),
    refreshToken: clean(connection.refresh_token),
    idToken: clean(connection.id_token),
    tokenType: clean(connection.token_type),
    scope: clean(connection.scope),
    expiresAt: connection.expires_at,
  });
  return {
    ...connection,
    ...encrypted,
    access_token: clean(connection.access_token),
    refresh_token: clean(connection.refresh_token),
    id_token: clean(connection.id_token),
  };
};

export const getXeroConnection = async (adminClient: any) => {
  const { data, error } = await adminClient
    .from("xero_connection_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  return await decryptConnection(adminClient, data);
};

export const isXeroConnected = (connection: any) =>
  Boolean(
    connection?.tenant_id &&
      (connection?.refresh_token || connection?.refresh_token_ciphertext) &&
      !connection?.disconnected_at,
  );

export const assertExpectedXeroTenant = (
  connection: any,
  options: { allowInventory?: boolean } = {},
) => {
  if (!isXeroConnected(connection)) throw new Error("Xero is not connected.");
  assertTenantBoundConnection(connection, options);
};

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const getFreshXeroConnection = async (
  adminClient: any,
  options: { allowInventory?: boolean } = {},
) => {
  let connection = await getXeroConnection(adminClient);
  assertExpectedXeroTenant(connection, options);
  const expiry = connection?.expires_at
    ? new Date(connection.expires_at).getTime()
    : 0;
  if (connection?.access_token && expiry - Date.now() > 120_000) {
    return connection;
  }

  const lockId = crypto.randomUUID();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data: claimed, error: claimError } = await adminClient.rpc(
      "claim_xero_token_refresh",
      { p_lock_id: lockId, p_lease_seconds: 45 },
    );
    if (claimError) throw claimError;
    if (claimed) break;
    await wait(500 + attempt * 250);
    connection = await getXeroConnection(adminClient);
    const currentExpiry = connection?.expires_at
      ? new Date(connection.expires_at).getTime()
      : 0;
    if (connection?.access_token && currentExpiry - Date.now() > 120_000) {
      return connection;
    }
    if (attempt === 7) {
      throw new Error("Another Xero token refresh is still in progress.");
    }
  }

  try {
    connection = await getXeroConnection(adminClient);
    const refreshedExpiry = connection?.expires_at
      ? new Date(connection.expires_at).getTime()
      : 0;
    if (connection?.access_token && refreshedExpiry - Date.now() > 120_000) {
      return connection;
    }

    const clientId = clean(Deno.env.get("XERO_CLIENT_ID"));
    const clientSecret = clean(Deno.env.get("XERO_CLIENT_SECRET"));
    if (!clientId || !clientSecret || !connection?.refresh_token) {
      throw new Error("Xero refresh credentials are not configured.");
    }
    const form = new URLSearchParams();
    form.set("grant_type", "refresh_token");
    form.set("refresh_token", connection.refresh_token);
    const response = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(clientId, clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const token = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        clean(token?.error_description || token?.error) ||
          `Xero token refresh failed with HTTP ${response.status}`,
      );
    }
    const expiresIn = Number(token?.expires_in || 0);
    const expiresAt = expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;
    await storeEncryptedXeroTokens(adminClient, {
      accessToken: clean(token.access_token),
      refreshToken: clean(token.refresh_token) || connection.refresh_token,
      idToken: clean(token.id_token) || connection.id_token,
      tokenType: clean(token.token_type) || connection.token_type,
      scope: clean(token.scope) || connection.scope,
      expiresAt,
    });
    return await getXeroConnection(adminClient);
  } finally {
    await adminClient.rpc("release_xero_token_refresh", { p_lock_id: lockId });
  }
};
