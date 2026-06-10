import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isStaffRole = (role: string) => ["admin", "senior_instructor", "instructor"].includes(role);

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const paragraphs = (value: unknown) =>
  String(value ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 14px;line-height:1.65;color:#334155;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");

const sendBrevoEmail = async ({
  to,
  toName,
  subject,
  html,
}: {
  to: string;
  toName?: string;
  subject: string;
  html: string;
}) => {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) return { sent: false, error: "BREVO_API_KEY is not configured" };

  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@bendigoflyingclub.com.au";
  const senderName = Deno.env.get("BREVO_SENDER_NAME") || "Bendigo Flying Club";

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { sent: false, error: body || `Brevo email failed with ${response.status}` };
  }

  return { sent: true, error: null };
};

const buildVoucherEmail = ({
  voucher,
  product,
  recipientName,
  redeemUrl,
}: {
  voucher: any;
  product: any;
  recipientName: string;
  redeemUrl: string;
}) => {
  const aircraftLabel =
    product.aircraft_mode === "tecnam"
      ? "Tecnam trial instructional flight"
      : product.aircraft_mode === "archer"
        ? "PA-28 Archer trial instructional flight"
        : "Trial instructional flight";

  return `<!doctype html>
<html>
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.16);">
            <tr>
              <td style="background:linear-gradient(135deg,#06152f,#0d3b78);padding:34px 30px;color:#ffffff;">
                <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#bfdbfe;font-weight:700;">Bendigo Flying Club</p>
                <h1 style="margin:0;font-size:30px;line-height:1.15;">Your trial flight voucher is ready</h1>
                <p style="margin:14px 0 0;color:#dbeafe;font-size:15px;line-height:1.6;">${escapeHtml(aircraftLabel)} for ${escapeHtml(recipientName || "the recipient")}.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 30px;">
                <p style="margin:0 0 18px;font-size:17px;line-height:1.6;color:#0f172a;">Hi ${escapeHtml(recipientName || "there")},</p>
                ${paragraphs(product.email_body || product.description)}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;border:1px solid #dbeafe;border-radius:18px;background:#f8fbff;">
                  <tr>
                    <td style="padding:18px;">
                      <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#2563eb;font-weight:700;">Voucher code</p>
                      <p style="margin:0;font-size:26px;font-weight:800;letter-spacing:1px;color:#0f172a;">${escapeHtml(voucher.code)}</p>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="padding:12px 0;width:50%;border-bottom:1px solid #e2e8f0;">
                      <strong style="display:block;color:#0f172a;">Flight time</strong>
                      <span style="color:#475569;">${escapeHtml(product.duration_minutes)} minutes</span>
                    </td>
                    <td style="padding:12px 0;width:50%;border-bottom:1px solid #e2e8f0;">
                      <strong style="display:block;color:#0f172a;">Booking block</strong>
                      <span style="color:#475569;">${escapeHtml(Number(product.duration_minutes || 0) + 30)} minutes</span>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 18px;line-height:1.65;color:#334155;">${escapeHtml(product.booking_instructions || "Use the button below to verify your voucher and choose an available flight time.")}</p>
                <p style="margin:26px 0;">
                  <a href="${escapeHtml(redeemUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;border-radius:14px;padding:14px 22px;">Book your trial flight</a>
                </p>
                <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">If the button does not work, visit ${escapeHtml(redeemUrl)} and enter the voucher code above.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerUser) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const [{ data: callerRoles, error: rolesError }, { data: callerProfile, error: profileError }] = await Promise.all([
      adminClient.from("user_roles").select("role").eq("user_id", callerUser.id),
      adminClient.from("users").select("role").eq("id", callerUser.id).maybeSingle(),
    ]);
    if (rolesError) return json({ error: rolesError.message }, 500);
    if (profileError) return json({ error: profileError.message }, 500);

    const callerIsStaff = isStaffRole(String(callerProfile?.role || "")) ||
      (callerRoles || []).some((row) => isStaffRole(String(row.role)));
    if (!callerIsStaff) return json({ error: "Only staff can send voucher emails" }, 403);

    const { voucherId, redirectOrigin, force = false } = await req.json();
    if (!voucherId || typeof voucherId !== "string") return json({ error: "voucherId is required" }, 400);

    const { data: voucher, error: voucherError } = await adminClient
      .from("trial_flight_vouchers")
      .select("*, trial_flight_voucher_products(*)")
      .eq("id", voucherId)
      .maybeSingle();

    if (voucherError) return json({ error: voucherError.message }, 500);
    if (!voucher) return json({ error: "Voucher not found" }, 404);

    const deliveryAt = voucher.recipient_delivery_at ? new Date(voucher.recipient_delivery_at) : null;
    if (!force && voucher.send_to_recipient && deliveryAt && deliveryAt.getTime() > Date.now()) {
      return json({ sent: false, scheduled: true, deliveryAt: deliveryAt.toISOString() });
    }

    const product = voucher.trial_flight_voucher_products;
    const to = voucher.send_to_recipient ? voucher.recipient_email : voucher.purchaser_email;
    const toName = voucher.send_to_recipient ? voucher.recipient_name : voucher.purchaser_name;
    if (!to) return json({ error: "Voucher has no delivery email address" }, 400);

    const origin = String(redirectOrigin || Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
    const redeemUrl = `${origin}/trial-flight-voucher?code=${encodeURIComponent(voucher.code)}`;
    const subject = product.email_subject || "Your Bendigo Flying Club trial flight voucher";
    const html = buildVoucherEmail({ voucher, product, recipientName: toName || "", redeemUrl });

    const result = await sendBrevoEmail({ to, toName, subject, html });
    if (!result.sent) return json({ error: result.error || "Email could not be sent" }, 500);

    await adminClient
      .from("trial_flight_vouchers")
      .update({ delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", voucher.id);

    return json({ sent: true, to, redeemUrl });
  } catch (error) {
    console.error("send-trial-voucher-email error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
