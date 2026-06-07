import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isStaffRole = (role: string) => ["admin", "senior_instructor", "instructor"].includes(role);

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const createRawToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const isUnder18 = (dateValue?: string | null) => {
  if (!dateValue) return false;
  const dob = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return false;
  const eighteenth = new Date(dob);
  eighteenth.setFullYear(eighteenth.getFullYear() + 18);
  return new Date() < eighteenth;
};

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

const sendBrevoSms = async ({ to, content }: { to: string; content: string }) => {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const sender = Deno.env.get("BREVO_SMS_SENDER");
  if (!apiKey || !sender) return { sent: false, error: "BREVO_API_KEY or BREVO_SMS_SENDER is not configured" };

  const response = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender,
      recipient: to,
      content,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { sent: false, error: body || `Brevo SMS failed with ${response.status}` };
  }

  return { sent: true, error: null };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerUser) return jsonResponse({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerRoles, error: rolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUser.id);
    if (rolesError) return jsonResponse({ error: rolesError.message }, 500);
    if (!(callerRoles || []).some((row) => isStaffRole(String(row.role)))) {
      return jsonResponse({ error: "Only instructors or admins can send declaration links" }, 403);
    }

    const {
      enrolmentId,
      recipientType = "both",
      deliveryMethod = "email",
      guardianEmail,
      guardianPhone,
      redirectOrigin,
    } = await req.json();

    if (!enrolmentId || typeof enrolmentId !== "string") {
      return jsonResponse({ error: "enrolmentId is required" }, 400);
    }

    const { data: enrolment, error: enrolmentError } = await adminClient
      .from("student_course_enrolments")
      .select("*")
      .eq("id", enrolmentId)
      .maybeSingle();

    if (enrolmentError) return jsonResponse({ error: enrolmentError.message }, 500);
    if (!enrolment) return jsonResponse({ error: "Course enrolment not found" }, 404);

    const [
      { data: student, error: studentError },
      { data: studentExtra, error: studentExtraError },
      { data: course, error: courseError },
    ] = await Promise.all([
      adminClient
        .from("users")
        .select("id,name,email,date_of_birth,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship")
        .eq("id", enrolment.student_id)
        .maybeSingle(),
      adminClient
        .from("students")
        .select("raaus_id,date_of_birth,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship")
        .eq("id", enrolment.student_id)
        .maybeSingle(),
      adminClient
        .from("training_courses")
        .select("id,title,requires_flying_declaration,flying_declaration_title,flying_declaration_text,flying_declaration_version,requires_guardian_declaration_for_minors,guardian_declaration_title,guardian_declaration_text")
        .eq("id", enrolment.course_id)
        .maybeSingle(),
    ]);

    if (studentError) return jsonResponse({ error: studentError.message }, 500);
    if (studentExtraError) return jsonResponse({ error: studentExtraError.message }, 500);
    if (courseError) return jsonResponse({ error: courseError.message }, 500);
    if (!student || !course) return jsonResponse({ error: "Student or course not found" }, 404);
    if (!course?.requires_flying_declaration || !course?.flying_declaration_text?.trim()) {
      return jsonResponse({ error: "This course does not require a flying declaration" }, 400);
    }

    const declarationVersion = Number(course.flying_declaration_version || 1);
    const studentSigned = Boolean(enrolment.declaration_signed_at && Number(enrolment.declaration_version || 0) >= declarationVersion);
    const guardianSigned = Boolean(enrolment.guardian_declaration_signed_at && Number(enrolment.guardian_declaration_version || 0) >= declarationVersion);
    const minor = isUnder18(student?.date_of_birth || studentExtra?.date_of_birth);
    const guardianRequired = minor && (course.requires_guardian_declaration_for_minors ?? true) && Boolean(course.guardian_declaration_text?.trim());

    const origin = typeof redirectOrigin === "string" && redirectOrigin.trim()
      ? redirectOrigin.trim().replace(/\/$/, "")
      : (Deno.env.get("SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");

    const requestedRecipients = recipientType === "student"
      ? ["student"]
      : recipientType === "guardian"
        ? ["guardian"]
        : ["student", "guardian"];
    const results = [];

    for (const recipient of requestedRecipients) {
      if (recipient === "student" && studentSigned) {
        results.push({ recipientType: recipient, skipped: true, reason: "Student declaration already signed" });
        continue;
      }

      if (recipient === "guardian") {
        if (!guardianRequired) {
          results.push({ recipientType: recipient, skipped: true, reason: "Guardian declaration is not required" });
          continue;
        }
        if (guardianSigned) {
          results.push({ recipientType: recipient, skipped: true, reason: "Guardian declaration already signed" });
          continue;
        }
      }

      const rawToken = createRawToken();
      const tokenHash = await sha256Hex(rawToken);
      const link = `${origin}/declaration-sign?token=${encodeURIComponent(rawToken)}`;
      const recipientEmail = recipient === "student"
        ? student?.email
        : (typeof guardianEmail === "string" && guardianEmail.trim()
          ? guardianEmail.trim()
          : enrolment.guardian_declaration_email);
      const recipientPhone = recipient === "student"
        ? null
        : (typeof guardianPhone === "string" && guardianPhone.trim()
          ? guardianPhone.trim()
          : enrolment.guardian_declaration_phone || student?.emergency_contact_phone || studentExtra?.emergency_contact_phone);
      const resolvedDelivery = deliveryMethod === "sms" ? "sms" : recipientEmail ? "email" : recipientPhone ? "sms" : "manual";

      const { data: tokenRow, error: tokenError } = await adminClient
        .from("declaration_signing_tokens")
        .insert({
          enrolment_id: enrolment.id,
          recipient_type: recipient,
          delivery_method: resolvedDelivery,
          token_hash: tokenHash,
          recipient_email: recipientEmail || null,
          recipient_phone: recipientPhone || null,
          created_by: callerUser.id,
          metadata: {
            courseTitle: course.title,
            studentName: student?.name,
            generatedFrom: "send-declaration-link",
          },
        })
        .select("id")
        .single();

      if (tokenError) {
        results.push({ recipientType: recipient, error: tokenError.message });
        continue;
      }

      const subject = recipient === "student"
        ? `Please sign your ${course.title} flying declaration`
        : `Parent/guardian declaration required for ${student?.name || "student"}`;
      const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h2 style="margin:0 0 12px">Bendigo Flying Club declaration</h2>
          <p>${recipient === "student"
            ? `Please review and sign your flying declaration for <strong>${course.title}</strong>.`
            : `Please review and sign the under-18 parent/guardian declaration for <strong>${student?.name || "the student"}</strong> in <strong>${course.title}</strong>.`}</p>
          <p><a href="${link}" style="display:inline-block;background:#2563eb;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open signing link</a></p>
          <p style="font-size:13px;color:#4b5563">This one-time link expires in 14 days. If you did not expect this email, contact Bendigo Flying Club.</p>
          <p style="font-size:12px;color:#6b7280;word-break:break-all">${link}</p>
        </div>
      `;

      let sendResult = { sent: false, error: "Manual link generated" as string | null };
      if (resolvedDelivery === "email" && recipientEmail) {
        sendResult = await sendBrevoEmail({
          to: recipientEmail,
          toName: recipient === "student" ? student?.name : enrolment.guardian_declaration_signed_name,
          subject,
          html,
        });
      } else if (resolvedDelivery === "sms" && recipientPhone) {
        sendResult = await sendBrevoSms({
          to: recipientPhone,
          content: `Bendigo Flying Club declaration signing link: ${link}`,
        });
      }

      await adminClient
        .from("declaration_signing_tokens")
        .update({
          sent_at: sendResult.sent ? new Date().toISOString() : null,
          send_error: sendResult.error,
        })
        .eq("id", tokenRow.id);

      results.push({
        recipientType: recipient,
        deliveryMethod: resolvedDelivery,
        emailSent: sendResult.sent && resolvedDelivery === "email",
        smsSent: sendResult.sent && resolvedDelivery === "sms",
        sendError: sendResult.error,
        manualLink: link,
      });
    }

    return jsonResponse({ results });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
