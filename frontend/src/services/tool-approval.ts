/**
 * Answers a pending tool approval.
 *
 * The backend blocks the chat stream while a mutating tool (write_file,
 * edit_file) waits for the user's consent. This call releases the stream.
 */
import { getAuthAdapter } from "#/services/runtime";

export async function respondToToolApproval(
  chatId: string,
  payload: { approvalId: string; approved: boolean; reason?: string },
): Promise<void> {
  const auth = await getAuthAdapter();
  const headers = await auth.getAuthorizationHeaders();

  const response = await fetch(`/api/chats/${chatId}/tool-approval`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Failed to answer the approval (${response.status})`);
  }
}
