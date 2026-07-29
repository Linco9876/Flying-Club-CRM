import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeadersForRequest,
  isAllowedBrowserOrigin,
} from "../_shared/edgeSecurity.ts";
import {
  deriveFinancialProviderCapabilities,
} from "../_shared/financialCapabilities.ts";
import {
  getStripeModeSettings,
  getStripeSecretStatus,
} from "../_shared/stripeMode.ts";

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersForRequest(req, "POST, OPTIONS");
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=30",
      },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!isAllowedBrowserOrigin(req)) {
    return json({ error: "Origin is not allowed." }, 403);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Financial provider status is not configured." }, 503);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const [
      { data: stripeConnection, error: stripeError },
      { data: xeroConnection, error: xeroError },
      stripeMode,
    ] = await Promise.all([
      adminClient
        .from("stripe_connect_settings")
        .select("stripe_user_id")
        .eq("id", true)
        .maybeSingle(),
      adminClient
        .from("xero_connection_settings")
        .select("tenant_id,expected_tenant_id,refresh_token,refresh_token_ciphertext,disconnected_at,connection_mode,posting_enabled")
        .eq("id", true)
        .maybeSingle(),
      getStripeModeSettings(adminClient),
    ]);
    if (stripeError) throw stripeError;
    if (xeroError) throw xeroError;

    const stripeSecrets = getStripeSecretStatus();
    const activeStripeSecrets = stripeSecrets[stripeMode.mode];
    const xeroConfigured = Boolean(
      Deno.env.get("XERO_CLIENT_ID") &&
        Deno.env.get("XERO_CLIENT_SECRET") &&
        Deno.env.get("XERO_TOKEN_ENCRYPTION_KEY"),
    );

    return json(deriveFinancialProviderCapabilities({
      stripeAccountId: stripeConnection?.stripe_user_id,
      stripeConfigured: Boolean(
        activeStripeSecrets.secretKey &&
          activeStripeSecrets.webhookSecret,
      ),
      stripeMode: stripeMode.mode,
      xeroTenantId: xeroConnection?.tenant_id,
      xeroExpectedTenantId: xeroConnection?.expected_tenant_id,
      xeroHasRefreshToken: Boolean(
        xeroConnection?.refresh_token_ciphertext ||
          xeroConnection?.refresh_token,
      ),
      xeroDisconnected: Boolean(xeroConnection?.disconnected_at),
      xeroConfigured,
      xeroPostingEnabled: Boolean(xeroConnection?.posting_enabled),
      xeroConnectionMode: xeroConnection?.connection_mode || "disconnected",
    }));
  } catch (error) {
    console.error("financial-provider-status error:", error);
    return json({
      error: error instanceof Error
        ? error.message
        : "Could not determine financial provider status.",
    }, 500);
  }
});
