import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const clean = (value: unknown) => String(value || "").trim();
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};
const timingSafeEqual = (left: string, right: string) => {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const rawBody = await req.text();
  const webhookKey = clean(Deno.env.get("XERO_WEBHOOK_KEY"));
  const suppliedSignature = clean(req.headers.get("X-Xero-Signature"));
  if (!webhookKey || !suppliedSignature) {
    return new Response("Webhook signature required", { status: 401 });
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expectedSignature = toBase64(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(rawBody)),
    ),
  );
  if (!timingSafeEqual(suppliedSignature, expectedSignature)) {
    return new Response("Invalid webhook signature", { status: 401 });
  }

  const payload = rawBody ? JSON.parse(rawBody) : {};
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: connection, error: connectionError } = await adminClient
    .from("xero_connection_settings")
    .select("tenant_id,expected_tenant_id")
    .eq("id", true).maybeSingle();
  if (connectionError) return new Response("Connection lookup failed", { status: 500 });

  const events = Array.isArray(payload?.events) ? payload.events : [];
  for (const event of events) {
    const tenantId = clean(event?.tenantId);
    const eventId = clean(event?.eventId);
    if (!tenantId || !eventId) continue;
    const tenantMatches = Boolean(
      connection?.expected_tenant_id &&
      tenantId === connection.expected_tenant_id &&
      tenantId === connection.tenant_id,
    );
    const { error } = await adminClient.from("xero_webhook_events").upsert({
      tenant_id: tenantId,
      event_id: eventId,
      event_type: clean(event?.eventCategory || event?.eventType) || null,
      signature_valid: true,
      payload: event,
      status: tenantMatches ? "pending" : "needs_review",
      last_error: tenantMatches
        ? null
        : "Webhook tenant does not match the immutable active BFC tenant.",
    }, { onConflict: "tenant_id,event_id" });
    if (error) return new Response("Webhook persistence failed", { status: 500 });
  }
  return new Response(null, { status: 200 });
});
