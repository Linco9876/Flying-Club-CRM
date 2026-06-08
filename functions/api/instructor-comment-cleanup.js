const STAFF_ROLES = new Set(['admin', 'senior_instructor', 'instructor']);
const MODEL = '@cf/meta/llama-3.1-8b-instruct';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
    },
  });

const getBearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

const normaliseRoles = (...values) =>
  values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .map((role) => String(role).trim().toLowerCase());

const getAuthenticatedStaff = async (request, env) => {
  const token = getBearerToken(request);
  if (!token) return { error: 'Missing session token', status: 401 };
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return { error: 'Supabase environment is not configured', status: 500 };

  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
    },
  });

  if (!authResponse.ok) return { error: 'Invalid session token', status: 401 };
  const authUser = await authResponse.json();
  const headers = {
    apikey: env.SUPABASE_ANON_KEY,
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  const [profileResponse, rolesResponse] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/users?id=eq.${authUser.id}&select=role,roles`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${authUser.id}&select=role`, { headers }),
  ]);

  const profileRows = profileResponse.ok ? await profileResponse.json() : [];
  const roleRows = rolesResponse.ok ? await rolesResponse.json() : [];
  const roles = normaliseRoles(profileRows[0]?.role, profileRows[0]?.roles, roleRows.map((row) => row.role));

  if (!roles.some((role) => STAFF_ROLES.has(role))) {
    return { error: 'Only instructors and admins can use comment cleanup', status: 403 };
  }

  return { user: authUser, roles };
};

const cleanContext = (value) =>
  String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);

const normaliseForLength = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const originalWordCount = (value) => normaliseForLength(value).split(/\s+/).filter(Boolean).length;

const cleanedRewrite = (value) =>
  String(value || '')
    .replace(/^["']|["']$/g, '')
    .replace(/^rewritten comment:\s*/i, '')
    .trim();

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
    },
  });

export const onRequestPost = async ({ request, env }) => {
  try {
    const staff = await getAuthenticatedStaff(request, env);
    if (staff.error) return json({ error: staff.error }, staff.status);
    if (!env.AI) return json({ error: 'Cloudflare Workers AI binding "AI" is not configured' }, 500);

    const body = await request.json().catch(() => null);
    const comment = String(body?.comment || '').trim();
    if (comment.length < 12) return json({ error: 'Write a little more before using AI cleanup.' }, 400);
    if (comment.length > 4000) return json({ error: 'Comment is too long for a quick cleanup. Please shorten it first.' }, 400);

    const context = body?.context || {};
    const contextLines = [
      ['Student', context.studentName],
      ['Lesson', context.lessonName || context.lessonCode],
      ['Course', context.courseName],
      ['Aircraft', context.aircraft],
      ['Flight date', context.date],
    ]
      .map(([label, value]) => `${label}: ${cleanContext(value) || 'Not supplied'}`)
      .join('\n');

    const sourceWordCount = originalWordCount(comment);
    const targetWordLimit = Math.max(sourceWordCount + 10, Math.ceil(sourceWordCount * 1.35));

    const prompt = [
      'You are assisting a Bendigo Flying Club flight instructor by lightly copy-editing student training record comments.',
      'This is a cleanup task, not an assessment-writing task.',
      '',
      'Strict rules:',
      '- Stay very close to the original wording and meaning.',
      '- Keep it concise. Do not make it longer unless needed for grammar.',
      `- Maximum ${targetWordLimit} words.`,
      '- Do not add examples, causes, consequences, recommendations, new weaknesses, new strengths, exercises, grades, safety concerns, or deviations unless they are explicitly stated in the original comment.',
      '- Do not turn praise into criticism.',
      '- Do not add “however”, “to improve”, “should focus”, or similar coaching unless the original comment already says that.',
      '- Fix grammar, spelling, punctuation, flow, and professional tone only.',
      '- Use Australian English.',
      '- Return only the rewritten comment, with no heading, markdown, or explanation.',
      '',
      'Example:',
      'Original: Very light on controls and had a great understanding of the fundamentals of flight',
      'Good rewrite: Very light on the controls and showed a great understanding of the fundamentals of flight.',
      'Bad rewrite: Any version that invents minor deviations, pitch/roll problems, or extra next steps.',
      '',
      'Training context:',
      contextLines,
      '',
      'Original instructor comment:',
      comment,
    ].join('\n');

    const result = await env.AI.run(MODEL, {
      messages: [
        {
          role: 'system',
          content: 'You are a conservative copy editor for flight training comments. Preserve facts exactly. Never add unmentioned issues, recommendations, or details.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 180,
      temperature: 0.1,
    });

    const rewritten = cleanedRewrite(result?.response || result?.result?.response || result?.text || '');
    if (!rewritten) return json({ error: 'AI did not return a usable comment. Please try again.' }, 502);

    const rewrittenWordCount = originalWordCount(rewritten);
    const tooLong = rewrittenWordCount > targetWordLimit + 5;
    const inventedCoaching = /\b(however|to improve|should focus|minor deviations|desired flight path|pitch and roll|more stable|controlled flight path)\b/i.test(rewritten)
      && !/\b(however|to improve|should focus|minor deviations|desired flight path|pitch and roll|more stable|controlled flight path)\b/i.test(comment);

    if (tooLong || inventedCoaching) {
      return json({
        error: 'AI rewrite changed the meaning too much. Please try a shorter comment or edit manually.',
      }, 422);
    }

    return json({
      rewrittenComment: rewritten,
      model: MODEL,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Comment cleanup failed' }, 500);
  }
};
