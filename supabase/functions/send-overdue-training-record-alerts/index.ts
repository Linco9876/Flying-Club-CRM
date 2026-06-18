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

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

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
    return { sent: false, error: await response.text() };
  }

  return { sent: true, error: null };
};

const formatSydneyDate = (value: string) =>
  new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Sydney",
  }).format(new Date(value));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const suppliedBearer = authHeader.replace(/^Bearer\s+/i, "");
  const suppliedCronSecret = req.headers.get("x-cron-secret") || "";

  if (
    serviceRoleKey &&
    suppliedBearer !== serviceRoleKey &&
    (!cronSecret || suppliedCronSecret !== cronSecret)
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing Supabase service configuration" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const reminderCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: logs, error: logsError } = await admin
    .from("flight_logs")
    .select("id, student_id, instructor_id, aircraft_id, start_time, training_record_overdue_email_sent_at")
    .eq("training_record_status", "pending")
    .not("instructor_id", "is", null)
    .lt("start_time", cutoff)
    .or(`training_record_overdue_email_sent_at.is.null,training_record_overdue_email_sent_at.lt.${reminderCutoff}`)
    .order("start_time", { ascending: true })
    .limit(1000);

  if (logsError) return json({ error: logsError.message }, 500);
  if (!logs?.length) return json({ sent: 0, logs: 0 });

  const instructorIds = [...new Set(logs.map((log: any) => log.instructor_id).filter(Boolean))];
  const studentIds = [...new Set(logs.map((log: any) => log.student_id).filter(Boolean))];
  const aircraftIds = [...new Set(logs.map((log: any) => log.aircraft_id).filter(Boolean))];

  const [
    { data: instructors, error: instructorsError },
    { data: students, error: studentsError },
    { data: aircraft, error: aircraftError },
  ] = await Promise.all([
    admin.from("users").select("id, name, email").in("id", instructorIds),
    studentIds.length
      ? admin.from("users").select("id, name").in("id", studentIds)
      : Promise.resolve({ data: [], error: null }),
    aircraftIds.length
      ? admin.from("aircraft").select("id, registration").in("id", aircraftIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (instructorsError) return json({ error: instructorsError.message }, 500);
  if (studentsError) return json({ error: studentsError.message }, 500);
  if (aircraftError) return json({ error: aircraftError.message }, 500);

  const instructorsById = new Map((instructors || []).map((instructor: any) => [instructor.id, instructor]));
  const studentsById = new Map((students || []).map((student: any) => [student.id, student]));
  const aircraftById = new Map((aircraft || []).map((item: any) => [item.id, item]));
  const portalUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
  let sent = 0;
  let failed = 0;

  for (const instructorId of instructorIds) {
    const instructor = instructorsById.get(instructorId);
    if (!instructor?.email) continue;

    const instructorLogs = logs.filter((log: any) => log.instructor_id === instructorId);
    const rows = instructorLogs.slice(0, 12).map((log: any) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(formatSydneyDate(log.start_time))}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(studentsById.get(log.student_id)?.name || "Student")}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(aircraftById.get(log.aircraft_id)?.registration || "")}</td>
      </tr>
    `).join("");

    const html = `<!doctype html>
<html>
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 16px 40px rgba(15,23,42,.14);">
          <tr><td style="background:#0b1f44;color:#ffffff;padding:28px;">
            <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#bfdbfe;font-weight:700;">Bendigo Flying Club</p>
            <h1 style="margin:0;font-size:26px;line-height:1.2;">Outstanding training records</h1>
          </td></tr>
          <tr><td style="padding:26px 28px;">
            <p style="margin:0 0 14px;line-height:1.6;">Hi ${escapeHtml(instructor.name || "there")},</p>
            <p style="margin:0 0 18px;line-height:1.6;">You have ${instructorLogs.length} training ${instructorLogs.length === 1 ? "record" : "records"} older than 7 days waiting to be submitted.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
              <tr style="background:#f8fafc;">
                <th align="left" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;">Flight</th>
                <th align="left" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;">Student</th>
                <th align="left" style="padding:10px 8px;border-bottom:1px solid #e2e8f0;">Aircraft</th>
              </tr>
              ${rows}
            </table>
            ${instructorLogs.length > 12 ? `<p style="margin:12px 0 0;color:#64748b;font-size:13px;">Plus ${instructorLogs.length - 12} more.</p>` : ""}
            <p style="margin:24px 0 0;">
              <a href="${portalUrl}/training/outstanding-records" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;border-radius:12px;padding:12px 18px;">Open outstanding records</a>
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

    const result = await sendBrevoEmail({
      to: instructor.email,
      toName: instructor.name,
      subject: "Outstanding Bendigo Flying Club training records",
      html,
    });

    if (result.sent) {
      sent += 1;
      await admin
        .from("flight_logs")
        .update({ training_record_overdue_email_sent_at: new Date().toISOString() })
        .in("id", instructorLogs.map((log: any) => log.id));
    } else {
      failed += 1;
      console.error("Failed to send overdue training record alert", instructor.email, result.error);
    }
  }

  return json({ sent, failed, logs: logs.length });
});
