import type {
  BookingCancellationReason,
  BookingCancellationReasonInput,
} from '../hooks/useBookingCancellationReasons';

export const getCancellationReasonValidationError = (
  input: BookingCancellationReasonInput,
  existingReasons: BookingCancellationReason[],
  editingId?: string | null,
) => {
  const name = input.name.trim();
  if (!name) return 'Enter a cancellation reason name.';
  if (name.length > 100) return 'Cancellation reason names must be 100 characters or fewer.';
  if ((input.description?.trim().length || 0) > 500) return 'Cancellation reason descriptions must be 500 characters or fewer.';
  if (existingReasons.some(reason => reason.id !== editingId && reason.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    return 'A cancellation reason with this name already exists.';
  }
  if (input.feeType !== 'none' && (!Number.isFinite(input.feeAmount) || input.feeAmount < 0)) {
    return 'Enter a valid fee amount of zero or more.';
  }
  if (!Number.isInteger(input.displayOrder) || input.displayOrder < 0) {
    return 'Cancellation reason order must be a whole number of zero or more.';
  }
  return null;
};
