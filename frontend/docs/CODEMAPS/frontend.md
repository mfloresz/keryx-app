# Frontend Codemap

**Last Updated:** 2026-05-06
**Entry Points:** `src/main.ts`, `src/App.vue`, `src/pages/index.vue`, `src/pages/chat/[id].vue`

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         index.html                               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                       main.ts                               │  │
│  │  Pinia · Router · vue-i18n · Theme Init · Fetch Intercept  │  │
│  └──────────────────────┬─────────────────────────────────────┘  │
│                          │                                        │
│  ┌───────────────────────▼─────────────────────────────────────┐  │
│  │                         App.vue                              │  │
│  │                    ┌──────────────┐                          │  │
│  │                    │  AppLayout   │                          │  │
│  │                    │ ┌──────────┐ │                          │  │
│  │                    │ │Sidebar   │ │ ← chat list, search,     │  │
│  │                    │ │          │ │   settings, collapse     │  │
│  │                    │ ├──────────┤ │                          │  │
│  │                    │ │ RouterView│ │ ← Suspense wrapper      │  │
│  │                    │ └──────────┘ │                          │  │
│  │                    └──────┬───────┘                          │  │
│  │                           │                                  │  │
│  │  ┌───────────┐  ┌────────▼───────┐  ┌───────────┐          │  │
│  │  │  / (root) │  │ /chat/:id      │  │ Settings  │          │  │
│  │  │ index.vue │  │ [id].vue       │  │ Modal     │          │  │
│  │  │           │  │                │  │           │          │  │
│  │  │ ChatInput │  │ ChatMessages   │  │ Theme     │          │  │
│  │  │           │  │ ChatInput      │  │ Language  │          │  │
│  │  │           │  │ ChatMessageItem│  │ Font      │          │  │
│  │  └───────────┘  └────────────────┘  │ Search    │          │  │
│  │                                     └───────────┘          │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Key Modules

| Module | Purpose | Exports | Dependencies |
|--------|---------|---------|--------------|
| `src/main.ts` | App bootstrap: Pinia, Router, i18n, fetch intercept | — | vue, pinia, vue-router, vue-i18n, clientApi, useTheme |
| `src/App.vue` | Root layout with Suspense, toast system | — | AppLayout, useChatStore, useToast, useAppFont, vue-router |
| `src/router/index.ts` | Route definitions: `/` + `/chat/:id` | `default` | vue-router |
| `src/pages/index.vue` | New chat page (welcome + input) | — | ChatInput, useModels, useChatStore, saveChat |
| `src/pages/chat/[id].vue` | Existing chat page (load, stream, edit, vote) | — | ChatMessages, ChatInput, Chat (ai-sdk/vue), useChatStore |
| `src/components/chat/ChatInput.vue` | Rich text input with file attachments, model selector, web search toggle | — | PromptInput, ModelSelector, useSearchSettings |
| `src/components/chat/ChatMessages.vue` | Message list with auto-scroll, streaming indicator | — | ScrollArea, ChatMessageItem, ai-elements/message |
| `src/components/chat/ChatMessageItem.vue` | Single message: text, reasoning, tools, sources, attachments, actions | — | ai-elements/*, useAppFont, lucide-vue |
| `src/components/layout/AppLayout.vue` | Flex layout: sidebar + content | — | AppSidebar |
| `src/components/layout/AppSidebar.vue` | Sidebar with chat list (grouped), search, rename/delete, collapse, settings | — | shadcn/ui components, useChatStore, SettingsModal |
| `src/components/settings/SettingsModal.vue` | Settings dialog (General, Search, Privacy/Accounts tabs) | — | shadcn/ui dialog, useTheme, useLanguage, useAppFont, useSearchSettings |
| `src/components/prompt-input-attachments-display.vue` | Displays file attachments inline in the prompt input | — | ai-elements/attachments, usePromptInput |

## Component Tree Details

### Chat Pages

```
pages/index.vue                  pages/chat/[id].vue
├── Welcome Area                 ├── Chat Header (title + count)
└── ChatInput                    ├── ChatMessages
    ├── PromptInput                  ├── ChatMessageItem (per message)
    │   ├── Attachments Display          ├── Message
    │   ├── Textarea                     │   ├── MessageAvatar
    │   ├── ActionMenu                   │   ├── Reasoning
    │   │   └── Add Attachments          │   ├── MessageResponse
    │   ├── Web Search Toggle            │   ├── Attachments
    │   └── Submit/Stop Button           │   ├── Tool invocations
    ├── ModelSelector                    │   ├── Sources
    └── Unsupported Image Dialog         │   └── MessageActions
                                      ├── (Thinking indicator)
                                      └── ChatInput
```

### Sidebar

```
AppSidebar
├── Header (logo + collapse toggle)
├── New Chat button
├── Search button (Ctrl+K → CommandDialog)
├── Separator
├── Chat History (ScrollArea)
│   └── Date groups (Today, Yesterday, Last 7 Days, Last 30 Days, older months)
│       └── Chat items (icon + title + actions menu)
│           ├── Rename (AlertDialog)
│           └── Delete (AlertDialog)
├── Separator
└── Settings button → SettingsModal
    ├── General tab
    │   ├── Theme (light/dark/system)
    │   ├── Language (en/es)
    │   ├── Font (spectral, open-sans, montserrat, merriweather, geist, sn-pro)
    │   ├── Font size
    │   └── Provider dropdown (Vercel AI Gateway / OpenCode GO)
    ├── Search tab (Engine, Tavily Key, Search Options)
    └── Privacy/Accounts tab
        ├── Vercel AI Gateway API key
        ├── OpenCode GO API key
        └── Delete All Chats
```

## Data Flow

1. **Page navigation:** Vue Router with `createWebHistory`. `/` renders `index.vue`, `/chat/:id` renders `[id].vue`.
2. **Chat creation:** User types on `/` → `handleSubmit` → `saveChat()` to OPFS → store optimistic add → `router.push(/chat/:id)`.
3. **Chat loading:** `[id].vue` fetches from `/api/chats/:id` (intercepted by `clientApi` → OPFS `getChat()`).
4. **AI streaming:** `[id].vue` initializes `Chat` from `@ai-sdk/vue` with `DefaultChatTransport` pointing to `/api/chats/:id`. Streaming updates `chat.messages` reactively.
5. **Message actions:** Edit/Regenerate → sends DELETE to API route, then triggers AI re-generation with branch tracking.
6. **Voting:** Optimistic UI update + POST to `/api/chats/votes/:id`.
7. **Sidebar refresh:** After streaming completes, `fetchChats()` is called to update the sidebar list.

## State Management (Pinia)

| Store | Purpose | Key State | Key Actions |
|-------|---------|-----------|-------------|
| `useChatStore` | Chat list + date grouping | `chats`, `groups` (computed), `isLoading` | `fetchChats`, `addChat`, `updateChat`, `removeChat`, `deleteAllChats` |

## Composables

`useAppFont` supports 6 fonts (spectral — default, open-sans, montserrat, merriweather, geist, sn-pro) via CSS custom properties `--app-font-family` and `--app-font-size` on `:root`. Called in `App.vue`.

| Composable | Purpose | Persistence |
|------------|---------|-------------|
| `useTheme` | Theme state (light/dark/system), applies `.dark` class | localStorage (`theme`) |
| `useLanguage` | i18n locale management (en/es) | localStorage (`app-locale`) |
| `useModels` | Current AI model selection | localStorage (`model`) |
| `useAppFont` | App font family + size settings applied to :root via CSS custom properties | localStorage (`app-font`, `app-font-size`) |
| `useSearchSettings` | Web search engine (native/Tavily) + Tavily options | localStorage + secureStorage |
| `useToast` | Global toast notification system | In-memory (reactive ref) |

## shadcn-vue Components (src/components/ui/)

> **Style:** New York · **Config:** `components.json`

| Category | Components |
|----------|------------|
| Overlay | `alert-dialog`, `dialog`, `command`, `popover`, `tooltip`, `dropdown-menu`, `hover-card` |
| Layout | `separator`, `scroll-area`, `card`, `tabs` |
| Form | `input`, `textarea`, `select`, `label`, `switch`, `button`, `button-group`, `input-group` |
| Data display | `badge`, `avatar`, `progress`, `collapsible`, `accordion`, `carousel` |
| Utility | `spinner` |

## External Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `vue` | UI framework | ^3.5.24 |
| `vue-router` | Client-side routing | ^4.6.4 |
| `pinia` | State management | ^3.0.2 |
| `vue-i18n` | Internationalization | ^11.4.0 |
| `@vueuse/core` | Vue composition utilities | ^14.1.0 |
| `@vue-flow/core` | Node-based workflow/graph editor | ^1.48.1 |
| `@vue-flow/background` | Background grid for Vue Flow | ^1.3.2 |
| `@vue-flow/controls` | Zoom controls for Vue Flow | ^1.1.3 |
| `@vue-flow/node-toolbar` | Node toolbar for Vue Flow | ^1.1.1 |
| `tailwindcss` + `@tailwindcss/vite` | Utility-first CSS | ^4.1.18 |
| `class-variance-authority` | Component variant API | ^0.7.1 |
| `clsx` + `tailwind-merge` | Class merging (`cn` util) | ^2.1.1 / ^3.4.0 |
| `lucide-vue-next` | Icon library | ^0.562.0 |
| `motion-v` | Animation library | ^1.8.1 |
| `embla-carousel-vue` | Carousel component | ^8.6.0 |
| `media-chrome` | Media UI components | ^4.19.0 |
| `shiki` | Code syntax highlighting | ^3.21.0 |
| `reka-ui` | Unstyled accessible primitives | ^2.7.0 |
| `tokenlens` | Token counter/analyzer for LLM prompts | ^1.3.1 |
| `vue-stream-markdown` | Streaming markdown renderer | ^0.7.2 |
| `vue-stick-to-bottom` | Auto-scroll to bottom | ^0.1.0 |
| `ansi-to-vue3` | ANSI → HTML rendering | ^0.1.2 |
| `tw-animate-css` | Tailwind CSS animation utilities (dev) | ^1.4.0 |

## i18n

- **Locales:** `src/locales/en.json`, `src/locales/es.json`
- **Toggling:** `useLanguage()` composable, persisted in localStorage
- **Strategy:** Browser detection → stored preference → fallback to 'en'

## Testing

| File | Type | What it tests |
|------|------|---------------|
| `src/stores/chat.test.ts` | Unit (vitest) | Chat store: date grouping, mutations, CRUD |
| `src/composables/useAppFont.test.ts` | Unit (vitest) | Font composable: defaults, persistence, changes |
| `src/composables/useSearchSettings.test.ts` | Unit (vitest) | Search settings: engine, Tavily key, options persistence |

## Related Areas

- [AI Integration](ai-integration.md) — AI SDK usage, model definitions, AI Elements components
- [Backend/API](backend.md) — Client-side API routing, OPFS storage, fetch interception
