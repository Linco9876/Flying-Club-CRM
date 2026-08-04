import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commentCleanupSessionNeedsRefresh,
  getCommentCleanupAccessToken,
  withCommentCleanupSessionRetry,
  type CommentCleanupAuth,
} from './commentCleanupSession.ts';

const authWith = ({
  currentToken = 'current-token',
  currentExpiry = 2_000,
  refreshedToken = 'refreshed-token',
  refreshError = false,
} = {}) => {
  let refreshCalls = 0;
  const auth: CommentCleanupAuth = {
    getSession: async () => ({
      data: {
        session: currentToken
          ? { access_token: currentToken, expires_at: currentExpiry }
          : null,
      },
      error: null,
    }),
    refreshSession: async () => {
      refreshCalls += 1;
      return {
        data: {
          session: refreshError ? null : { access_token: refreshedToken, expires_at: 4_000 },
        },
        error: refreshError ? { message: 'refresh failed' } : null,
      };
    },
  };

  return { auth, getRefreshCalls: () => refreshCalls };
};

test('a healthy session token is reused without an unnecessary refresh', async () => {
  const { auth, getRefreshCalls } = authWith();

  const token = await getCommentCleanupAccessToken(auth, { nowSeconds: 1_000 });

  assert.equal(token, 'current-token');
  assert.equal(getRefreshCalls(), 0);
});

test('a token close to expiry is refreshed before AI Rewrite starts', async () => {
  const { auth, getRefreshCalls } = authWith({ currentExpiry: 1_050 });

  const token = await getCommentCleanupAccessToken(auth, { nowSeconds: 1_000 });

  assert.equal(token, 'refreshed-token');
  assert.equal(getRefreshCalls(), 1);
});

test('a 401 forces one refresh and retries exactly once', async () => {
  const { auth, getRefreshCalls } = authWith({
    currentExpiry: Math.floor(Date.now() / 1000) + 4_000,
  });
  const seenTokens: string[] = [];

  const response = await withCommentCleanupSessionRetry(auth, async (token) => {
    seenTokens.push(token);
    return { status: token === 'current-token' ? 401 : 200 };
  });

  assert.equal(response.status, 200);
  assert.deepEqual(seenTokens, ['current-token', 'refreshed-token']);
  assert.equal(getRefreshCalls(), 1);
});

test('a failed refresh returns a friendly sign-in action without provider details', async () => {
  const { auth } = authWith({ currentExpiry: 1_050, refreshError: true });

  await assert.rejects(
    () => getCommentCleanupAccessToken(auth, { nowSeconds: 1_000 }),
    /Refresh the page or sign in again to use AI Rewrite/,
  );
});

test('sessions without an expiry are refreshed defensively', () => {
  assert.equal(commentCleanupSessionNeedsRefresh({ access_token: 'token' }, 1_000), true);
});
