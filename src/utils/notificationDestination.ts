export interface NotificationDestinationInput {
  type: string;
  bookingId?: string;
  metadata?: Record<string, string>;
}

export interface NotificationViewer {
  id?: string;
  role?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ROUTE_PREFIXES = [
  '/aircraft',
  '/billing',
  '/calendar',
  '/documents',
  '/duty',
  '/financial-dashboard',
  '/gift-vouchers',
  '/learning-centre',
  '/maintenance',
  '/membership',
  '/my-logbook',
  '/pilot-file',
  '/profile',
  '/reports',
  '/safety',
  '/settings',
  '/students',
  '/training',
];

const isUuid = (value: string | undefined): value is string =>
  Boolean(value && UUID_PATTERN.test(value));

const encodeQuery = (value: string) => encodeURIComponent(value);

export const getSafeNotificationRoute = (route: string | undefined): string | null => {
  if (!route || !route.startsWith('/') || route.startsWith('//')) return null;

  try {
    const parsed = new URL(route, 'https://portal.bendigoflyingclub.com.au');
    const isAllowedPath = ALLOWED_ROUTE_PREFIXES.some((prefix) =>
      parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
    );

    if (parsed.origin !== 'https://portal.bendigoflyingclub.com.au' || !isAllowedPath) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
};

export const getNotificationDestination = (
  notification: NotificationDestinationInput,
  viewer: NotificationViewer = {}
): string | null => {
  const metadata = notification.metadata ?? {};

  if (
    notification.type === 'licence_verification' &&
    isUuid(metadata.student_id) &&
    isUuid(metadata.licence_id)
  ) {
    return `/students/${metadata.student_id}?tab=profile&action=review-licence&licenceId=${metadata.licence_id}`;
  }

  if (notification.type === 'training_record' && isUuid(metadata.student_id)) {
    const isOwnStudentRecord =
      (viewer.role === 'student' || viewer.role === 'pilot') &&
      metadata.student_id === viewer.id;

    return isOwnStudentRecord
      ? '/profile?tab=training'
      : `/students/${metadata.student_id}?tab=training`;
  }

  if (notification.type === 'booking_approval' && isUuid(metadata.booking_id)) {
    return `/calendar?view=list&bookingId=${encodeQuery(metadata.booking_id)}`;
  }

  if (
    notification.type === 'duty_auto_started' ||
    notification.type === 'duty_auto_closed'
  ) {
    return '/duty';
  }

  const bookingId = metadata.booking_id || notification.bookingId;
  if (isUuid(bookingId)) {
    return `/calendar?view=list&bookingId=${encodeQuery(bookingId)}`;
  }

  return getSafeNotificationRoute(metadata.route);
};
