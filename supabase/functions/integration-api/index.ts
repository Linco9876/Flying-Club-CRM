import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sha256Hex } from "../_shared/integrationSecurity.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const asUuidList = (value: unknown) => Array.isArray(value)
  ? value.map(String).filter((item) => /^[0-9a-f-]{36}$/i.test(item))
  : null;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: { code: "server_configuration", message: "API is not configured" } }, 503);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token?.startsWith("bfc_") || token.length < 40) {
    return json({ error: { code: "unauthorized", message: "A valid BFC integration API key is required" } }, 401);
  }

  const { data: apiKey } = await admin
    .from("integration_api_keys")
    .select("id, scopes, is_active, expires_at")
    .eq("key_hash", await sha256Hex(token))
    .maybeSingle();
  if (!apiKey?.is_active || (apiKey.expires_at && new Date(apiKey.expires_at) <= new Date())) {
    return json({ error: { code: "unauthorized", message: "API key is invalid, expired or revoked" } }, 401);
  }

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("integration_api_request_log").select("id", { head: true, count: "exact" }).eq("api_key_id", apiKey.id).gte("occurred_at", since);
  if ((count || 0) >= 60) {
    return json({ error: { code: "rate_limited", message: "Limit is 60 requests per minute" } }, 429);
  }

  const pathname = new URL(request.url).pathname;
  const route = pathname.slice(pathname.indexOf("/integration-api") + "/integration-api".length) || "/";
  const requireScope = (scope: string) => {
    if (!apiKey.scopes?.includes(scope)) throw new Error(`scope:${scope}`);
  };
  let status = 200;

  try {
    let response: unknown;
    if (route === "/v1/aircraft" && request.method === "GET") {
      requireScope("aircraft:read");
      const { data, error } = await admin.from("aircraft")
        .select("id, registration, make, model, type, status, is_archived, seat_capacity, updated_at")
        .eq("is_archived", false)
        .order("registration");
      if (error) throw error;
      response = { data, meta: { apiVersion: "v1" } };
    } else if (route === "/v1/availability" && request.method === "POST") {
      requireScope("availability:read");
      const body = await request.json().catch(() => ({}));
      const { data, error } = await admin.rpc("find_next_available_slots", {
        p_after: typeof body.after === "string" ? body.after : new Date().toISOString(),
        p_duration_minutes: Number(body.durationMinutes || 120),
        p_search_days: Number(body.searchDays || 30),
        p_aircraft_ids: asUuidList(body.aircraftIds),
        p_instructor_ids: asUuidList(body.instructorIds),
        p_location_id: typeof body.locationId === "string" ? body.locationId : null,
        p_limit: Number(body.limit || 8),
      });
      if (error) throw error;
      response = { data, meta: { apiVersion: "v1", timezone: "Australia/Sydney" } };
    } else if (route === "/v1/bookings" && request.method === "GET") {
      requireScope("bookings:read");
      const changedSince = new URL(request.url).searchParams.get("changed_since") || new Date(Date.now() - 7 * 86400_000).toISOString();
      const { data, error } = await admin.from("bookings")
        .select("id, aircraft_id, instructor_id, location_id, location, start_time, end_time, status, booking_kind, updated_at, deleted_at")
        .gte("updated_at", changedSince)
        .order("updated_at")
        .limit(500);
      if (error) throw error;
      response = { data, meta: { apiVersion: "v1", limit: 500 } };
    } else {
      status = 404;
      response = { error: { code: "not_found", message: "Use /v1/aircraft, /v1/availability or /v1/bookings" } };
    }

    await Promise.all([
      admin.from("integration_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", apiKey.id),
      admin.from("integration_api_request_log").insert({ api_key_id: apiKey.id, method: request.method, path: route, response_status: status }),
    ]);
    return json(response, status);
  } catch (error) {
    status = error instanceof Error && error.message.startsWith("scope:") ? 403 : 500;
    await admin.from("integration_api_request_log").insert({ api_key_id: apiKey.id, method: request.method, path: route, response_status: status });
    if (status === 403) return json({ error: { code: "insufficient_scope", message: `API key requires ${String((error as Error).message).slice(6)}` } }, status);
    console.error("integration-api error", error);
    return json({ error: { code: "internal_error", message: "Request could not be completed" } }, status);
  }
});
