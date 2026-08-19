import type { User } from '../types';

export const PORTAL_FEEDBACK_RECIPIENT_LABEL = 'Lincoln';
export const PORTAL_FEEDBACK_MIN_COMMENT_LENGTH = 5;
export const PORTAL_FEEDBACK_MAX_COMMENT_LENGTH = 4000;
export const PORTAL_FEEDBACK_MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

export type PortalFeedbackCategory = 'bug' | 'improvement' | 'other';

export const canAccessPortalFeedback = (user: User | null) => {
  if (!user || user.isActive === false) return false;
  const roles = user.roles?.length ? user.roles : [user.role];
  return roles.some(role => ['admin', 'cfi', 'senior_instructor', 'instructor'].includes(role));
};

export const validatePortalFeedbackComment = (value: unknown) => {
  const comment = String(value ?? '').trim();
  if (comment.length < PORTAL_FEEDBACK_MIN_COMMENT_LENGTH) {
    return `Add at least ${PORTAL_FEEDBACK_MIN_COMMENT_LENGTH} characters so Lincoln knows what to look at.`;
  }
  if (comment.length > PORTAL_FEEDBACK_MAX_COMMENT_LENGTH) {
    return `Keep the comment under ${PORTAL_FEEDBACK_MAX_COMMENT_LENGTH.toLocaleString()} characters.`;
  }
  return null;
};

export const estimateDataUrlBytes = (dataUrl: string) => {
  const separatorIndex = dataUrl.indexOf(',');
  if (separatorIndex < 0) return 0;
  const encoded = dataUrl.slice(separatorIndex + 1).replace(/\s/g, '');
  if (!encoded) return 0;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding);
};

export const formatFeedbackFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const createPortalFeedbackSubmissionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};
