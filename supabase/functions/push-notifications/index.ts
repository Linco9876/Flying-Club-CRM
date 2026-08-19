import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import {
  corsHeadersForRequest,
  isAllowedBrowserOrigin,
} from "../_shared/edgeSecurity.ts";
import {
  cleanPushText,
  pushRetryDelaySeconds,
  pushRouteForNotification,
  safePushIconUrl,
  shouldRevokePushSubscription,
} from "../_shared/pushNotifications.ts";

const json = (req: Request, payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });

const bearerToken = (req: Request) =>
  cleanPushText(req.headers.get("Authorization"), 8_000).replace(/^Bearer\s+/i, "").trim();

const timingSafeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
};

const requireUser = async (req: Request, supabaseUrl: string, anonKey: string) => {
  const token = bearerToken(req);
  if (!token) return null;
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  return error || !user?.id ? null : user;
};

const validSubscription = (value: any) => {
  try {
    const endpoint = cleanPushText(value?.endpoint, 4096);
    const url = new URL(endpoint);
    const p256dh = cleanPushText(value?.keys?.p256dh, 1024);
    const auth = cleanPushText(value?.keys?.auth, 512);
    if (url.protocol !== "https:" || p256dh.length < 20 || auth.length < 8) return null;
    return {
      endpoint,
      expirationTime: value?.expirationTime != null && Number.isFinite(Number(value.expirationTime))
        ? new Date(Number(value.expirationTime)).toISOString()
        : null,
      keys: { p256dh, auth },
    };
  } catch {
    return null;
  }
};

const workerAuthorised = (req: Request, workerSecret: string) => {
  const supplied = cleanPushText(req.headers.get("X-Push-Worker-Secret"), 1000);
  return Boolean(workerSecret && supplied && timingSafeEqual(workerSecret, supplied));
};

const markDelivery = async (
  adminClient: any,
  delivery: any,
  result: { success: boolean; statusCode?: number; error?: string },
) => {
  const now = new Date();
  if (result.success) {
    await Promise.all([
      adminClient.from("notification_push_deliveries").update({
        status: "sent",
        sent_at: now.toISOString(),
        push_status_code: result.statusCode ?? 201,
        last_error: null,
        updated_at: now.toISOString(),
      }).eq("id", delivery.delivery_id),
      adminClient.from("push_subscriptions").update({
        last_success_at: now.toISOString(),
        failure_count: 0,
        updated_at: now.toISOString(),
      }).eq("id", delivery.subscription_id),
    ]);
    return;
  }

  const revoke = shouldRevokePushSubscription(result.statusCode);
  const finalFailure = revoke || Number(delivery.attempt_number || 0) >= 5;
  const delaySeconds = pushRetryDelaySeconds(Number(delivery.attempt_number || 1));
  const subscriptionUpdate: Record<string, unknown> = {
    failure_count: Number(delivery.attempt_number || 1),
    updated_at: now.toISOString(),
  };
  if (revoke) subscriptionUpdate.revoked_at = now.toISOString();
  await Promise.all([
    adminClient.from("notification_push_deliveries").update({
      status: finalFailure ? "failed" : "pending",
      next_attempt_at: finalFailure ? now.toISOString() : new Date(now.getTime() + delaySeconds * 1000).toISOString(),
      push_status_code: result.statusCode ?? null,
      last_error: cleanPushText(result.error || "Push provider rejected the delivery", 1000),
      updated_at: now.toISOString(),
    }).eq("id", delivery.delivery_id),
    adminClient.from("push_subscriptions").update(subscriptionUpdate).eq("id", delivery.subscription_id),
  ]);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersForRequest(req) });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  if (!isAllowedBrowserOrigin(req)) return json(req, { error: "This browser origin is not allowed." }, 403);

  try {
    const supabaseUrl = cleanPushText(Deno.env.get("SUPABASE_URL"), 500);
    const anonKey = cleanPushText(Deno.env.get("SUPABASE_ANON_KEY"), 8_000);
    const serviceRoleKey = cleanPushText(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), 8_000);
    const vapidPublicKey = cleanPushText(Deno.env.get("VAPID_PUBLIC_KEY"), 1000);
    const vapidPrivateKey = cleanPushText(Deno.env.get("VAPID_PRIVATE_KEY"), 1000);
    const vapidSubject = cleanPushText(Deno.env.get("VAPID_SUBJECT") || "mailto:lincoln@bbkm.com.au", 500);
    const workerSecret = cleanPushText(Deno.env.get("PUSH_WORKER_SECRET"), 1000);
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !workerSecret) {
      throw new Error("Web Push server settings are incomplete.");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const body = await req.json().catch(() => ({}));
    const action = cleanPushText(body?.action, 50).toLowerCase();

    if (action === "process") {
      if (!workerAuthorised(req, workerSecret)) return json(req, { error: "Worker authentication failed." }, 401);
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      const { data: organisationSettings } = await adminClient
        .from("organisation_settings")
        .select("logo_url")
        .limit(1)
        .maybeSingle();
      const notificationIcon = safePushIconUrl(organisationSettings?.logo_url);
      const { data: deliveries, error: claimError } = await adminClient.rpc(
        "claim_notification_push_deliveries",
        { p_limit: 50 },
      );
      if (claimError) throw claimError;

      let sent = 0;
      let failed = 0;
      for (const delivery of deliveries || []) {
        const route = pushRouteForNotification({
          type: delivery.notification_type,
          user_id: delivery.user_id,
          booking_id: delivery.booking_id,
          metadata: delivery.metadata,
        });
        const payload = JSON.stringify({
          title: cleanPushText(delivery.title || "BFC Portal", 100),
          body: cleanPushText(delivery.message || "You have a new CRM notification.", 320),
          notificationId: delivery.notification_id,
          url: route,
          tag: `crm-${delivery.notification_id}`,
          badgeCount: Math.max(0, Number(delivery.unread_count || 0)),
          icon: notificationIcon,
        });
        try {
          const response = await webpush.sendNotification({
            endpoint: delivery.endpoint,
            keys: { p256dh: delivery.p256dh, auth: delivery.auth_key },
          }, payload, {
            TTL: 60 * 60 * 24,
            urgency: "normal",
            topic: String(delivery.notification_id).replace(/-/g, "").slice(0, 32),
          });
          await markDelivery(adminClient, delivery, { success: true, statusCode: response.statusCode });
          sent += 1;
        } catch (pushError: any) {
          await markDelivery(adminClient, delivery, {
            success: false,
            statusCode: Number(pushError?.statusCode) || undefined,
            error: pushError?.body || pushError?.message || "Push delivery failed",
          });
          failed += 1;
        }
      }
      return json(req, { ok: true, claimed: (deliveries || []).length, sent, failed });
    }

    const user = await requireUser(req, supabaseUrl, anonKey);
    if (!user) return json(req, { error: "Authentication is required." }, 401);

    if (action === "public-key") {
      return json(req, { publicKey: vapidPublicKey });
    }

    if (action === "subscribe") {
      const subscription = validSubscription(body?.subscription);
      if (!subscription) return json(req, { error: "The device push subscription is invalid." }, 400);
      const appScope = body?.appScope === "duty_clock" ? "duty_clock" : "portal";
      const now = new Date().toISOString();
      const { error } = await adminClient.from("push_subscriptions").upsert({
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth_key: subscription.keys.auth,
        app_scope: appScope,
        device_label: cleanPushText(body?.deviceLabel, 120) || null,
        user_agent: cleanPushText(body?.userAgent, 500) || null,
        expiration_time: subscription.expirationTime,
        last_seen_at: now,
        updated_at: now,
        revoked_at: null,
        failure_count: 0,
      }, { onConflict: "endpoint" });
      if (error) throw error;
      return json(req, { ok: true, enabled: true });
    }

    if (action === "unsubscribe" || action === "detach") {
      const endpoint = cleanPushText(body?.endpoint, 4096);
      if (!endpoint) return json(req, { ok: true, enabled: false });
      const { error } = await adminClient.from("push_subscriptions").update({
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id).eq("endpoint", endpoint);
      if (error) throw error;
      return json(req, { ok: true, enabled: false });
    }

    if (action === "test") {
      const { error } = await adminClient.from("notifications").insert({
        user_id: user.id,
        type: "system",
        title: "Phone notifications are working",
        message: "Tap to open your notification preferences in the BFC Portal.",
        metadata: { route: "/settings?tab=account-notifications", notification_kind: "push_test" },
        is_read: false,
      });
      if (error) throw error;
      return json(req, { ok: true });
    }

    return json(req, { error: "Unknown push notification action." }, 400);
  } catch (error) {
    console.error("Push notification function failed", error);
    return json(req, {
      error: error instanceof Error ? error.message : "Push notification request failed.",
    }, 500);
  }
});
