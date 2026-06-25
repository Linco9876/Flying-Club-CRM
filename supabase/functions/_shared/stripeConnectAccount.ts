export const cleanStripeAccountId = (value: unknown) => String(value || "").trim();

export const isStripeAccountId = (value: string) => /^acct_[A-Za-z0-9_]+$/.test(value);

export const getConnectedStripeAccountId = async (adminClient: any) => {
  const { data, error } = await adminClient
    .from("stripe_connect_settings")
    .select("stripe_user_id")
    .eq("id", true)
    .maybeSingle();

  if (error) throw error;

  const accountId = cleanStripeAccountId(data?.stripe_user_id);
  return isStripeAccountId(accountId) ? accountId : null;
};

export const stripeHeaders = (
  secretKey: string,
  accountId?: string | null,
  extraHeaders: Record<string, string> = {},
) => ({
  Authorization: `Bearer ${secretKey}`,
  ...(accountId ? { "Stripe-Account": accountId } : {}),
  ...extraHeaders,
});

export const stripeIdempotencyKey = (...parts: Array<string | number | null | undefined>) => {
  const raw = parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(":")
    .replace(/[^A-Za-z0-9:_-]+/g, "-");

  return raw.slice(0, 255);
};
