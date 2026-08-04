export interface CommentCleanupSession {
  access_token: string;
  expires_at?: number;
}

interface AuthResult {
  data: { session: CommentCleanupSession | null };
  error: { message?: string } | null;
}

export interface CommentCleanupAuth {
  getSession: () => Promise<AuthResult>;
  refreshSession: () => Promise<AuthResult>;
}

const SESSION_REFRESH_SKEW_SECONDS = 90;
const SIGN_IN_MESSAGE = 'Your session has expired. Refresh the page or sign in again to use AI Rewrite.';

let activeRefresh: Promise<CommentCleanupSession | null> | null = null;

export const commentCleanupSessionNeedsRefresh = (
  session: CommentCleanupSession,
  nowSeconds = Math.floor(Date.now() / 1000),
) => !session.expires_at || session.expires_at <= nowSeconds + SESSION_REFRESH_SKEW_SECONDS;

const refreshCommentCleanupSession = async (auth: CommentCleanupAuth) => {
  if (!activeRefresh) {
    const refresh = auth.refreshSession()
      .then(({ data, error }) => {
        if (error || !data.session?.access_token) return null;
        return data.session;
      })
      .catch(() => null);

    activeRefresh = refresh;
    void refresh.then(
      () => {
        if (activeRefresh === refresh) activeRefresh = null;
      },
      () => {
        if (activeRefresh === refresh) activeRefresh = null;
      },
    );
  }

  return activeRefresh;
};
export const getCommentCleanupAccessToken = async (
  auth: CommentCleanupAuth,
  options: { forceRefresh?: boolean; nowSeconds?: number } = {},
) => {
  const { data, error } = await auth.getSession().catch(() => ({
    data: { session: null },
    error: { message: 'Unable to read the current session' },
  }));
  const session = data.session;

  if (error || !session?.access_token) {
    throw new Error(SIGN_IN_MESSAGE);
  }

  if (
    !options.forceRefresh
    && !commentCleanupSessionNeedsRefresh(session, options.nowSeconds)
  ) {
    return session.access_token;
  }

  const refreshed = await refreshCommentCleanupSession(auth);
  if (!refreshed?.access_token) {
    throw new Error(SIGN_IN_MESSAGE);
  }

  return refreshed.access_token;
};

export const withCommentCleanupSessionRetry = async <T extends { status: number }>(
  auth: CommentCleanupAuth,
  request: (accessToken: string) => Promise<T>,
) => {
  const accessToken = await getCommentCleanupAccessToken(auth);
  const response = await request(accessToken);
  if (response.status !== 401) return response;

  const refreshedToken = await getCommentCleanupAccessToken(auth, { forceRefresh: true });
  return request(refreshedToken);
};
