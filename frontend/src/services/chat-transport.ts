import { getAuthAdapter } from "#/services/runtime";

export function getChatStreamApi(chatId: string): string {
  return `/api/chats/${chatId}/stream`;
}

export async function getChatTransportHeaders(): Promise<Record<string, string>> {
  const auth = await getAuthAdapter();
  return await auth.getAuthorizationHeaders();
}

/**
 * Asks the backend to stop the active generation for this chat. The
 * browser-side abort no longer cancels server-side runs, so the stop
 * button must call this explicitly alongside the local `stop()`.
 */
export async function cancelChatStream(chatId: string): Promise<void> {
  try {
    await fetch(`/api/chats/${chatId}/cancel`, {
      method: "POST",
      headers: await getChatTransportHeaders(),
    });
  } catch {
    // Fire-and-forget: the local abort already stopped the UI.
  }
}
