import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const clean = (value: unknown, maximum = 1000) => String(value ?? "").trim().slice(0, maximum);
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
}[character] || character));

const page = ({ businessName, state }: { businessName: string; state: "confirm" | "done" | "invalid" | "test" }) => {
  const content = state === "done"
    ? {
      icon: "✓",
      title: "You’re unsubscribed",
      copy: "You won’t receive future post-flight feedback requests. Essential booking confirmations and reminders are not affected.",
      action: "",
    }
    : state === "test"
    ? {
      icon: "✓",
      title: "The unsubscribe link works",
      copy: "This is a test email, so no preference was changed.",
      action: "",
    }
    : state === "invalid"
    ? {
      icon: "!",
      title: "This link is no longer available",
      copy: `Contact ${businessName} if you would like help changing your email preferences.`,
      action: "",
    }
    : {
      icon: "✉",
      title: "Stop post-flight feedback emails?",
      copy: "You will still receive essential booking confirmations and reminders.",
      action: `<form method="post" style="margin:24px 0 0;"><button type="submit" style="width:100%;border:0;border-radius:12px;background:#1d4ed8;color:#fff;padding:14px 18px;font-size:15px;font-weight:800;cursor:pointer;">Unsubscribe</button></form>`,
    };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.title)}</title></head>
  <body style="margin:0;background:#edf3fa;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;">
      <section style="width:100%;max-width:460px;border-radius:22px;background:#fff;padding:32px;box-sizing:border-box;box-shadow:0 18px 50px rgba(15,23,42,.14);text-align:center;">
        <div style="width:52px;height:52px;margin:0 auto 18px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#dbeafe;color:#1d4ed8;font-size:24px;font-weight:900;">${content.icon}</div>
        <p style="margin:0 0 9px;color:#64748b;font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">${escapeHtml(businessName)}</p>
        <h1 style="margin:0;font-size:25px;line-height:1.25;">${escapeHtml(content.title)}</h1>
        <p style="margin:13px 0 0;color:#475569;font-size:15px;line-height:1.65;">${escapeHtml(content.copy)}</p>
        ${content.action}
      </section>
    </main>
  </body></html>`;
};

const htmlResponse = (html: string, status = 200) => new Response(html, {
  status,
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  },
});

Deno.serve(async (req: Request) => {
  if (!["GET", "POST"].includes(req.method)) return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"), 1000);
  const serviceRoleKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), 10_000);
  if (!supabaseUrl || !serviceRoleKey) return htmlResponse(page({ businessName: "The flying club", state: "invalid" }), 503);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: organisation } = await admin.from("organisation_settings").select("club_name").limit(1).maybeSingle();
  const businessName = clean(organisation?.club_name, 200) || "The flying club";

  if (url.searchParams.get("test") === "1") {
    return htmlResponse(page({ businessName, state: "test" }));
  }

  const token = clean(url.searchParams.get("token"), 80).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) {
    return htmlResponse(page({ businessName, state: "invalid" }), 404);
  }
  const { data: delivery } = await admin.from("guest_booking_email_deliveries")
    .select("id,recipient_email,delivery_kind")
    .eq("unsubscribe_token", token)
    .eq("delivery_kind", "guest_review_request")
    .maybeSingle();
  if (!delivery?.id || !delivery.recipient_email) {
    return htmlResponse(page({ businessName, state: "invalid" }), 404);
  }
  if (req.method === "GET") return htmlResponse(page({ businessName, state: "confirm" }));

  const email = clean(delivery.recipient_email, 320).toLowerCase();
  const now = new Date().toISOString();
  const { error: preferenceError } = await admin.from("guest_review_email_suppressions").upsert({
    email,
    suppressed_at: now,
    source_delivery_id: delivery.id,
    reason: "recipient_unsubscribed",
    updated_at: now,
  }, { onConflict: "email" });
  if (preferenceError) {
    console.error("Guest review unsubscribe failed", preferenceError);
    return htmlResponse(page({ businessName, state: "invalid" }), 500);
  }
  await admin.from("guest_booking_email_deliveries").update({
    status: "suppressed",
    suppression_reason: "Recipient unsubscribed from post-flight feedback email",
    processing_started_at: null,
    updated_at: now,
  }).eq("delivery_kind", "guest_review_request")
    .ilike("recipient_email", email)
    .in("status", ["pending", "retry", "processing"]);

  return htmlResponse(page({ businessName, state: "done" }));
});
