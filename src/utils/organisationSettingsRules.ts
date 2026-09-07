export interface OrganisationSettingsDraft {
  clubName: string;
  contactEmail: string;
  website: string;
  studentPortalUrl: string;
  bookingDayStart: string;
  bookingDayEnd: string;
  defaultSlotLength: number;
  guestReviewRequestsEnabled?: boolean;
  googleReviewUrl?: string;
  guestReviewDelayMinutes?: number;
  guestReviewPrivateFeedbackEmail?: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isHttpUrl = (value: string) => {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

export const getOrganisationSettingsValidationError = (
  settings: OrganisationSettingsDraft,
) => {
  if (!settings.clubName.trim()) return 'Business name is required.';
  if (settings.contactEmail.trim() && !emailPattern.test(settings.contactEmail.trim())) {
    return 'Enter a valid contact email address.';
  }
  if (!isHttpUrl(settings.website)) return 'Website URL must start with http:// or https://.';
  if (!isHttpUrl(settings.studentPortalUrl)) return 'Student Portal URL must start with http:// or https://.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.bookingDayStart)) return 'Choose a valid booking-day start time.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.bookingDayEnd)) return 'Choose a valid booking-day end time.';
  if (settings.bookingDayStart >= settings.bookingDayEnd) return 'Booking Day End must be later than Booking Day Start.';
  if (![15, 30, 60, 90].includes(settings.defaultSlotLength)) return 'Choose a supported default slot length.';
  const reviewUrl = settings.googleReviewUrl?.trim() || '';
  if (settings.guestReviewRequestsEnabled && !reviewUrl) {
    return 'Add the Google review link before enabling guest review requests.';
  }
  if (reviewUrl && !isSecureGoogleReviewUrl(reviewUrl)) {
    return 'Enter a secure Google review link from google.com, g.page or maps.app.goo.gl.';
  }
  const feedbackEmail = settings.guestReviewPrivateFeedbackEmail?.trim() || '';
  if (feedbackEmail && !emailPattern.test(feedbackEmail)) {
    return 'Enter a valid private feedback email address.';
  }
  const delay = settings.guestReviewDelayMinutes ?? 120;
  if (!Number.isInteger(delay) || delay < 0 || delay > 10_080) {
    return 'Guest review delay must be between 0 minutes and 7 days.';
  }
  return null;
};

export const isSecureGoogleReviewUrl = (value: string) => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return false;
    const hostname = url.hostname.toLowerCase();
    return hostname === 'google.com'
      || hostname.endsWith('.google.com')
      || hostname === 'g.page'
      || hostname.endsWith('.g.page')
      || hostname === 'maps.app.goo.gl'
      || hostname === 'goo.gl';
  } catch {
    return false;
  }
};
