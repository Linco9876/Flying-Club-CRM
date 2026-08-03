export const SETTINGS_FOCUS_TARGETS = {
  'personal-details': {
    elementId: 'account-personal-details',
    label: 'Personal Details',
  },
  'profile-photo': {
    elementId: 'account-profile-photo',
    label: 'Profile Photo',
  },
  'aviation-credentials': {
    elementId: 'account-aviation-credentials',
    label: 'Aviation Credentials',
  },
  'contact-details': {
    elementId: 'account-contact-details',
    label: 'Contact Details',
  },
  'emergency-contact': {
    elementId: 'account-emergency-contact',
    label: 'Emergency Contact',
  },
  licences: {
    elementId: 'account-licences',
    label: 'Licences',
  },
  endorsements: {
    elementId: 'account-endorsements',
    label: 'Endorsements',
  },
} as const;

export type SettingsFocus = keyof typeof SETTINGS_FOCUS_TARGETS;

export interface SettingsDeepLink {
  sectionId: string | null;
  focus: SettingsFocus | null;
  focusElementId: string | null;
  focusLabel: string | null;
}

const isSettingsFocus = (value: string | null): value is SettingsFocus =>
  Boolean(value && Object.hasOwn(SETTINGS_FOCUS_TARGETS, value));

export const parseSettingsDeepLink = (
  search: string,
  hash = '',
): SettingsDeepLink => {
  const params = new URLSearchParams(search);
  const requestedFocus = params.get('focus');
  const hashElementId = decodeURIComponent(hash.replace(/^#/, ''));
  const hashFocus = Object.entries(SETTINGS_FOCUS_TARGETS)
    .find(([, target]) => target.elementId === hashElementId)?.[0] || null;
  const focus = isSettingsFocus(requestedFocus)
    ? requestedFocus
    : isSettingsFocus(hashFocus)
      ? hashFocus
      : null;
  const target = focus ? SETTINGS_FOCUS_TARGETS[focus] : null;

  return {
    sectionId: params.get('tab') || params.get('section') || (focus ? 'account-info' : null),
    focus,
    focusElementId: target?.elementId || null,
    focusLabel: target?.label || null,
  };
};
