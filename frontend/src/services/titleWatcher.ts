/**
 * Title watcher: keeps the sidebar in sync with titles generated
 * server-side while a chat is streaming.
 *
 * When a stream finishes on the backend, a title may be generated
 * asynchronously (its own provider call). If the user has already navigated
 * away from that chat, nothing re-reads the title — until now. This module
 * polls the chats index and applies label changes to the Pinia store, so
 * "Untitled" becomes the real title without a page reload.
 */

import { getChatRepository } from '@/services/runtime'
import { useChatStore } from '@/stores/chat'

const POLL_INTERVAL_MS = 4000
const MAX_ATTEMPTS = 30 // ~2 minutes

/**
 * Watch a single chat's title until it changes from its current value.
 * Multiple concurrent watchers coexist safely; each stops as soon as the
 * chat disappears from the list or a real (non-"Untitled") title arrives.
 */
export function watchChatTitle(chatId: string): void {
  const store = useChatStore()

  let attemptsLeft = MAX_ATTEMPTS
  const timer: ReturnType<typeof setInterval> = setInterval(async () => {
    attemptsLeft--

    const current = store.chats.find(c => c.id === chatId)
    if (!current) {
      clearInterval(timer)
      return
    }

    try {
      const repo = await getChatRepository()
      const data = (await repo.listChats()) as Array<{ id: string; title?: string | null }>
      const entry = data.find(c => c.id === chatId)
      if (!entry) {
        clearInterval(timer)
        return
      }
      const title = entry.title || 'Untitled'
      if (title !== 'Untitled' && title !== current.label) {
        store.updateChat(chatId, { label: title })
        clearInterval(timer)
        return
      }
    } catch {
      // Network/store errors are non-fatal; keep trying until attempts run out.
    }

    if (attemptsLeft <= 0) {
      clearInterval(timer)
    }
  }, POLL_INTERVAL_MS)
}
