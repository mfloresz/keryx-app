# Keryx — Codemap Index

**Last Updated:** 2026-05-06
**Entry Points:** `src/main.ts`, `src/App.vue`

## Overview

Keryx is a fully client-side AI chat application built with **Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS v4**. It uses **AI SDK v6** (`@ai-sdk/vue`) for streaming AI responses and **OPFS** (Origin Private File System) for local chat persistence, accessed through a dedicated **Web Worker** to keep I/O off the main thread. The app has no backend — everything runs in the browser.

## Architecture Diagram

```
User Input → ChatInput → Chat (AI SDK) → fetch intercept → clientApi.ts
                                                              │
                    ┌─────────────────────────────────────────┤
                    ▼                                         ▼
           opfsWorkerClient.ts                       Vercel AI Gateway
             (postMessage)                           /api/ai-gateway/*
                    │                              OpenCode GO
                    ▼                              /api/opencode/*
           opfs.worker.ts
           (I/O in background thread)
                    │
                    ▼
               OPFS (persistence)
               keryx://chats/*
               keryx://attachments/*
```

## Key Areas

| Area | Codemap | Purpose |
|------|---------|---------|
| **Frontend / Components** | [frontend.md](frontend.md) | Vue components, layouts, pages, UI library, AI Elements |
| **Client API & Storage** | [backend.md](backend.md) | Fetch interception, OPFS persistence (Worker-based), client-side API handlers |
| **AI Integration** | [ai-integration.md](ai-integration.md) | AI SDK usage, model definitions, streaming, search tools, branch state |
| **Configuration** | See below | Vite, TypeScript, Tailwind, shadcn-vue, Docker |

## Data Flow

```
User Input → ChatInput → Chat (AI SDK) → API intercept → clientApi.ts
                                                         │
                    ┌────────────────────────────────────┤
                    ▼                                    ▼
           opfsWorkerClient.ts                   Vercel AI Gateway
             (postMessage)                       /api/ai-gateway/*
                    │                           OpenCode GO
                    ▼                           /api/opencode/*
           opfs.worker.ts                              │
           (I/O in background thread)                  ▼
                    │                           OpenAI/Anthropic/etc.
                    ▼                                Models
               OPFS (persistence)
               keryx://chats/*
               keryx://attachments/*

            localStorage (prefs)
            encrypt: secureStorage.ts
```

## Directory Structure

```
keryx/
├── src/
│   ├── main.ts                  # App bootstrap
│   ├── App.vue                  # Root layout + Suspense
│   ├── style.css                # Tailwind v4 + design tokens
│   ├── router/index.ts          # Routes: / and /chat/:id
│   ├── components/
│   │   ├── ai-elements/         # ~35 component categories (loaded as source)
│   │   ├── chat/                # Chat components (ChatInput, Messages, MessageItem)
│   │   ├── layout/              # AppLayout, AppSidebar
│   │   ├── settings/            # SettingsModal
│   │   └── ui/                  # shadcn-vue UI components (New York style)
│   ├── composables/             # useTheme, useLanguage, useModels, useAppFont, useSearchSettings, useToast
│   ├── stores/chat.ts           # Pinia store for chat list + date grouping
│   ├── pages/
│   │   ├── index.vue            # New chat (empty state)
│   │   └── chat/[id].vue        # Existing chat (streaming, editing)
│   ├── utils/
│   │   ├── clientApi.ts         # API handler + AI streaming orchestration
│   │   ├── opfsWorkerClient.ts  # Bridge to OPFS Worker via postMessage
│   │   ├── secureStorage.ts     # AES-GCM encrypted localStorage
│   │   ├── chatAttachments.ts   # Attachment persistence helper
│   │   └── tavilyTools.ts       # Web search tool definitions (Tavily)
│   ├── workers/
│   │   ├── opfs.worker.ts       # OPFS I/O in background thread (Web Worker)
│   │   └── opfs-protocol.ts     # Shared types for Worker message protocol
│   ├── shared/utils/models.ts   # AI model definitions
│   ├── lib/utils.ts             # cn() utility (clsx + tailwind-merge)
│   ├── locales/                 # en.json, es.json (vue-i18n)
│   └── test/                    # mock-opfs.ts, setup.ts
├── public/
│   ├── coi-serviceworker.js     # Cross-Origin Isolation (required for OPFS)
│   ├── logo.svg
│   └── vite.svg
├── .agents/skills/              # Reusable agent skill definitions
└── docs/
    ├── CODEMAPS/                # This codemap suite
    └── PLAN_MIGRACION_BIBLIA_SQLITE.md  # Planned Bible feature
```

> **OPFS Worker:** All OPFS read/write operations run in a dedicated Web Worker (`src/workers/opfs.worker.ts`) to avoid blocking the main thread. The main thread communicates with it via `postMessage` using the protocol defined in `src/workers/opfs-protocol.ts`. The bridge is managed by `src/utils/opfsWorkerClient.ts`.

## External Dependencies

| Category | Package | Version | Purpose |
|----------|---------|---------|---------|
| **Core** | vue | ^3.5.24 | UI framework |
| **Core** | vue-router | ^4.6.4 | Client-side routing |
| **Core** | pinia | ^3.0.2 | State management |
| **AI** | ai | ^6.0.168 | AI SDK core |
| **AI** | @ai-sdk/vue | ^3.0.168 | Vue integration |
| **AI** | @ai-sdk/openai | ^3.0.53 | OpenAI provider |
| **AI** | @ai-sdk/anthropic | ^3.0.71 | Anthropic provider |
| **AI** | @ai-sdk/gateway | ^3.0.104 | Vercel AI Gateway |
| **AI** | @ai-sdk/openai-compatible | ^2.0.47 | OpenCode GO provider |
| **UI** | tailwindcss | ^4.1.18 | Utility CSS |
| **UI** | @tailwindcss/vite | ^4.1.18 | Vite plugin for Tailwind v4 |
| **UI** | reka-ui | ^2.7.0 | Headless UI primitives |
| **UI** | lucide-vue-next | ^0.562.0 | Icon library |
| **UI** | embla-carousel-vue | ^8.6.0 | Carousel |
| **UI** | shiki | ^3.21.0 | Syntax highlighting |
| **Fonts** | @fontsource-variable/* | ^5.x | Variable fonts (5 options) |
| **Flow** | @vue-flow/core | ^1.48.1 | Flow diagram engine |
| **Flow** | @vue-flow/background | ^1.3.2 | Grid/dot background |
| **Flow** | @vue-flow/controls | ^1.1.3 | Zoom controls |
| **Flow** | @vue-flow/node-toolbar | ^1.1.1 | Node toolbar |
| **Animations** | motion-v | ^1.8.1 | Motion library |
| **Animations** | tw-animate-css | ^1.4.0 | Tailwind animation CSS |
| **Utils** | nanoid | ^5.1.6 | ID generation |
| **Utils** | date-fns | ^4.1.0 | Date utilities |
| **Utils** | @vueuse/core | ^14.1.0 | Vue composable utilities |
| **Utils** | zod | ^4.3.6 | Schema validation |
| **Utils** | clsx + tailwind-merge | ^2.x/^3.x | Class merging |
| **Utils** | tokenlens | ^1.3.1 | Token counting |
| **Utils** | ansi-to-vue3 | ^0.1.2 | ANSI escape rendering |
| **Media** | media-chrome | ^4.19.0 | Media controls |
| **Media** | @rive-app/webgl2 | ^2.37.5 | Rive animations |
| **Testing** | vitest | ^4.1.5 | Test runner |
| **Testing** | jsdom | ^29.1.1 | DOM environment |
| **Build** | vite | ^7.2.4 | Build tool |
| **Build** | vue-tsc | ^3.1.4 | Type checker |
| **Build** | typescript | ~5.9.3 | Language |
| **Build** | tw-animate-css | ^1.4.0 | Tailwind animation CSS (dev) |

## Related Documentation

- [AGENTS.md](/AGENTS.md) — Project rules for AI agents
- [Frontend Codemap](frontend.md) — Detailed component architecture
- [Client API & Storage Codemap](backend.md) — API interception, OPFS persistence
- [AI Integration Codemap](ai-integration.md) — AI SDK, models, tools, branching
- [PLAN_MIGRACION_BIBLIA_SQLITE.md](/docs/PLAN_MIGRACION_BIBLIA_SQLITE.md) — Planned Bible query feature
