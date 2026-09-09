export const promotionErrorMessage = (error: unknown): string => {
  if (error && typeof error === "object" && "message" in error
    && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return "The casual contact could not be promoted";
};
