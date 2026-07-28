# Keryx — AI Chat Application

A fully client-side AI chat application built with Vue 3, TypeScript, Vite, and Tailwind CSS v4. All data is persisted locally in the browser using the Origin Private File System (OPFS) through a dedicated Web Worker. No backend server required.

> **Status:** Active development. Originally forked from `ai-elements-vue-starter`, now significantly evolved with custom architecture, OPFS worker, branch tracking, encrypted storage, Tavily web search integration, and dual AI provider support (Vercel AI Gateway + OpenCode GO).

## Quick Start

```bash
# Install dependencies
bun install

# Start dev server (http://localhost:5173)
bun dev

# Typecheck + production build
bun build

# Preview production build
bun preview

# Run tests
bun test        # once
bun test:watch  # watch mode
```

## Architecture

```
User Input → ChatInput → AI SDK Chat → fetch intercept → clientApi.ts
                                                             │
                    ┌────────────────────────────────────────┤
                    ▼                                        ▼
          ┌──────────────────┐                     ┌────────────────────┐
          │  OPFS Worker     │                     │  Vercel AI Gateway │
          │  (opfs.worker.ts)│                     │  /api/ai-gateway/* │
          │  opfsWorkerClient│                     └────────────────────┘
          │  chats/ + atts/  │                     ┌────────────────────┐
          └──────────────────┘                     │  OpenCode GO       │
                                                   │  /api/opencode/*   │
                                                   └────────────────────┘
```

### Key Design Decisions

- **Fully client-side** — No backend, no database, no auth. Everything runs in the browser.
- **OPFS Worker** — OPFS I/O runs in a dedicated Web Worker (`src/workers/opfs.worker.ts`) to avoid blocking the main thread. Communication happens via `opfsWorkerClient.ts` using a structured message protocol (`opfs-protocol.ts`).
- **Dual AI Provider** — Settings let users choose between **Vercel AI Gateway** and **OpenCode GO**, each with its own API key field and model list. Requests are routed through the appropriate Vite dev proxy.
- **AI SDK v6** — Uses `@ai-sdk/vue` `Chat` class for streaming, with `@ai-sdk/openai-compatible` for OpenCode GO compatibility.
- **Branch tracking** — Edits and regenerations create snapshots; users can navigate between branches per message.
- **AES-GCM encryption** — API keys encrypted via Web Crypto before storage in localStorage (`secureStorage.ts`).
- **shadcn-vue (New York)** — UI component library, configured in `components.json`.

## Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Vue 3 + TypeScript (strict mode) |
| **Build** | Vite 7 + vue-tsc 3 |
| **Styling** | Tailwind CSS v4 (`@tailwindcss/vite` plugin) |
| **State** | Pinia |
| **Routing** | Vue Router 4 (web history) |
| **AI** | AI SDK v6 (`@ai-sdk/vue`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/gateway`, `@ai-sdk/openai-compatible`) |
| **AI Gateway** | Vercel AI Gateway + OpenCode GO (dev proxies in `vite.config.ts`) |
| **UI Library** | shadcn-vue (New York style) |
| **AI UI** | AI Elements Vue (source components under `src/components/ai-elements/`) |
| **Icons** | lucide-vue-next |
| **i18n** | vue-i18n (en/es) |
| **Persistence** | OPFS (Origin Private File System) via Web Worker |
| **Encryption** | Web Crypto API (AES-256-GCM) |
| **Diagrams (future)** | vue-flow/\* |
| **Testing** | Vitest + jsdom |
| **Container** | Docker (nginx, port 3000) |

## Project Structure

```
src/
├── main.ts                         # App bootstrap + fetch interception
├── App.vue                         # Root layout (Suspense + toast, useAppFont)
├── style.css                       # Tailwind v4 + CSS custom properties
├── router/index.ts                 # Routes: / and /chat/:id
├── pages/
│   ├── index.vue                   # New chat (welcome + input)
│   └── chat/[id].vue               # Existing chat (streaming, editing, voting)
├── components/
│   ├── ai-elements/                # ~35 AI Elements component categories
│   ├── chat/                       # ChatInput, ChatMessages, ChatMessageItem
│   ├── layout/                     # AppLayout, AppSidebar
│   ├── settings/                   # SettingsModal (General, Search, Privacy)
│   └── ui/                         # shadcn-vue components (~25 categories)
├── composables/
│   ├── useTheme.ts                 # Light/dark/system theme toggle
│   ├── useLanguage.ts              # i18n locale (en/es)
│   ├── useModels.ts                # Selected AI model (localStorage)
│   ├── useAppFont.ts               # App font family/size (6 fonts, CSS custom props)
│   ├── useSearchSettings.ts        # Web search engine + Tavily config
│   └── useToast.ts                 # Global toast notifications
├── stores/
│   └── chat.ts                     # Pinia store: chat list + date grouping
├── workers/
│   ├── opfs.worker.ts              # OPFS Web Worker (I/O off the main thread)
│   └── opfs-protocol.ts            # Structured message protocol for worker comms
├── utils/
│   ├── clientApi.ts                # API handler + AI streaming orchestration
│   ├── opfs.ts                     # OPFS CRUD operations (legacy direct access)
│   ├── opfsWorkerClient.ts         # Client-side proxy to the OPFS Worker
│   ├── secureStorage.ts            # AES-GCM encrypted localStorage
│   ├── chatAttachments.ts          # Attachment persistence helper
│   └── tavilyTools.ts              # Tavily search/extract AI tools
├── shared/utils/
│   └── models.ts                   # AI model definitions
├── lib/utils.ts                    # cn() utility (clsx + tailwind-merge)
├── locales/
│   ├── en.json                     # English translations
│   └── es.json                     # Spanish translations
├── test/
│   ├── setup.ts                    # Test environment (OPFS mock, localStorage)
│   └── mock-opfs.ts                # In-memory OPFS mock
└── assets/                         # Static assets
```

## Key Features

- **AI Chat** — Stream responses from multiple AI models (GPT, Gemini, DeepSeek, Mimo, Qwen) via Vercel AI Gateway or OpenCode GO
- **Provider Selection** — Choose between Vercel AI Gateway and OpenCode GO, each with its own API key and model list
- **Model Selection** — Pick from 7 models in the input area
- **File Attachments** — Upload images, documents, and code files (max 3 per message)
- **Web Search** — Toggle web search per message; supports native (GPT models) and Tavily (all models)
- **Message Editing** — Edit user messages to regenerate AI responses
- **Branch History** — Navigate between snapshots of regenerations per message
- **Voting** — Upvote/downvote assistant responses
- **Chat Organization** — Sidebar with date-grouped chat history (Today, Yesterday, Last 7 Days, Last 30 Days, older months)
- **Search** — Ctrl+K command palette to search and jump to chats
- **Dark Mode** — Theme toggle (light/dark/system)
- **Internationalization** — English and Spanish
- **Font Customization** — 6 fonts with size options (spectral — default, open-sans, montserrat, merriweather, geist, sn-pro)
- **Encrypted Storage** — API keys encrypted with AES-256-GCM via Web Crypto
- **Fully Offline** — All data stored locally in the browser

## AI Models

| Model | Provider ID | Images | Search |
|-------|-------------|--------|--------|
| GPT-5.4 Nano | `openai/gpt-5.4-nano` | ✅ | ✅ |
| Gemini 3 Flash | `google/gemini-3-flash` | ✅ | ❌ |
| GPT-5 Nano | `openai/gpt-5-nano` | ✅ | ✅ |
| DeepSeek V4 Flash | `deepseek/deepseek-v4-flash` | ❌ | ❌ |
| Mimo V2.5 | `opencode/mimo-v2.5` | ✅ | ❌ |
| Qwen 3.5 Plus | `opencode/qwen3.5-plus` | ✅ | ❌ |
| DeepSeek V4 Flash | `opencode/deepseek-v4-flash` | ❌ | ❌ |

## Development

### Dev Server Proxy

In `vite.config.ts`, two proxies are configured:

| Proxy path | Target |
|---|---|
| `/api/ai-gateway` | `https://ai-gateway.vercel.sh` |
| `/api/opencode` | `https://opencode.ai/zen` |

Both use `changeOrigin: true`. Only works in dev.

### Docker

```bash
docker compose up
```

Serves production build on port 3000 via nginx. See `Dockerfile` and `default.conf`.

### Cross-Origin Isolation

The app requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` for OPFS SharedArrayBuffer support. A `coi-serviceworker.js` is loaded from `index.html`. The same headers are set in:

- `vercel.json` (for Vercel deployments)
- `default.conf` (for Docker/nginx)

A **Content Security Policy** is also defined in `index.html` via a `<meta>` tag to restrict resource loading and mitigate XSS risks.

## Testing

- **Runner:** Vitest with `jsdom` environment
- **OPFS mock:** In-memory implementation in `src/test/mock-opfs.ts`
- **Storage mocks:** `localStorage` and `navigator.storage` stubbed globally in `src/test/setup.ts`
- **Key tests:**
  - `opfs.test.ts` — Persistence layer (CRUD, attachments)
  - `clientApi.test.ts` — API routing and message preparation
  - `chat.test.ts` — Pinia store logic (grouping by date, mutations)
  - `useAppFont.test.ts` — Font composable (family/size, CSS custom properties)
  - `useSearchSettings.test.ts` — Search settings composable

## Documentation

- [Architecture Overview](docs/CODEMAPS/INDEX.md) — Complete codemap index
- [Frontend Codemap](docs/CODEMAPS/frontend.md) — Component architecture
- [Client API & Storage Codemap](docs/CODEMAPS/backend.md) — API interception, OPFS persistence
- [AI Integration Codemap](docs/CODEMAPS/ai-integration.md) — AI SDK, models, tools
- [Agent Rules](AGENTS.md) — Project conventions for AI agents

## Planned Features

- [Bible query system](docs/PLAN_MIGRACION_BIBLIA_SQLITE.md) — SQLite-based Bible study tools via `sql.js-httpvfs`

## License

Private project.
