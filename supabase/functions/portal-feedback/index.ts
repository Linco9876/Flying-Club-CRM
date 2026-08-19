import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { brandPortalEmailHtml } from '../_shared/emailBranding.ts';
import { corsHeadersForRequest, isAllowedBrowserOrigin } from '../_shared/edgeSecurity.ts';
import { buildPortalFeedbackEmail, validatePortalFeedbackPayload } from '../_shared/portalFeedback.ts';

const FEEDBACK_RECIPIENT_EMAIL = 'lincoln@bbkm.com.au';
const FEEDBACK_RECIPIENT_NAME = 'Lincoln';
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_NEW_REPORTS = 5;

const clean = (value: unknown, maximum = Number.POSITIVE_INFINITY) =>
  String(value ?? '').trim().slice(0, maximum);

const json = (req: Request, body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' } },
);

const isStaffRole = (value: unknown) =>
  ['admin', 'cfi', 'instructor', 'senior_instructor'].includes(clean(value).toLowerCase());

const safeEmailError = (value: unknown) => clean(value, 1000) || 'Email provider rejected the message.';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeadersForRequest(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);
  if (!isAllowedBrowserOrigin(req)) return json(req, { error: 'This portal origin is not allowed.' }, 403);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json(req, { error: 'Feedback service is not configured.' }, 503);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const authHeader = clean(req.headers.get('Authorization'));
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(req, { error: 'Sign in before sending feedback.' }, 401);

    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      return json(req, { error: 'Your session has expired. Sign in again, then retry.' }, 401);
    }

    const userId = authData.user.id;
    const [{ data: profile, error: profileError }, { data: roleRows, error: rolesError }] = await Promise.all([
      adminClient.from('users').select('id,name,email,role,is_active').eq('id', userId).maybeSingle(),
      adminClient.from('user_roles').select('role').eq('user_id', userId),
    ]);
    if (profileError || rolesError) {
      console.error('Feedback staff verification failed', profileError || rolesError);
      return json(req, { error: 'Staff access could not be verified. Please retry.' }, 500);
    }
    const hasStaffAccess = profile?.is_active !== false && (
      isStaffRole(profile?.role) || (roleRows || []).some((row: { role?: unknown }) => isStaffRole(row.role))
    );
    if (!hasStaffAccess) return json(req, { error: 'Only active administrators and instructors can send portal feedback.' }, 403);

    let requestBody: unknown;
    try {
      requestBody = await req.json();
    } catch {
      return json(req, { error: 'Feedback details could not be read.' }, 400);
    }
    const validation = validatePortalFeedbackPayload(requestBody);
    if (!validation.ok) return json(req, { error: validation.error }, 400);
    const feedback = validation.value;

    const { data: existing, error: existingError } = await adminClient
      .from('portal_feedback_submissions')
      .select('id,submitted_by,email_status,created_at')
      .eq('id', feedback.submissionId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing && existing.submitted_by !== userId) {
      return json(req, { error: 'That feedback submission ID is already in use.' }, 409);
    }
    if (existing?.email_status === 'sent') {
      return json(req, { success: true, submissionId: feedback.submissionId, alreadySent: true });
    }
    if (existing?.email_status === 'pending') {
      const pendingAge = Date.now() - new Date(existing.created_at).getTime();
      if (pendingAge < 5 * 60 * 1000) {
        return json(req, { error: 'This feedback report is already being sent. Wait a moment before retrying.' }, 409);
      }
    }

    if (!existing) {
      const rateLimitStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
      const { count, error: countError } = await adminClient
        .from('portal_feedback_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('submitted_by', userId)
        .gte('created_at', rateLimitStart);
      if (countError) throw countError;
      if ((count || 0) >= RATE_LIMIT_MAX_NEW_REPORTS) {
        return json(req, { error: `You have sent several reports. Wait ${RATE_LIMIT_WINDOW_MINUTES} minutes, then try again.` }, 429);
      }
    }

    const record = {
      id: feedback.submissionId,
      submitted_by: userId,
      category: feedback.category,
      comment: feedback.comment,
      page_url: feedback.pageUrl,
      route: feedback.route,
      screenshot_bytes: feedback.screenshotBytes,
      screenshot_width: feedback.screenshotWidth,
      screenshot_height: feedback.screenshotHeight,
      screenshot_mime_type: feedback.screenshotMimeType,
      display_surface: feedback.displaySurface,
      viewport_width: feedback.viewportWidth,
      viewport_height: feedback.viewportHeight,
      user_agent: feedback.userAgent,
      client_submitted_at: feedback.submittedAt,
      email_status: 'pending',
      email_error: null,
      updated_at: new Date().toISOString(),
    };
    const recordResult = existing
      ? await adminClient.from('portal_feedback_submissions').update(record).eq('id', feedback.submissionId)
      : await adminClient.from('portal_feedback_submissions').insert(record);
    if (recordResult.error) throw recordResult.error;

    const reporterName = clean(profile?.name, 160) || clean(authData.user.user_metadata?.name, 160) || 'Portal staff member';
    const reporterEmail = clean(profile?.email, 320) || clean(authData.user.email, 320) || 'unknown@bendigoflyingclub.com.au';
    const { subject, html } = buildPortalFeedbackEmail({ feedback, reporterName, reporterEmail });
    const apiKey = Deno.env.get('BREVO_API_KEY');
    if (!apiKey) {
      await adminClient.from('portal_feedback_submissions').update({
        email_status: 'failed',
        email_error: 'BREVO_API_KEY is not configured',
        updated_at: new Date().toISOString(),
      }).eq('id', feedback.submissionId);
      return json(req, { error: 'Feedback email is temporarily unavailable. Your report was retained; please retry shortly.' }, 503);
    }

    const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL') || 'no-reply@bendigoflyingclub.com.au';
    const senderName = Deno.env.get('BREVO_SENDER_NAME') || 'Bendigo Flying Club';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: FEEDBACK_RECIPIENT_EMAIL, name: FEEDBACK_RECIPIENT_NAME }],
        replyTo: { email: reporterEmail, name: reporterName },
        subject,
        htmlContent: await brandPortalEmailHtml(html),
        attachment: [{
          content: feedback.screenshotContent,
          name: `bfc-portal-${feedback.category}-${timestamp}.${feedback.screenshotExtension}`,
        }],
        headers: { 'X-BFC-Feedback-ID': feedback.submissionId },
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      const providerError = safeEmailError(responseText || `Brevo returned HTTP ${response.status}`);
      await adminClient.from('portal_feedback_submissions').update({
        email_status: 'failed',
        email_error: providerError,
        updated_at: new Date().toISOString(),
      }).eq('id', feedback.submissionId);
      console.error('Portal feedback email failed', response.status, providerError);
      return json(req, { error: 'The report was saved, but its email could not be delivered. Please retry.' }, 502);
    }

    let providerMessageId: string | null = null;
    try {
      const providerBody = JSON.parse(responseText || '{}');
      providerMessageId = clean(providerBody?.messageId, 240) || null;
    } catch {
      // A successful provider response without JSON is still a successful delivery handoff.
    }
    const { error: updateError } = await adminClient.from('portal_feedback_submissions').update({
      email_status: 'sent',
      email_error: null,
      emailed_at: new Date().toISOString(),
      email_provider_message_id: providerMessageId,
      updated_at: new Date().toISOString(),
    }).eq('id', feedback.submissionId);
    if (updateError) console.error('Feedback delivery status update failed', updateError);

    return json(req, { success: true, submissionId: feedback.submissionId });
  } catch (error) {
    console.error('Portal feedback submission failed', error);
    return json(req, { error: 'Feedback could not be sent. Your screenshot and comment remain open so you can retry.' }, 500);
  }
});
