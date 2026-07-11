export type StripeMode = "test" | "live";

export interface StripeModeSettings {
  mode: StripeMode;
  allowTestModeXeroSync: boolean;
}

const cleanMode = (value: unknown): StripeMode => value === "test" ? "test" : "live";

export const isTestStripeMode = (mode: StripeMode) => mode === "test";

export const getStripeModeSettings = async (adminClient: any): Promise<StripeModeSettings> => {
  const { data, error } = await adminClient
    .from("stripe_connect_settings")
    .select("stripe_mode,allow_test_mode_xero_sync")
    .eq("id", true)
    .maybeSingle();

  if (error) throw error;

  return {
    mode: cleanMode(data?.stripe_mode),
    allowTestModeXeroSync: Boolean(data?.allow_test_mode_xero_sync),
  };
};

export const getStripeSecretKeyForMode = (mode: StripeMode) => {
  const key = Deno.env.get(mode === "test" ? "STRIPE_TEST_SECRET_KEY" : "STRIPE_LIVE_SECRET_KEY");
  if (!key) {
    throw Object.assign(
      new Error(
        mode === "test"
          ? "Stripe Test Mode is active, but STRIPE_TEST_SECRET_KEY is not configured."
          : "Stripe Live Mode is active, but STRIPE_LIVE_SECRET_KEY is not configured.",
      ),
      { status: 503 },
    );
  }
  return key;
};

export const getStripePublishableKeyForMode = (mode: StripeMode) =>
  Deno.env.get(mode === "test" ? "STRIPE_TEST_PUBLISHABLE_KEY" : "STRIPE_LIVE_PUBLISHABLE_KEY") || null;

export const getStripeWebhookSecretForMode = (mode: StripeMode) =>
  Deno.env.get(mode === "test" ? "STRIPE_TEST_WEBHOOK_SECRET" : "STRIPE_LIVE_WEBHOOK_SECRET") || null;

export const getStripeSecretStatus = () => {
  const testSecret = Boolean(Deno.env.get("STRIPE_TEST_SECRET_KEY"));
  const liveSecret = Boolean(Deno.env.get("STRIPE_LIVE_SECRET_KEY"));
  const testWebhook = Boolean(Deno.env.get("STRIPE_TEST_WEBHOOK_SECRET"));
  const liveWebhook = Boolean(Deno.env.get("STRIPE_LIVE_WEBHOOK_SECRET"));
  const testPublishable = Boolean(Deno.env.get("STRIPE_TEST_PUBLISHABLE_KEY"));
  const livePublishable = Boolean(Deno.env.get("STRIPE_LIVE_PUBLISHABLE_KEY"));

  return {
    test: {
      secretKey: testSecret,
      webhookSecret: testWebhook,
      publishableKey: testPublishable,
      configured: testSecret && testWebhook && testPublishable,
    },
    live: {
      secretKey: liveSecret,
      webhookSecret: liveWebhook,
      publishableKey: livePublishable,
      configured: liveSecret && liveWebhook && livePublishable,
    },
  };
};

export const getActiveStripeMode = async (adminClient: any) => {
  const settings = await getStripeModeSettings(adminClient);
  const secretKey = getStripeSecretKeyForMode(settings.mode);
  return { ...settings, secretKey, isTestMode: settings.mode === "test" };
};

export const addStripeModeMetadata = (form: URLSearchParams, mode: StripeMode) => {
  form.set("metadata[stripe_mode]", mode);
  form.set("metadata[test_mode]", mode === "test" ? "true" : "false");
};

export const stripeModeColumns = (mode: StripeMode) => ({
  stripe_mode: mode,
  is_test_mode: mode === "test",
});

export const testModeSubject = (mode: StripeMode, subject: string) =>
  mode === "test" && !subject.startsWith("[TEST]") ? `[TEST] ${subject}` : subject;
