import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const clean = (value: unknown) => String(value || "").trim();
const escapeHtml = (value: unknown) => clean(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[character] || character));

type Variant = "automatic" | "manual";

const renderWelcome = ({ name, membershipClass, variant, review = false }: {
  name: string; membershipClass: string; variant: Variant; review?: boolean;
}) => {
  const firstName = clean(name).split(/\s+/)[0] || "member";
  const portalUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
  const paymentHeading = variant === "automatic" ? "Your automatic renewal" : "Your annual invoice";
  const paymentHtml = variant === "automatic"
    ? `<p>Your saved payment method will be used for your initial prorated membership invoice. For future financial years, payment will be attempted on <strong>1 July</strong>.</p>
       <p>If a renewal payment is unsuccessful, you will have <strong>60 days to pay</strong> before your membership ceases for non-payment. Aircraft self-booking is unavailable while the membership fee is unpaid, throughout that 60-day period, and after membership ceases.</p>`
    : `<p>Your initial prorated membership invoice will be issued through Xero. For future financial years, an invoice will be raised before your membership can cease.</p>
       <p>If an invoice remains unpaid, available <strong>Xero-verified prepaid credit</strong> may be applied first. Any remainder must still be paid. Aircraft self-booking is unavailable while the membership fee is unpaid, and membership ceases after the 60-day non-payment period.</p>`;
  const reviewBanner = review
    ? `<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;color:#9a3412;margin:0 0 20px;padding:12px 16px;font-size:13px"><strong>Review copy:</strong> This is the ${variant} payment version of the member welcome email. No membership record has been changed.</div>`
    : "";
  const subject = review
    ? `[REVIEW – ${variant === "automatic" ? "Automatic renewal" : "Annual invoice"}] Welcome to Bendigo Flying Club`
    : `Welcome to Bendigo Flying Club, ${firstName}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033">
    <div style="max-width:640px;margin:0 auto;padding:28px 14px">
      <div style="background:#071b33;border-radius:16px 16px 0 0;padding:28px;color:white;text-align:center">
        <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#bae6fd">Bendigo Flying Club</div>
        <h1 style="font-size:28px;margin:10px 0 0">Welcome to the club</h1>
      </div>
      <div style="background:white;border-radius:0 0 16px 16px;padding:28px;line-height:1.65">
        ${reviewBanner}
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>Your <strong>${escapeHtml(membershipClass)}</strong> membership has commenced. We are delighted to welcome you to Bendigo Flying Club.</p>
        <h2 style="font-size:18px;margin-top:26px">Your member portal</h2>
        <p>Your portal account is ready. It is your place to:</p>
        <ul style="padding-left:20px"><li>view the aircraft calendar and make eligible bookings;</li><li>keep your profile and RAAus information current;</li><li>review flights, training records and your logbook;</li><li>see membership, invoice and payment status; and</li><li>manage your annual payment preference.</li></ul>
        <p style="background:#eff6ff;border-left:4px solid #2563eb;padding:13px 15px">Club membership and RAAus membership are separate. Please keep your RAAus details current in your profile.</p>
        <h2 style="font-size:18px;margin-top:26px">${paymentHeading}</h2>
        ${paymentHtml}
        <div style="text-align:center;margin:28px 0"><a href="${portalUrl}" style="display:inline-block;background:#1d4ed8;color:white;text-decoration:none;font-weight:bold;border-radius:10px;padding:13px 22px">Open the member portal</a></div>
        <p>If anything looks wrong or you need help, reply to this email and the club team can assist.</p>
        <p>Blue skies,<br><strong>Bendigo Flying Club</strong></p>
      </div>
      <p style="text-align:center;color:#64748b;font-size:11px">This operational membership email was sent by Bendigo Flying Club.</p>
    </div></body></html>`;
  const paymentText = variant === "automatic"
    ? "Your saved payment method will be used for the initial prorated invoice. Future renewal payment will be attempted on 1 July. If unsuccessful, you have 60 days to pay before membership ceases. Aircraft self-booking is unavailable while unpaid and after cessation."
    : "Your initial prorated Xero invoice will be issued. Future invoices are raised before membership can cease. If left unpaid, available Xero-verified prepaid credit may be applied first. Aircraft self-booking is unavailable while unpaid and membership ceases after 60 days.";
  const text = `${review ? `REVIEW COPY – ${variant} payment version\n\n` : ""}Hi ${firstName},\n\nYour ${membershipClass} membership has commenced. Welcome to Bendigo Flying Club.\n\nThe member portal lets you view the aircraft calendar, make eligible bookings, maintain your profile and RAAus information, review flight/training records and your logbook, and manage membership and payments. Club and RAAus membership are separate.\n\n${paymentText}\n\nOpen the portal: ${portalUrl}\n\nBlue skies,\nBendigo Flying Club`;
  return { subject, html, text };
};

const sendBrevo = async (recipient: string, message: ReturnType<typeof renderWelcome>) => {
  const apiKey = clean(Deno.env.get("BREVO_API_KEY"));
  if (!apiKey) throw new Error("BREVO_API_KEY is not configured.");
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { accept: "application/json", "api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      sender: {
        email: clean(Deno.env.get("BREVO_SENDER_EMAIL")) || "noreply@bendigoflyingclub.com.au",
        name: clean(Deno.env.get("BREVO_SENDER_NAME")) || "Bendigo Flying Club",
      },
      to: [{ email: recipient }], subject: message.subject, htmlContent: message.html, textContent: message.text,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(clean(payload?.message) || `Brevo returned HTTP ${response.status}.`);
  return clean(payload?.messageId) || null;
};

const requireServiceOrAdmin = async (adminClient: any, req: Request, serviceRoleKey: string) => {
  const token = clean(req.headers.get("Authorization")).replace(/^Bearer\s+/i, "");
  if (token && token === serviceRoleKey) return;
  if (!token) throw Object.assign(new Error("Authentication is required."), { status: 401 });
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user?.id) throw Object.assign(new Error("Invalid session."), { status: 401 });
  const { data: profile } = await adminClient.from("users").select("role").eq("id", data.user.id).maybeSingle();
  const { data: roles } = await adminClient.from("user_roles").select("role").eq("user_id", data.user.id);
  if (profile?.role !== "admin" && !(roles || []).some((item: any) => item.role === "admin")) {
    throw Object.assign(new Error("Admin access is required."), { status: 403 });
  }
};

const deliver = async (adminClient: any, input: {
  key: string; membershipId?: string; userId?: string; recipient: string; name: string;
  membershipClass: string; variant: Variant; review?: boolean;
}) => {
  const { data: existing } = await adminClient.from("membership_welcome_email_deliveries")
    .select("id,status,attempts").eq("delivery_key", input.key).maybeSingle();
  if (existing?.status === "sent") return { deliveryKey: input.key, status: "already_sent" };

  let delivery = existing;
  if (existing) {
    const { data, error } = await adminClient.from("membership_welcome_email_deliveries").update({
      status: "sending", attempts: Number(existing.attempts || 1) + 1, error_message: null, updated_at: new Date().toISOString(),
    }).eq("id", existing.id).select("id,status,attempts").single();
    if (error) throw error;
    delivery = data;
  } else {
    const { data, error } = await adminClient.from("membership_welcome_email_deliveries").insert({
      delivery_key: input.key, membership_id: input.membershipId || null, user_id: input.userId || null,
      recipient_email: input.recipient, payment_variant: input.variant, is_review: Boolean(input.review), status: "sending",
    }).select("id,status,attempts").single();
    if (error) {
      const { data: raced } = await adminClient.from("membership_welcome_email_deliveries").select("id,status,attempts").eq("delivery_key", input.key).maybeSingle();
      if (raced?.status === "sent" || raced?.status === "sending") return { deliveryKey: input.key, status: "already_claimed" };
      throw error;
    }
    delivery = data;
  }

  try {
    const message = renderWelcome({ name: input.name, membershipClass: input.membershipClass, variant: input.variant, review: input.review });
    const messageId = await sendBrevo(input.recipient, message);
    await adminClient.from("membership_welcome_email_deliveries").update({
      status: "sent", provider_message_id: messageId, sent_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString(),
    }).eq("id", delivery.id);
    return { deliveryKey: input.key, status: "sent", subject: message.subject, messageId };
  } catch (error) {
    await adminClient.from("membership_welcome_email_deliveries").update({
      status: "failed", error_message: error instanceof Error ? error.message : "Email delivery failed", updated_at: new Date().toISOString(),
    }).eq("id", delivery.id);
    throw error;
  }
};

const sendForMembership = async (adminClient: any, membership: any) => {
  const [{ data: member, error: memberError }, { data: membershipClass, error: classError }, { data: preference, error: preferenceError }] = await Promise.all([
    adminClient.from("users").select("id,name,email").eq("id", membership.user_id).maybeSingle(),
    adminClient.from("membership_classes").select("name").eq("id", membership.membership_class_id).maybeSingle(),
    adminClient.from("membership_payment_preferences").select("payment_method,auto_renew").eq("user_id", membership.user_id).maybeSingle(),
  ]);
  if (memberError) throw memberError;
  if (classError) throw classError;
  if (preferenceError) throw preferenceError;
  if (!member?.email) throw new Error("The member does not have an email address.");
  const variant: Variant = ["becs", "card"].includes(clean(preference?.payment_method)) && preference?.auto_renew === true ? "automatic" : "manual";
  return deliver(adminClient, {
    key: `membership:${membership.id}`, membershipId: membership.id, userId: membership.user_id,
    recipient: clean(member.email), name: clean(member.name) || "Member", membershipClass: clean(membershipClass?.name) || "BFC",
    variant,
  });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = clean(body.action || "send-pending");

    if (action === "send-review") {
      const recipient = "lincoln@bbkm.com.au";
      const results = [];
      for (const variant of ["automatic", "manual"] as Variant[]) {
        results.push(await deliver(adminClient, {
          key: `review:membership-welcome-v1:${variant}:${recipient}`, recipient, name: "Lincoln",
          membershipClass: "Full", variant, review: true,
        }));
      }
      return json({ recipient, results });
    }

    await requireServiceOrAdmin(adminClient, req, serviceRoleKey);
    if (action === "send-for-user") {
      const userId = clean(body.userId);
      if (!userId) return json({ error: "Missing userId" }, 400);
      const { data: membership, error } = await adminClient.from("club_memberships")
        .select("id,user_id,membership_class_id,legal_status").eq("user_id", userId).eq("legal_status", "current").maybeSingle();
      if (error) throw error;
      if (!membership) return json({ sent: false, reason: "membership_not_current" });
      return json({ sent: true, result: await sendForMembership(adminClient, membership) });
    }
    if (action !== "send-pending") return json({ error: "Unknown action" }, 400);
    const { data: memberships, error } = await adminClient.from("club_memberships")
      .select("id,user_id,membership_class_id,legal_status").eq("legal_status", "current").order("commenced_at", { ascending: true }).limit(100);
    if (error) throw error;
    const results = [];
    for (const membership of memberships || []) {
      try { results.push(await sendForMembership(adminClient, membership)); }
      catch (error) { results.push({ membershipId: membership.id, status: "failed", error: error instanceof Error ? error.message : "Email failed" }); }
    }
    return json({ processed: results.length, failed: results.filter((item: any) => item.status === "failed").length, results });
  } catch (error) {
    const status = typeof (error as any)?.status === "number" ? (error as any).status : 500;
    console.error("send-membership-welcome-email error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, status);
  }
});
