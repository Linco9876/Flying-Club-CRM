export const canEditLogbookNotes = (
  signedInUserId: string | null | undefined,
  logbookOwnerId: string | null | undefined,
) => Boolean(signedInUserId && logbookOwnerId && signedInUserId === logbookOwnerId);
