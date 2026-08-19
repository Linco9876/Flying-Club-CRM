export interface OrganisationSettingsDraft {
  clubName: string;
  contactEmail: string;
  website: string;
  studentPortalUrl: string;
  bookingDayStart: string;
  bookingDayEnd: string;
  defaultSlotLength: number;
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
  return null;
};
