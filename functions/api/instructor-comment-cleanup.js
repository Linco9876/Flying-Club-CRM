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

    const prompt = [
      'You are assisting a Bendigo Flying Club flight instructor writing student training record comments.',
      'Rewrite the instructor comment so it is clear, professional, plain-English, and useful for a student file.',
      'Keep the original aviation meaning. Do not invent events, grades, exercises, incidents, achievements, risks, or medical details.',
      'Keep constructive critique, next steps, safety/airmanship points, and any stated weaknesses.',
      'Use Australian English. Return only the rewritten comment, with no heading, markdown, or explanation.',
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
          content: 'You rewrite flight training comments for a CRM. You preserve facts and never add unmentioned information.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 700,
    });

    const rewritten = String(result?.response || result?.result?.response || result?.text || '').trim();
    if (!rewritten) return json({ error: 'AI did not return a usable comment. Please try again.' }, 502);

    return json({
      rewrittenComment: rewritten.replace(/^["']|["']$/g, '').trim(),
      model: MODEL,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Comment cleanup failed' }, 500);
  }
};
