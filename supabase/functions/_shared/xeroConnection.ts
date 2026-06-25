export const getXeroConnection = async (adminClient: any) => {
  const { data, error } = await adminClient
    .from("xero_connection_settings")
    .select("tenant_id,tenant_name,access_token,refresh_token,expires_at")
    .eq("id", true)
    .maybeSingle();

  if (error) throw error;
  return data || null;
};

export const isXeroConnected = (connection: any) =>
  Boolean(connection?.tenant_id && connection?.refresh_token);
