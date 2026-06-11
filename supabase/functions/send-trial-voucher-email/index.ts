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
  const bookingBlockMinutes = Number(product.duration_minutes || 0) + 30;
  const expiryDate = voucher.expires_at
    ? new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Australia/Sydney",
      }).format(new Date(voucher.expires_at))
    : "";
  const sentToPurchaser = !voucher.send_to_recipient;
  const flyerName = voucher.recipient_name || (sentToPurchaser ? "the recipient" : recipientName) || "the recipient";
  const greetingName = recipientName || "there";
  const productText = product.email_body || product.description || "This voucher includes a trial instructional flight with a qualified Bendigo Flying Club instructor.";
  const purchaserForwardingNote = sentToPurchaser
    ? voucher.recipient_name
      ? `This voucher has been sent to the purchaser so they can forward it to ${escapeHtml(voucher.recipient_name)} whenever they are ready.`
      : "This voucher has been sent to the purchaser so they can forward it to the recipient whenever they are ready."
    : "";

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
                <p style="margin:14px 0 0;color:#dbeafe;font-size:15px;line-height:1.6;">${escapeHtml(aircraftLabel)} for ${escapeHtml(flyerName)}.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 30px;">
                <p style="margin:0 0 18px;font-size:17px;line-height:1.6;color:#0f172a;">Hi ${escapeHtml(greetingName)},</p>
                ${sentToPurchaser ? `<p style="margin:0 0 14px;line-height:1.65;color:#334155;">${purchaserForwardingNote}</p>` : ""}
                ${paragraphs(productText)}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;border:1px solid #dbeafe;border-radius:18px;background:#f8fbff;">
                  <tr>
                    <td style="padding:18px;">
                      <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#2563eb;font-weight:700;">Voucher code</p>
                      <p style="margin:0;font-size:26px;font-weight:800;letter-spacing:1px;color:#0f172a;">${escapeHtml(voucher.code)}</p>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border:1px solid #e2e8f0;border-radius:18px;background:#ffffff;">
                  <tr>
                    <td style="padding:18px;">
                      <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#2563eb;font-weight:700;">What is included</p>
                      <ul style="margin:0;padding-left:20px;color:#334155;line-height:1.65;">
                        <li>A welcome and pre-flight briefing at Bendigo Flying Club.</li>
                        <li>${escapeHtml(product.duration_minutes)} minutes of trial instructional flight time with a qualified instructor.</li>
                        <li>Use of the eligible ${escapeHtml(product.aircraft_mode === "archer" ? "PA-28 Archer" : product.aircraft_mode === "tecnam" ? "Tecnam aircraft" : "selected aircraft")} for this voucher.</li>
                        <li>Time after the flight to ask questions about learning to fly.</li>
                      </ul>
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
                      <span style="color:#475569;">${escapeHtml(bookingBlockMinutes)} minutes</span>
                    </td>
                  </tr>
                  ${expiryDate ? `
                  <tr>
                    <td colspan="2" style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
                      <strong style="display:block;color:#0f172a;">Voucher expiry</strong>
                      <span style="color:#475569;">${escapeHtml(expiryDate)}</span>
                    </td>
                  </tr>` : ""}
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border:1px solid #dbeafe;border-radius:18px;background:#f8fbff;">
                  <tr>
                    <td style="padding:18px;">
                      <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#2563eb;font-weight:700;">How to book</p>
                      <ol style="margin:0;padding-left:20px;color:#334155;line-height:1.65;">
                        <li>Click the booking button below, or enter the voucher code on the Bendigo Flying Club portal.</li>
                        <li>Verify the voucher and create the restricted booking account using full name, email and phone.</li>
                        <li>Choose an available time. The system checks the aircraft and qualified instructor together.</li>
                      </ol>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 18px;line-height:1.65;color:#334155;">${escapeHtml(product.booking_instructions || "Use the button below to verify your voucher and choose an available flight time.")}</p>
                <p style="margin:26px 0;">
                  <a href="${escapeHtml(redeemUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;border-radius:14px;padding:14px 22px;">Book your trial flight</a>
                </p>
                <p style="margin:0 0 10px;color:#64748b;font-size:13px;line-height:1.6;">If the button does not work, visit ${escapeHtml(redeemUrl)} and enter the voucher code above.</p>
                ${voucher.send_to_recipient ? "" : `<p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">Forward this email to the recipient when you are ready. The booking link and voucher code are all they need to start the restricted booking account setup.</p>`}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const resolveDelivery = (voucher: any) => {
  const to = voucher.send_to_recipient ? voucher.recipient_email : voucher.purchaser_email;
  const toName = voucher.send_to_recipient ? voucher.recipient_name : voucher.purchaser_name;
  return { to, toName };
};

const claimVoucherEmailDelivery = async (
  adminClient: ReturnType<typeof createClient>,
  voucherId: string,
) => {
  const staleClaimCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data, error } = await adminClient
    .from("trial_flight_vouchers")
    .update({
      email_delivery_claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", voucherId)
    .is("delivered_at", null)
    .or(`email_delivery_claimed_at.is.null,email_delivery_claimed_at.lt.${staleClaimCutoff}`)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
};

const releaseVoucherEmailDeliveryClaim = async (
  adminClient: ReturnType<typeof createClient>,
  voucherId: string,
) => {
  await adminClient
    .from("trial_flight_vouchers")
    .update({
      email_delivery_claimed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", voucherId)
    .is("delivered_at", null);
};

type StaffAuthResult =
  | { ok: true; userId: string }
  | { ok: false; error: string; status: number };

const hasValidInternalSecret = (req: Request) => {
  const configuredSecret = Deno.env.get("TRIAL_VOUCHER_INTERNAL_SECRET");
  const suppliedSecret = req.headers.get("x-internal-secret");
  return Boolean(configuredSecret && suppliedSecret && suppliedSecret === configuredSecret);
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const getStoredCronSecretHash = async (adminClient: ReturnType<typeof createClient>) => {
  const { data, error } = await adminClient
    .from("trial_voucher_cron_auth")
    .select("secret_hash")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    console.error("Failed to read trial voucher cron auth hash:", error.message);
    return null;
  }

  return typeof data?.secret_hash === "string" ? data.secret_hash : null;
};

const hasValidCronSecret = async (req: Request, body: any, adminClient: ReturnType<typeof createClient>) => {
  const suppliedSecret = req.headers.get("x-cron-secret") || String(body.cronSecret || "");
  if (!suppliedSecret) return false;

  const configuredSecret = Deno.env.get("TRIAL_VOUCHER_CRON_SECRET");
  if (configuredSecret && suppliedSecret === configuredSecret) return true;

  const storedHash = await getStoredCronSecretHash(adminClient);
  if (!storedHash) return false;

  return await sha256Hex(suppliedSecret) === storedHash;
};

const authenticateStaff = async ({
  req,
  supabaseUrl,
  anonKey,
  adminClient,
}: {
  req: Request;
  supabaseUrl: string;
  anonKey: string;
  adminClient: ReturnType<typeof createClient>;
}): Promise<StaffAuthResult> => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, error: "No authorization header", status: 401 };

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerUser) return { ok: false, error: "Unauthorized", status: 401 };

  const [{ data: callerRoles, error: rolesError }, { data: callerProfile, error: profileError }] = await Promise.all([
    adminClient.from("user_roles").select("role").eq("user_id", callerUser.id),
    adminClient.from("users").select("role").eq("id", callerUser.id).maybeSingle(),
  ]);
  if (rolesError) return { ok: false, error: rolesError.message, status: 500 };
  if (profileError) return { ok: false, error: profileError.message, status: 500 };

  const callerIsStaff = isStaffRole(String(callerProfile?.role || "")) ||
    (callerRoles || []).some((row) => isStaffRole(String(row.role)));
  if (!callerIsStaff) return { ok: false, error: "Only staff can send voucher emails", status: 403 };

  return { ok: true, userId: callerUser.id };
};

const sendVoucherEmail = async ({
  adminClient,
  voucher,
  redirectOrigin,
}: {
  adminClient: ReturnType<typeof createClient>;
  voucher: any;
  redirectOrigin?: string;
}) => {
  if (!["issued", "redeemed", "booked"].includes(String(voucher.status || ""))) {
    return { sent: false, error: "Voucher email can only be sent after the voucher is issued." };
  }

  const product = voucher.trial_flight_voucher_products;
  const { to, toName } = resolveDelivery(voucher);
  if (!to) return { sent: false, error: "Voucher has no delivery email address" };

  if (!voucher.delivered_at) {
    const claimed = await claimVoucherEmailDelivery(adminClient, voucher.id);
    if (!claimed) {
      return {
        sent: false,
        skipped: true,
        error: "Voucher email delivery is already in progress or has already completed.",
      };
    }
  }

  const origin = String(redirectOrigin || Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
  const redeemUrl = `${origin}/trial-flight-voucher?voucherCode=${encodeURIComponent(voucher.code)}`;
  const subject = product.email_subject || "Your Bendigo Flying Club trial flight voucher";
  const html = buildVoucherEmail({ voucher, product, recipientName: toName || "", redeemUrl });

  const result = await sendBrevoEmail({ to, toName, subject, html });
  if (!result.sent) {
    await releaseVoucherEmailDeliveryClaim(adminClient, voucher.id);
    return { sent: false, error: result.error || "Email could not be sent" };
  }

  await adminClient
    .from("trial_flight_vouchers")
    .update({
      delivered_at: new Date().toISOString(),
      email_delivery_claimed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", voucher.id);

  return { sent: true, to, redeemUrl };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const body = await req.json();
    const action = String(body.action || "send-one");

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (action === "send-due") {
      if (!(await hasValidCronSecret(req, body, adminClient))) {
        const staffAuth = await authenticateStaff({ req, supabaseUrl, anonKey, adminClient });
        if (!staffAuth.ok) return json({ error: staffAuth.error }, staffAuth.status);
      }

      const staleClaimCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
      const { data: vouchers, error: voucherError } = await adminClient
        .from("trial_flight_vouchers")
        .select("*, trial_flight_voucher_products(*)")
        .eq("send_to_recipient", true)
        .is("delivered_at", null)
        .or(`email_delivery_claimed_at.is.null,email_delivery_claimed_at.lt.${staleClaimCutoff}`)
        .in("status", ["issued", "redeemed", "booked"])
        .not("recipient_delivery_at", "is", null)
        .lte("recipient_delivery_at", new Date().toISOString())
        .order("recipient_delivery_at", { ascending: true })
        .limit(25);

      if (voucherError) return json({ error: voucherError.message }, 500);

      const results = [];
      for (const voucher of vouchers || []) {
        const result = await sendVoucherEmail({ adminClient, voucher });
        results.push({ voucherId: voucher.id, code: voucher.code, ...result });
      }

      return json({
        processed: results.length,
        sent: results.filter((result: any) => result.sent).length,
        failed: results.filter((result: any) => !result.sent && !result.skipped).length,
        results,
      });
    }

    const internalSend = hasValidInternalSecret(req);
    if (!internalSend) {
      const staffAuth = await authenticateStaff({ req, supabaseUrl, anonKey, adminClient });
      if (!staffAuth.ok) return json({ error: staffAuth.error }, staffAuth.status);
    }

    const { voucherId, redirectOrigin, force = false } = body;
    if (!voucherId || typeof voucherId !== "string") return json({ error: "voucherId is required" }, 400);

    const { data: voucher, error: voucherError } = await adminClient
      .from("trial_flight_vouchers")
      .select("*, trial_flight_voucher_products(*)")
      .eq("id", voucherId)
      .maybeSingle();

    if (voucherError) return json({ error: voucherError.message }, 500);
    if (!voucher) return json({ error: "Voucher not found" }, 404);
    if (!["issued", "redeemed", "booked"].includes(String(voucher.status || ""))) {
      return json({ error: "Voucher email can only be sent after the voucher is issued." }, 409);
    }

    const deliveryAt = voucher.recipient_delivery_at ? new Date(voucher.recipient_delivery_at) : null;
    if (!force && voucher.send_to_recipient && deliveryAt && deliveryAt.getTime() > Date.now()) {
      return json({ sent: false, scheduled: true, deliveryAt: deliveryAt.toISOString() });
    }

    const result = await sendVoucherEmail({ adminClient, voucher, redirectOrigin });
    if (!result.sent) return json({ error: result.error || "Email could not be sent" }, 500);

    return json(result);
  } catch (error) {
    console.error("send-trial-voucher-email error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
