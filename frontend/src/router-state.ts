import "@tanstack/history";

/**
 * State carried across a navigation.
 *
 * The new-chat screen creates the chat and persists the first user message
 * before navigating, so the conversation route needs to know that a message
 * is waiting to be streamed. Passing it through the router state keeps the
 * message out of the URL.
 */
declare module "@tanstack/history" {
  interface HistoryState {
    /** Text of a message sent from the new-chat screen. */
    pendingText?: string;
    /** Whether web search was toggled on for that message. */
    pendingWebSearch?: boolean;
    /** Persisted attachment parts for that message. */
    pendingFiles?: unknown[];
    /** Skills pinned for that message (next-message-only scope). */
    pendingPinnedSkills?: string[];
  }
}

export {};
