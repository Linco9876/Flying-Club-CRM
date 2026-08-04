import { supabase } from '../lib/supabase';
import { withCommentCleanupSessionRetry } from './commentCleanupSession';
import type { CommentCleanupContext } from './commentCleanupContext';

export type { CommentCleanupContext } from './commentCleanupContext';

export type CommentCleanupMode = 'grammar' | 'readability';

export interface CommentCleanupResult {
  rewrittenComment: string;
  usedFallback: boolean;
  fallbackReason?: string;
}

const REQUEST_TIMEOUT_MS = 25_000;

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
  const requestRewrite = async (token: string) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ comment, context, mode }),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }
  };

  let response: Response;
  try {
    response = await withCommentCleanupSessionRetry(supabase.auth, requestRewrite);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('AI Rewrite took too long to respond. Please try again.', { cause: error });
    }
    if (error instanceof TypeError && /fetch|network|load/i.test(error.message)) {
      throw new Error('AI Rewrite could not be reached. Check your connection and try again.', { cause: error });
    }
    throw error;
  }

  const responseText = await response.text().catch(() => '');
  let payload: {
    code?: string;
    error?: string;
    rewrittenComment?: string;
    usedFallback?: boolean;
    fallbackReason?: string;
  } = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Your session has expired. Refresh the page or sign in again to use AI Rewrite.');
    }
    if (response.status === 429) {
      throw new Error('AI Rewrite is busy. Wait a moment and try again.');
    }
    const detail = payload.error || responseText.trim();
    throw new Error(detail || `AI comment cleanup failed (${response.status}).`);
  }

  const rewrittenComment = String(payload.rewrittenComment || '').trim();
  if (!rewrittenComment) {
    throw new Error('AI Rewrite returned an empty comment. Your original comment has not been changed.');
  }

  return {
    rewrittenComment,
    usedFallback: Boolean(payload.usedFallback),
    fallbackReason: payload.fallbackReason,
  } satisfies CommentCleanupResult;
};
