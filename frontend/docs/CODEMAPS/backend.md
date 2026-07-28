# Backend Codemap — Client-Side API & Storage Layer

**Last Updated:** 2026-05-06
**Entry Points:** `src/main.ts`, `src/utils/clientApi.ts`, `src/utils/opfsWorkerClient.ts`

## Architecture

Keryx has **no actual backend server**. All API routes are intercepted client-side by a fetch wrapper and handled locally using:

1. **OPFS (Origin Private File System)** — for chat and attachment persistence, running on a dedicated Web Worker
2. **Vercel AI SDK** — for streaming AI responses via the AI Gateway proxy or OpenCode GO proxy
3. **AES-GCM Web Crypto** — for encrypting API keys in localStorage

```
┌────────────────────────────────────────────────────────────┐
│                    Browser (Client)                         │
│                                                             │
│  ┌─────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │ Vue App │───▶│ fetch Hook   │───▶│ clientApi.ts     │   │
│  │(App.vue)│    │ (main.ts)    │    │ (apiFetch fn)    │   │
│  └─────────┘    └──────────────┘    └───────┬──────────┘   │
│                                              │              │
│              ┌───────────────────────────────┼──────────────┤
│              │        Client Routes          │              │
│              │  /api/chats/*                 │              │
│              │  /api/ai-gateway/*            │              │
│              │  /api/opencode/*              │              │
│              └───────────────────────────────┼──────────────┤
│                                               ▼              │
│              ┌──────────────────────────────────────────┐   │
│              │     opfsWorkerClient.ts (proxy)          │   │
│              │     postMessage → Worker                 │   │
│              └─────────────────┬────────────────────────┘   │
│                                │ postMessage                 │
│              ┌─────────────────▼────────────────────────┐   │
│              │     opfs.worker.ts (dedicated Worker)    │   │
│              │  ┌────────────────────────────────────┐  │   │
│              │  │  chats/ (JSON via index.json)      │  │   │
│              │  │  attachments/ (binary files)       │  │   │
│              │  └────────────────────────────────────┘  │   │
│              └─────────────────────────────────────────┘   │
│                                              │              │
│              ┌───────────────────────────────┼──────────────┤
│              │   AI Providers                │              │
│              │  /api/ai-gateway/ ────────────┼────────────▶│ Vercel
│              │  /api/opencode/ ──────────────┼────────────▶│ OpenCode
│              │  (Vite dev server proxies)    │              │   GO
│              └───────────────────────────────┘              │
└────────────────────────────────────────────────────────────┘
```

## Key Modules

| Module | Purpose | Exports | Dependencies |
|--------|---------|---------|--------------|
| `src/main.ts` | App bootstrap + fetch interception + OPFS Worker init | Boots Vue app, patches `window.fetch`, calls `initOpfsWorker()` | All app modules |
| `src/utils/clientApi.ts` | Core API handler: CRUD + AI streaming | `apiFetch()` | `opfs`, `opfsWorkerClient`, `ai`, `@ai-sdk/*`, `tavilyTools` |
| `src/utils/opfs.ts` | Type definitions + pure helpers only (NO I/O) | `ChatRecord`, `ChatBranchState`, `ChatBranchSnapshot`, `ChatIndexEntry`, `AttachmentReference`, `getAttachmentStorageKey()`, `createAttachmentUrl()` | None (pure types/fns) |
| `src/utils/opfsWorkerClient.ts` | Promise-based proxy to OPFS Worker | `initOpfsWorker()`, `listChats()`, `getChat()`, `getStoredChat()`, `saveChat()`, `deleteChat()`, `deleteAllChats()`, `saveAttachment()`, `getAttachmentAsBase64()`, `getAttachmentAsDataUrl()`, `revokeObjectUrlsForChat()` | `opfs` (types only), `opfs-protocol` |
| `src/workers/opfs.worker.ts` | Dedicated Web Worker running all OPFS I/O | Handles hydration of attachment URLs, index management, CRUD | Native browser APIs (File System Access) |
| `src/workers/opfs-protocol.ts` | Shared types for Worker communication | `OpfsRequest` (union of all request shapes), `OpfsResponse` (tagged union with `ok`/`error`) | `opfs` (types only) |
| `src/utils/secureStorage.ts` | Encrypted localStorage | `secureSetItem`, `secureGetItem` | Web Crypto API (AES-GCM) |
| `src/utils/chatAttachments.ts` | Attachment persistence during submit | `persistAttachmentFiles` | `opfsWorkerClient` |
| `src/utils/tavilyTools.ts` | Tavily search/extract tools (Zod-defined) | `tavilySearchTool`, `tavilyExtractTool` | `zod`, `secureStorage` |
| `src/shared/utils/models.ts` | AI provider and model definitions | `PROVIDERS`, `VERCEL_MODELS`, `OPENCODE_MODELS`, `getModels()`, `supportsImages()`, `supportsSearch()` | None |

## Client-Side API Routes

All routes are intercepted by the fetch hook in `main.ts` and dispatched to `clientApi.ts`:

| Method | Route | Handler | Description |
|--------|-------|---------|-------------|
| `GET` | `/api/chats` | `listChats()` (via Worker index) | Fetch all chats (sorted newest first) — O(1) file read via `index.json` |
| `GET` | `/api/chats/:id` | `getChat(id)` (via Worker) | Fetch single chat with hydrated attachment `blob:` URLs |
| `POST` | `/api/chats/:id` | AI SDK `streamText` | Send message, stream AI response, persist |
| `DELETE` | `/api/chats` | `deleteAllChats()` (via Worker) | Delete all chats + attachments + index |
| `DELETE` | `/api/chats/:id` | `deleteChat(id)` (via Worker) | Delete single chat + its attachments + index entry |
| `PATCH` | `/api/chats/title/:id` | OPFS update title field | Rename a chat |
| `POST` | `/api/chats/votes/:id` | OPFS vote mutation | Vote message up/down |
| `GET` | `/api/chats/votes/:id` | OPFS vote read | Get all votes for a chat |
| `DELETE` | `/api/chats/messages/:id` | OPFS message mutation | Edit/regenerate: truncate messages |
| `POST` | `/api/chats/branches/:id` | OPFS branch switch | Switch to a different snapshot |
| `GET`/`POST` | `/api/ai-gateway/*` | Proxied to Vercel AI Gateway | AI provider API calls |
| `GET`/`POST` | `/api/opencode/*` | Proxied to OpenCode GO API | AI provider API calls (secondary provider) |

## OPFS Storage Layout

```
Origin Private File System:
├── chats/
│   ├── index.json               # Lightweight metadata for O(1) listing
│   ├── {chatId}.json             # ChatRecord (messages, votes, branches, metadata)
│   ├── {chatId}.json
│   └── ...
├── attachments/
│   ├── {chatId}/
│   │   ├── {attachmentId}        # Binary file data
│   │   └── ...
│   ├── {chatId}/
│   │   └── ...
│   └── ...
```

The `index.json` file stores lightweight `ChatIndexEntry` objects (only `id`, `title`, `createdAt`) to avoid reading and parsing every `.json` file when listing chats on the sidebar. The index is automatically migrated from legacy `.json` files on first Worker startup.

### ChatRecord Schema

```typescript
interface ChatRecord {
  id: string               // UUID
  title: string | null     // User-defined title
  visibility: 'public' | 'private'
  createdAt: string        // ISO 8601
  messages: any[]          // AI SDK UIMessage[]
  votes: any[]             // Vote records
  webSearch?: boolean      // Web search enabled flag
  branches?: Record<string, ChatBranchState>  // Branch/snapshot history
}
```

### Attachment Reference

Attachments are saved as physical files in OPFS. Messages reference them via `attachment://{id}` URLs. On chat load (`getChat`), the Worker reads the binary data and creates `blob:` URLs for rendering. The Worker also manages a per-chat object URL registry to revoke unreferenced URLs.

## Encryption Layer

`src/utils/secureStorage.ts` provides AES-256-GCM encryption for API keys:

- A random 256-bit master key is generated once and stored in localStorage as JWK under `__keryx_mk_v1`
- Encrypted values are prefixed with `enc:v1:`
- Falls back to plain-text storage when Web Crypto is unavailable (e.g. test runners)
- Used to securely store AI Gateway API key and Tavily API key

## External Dependencies

| Dependency | Purpose | Version |
|------------|---------|---------|
| `ai` | AI SDK v6 (streamText, generateText, smoothStream) | ^6.0.168 |
| `@ai-sdk/vue` | Vue integration for AI SDK (Chat class) | ^3.0.168 |
| `@ai-sdk/openai` | OpenAI provider | ^3.0.53 |
| `@ai-sdk/openai-compatible` | OpenCode GO provider (OpenAI-compatible) | ^2.0.47 |
| `@ai-sdk/anthropic` | Anthropic provider | ^3.0.71 |
| `@ai-sdk/gateway` | Vercel AI Gateway provider | ^3.0.104 |
| `zod` | Runtime schema validation (for Tavily tools) | ^4.3.6 |
| `nanoid` | Unique ID generation | ^5.1.6 |

## AI Gateway Proxy

In development, two proxy routes are configured in `vite.config.ts`:

| Proxy Path | Target | Purpose |
|------------|--------|---------|
| `/api/ai-gateway` | `https://ai-gateway.vercel.sh` | AI provider API calls via Vercel AI Gateway |
| `/api/opencode` | `https://opencode.ai/zen` | AI provider API calls via OpenCode GO API |

Both proxies use `changeOrigin: true` and strip the path prefix before forwarding.

In production, requests go directly to the respective provider's URL as configured in the API key's default endpoint.

## Data Flow for AI Streaming

1. User submits a message via `ChatInput`
2. Attachments are persisted to OPFS via `persistAttachmentFiles()` (calls `saveAttachment` on the Worker proxy)
3. On the chat page (`[id].vue`), `chat.sendMessage()` is called on the AI SDK `Chat` instance
4. The `Chat` transport sends a POST to `/api/chats/:id`
5. `clientApi.ts` intercepts and calls `streamText()` with model, messages, and tools
6. Streamed response is returned as a `StreamDataStream` or `Response`
7. On completion:
   - Messages are persisted to OPFS (`saveChat` via Worker proxy)
   - Chat store is refreshed
   - Branch metadata is updated

## OPFS Worker Design

The OPFS persistence layer was moved to a dedicated Web Worker to offload file I/O from the main thread. The design follows a **request-response** pattern:

1. `opfsWorkerClient.ts` sends a `postMessage` with an `OpfsRequest` (which includes a unique `reqId`)
2. `opfs.worker.ts` processes the request and posts back an `OpfsResponse`
3. The client matches the response to the pending request via `reqId` and resolves/rejects the corresponding Promise

This keeps the main thread responsive during file operations and avoids blocking UI rendering.

## Related Areas

- [Frontend Codemap](frontend.md) — Chat components and UI
- [AI Integration Codemap](ai-integration.md) — Model config and tool definitions
