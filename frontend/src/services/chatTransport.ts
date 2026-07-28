import { getAuthAdapter } from "./runtime";

export function getChatStreamApi(chatId: string): string {
  return `/api/chats/${chatId}/stream`;
}

export async function getChatTransportHeaders(): Promise<Record<string, string>> {
  const auth = await getAuthAdapter();
  return await auth.getAuthorizationHeaders();
}
