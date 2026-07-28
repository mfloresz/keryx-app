# Keryx - AI Chat Application

## Quick start

```bash
bun install
bun run dev          # default static mode on http://localhost:5173
bun run dev:static   # explicit static mode on http://localhost:5173
bun run dev:cloud    # cloud mode on http://localhost:5174

bun run build
bun run build:static
bun run build:cloud

bun preview
bun test
bun test:watch
```

No lint or format commands exist. No CI workflows are configured.

## Architecture

- Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS v4
- AI SDK v6 via `ai`, `@ai-sdk/vue`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/gateway`, and `@ai-sdk/openai-compatible`
- AI Elements Vue components live in `src/components/ai-elements/`
- shadcn-vue components live in `src/components/ui/` with config in `components.json`
- The app supports two runtime modes controlled by `VITE_DEPLOY_MODE`:
  - `static`: browser-only mode with OPFS persistence and client-side fetch interception
  - `cloud`: server-backed mode with Vite middleware, auth, admin, and remote persistence
- Runtime repositories and auth adapters are selected dynamically from `src/services/runtime.ts`
- Chat state and branching logic is centralized in `src/shared/chatCore.ts`

## Runtime modes

### Static mode

- Default mode when `VITE_DEPLOY_MODE` is unset
- Stores chats and attachments in OPFS through `src/utils/opfs.ts` and `src/workers/opfs.worker.ts`
- Bootstraps the OPFS worker and installs the client-side `/api/*` interceptor in `src/app/bootstrap.ts`
- Supports local provider keys in browser storage

### Cloud mode

- Enabled with `VITE_DEPLOY_MODE=cloud`
- Uses Vite middleware from `vite.config.ts` to route `/api/*` into `src/server/chatApi.ts`
- Supports auth, invitations, admin tools, model access control, and remote chat storage
- Uses Supabase-oriented auth helpers and server utilities under `src/server/`

## Environment flags

Defined in `src/app/config.ts`:

- `VITE_DEPLOY_MODE`: `static` or `cloud`
- `VITE_APP_NAME`: app branding label
- `VITE_ENABLE_AUTH`: enables auth in cloud mode
- `VITE_ENABLE_LOCAL_KEYS`: controls local provider key usage in cloud mode
- `VITE_ENABLE_OPFS`: controls OPFS availability in cloud mode
- `VITE_ENABLE_ADMIN`: enables admin UI/features in cloud mode
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`

Server-side cloud features also rely on process env vars such as:

- `AI_GATEWAY_API_KEY` or `VERCEL_AI_GATEWAY_API_KEY`
- `OPENCODE_API_KEY`
- `APP_BASE_URL`

## Routing

Routes are defined in `src/router/index.ts`:

- `/` -> new chat
- `/chat/:id` -> existing chat
- `/login` -> auth screen
- `/invite/:token` -> invitation acceptance
- `/admin` -> admin console

In cloud mode, the router enforces auth and admin access. In static mode, login redirects back to `/`.

## AI and API flow

- Static mode intercepts `/api/*` calls in the browser via `src/adapters/static/clientApiInterceptor.ts`
- Cloud mode handles `/api/*` through `src/server/chatApi.ts`
- Model/provider definitions live in `src/shared/utils/models.ts`
- Supported providers today:
  - Vercel AI Gateway
  - OpenCode GO
- Tavily-powered search/extract tools live in `src/utils/tavilyTools.ts`
- Title generation uses a separate background request with the Vercel gateway path

## Key entrypoints

| File | Purpose |
|---|---|
| `src/main.ts` | App bootstrap: theme init, async runtime bootstrap, Pinia, Router, i18n |
| `src/app/bootstrap.ts` | Static runtime initialization for OPFS worker and fetch interception |
| `src/app/config.ts` | Deploy mode and feature flags |
| `src/router/index.ts` | App routes plus auth/admin navigation guards |
| `src/services/runtime.ts` | Chooses static vs cloud repositories/adapters at runtime |
| `src/pages/index.vue` | New chat page |
| `src/pages/chat/[id].vue` | Existing chat page |
| `src/pages/login.vue` | Login screen |
| `src/pages/invite/[token].vue` | Invitation acceptance flow |
| `src/pages/admin/index.vue` | Admin console for users, invitations, and models |
| `src/stores/chat.ts` | Chat list state and grouping logic |
| `src/stores/auth.ts` | Auth session state |
| `src/shared/chatCore.ts` | Shared message normalization, branching, and persistence helpers |
| `src/shared/prompts.ts` | System prompts and title-generation prompt |
| `src/shared/utils/models.ts` | Provider/model catalog and model capabilities |
| `src/utils/clientApi.ts` | Static-mode local API handler and AI streaming logic |
| `src/utils/opfs.ts` | OPFS persistence primitives |
| `src/utils/opfsWorkerClient.ts` | Main-thread bridge to the OPFS worker |
| `src/workers/opfs.worker.ts` | Background OPFS worker |
| `src/server/chatApi.ts` | Cloud-mode API entrypoint |
| `src/server/cloudStore.ts` | Cloud chat persistence layer |
| `src/server/appStore.ts` | Users, invitations, and model management storage |
| `src/server/supabaseAuth.ts` | Supabase auth verification helpers |

## Storage and data flow

- Static chats and attachments persist in OPFS
- Cloud chats use repository adapters under `src/adapters/cloud/`
- Static adapters live under `src/adapters/static/`
- Auth adapters follow the same split:
  - `src/adapters/static/staticAuthAdapter.ts`
  - `src/adapters/cloud/cloudAuthAdapter.ts`

## Testing

- Vitest with `jsdom`
- OPFS is mocked in-memory via `src/test/mock-opfs.ts`
- Test setup lives in `src/test/setup.ts`
- Important test files:
  - `src/shared/chatCore.test.ts`
  - `src/utils/opfs.test.ts`
  - `src/utils/clientApi.test.ts`
  - `src/utils/tavilyTools.test.ts`
  - `src/stores/chat.test.ts`
  - `src/composables/useAppFont.test.ts`
  - `src/composables/useLanguage.test.ts`
  - `src/composables/useSearchSettings.test.ts`
  - `src/i18n.test.ts`
  - `src/server/invitationEmail.test.ts`
  - `src/server/supabaseAuth.test.ts`

## TypeScript

- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `erasableSyntaxOnly: true`
- Do not use `enum`, `namespace`, or parameter properties
- Path alias: `@/*` -> `./src/*`

## Styling and UI

- Tailwind CSS v4 via `@tailwindcss/vite`
- Theme variables live in `src/style.css`
- Fonts are loaded in `src/main.ts`
- `motion-v`, `vue-flow`, and Rive are available in the dependency graph

## i18n

- vue-i18n with locales in `src/locales/`
- Main locale helpers/composables:
  - `src/i18n.ts`
  - `src/composables/useLanguage.ts`
  - `public/initial-locale.js`

## Cross-Origin Isolation

- `public/coi-serviceworker.js` is registered from `index.html`
- This is required for `SharedArrayBuffer` support used by the OPFS flow

## Docker

```bash
docker compose up
```

Serves the production build on port 3000 via nginx (`default.conf`).

## Skills

Reusable skill definitions live under `.agents/skills/` and should be loaded when relevant:

| Skill | When to load |
|---|---|
| `ai-elements` | Building or extending AI chat UI with AI Elements components |
| `ai-sdk` | Working with AI SDK primitives such as `streamText`, tool calling, or provider setup |
| `pocketbase-best-practices` | Only if the project adds or evaluates a PocketBase backend |
