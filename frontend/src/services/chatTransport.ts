import { IS_CLOUD_MODE } from "@/app/config";
import { getAuthAdapter } from "./runtime";

export function getChatStreamApi(chatId: string): string {
  return IS_CLOUD_MODE ? `/api/chats/${chatId}/stream` : `/api/chats/${chatId}`;
}

export async function getChatTransportHeaders(): Promise<Record<string, string>> {
  const auth = await getAuthAdapter();
  return await auth.getAuthorizationHeaders();
}
