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

const cleanText = (value: unknown) => String(value || "").trim();

const sendEmail = async ({
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
      "accept": "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
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

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildMemberSetupEmail = ({
  memberName,
  setupUrl,
}: {
  memberName: string;
  setupUrl: string;
}) => `<!doctype html>
<html>
  <body style="margin:0;background:#eef4fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef4fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.16);">
            <tr>
              <td style="background:linear-gradient(135deg,#06152f,#0d3b78);padding:32px 30px;color:#ffffff;">
                <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#bfdbfe;font-weight:700;">Bendigo Flying Club</p>
                <h1 style="margin:0;font-size:28px;line-height:1.15;">Your member portal is ready</h1>
                <p style="margin:14px 0 0;color:#dbeafe;font-size:15px;line-height:1.6;">Finish setting up your Members Flight Management System access.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 30px;">
                <p style="margin:0 0 16px;font-size:17px;line-height:1.6;color:#0f172a;">Hi ${escapeHtml(memberName || "there")},</p>
                <p style="margin:0 0 18px;line-height:1.65;color:#334155;">Bendigo Flying Club has converted your guest booking into a full member account. Use the secure link below to set or confirm your password and finish signing in.</p>
                <p style="margin:26px 0;">
                  <a href="${escapeHtml(setupUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;border-radius:14px;padding:14px 22px;">Set up my access</a>
                </p>
                <p style="margin:0 0 10px;color:#64748b;font-size:13px;line-height:1.6;">If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:0;color:#2563eb;font-size:13px;line-height:1.6;word-break:break-all;">${escapeHtml(setupUrl)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const isStaffRole = (role: string) => ["admin", "senior_instructor", "instructor"].includes(role);

const getPrimaryRoleFromRoles = (roles: string[]) =>
  roles.includes("admin") ? "admin"
    : roles.includes("senior_instructor") ? "senior_instructor"
    : roles.includes("instructor") ? "instructor"
    : roles.includes("pilot") ? "pilot"
    : "student";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerUser) return json({ error: "Unauthorized" }, 401);

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUser.id);
    if (callerRolesError) throw callerRolesError;
    if (!(callerRoles || []).some((row) => isStaffRole(String(row.role)))) {
      return json({ error: "Only staff can convert guest bookings into members." }, 403);
    }

    const body = await req.json();
    const bookingId = cleanText(body.bookingId);
    const redirectTo = cleanText(body.redirectTo) || `${Deno.env.get("PUBLIC_SITE_URL") || "https://portal.bendigoflyingclub.com.au"}/`;
    if (!bookingId) return json({ error: "Booking ID is required." }, 400);

    const { data: booking, error: bookingError } = await adminClient
      .from("bookings")
      .select("id,student_id,is_guest_booking,guest_name,guest_email,guest_phone,trial_flight_voucher_id")
      .eq("id", bookingId)
      .maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking) return json({ error: "Booking not found." }, 404);
    if (!booking.is_guest_booking) return json({ error: "This booking is already attached to a member account." }, 409);

    const guestName = cleanText(booking.guest_name);
    const guestEmail = cleanText(booking.guest_email).toLowerCase();
    const guestPhone = cleanText(booking.guest_phone);
    if (!guestName) return json({ error: "Guest name is missing from the booking." }, 409);
    if (!guestEmail) return json({ error: "Guest email is missing from the booking." }, 409);

    const { data: existingUser, error: existingUserError } = await adminClient
      .from("users")
      .select("id,email,name,portal_access_scope,is_active,role")
      .eq("email", guestEmail)
      .maybeSingle();
    if (existingUserError) throw existingUserError;

    let memberId = existingUser?.id as string | undefined;
    let setupLink: string | null = null;
    let emailSent = false;
    let emailError: string | null = null;
    let action: "promoted_existing" | "created_new" = existingUser ? "promoted_existing" : "created_new";

    if (!memberId) {
      const { data: authData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(guestEmail, {
        data: {
          name: guestName,
          phone: guestPhone || null,
        },
        redirectTo,
      });
      if (inviteError || !authData.user?.id) {
        return json({ error: inviteError?.message || "Failed to create the member login" }, 500);
      }
      memberId = authData.user.id;
    } else {
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: guestEmail,
        options: { redirectTo },
      });
      if (!linkError) {
        setupLink = linkData?.properties?.action_link || null;
      }
    }

    if (!memberId) return json({ error: "Member ID could not be resolved." }, 500);

    const { error: userUpsertError } = await adminClient
      .from("users")
      .upsert({
        id: memberId,
        email: guestEmail,
        name: guestName,
        phone: guestPhone || null,
        role: "student",
        portal_access_scope: "full",
        is_active: true,
      });
    if (userUpsertError) throw userUpsertError;

    const { data: roleRows, error: roleRowsError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", memberId);
    if (roleRowsError) throw roleRowsError;
    const nextRoles = Array.from(new Set([...(roleRows || []).map((row) => String(row.role)), "student"]));

    await adminClient.from("user_roles").delete().eq("user_id", memberId);
    const { error: roleInsertError } = await adminClient
      .from("user_roles")
      .insert(nextRoles.map((role) => ({ user_id: memberId, role })));
    if (roleInsertError) throw roleInsertError;

    const legacyRole = getPrimaryRoleFromRoles(nextRoles);
    const { error: roleUpdateError } = await adminClient
      .from("users")
      .update({ role: legacyRole === "pilot" ? "student" : legacyRole })
      .eq("id", memberId);
    if (roleUpdateError) throw roleUpdateError;

    const { error: studentUpsertError } = await adminClient
      .from("students")
      .upsert({ id: memberId });
    if (studentUpsertError) throw studentUpsertError;

    if (!existingUser) {
      const { error: invitationInsertError } = await adminClient
        .from("invitations")
        .insert({
          email: guestEmail,
          name: guestName,
          phone: guestPhone || null,
          role: "student",
          invited_by: callerUser.id,
          status: "pending",
          accepted_at: null,
          user_id: memberId,
        });
      if (invitationInsertError) {
        console.warn("Invitation record could not be created for converted guest:", invitationInsertError);
      }
    }

    if (setupLink) {
      const emailResult = await sendEmail({
        to: guestEmail,
        toName: guestName,
        subject: "Your Bendigo Flying Club member login is ready",
        html: buildMemberSetupEmail({
          memberName: guestName,
          setupUrl: setupLink,
        }),
      });
      emailSent = emailResult.sent;
      emailError = emailResult.error;
    }

    const { error: bookingUpdateError } = await adminClient
      .from("bookings")
      .update({
        student_id: memberId,
        is_guest_booking: false,
        guest_name: null,
        guest_email: null,
        guest_phone: null,
      })
      .eq("id", bookingId);
    if (bookingUpdateError) throw bookingUpdateError;

    const { error: flightLogUpdateError } = await adminClient
      .from("flight_logs")
      .update({ student_id: memberId })
      .eq("booking_id", bookingId);
    if (flightLogUpdateError) throw flightLogUpdateError;

    const { error: trainingRecordUpdateError } = await adminClient
      .from("training_records")
      .update({ student_id: memberId })
      .eq("booking_id", bookingId);
    if (trainingRecordUpdateError) throw trainingRecordUpdateError;

    return json({
      ok: true,
      action,
      memberId,
      memberEmail: guestEmail,
      setupLink,
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error("convert-guest-booking-to-member error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
