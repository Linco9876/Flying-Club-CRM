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

export const cleanupInstructorComment = async (
  comment: string,
  context: CommentCleanupContext = {},
  mode: CommentCleanupMode = 'grammar'
) => {
  const endpoint = import.meta.env.VITE_COMMENT_CLEANUP_ENDPOINT || '/api/instructor-comment-cleanup';
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

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'AI comment cleanup failed.');
  }

  return String(payload.rewrittenComment || '').trim();
};
