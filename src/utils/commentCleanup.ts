import { supabase } from '../lib/supabase';

export interface CommentCleanupContext {
  studentName?: string;
  lessonName?: string;
  lessonCode?: string;
  courseName?: string;
  aircraft?: string;
  date?: string;
}

export type CommentCleanupMode = 'grammar' | 'readability';

const getCommentCleanupEndpoint = () => {
  const configuredEndpoint = import.meta.env.VITE_COMMENT_CLEANUP_ENDPOINT;
  if (configuredEndpoint) return configuredEndpoint;

  if (
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname)
  ) {
    return 'https://portal.bendigoflyingclub.com.au/api/instructor-comment-cleanup';
  }

  return '/api/instructor-comment-cleanup';
};

export const cleanupInstructorComment = async (
  comment: string,
  context: CommentCleanupContext = {},
  mode: CommentCleanupMode = 'grammar'
) => {
  const endpoint = getCommentCleanupEndpoint();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('You need to be signed in to use AI comment cleanup.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ comment, context, mode }),
  });

  const responseText = await response.text();
  let payload: { error?: string; rewrittenComment?: string } = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const detail = payload.error || responseText.trim();
    throw new Error(detail || `AI comment cleanup failed (${response.status}).`);
  }

  return String(payload.rewrittenComment || '').trim();
};
