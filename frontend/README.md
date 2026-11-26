# Keryx Frontend

React 19 + Vite + TanStack Router frontend for Keryx, built on shadcn/ui
(Base UI) and the shadcn AI Elements patterns.

The Go backend in the repository root serves this app as a static SPA and
owns the API. The frontend talks to it over the same origin, so the session
cookie stays first-party.

## Stack

| Piece | Choice | Why |
|---|---|---|
| Framework | React 19 (React Compiler) | No manual memoization |
| Build | Vite 8 | Static SPA → `dist/`, embedded by the Go binary |
| Routing | TanStack Router (file-based) | Typed routes, loaders, search params |
| Server state | TanStack Query | Available for the non-chat pages |
| UI | shadcn/ui, `base-nova` style, Base UI primitives | Components live in this repo |
| AI UI | shadcn AI Elements patterns | `Trace` unifies Reasoning/Tool/Plan |
| Chat runtime | `ai` v7 + `@ai-sdk/react` v4 | `useChat` + a custom `ChatTransport` |
| Styling | Tailwind v4 (CSS-first) | Design tokens in `src/styles.css` |
| Lint | oxlint + oxfmt | Fast, type-aware |

## Commands

```bash
npm install
npm run dev        # Vite dev server on :5173, proxies /api to :5176
npm run build      # typecheck + production build to dist/
npm run preview    # serve the production build
npm run test       # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # oxlint
npm run format     # oxfmt
```

## Architecture

```
src/
  adapters/api/   HTTP adapters for the backend (auth, chats, models, attachments)
  app/            Root component and providers
  components/
    chat/         Chat page pieces: prompt input, message item, markdown
    layout/       App shell, sidebar, command palette, user menu
    ui/           shadcn/ui primitives (vendored from the registry)
  composables/    Theme provider
  domain/         Types and ports (the backend contract, framework-free)
  i18n/           Locale provider and messages (en, es)
  routes/         File-based routes
  services/       KeryxChatTransport and other backend glue
  stores/         React context providers (auth, chat, agents, projects)
  utils/          Shared helpers
```

### The chat transport

The backend speaks a custom SSE dialect (`type: start / reasoning / text /
tool_call / tool_result / finish / error`). `src/services/keryxChatTransport.ts`
adapts it to the AI SDK's `UIMessageChunk` stream, which `useChat` consumes.
The interface is unchanged, so the transport is the only place that knows
about the wire format.

Its contract is pinned by `src/services/keryxChatTransport.test.ts` — if the
backend's event names change, those tests fail first.

### Adding a shadcn component

The registry CLI is not a dependency (it pulls an advisory with no upstream
fix). Run it on demand:

```bash
npx shadcn@latest add <component>
```

Components are copied into `src/components/ui/`, so the app does not depend
on the CLI at build time. The AI Elements patterns live in the shadcn docs
under `docs/ai-elements/` and are adapted into `src/components/chat/`.
