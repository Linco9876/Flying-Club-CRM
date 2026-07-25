import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  allowedWebhookHosts,
  hmacSha256Hex,
  pinnedHttpsPost,
  resolvePublicWebhookDestination,
} from "../_shared/integrationSecurity.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expectedSecret = Deno.env.get("INTEGRATION_WORKER_SECRET");
  if (!expectedSecret || request.headers.get("x-worker-secret") !== expectedSecret) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Worker is not configured" }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const webhookHostAllowlist = allowedWebhookHosts(Deno.env.get("INTEGRATION_WEBHOOK_ALLOWED_HOSTS"));

  const { data: events, error: eventError } = await admin.from("integration_webhook_events")
    .select("id, event_type").is("expanded_at", null).order("occurred_at").limit(50);
  if (eventError) throw eventError;
  const { data: endpoints, error: endpointError } = await admin.from("integration_webhook_endpoints")
    .select("id, subscribed_events").eq("is_active", true);
  if (endpointError) throw endpointError;

  for (const event of events || []) {
    const deliveries = (endpoints || [])
      .filter((endpoint) => endpoint.subscribed_events.includes(event.event_type) || endpoint.subscribed_events.includes("*"))
      .map((endpoint) => ({ endpoint_id: endpoint.id, event_id: event.id }));
    if (deliveries.length) await admin.from("integration_webhook_deliveries").upsert(deliveries, { onConflict: "endpoint_id,event_id", ignoreDuplicates: true });
    await admin.from("integration_webhook_events").update({ expanded_at: new Date().toISOString() }).eq("id", event.id);
  }

  const { data: claimed, error: claimError } = await admin.rpc("claim_integration_webhook_deliveries", {
    p_limit: 25,
    p_lease_timeout_seconds: 300,
  });
  if (claimError) throw claimError;
  const claimedIds = (claimed || []).map((delivery: { id: string }) => delivery.id);
  const { data: pending, error: pendingError } = claimedIds.length
    ? await admin.from("integration_webhook_deliveries")
      .select("id, endpoint_id, event_id, attempt_count, integration_webhook_endpoints(url), integration_webhook_events(event_type, payload, occurred_at)")
      .in("id", claimedIds)
    : { data: [], error: null };
  if (pendingError) throw pendingError;
  let succeeded = 0;
  let failed = 0;

  for (const delivery of pending || []) {
    const endpoint = Array.isArray(delivery.integration_webhook_endpoints) ? delivery.integration_webhook_endpoints[0] : delivery.integration_webhook_endpoints;
    const event = Array.isArray(delivery.integration_webhook_events) ? delivery.integration_webhook_events[0] : delivery.integration_webhook_events;
    const { data: secretRow } = await admin.from("integration_webhook_secrets").select("signing_secret").eq("endpoint_id", delivery.endpoint_id).single();
    if (!endpoint?.url || !event || !secretRow?.signing_secret) {
      await admin.from("integration_webhook_deliveries").update({
        status: "abandoned",
        last_error: "Webhook endpoint is missing required delivery data",
        updated_at: new Date().toISOString(),
      }).eq("id", delivery.id);
      failed += 1;
      continue;
    }
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ id: delivery.event_id, type: event.event_type, occurredAt: event.occurred_at, data: event.payload });
    const attempt = delivery.attempt_count;
    try {
      const destination = await resolvePublicWebhookDestination(endpoint.url, webhookHostAllowlist);
      if (!destination) {
        await admin.from("integration_webhook_deliveries").update({
          status: "abandoned",
          last_error: "Webhook endpoint is not allowlisted or resolves to a non-public address",
          updated_at: new Date().toISOString(),
        }).eq("id", delivery.id);
        failed += 1;
        continue;
      }
      const response = await pinnedHttpsPost(
        destination,
        body,
        {
          "Content-Type": "application/json",
          "User-Agent": "BFC-Portal-Webhooks/1.0",
          "X-BFC-Event-Id": delivery.event_id,
          "X-BFC-Event-Type": event.event_type,
          "X-BFC-Timestamp": timestamp,
          "X-BFC-Signature": `v1=${await hmacSha256Hex(secretRow.signing_secret, `${timestamp}.${body}`)}`,
        },
      );
      const excerpt = response.text.slice(0, 500);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${excerpt}`);
      await admin.from("integration_webhook_deliveries").update({ status: "succeeded", response_status: response.status, response_excerpt: excerpt, delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", delivery.id);
      await admin.from("integration_webhook_endpoints").update({ last_success_at: new Date().toISOString() }).eq("id", delivery.endpoint_id);
      succeeded += 1;
    } catch (error) {
      const abandoned = attempt >= 8;
      const retryMinutes = Math.min(24 * 60, 2 ** attempt);
      await admin.from("integration_webhook_deliveries").update({
        status: abandoned ? "abandoned" : "failed",
        last_error: error instanceof Error ? error.message.slice(0, 500) : "Delivery failed",
        next_attempt_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", delivery.id);
      await admin.from("integration_webhook_endpoints").update({ last_failure_at: new Date().toISOString() }).eq("id", delivery.endpoint_id);
      failed += 1;
    }
  }
  return json({ expanded: events?.length || 0, processed: pending?.length || 0, succeeded, failed });
});
