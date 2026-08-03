export const PROFILE_PICTURE_BUCKET = 'user-avatars';

const publicObjectMarker = `/storage/v1/object/public/${PROFILE_PICTURE_BUCKET}/`;

export const profilePictureSettingsDestination =
  '/settings?tab=account-info&accountTab=info&focus=profile-photo#account-profile-photo';

/**
 * Returns the object path only for a portal-managed image owned by the user.
 * External/legacy URLs are deliberately ignored so cleanup can never delete
 * another user's object or an unrelated storage object.
 */
export const managedProfilePicturePath = (
  publicUrl: string | null | undefined,
  ownerUserId: string,
): string | null => {
  if (!publicUrl || !ownerUserId) return null;

  try {
    const pathname = new URL(publicUrl).pathname;
    const markerIndex = pathname.indexOf(publicObjectMarker);
    if (markerIndex < 0) return null;

    const encodedPath = pathname.slice(markerIndex + publicObjectMarker.length);
    const objectPath = decodeURIComponent(encodedPath);
    if (!objectPath.startsWith(`${ownerUserId}/`)) return null;
    if (objectPath.includes('..') || objectPath.includes('\\')) return null;
    return objectPath;
  } catch {
    return null;
  }
};
