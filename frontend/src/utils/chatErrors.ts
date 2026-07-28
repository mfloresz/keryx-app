export function getUserFacingChatError(
  message: string | null | undefined,
  _t: (key: string) => string,
): string {
  return message || "Failed to process request";
}
