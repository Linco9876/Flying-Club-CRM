const STAFF_ROLES = new Set(['admin', 'senior_instructor', 'instructor']);
const MODEL = '@cf/meta/llama-3.2-3b-instruct';

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

const sentenceCount = (value) => {
  const text = normaliseForLength(value);
  if (!text) return 0;
  const punctuated = text.match(/[.!?]+(\s|$)/g)?.length || 0;
  if (punctuated > 0) return punctuated;
  return text.split(/\n+/).filter(Boolean).length || 1;
};

const lightlyCleanOriginal = (value) => {
  const cleaned = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
  if (!cleaned) return '';
  const capitalised = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
};

const cleanedRewrite = (value) =>
  String(value || '')
    .replace(/^["']|["']$/g, '')
    .replace(/^rewritten comment:\s*/i, '')
    .trim();

const normaliseMode = (value) => value === 'readability' ? 'readability' : 'grammar';

const buildPrompt = ({ mode, targetWordLimit, contextLines, comment }) => {
  const isReadability = mode === 'readability';
  const taskLine = isReadability
    ? 'Make the comment a little easier to read while staying short and faithful.'
    : 'Lightly copy-edit the comment for grammar, spelling, punctuation, and professional tone only.';
  const modeRules = isReadability
    ? [
        '- Keep the same broad structure as the original comment.',
        '- You may lightly reorder words for clarity, but keep the same facts and tone.',
        '- If the original is already clear, only fix grammar and punctuation.',
      ]
    : [
        '- Stay very close to the original wording and sentence structure.',
        '- Do not change the style unless needed for grammar.',
      ];

  return [
    'You are assisting a Bendigo Flying Club flight instructor with student training record comments.',
    'This is a comment editing task, not an assessment-writing task.',
    taskLine,
    '',
    'Strict rules:',
    '- Preserve the original meaning exactly.',
    '- Preserve the original sentiment exactly.',
    '- Preserve the original level of detail exactly.',
    '- Preserve every observation from the original.',
    '- Do not summarise the comment.',
    '- Do not remove sentences or reduce a multi-point comment to one point.',
    '- Return the final comment as one paragraph unless the original clearly uses headings or bullet points.',
    '- Keep it concise. Do not bloat the comment.',
    `- Maximum ${targetWordLimit} words.`,
    '- Do not invent or infer examples, causes, consequences, recommendations, new weaknesses, new strengths, exercises, grades, safety concerns, deviations, or next steps.',
    '- Do not turn praise into criticism.',
    '- Do not insert the student name unless the original comment includes it.',
    '- Do not add "however", "to improve", "should focus", or similar coaching unless the original comment already says that.',
    '- Use Australian English.',
    '- Return only the rewritten comment, with no heading, markdown, or explanation.',
    ...modeRules,
    '',
    'Example:',
    'Original: Very light on controls and had a great understanding of the fundamentals of flight',
    isReadability
      ? 'Good rewrite: Very light on the controls and showed a great understanding of the fundamentals of flight.'
      : 'Good rewrite: Very light on the controls and showed a great understanding of the fundamentals of flight.',
    'Bad rewrite: Any version that invents minor deviations, pitch/roll problems, or extra next steps.',
    '',
    'Training context:',
    contextLines,
    '',
    'Original instructor comment:',
    comment,
  ].join('\n');
};

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
    const mode = normaliseMode(body?.mode);
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
    const sourceSentenceCount = sentenceCount(comment);
    const targetWordLimit = mode === 'readability'
      ? Math.max(sourceWordCount + 12, Math.ceil(sourceWordCount * 1.25))
      : Math.max(sourceWordCount + 10, Math.ceil(sourceWordCount * 1.2));
    const prompt = buildPrompt({ mode, targetWordLimit, contextLines, comment });

    const result = await env.AI.run(MODEL, {
      messages: [
        {
          role: 'system',
          content: 'You are a conservative copy editor for flight training comments. Preserve facts exactly. Never add unmentioned issues, recommendations, or details.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: Math.min(260, Math.max(120, Math.ceil(sourceWordCount * 2.4))),
      temperature: 0,
    });

    const rewritten = cleanedRewrite(result?.response || result?.result?.response || result?.text || '');
    const fallbackRewrite = lightlyCleanOriginal(comment);
    if (!rewritten) {
      return json({
        rewrittenComment: fallbackRewrite,
        model: MODEL,
        mode,
        usedFallback: true,
      });
    }

    const rewrittenWordCount = originalWordCount(rewritten);
    const tooLong = rewrittenWordCount > targetWordLimit;
    const tooShort = sourceWordCount >= 25 && rewrittenWordCount < Math.ceil(sourceWordCount * 0.72);
    const lostSentenceStructure = sourceSentenceCount >= 3 && sentenceCount(rewritten) < Math.max(2, Math.ceil(sourceSentenceCount * 0.6));
    const inventedCoaching = /\b(however|to improve|should focus|minor deviations|desired flight path|pitch and roll|more stable|controlled flight path)\b/i.test(rewritten)
      && !/\b(however|to improve|should focus|minor deviations|desired flight path|pitch and roll|more stable|controlled flight path)\b/i.test(comment);

    if (tooLong || tooShort || lostSentenceStructure || inventedCoaching) {
      return json({
        rewrittenComment: fallbackRewrite,
        model: MODEL,
        mode,
        usedFallback: true,
        fallbackReason: tooLong
          ? 'rewrite_too_long'
          : tooShort || lostSentenceStructure
            ? 'rewrite_dropped_detail'
            : 'meaning_guardrail',
      });
    }

    return json({
      rewrittenComment: rewritten,
      model: MODEL,
      mode,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Comment cleanup failed' }, 500);
  }
};
