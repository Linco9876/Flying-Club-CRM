import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { renderTrainingRecordAcknowledgementEmail } from "../_shared/trainingRecordAcknowledgementEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") || "https://portal.bendigoflyingclub.com.au",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Vary": "Origin",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const isStaffRole = (role: string) => ["admin", "senior_instructor", "instructor"].includes(role);

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const createRawToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const firstJoinRow = <T>(value: T | T[] | null | undefined): T | undefined =>
  Array.isArray(value) ? value[0] : value || undefined;

const formatDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" }).format(parsed);
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
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerUser) return jsonResponse({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const [{ data: callerRoles, error: rolesError }, { data: callerProfile, error: profileError }] = await Promise.all([
      adminClient.from("user_roles").select("role").eq("user_id", callerUser.id),
      adminClient.from("users").select("role").eq("id", callerUser.id).maybeSingle(),
    ]);
    if (rolesError) return jsonResponse({ error: rolesError.message }, 500);
    if (profileError) return jsonResponse({ error: profileError.message }, 500);
    const callerIsStaff = isStaffRole(String(callerProfile?.role || "")) ||
      (callerRoles || []).some((row) => isStaffRole(String(row.role)));
    if (!callerIsStaff) return jsonResponse({ error: "Only instructors or admins can send lesson record links" }, 403);

    const body = await req.json();
    const trainingRecordId = typeof body?.trainingRecordId === "string" ? body.trainingRecordId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trainingRecordId)) {
      return jsonResponse({ error: "A valid trainingRecordId is required" }, 400);
    }

    const { data: record, error: recordError } = await adminClient
      .from("training_records")
      .select(`
        id, student_id, instructor_id, course_id, lesson_id, date, status, student_ack,
        aircraft_type, registration, dual_time_min, solo_time_min, comments, briefing_comments,
        formal_briefing, criteria_grades, next_lesson, is_flight_review, flight_review_type,
        flight_review_result, flight_review_notes, audit_log,
        students:users!training_records_student_id_fkey(id,name,email),
        instructors:users!training_records_instructor_id_fkey(id,name),
        training_courses(id,title,requires_student_acknowledgement),
        training_lessons(id,name,sequence_code,sequence_title)
      `)
      .eq("id", trainingRecordId)
      .maybeSingle();
    if (recordError) return jsonResponse({ error: recordError.message }, 500);
    if (!record) return jsonResponse({ error: "Training record not found" }, 404);

    const student = firstJoinRow(record.students) as { id?: string; name?: string; email?: string } | undefined;
    const instructor = firstJoinRow(record.instructors) as { id?: string; name?: string } | undefined;
    const course = firstJoinRow(record.training_courses) as { id?: string; title?: string; requires_student_acknowledgement?: boolean } | undefined;
    const lesson = firstJoinRow(record.training_lessons) as { id?: string; name?: string; sequence_code?: string; sequence_title?: string } | undefined;

    const { data: settings, error: settingsError } = await adminClient
      .from("training_syllabus_settings")
      .select("force_student_acknowledgement_for_all_courses")
      .maybeSingle();
    if (settingsError) return jsonResponse({ error: settingsError.message }, 500);
    const requiresAcknowledgement = Boolean(
      settings?.force_student_acknowledgement_for_all_courses || course?.requires_student_acknowledgement,
    );
    if (!requiresAcknowledgement || record.status !== "submitted" || record.student_ack) {
      return jsonResponse({ skipped: true, reason: "This record is not awaiting student acknowledgement" });
    }
    if (!student?.email) return jsonResponse({ error: "The student does not have an email address" }, 409);

    const lessonTitle = lesson?.name || lesson?.sequence_title || lesson?.sequence_code || "Flight lesson";
    const fingerprint = await sha256Hex(JSON.stringify({
      studentId: record.student_id,
      instructorId: record.instructor_id,
      courseId: record.course_id,
      lessonId: record.lesson_id,
      date: record.date,
      aircraftType: record.aircraft_type,
      registration: record.registration,
      dualTimeMin: record.dual_time_min,
      soloTimeMin: record.solo_time_min,
      comments: record.comments,
      briefingComments: record.briefing_comments,
      formalBriefing: record.formal_briefing,
      criteriaGrades: record.criteria_grades,
      nextLesson: record.next_lesson,
      reviewType: record.flight_review_type,
      reviewResult: record.flight_review_result,
      reviewNotes: record.flight_review_notes,
      auditLog: record.audit_log,
    }));

    const { data: latestToken, error: latestError } = await adminClient
      .from("training_record_acknowledgement_tokens")
      .select("id,sent_at,send_error,expires_at,metadata")
      .eq("training_record_id", record.id)
      .is("used_at", null)
      .is("superseded_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) return jsonResponse({ error: latestError.message }, 500);
    if (
      latestToken?.sent_at && !latestToken.send_error &&
      latestToken.metadata?.recordFingerprint === fingerprint &&
      new Date(latestToken.expires_at).getTime() > Date.now()
    ) {
      return jsonResponse({ emailSent: true, duplicateSuppressed: true });
    }

    await adminClient
      .from("training_record_acknowledgement_tokens")
      .update({ superseded_at: new Date().toISOString() })
      .eq("training_record_id", record.id)
      .is("used_at", null)
      .is("superseded_at", null);

    const rawToken = createRawToken();
    const tokenHash = await sha256Hex(rawToken);
    const siteUrl = (Deno.env.get("SITE_URL") || "https://portal.bendigoflyingclub.com.au").replace(/\/$/, "");
    const acknowledgementUrl = `${siteUrl}/lesson-acknowledgement?token=${encodeURIComponent(rawToken)}`;
    const isRevision = Array.isArray(record.audit_log) && record.audit_log.some((entry: Record<string, unknown>) =>
      entry?.action === "record_updated" || entry?.action === "record_revised_after_student_acknowledgement"
    );

    const { data: tokenRow, error: tokenError } = await adminClient
      .from("training_record_acknowledgement_tokens")
      .insert({
        training_record_id: record.id,
        student_id: record.student_id,
        token_hash: tokenHash,
        recipient_email: student.email,
        created_by: callerUser.id,
        metadata: { recordFingerprint: fingerprint, isRevision, lessonTitle },
      })
      .select("id")
      .single();
    if (tokenError) return jsonResponse({ error: tokenError.message }, 500);

    const message = renderTrainingRecordAcknowledgementEmail({
      studentName: student.name || "Student",
      instructorName: instructor?.name || "Your instructor",
      courseTitle: course?.title || "Flight training",
      lessonTitle,
      lessonDate: formatDate(record.date),
      acknowledgementUrl,
      isRevision,
    });
    const apiKey = Deno.env.get("BREVO_API_KEY");
    if (!apiKey) {
      await adminClient.from("training_record_acknowledgement_tokens")
        .update({ send_error: "BREVO_API_KEY is not configured" }).eq("id", tokenRow.id);
      return jsonResponse({ error: "Email delivery is not configured" }, 503);
    }

    const emailResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: {
          email: Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@bendigoflyingclub.com.au",
          name: Deno.env.get("BREVO_SENDER_NAME") || "Bendigo Flying Club",
        },
        to: [{ email: student.email, name: student.name || student.email }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
    });
    const deliveryError = emailResponse.ok ? null : (await emailResponse.text()) || `Brevo email failed with ${emailResponse.status}`;
    await adminClient.from("training_record_acknowledgement_tokens").update({
      sent_at: emailResponse.ok ? new Date().toISOString() : null,
      send_error: deliveryError,
    }).eq("id", tokenRow.id);
    if (!emailResponse.ok) return jsonResponse({ error: "The lesson was saved, but its acknowledgement email could not be sent" }, 502);

    return jsonResponse({ emailSent: true, emailTo: student.email });
  } catch (error) {
    console.error("send-training-record-acknowledgement failed", error);
    return jsonResponse({ error: "The lesson acknowledgement email could not be sent" }, 500);
  }
});
