/**
 * OPFS Worker — Protocol Types
 *
 * Tipos compartidos entre el Worker y el cliente proxy.
 */
import type { ChatRecord } from "@/utils/opfs";

export type OpfsRequest =
  | { reqId: string; type: "list-chats" }
  | { reqId: string; type: "get-chat"; chatId: string }
  | { reqId: string; type: "get-stored-chat"; chatId: string }
  | { reqId: string; type: "save-chat"; chat: ChatRecord }
  | { reqId: string; type: "delete-chat"; chatId: string }
  | { reqId: string; type: "delete-all-chats" }
  | {
      reqId: string;
      type: "save-attachment";
      chatId: string;
      file: File;
      attachmentId?: string;
    }
  | {
      reqId: string;
      type: "get-attachment-base64";
      chatId: string;
      attachmentId: string;
    }
  | {
      reqId: string;
      type: "get-attachment-data-url";
      chatId: string;
      attachmentId: string;
    }
  | { reqId: string; type: "revoke-object-urls"; chatId: string };

export type OpfsResponse<T = unknown> =
  | { reqId: string; ok: true; result: T }
  | { reqId: string; ok: false; error: string };
