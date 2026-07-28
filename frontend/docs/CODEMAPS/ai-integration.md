# AI Integration Codemap

**Last Updated:** 2026-05-06
**Entry Points:** `src/utils/clientApi.ts`, `src/shared/utils/models.ts`, `src/composables/useModels.ts`, `src/utils/tavilyTools.ts`

## Architecture

```
User Input (ChatInput.vue — submit(text, files, webSearch))
       │
       ▼
  Chat (AI SDK Vue — @ai-sdk/vue)
  ── sends fetch POST to /api/chats/:id
       │
       ▼
  main.ts: window.fetch interception
  ── isClientApiRoute() matches /api/chats/*
       │
       ▼
  clientApi.ts: apiFetch()
  ── /api/chats/* → OPFS CRUD (local persistence)
  ── POST /api/chats/:id → AI streaming via selected provider
       │
       ├─── provider === "vercel" ──────────────────────────────┐
       │   getGatewayProvider() → createGatewayProvider()       │
       │   streamText() via @ai-sdk/gateway                    │
       │   Model IDs prefixed (e.g. "openai/gpt-5.4-nano")    │
       │   Vite proxy: /api/ai-gateway → ai-gateway.vercel.sh │
       │                                                      │
       └─── provider === "opencode" ───────────────────────────┐
           getGatewayProvider() → createOpenAICompatible()     │
           streamText() via @ai-sdk/openai-compatible          │
           Model ID stripped of prefix (e.g. "mimo-v2.5")     │
           Vite proxy: /api/opencode → opencode.ai/zen        │
                                                              │
       ▼
  AI SDK (ai v6): streamText()
  ── Provider: Vercel AI Gateway (@ai-sdk/gateway)
     or OpenCode GO (@ai-sdk/openai-compatible)
  ── Models: GPT-5.4 Nano, Gemini 3 Flash, GPT-5 Nano,
     DeepSeek V4 Flash (Vercel)
     + Mimo V2.5, Qwen 3.5 Plus, DeepSeek V4 Flash (OpenCode)
  ── Tools: Tavily search/extract (web search)
       │
       ▼
  Streamed response → result.toUIMessageStreamResponse()
  ── onFinish saves full chat back to OPFS
```

## Provider Selection

Users choose their AI provider in **Settings → General tab**. The selection is stored and persisted across sessions:

- **Provider** stored in `localStorage` as `ai-provider` (`"vercel"` or `"opencode"`)
- Each provider has its **own API key field** and **model list**
- **Model selection is persisted per provider** so switching providers remembers the last model chosen for each
  - `vercel-model` — last model used with Vercel AI Gateway (default: `openai/gpt-5.4-nano`)
  - `opencode-model` — last model used with OpenCode GO (default: `opencode/mimo-v2.5`)
- API keys stored encrypted via `secureStorage.ts` (AES-GCM Web Crypto)
  - `ai-gateway-api-key` — for Vercel AI Gateway
  - `opencode-api-key` — for OpenCode GO

## Key Modules

| Module | Purpose | Exports / Key internals | Dependencies |
|--------|---------|------------------------|--------------|
| `src/utils/clientApi.ts` | Core API handler: CRUD + AI streaming + provider routing | `apiFetch`, `getGatewayProvider()`, `getVercelGatewayProvider()`, `getProvider()`, `getApiKey()`, `getProviderLabel()`, `generateChatTitle()`, `tavilySearchTool`, `tavilyExtractTool`, `BASE_SYSTEM_PROMPT` | `ai`, `@ai-sdk/gateway`, `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `./opfs`, `./tavilyTools`, `./secureStorage`, `../shared/utils/models` |
| `src/shared/utils/models.ts` | AI provider and model definitions | `PROVIDERS`, `VERCEL_MODELS`, `OPENCODE_MODELS`, `MODELS` (alias for VERCEL_MODELS), `ProviderValue`, `ModelValue`, `getModels()`, `supportsImages()`, `supportsSearch()` | None |
| `src/composables/useModels.ts` | Dual provider/model selection with per-provider persistence | `useModels()` → `{ provider, models, model, PROVIDERS }` | `@vueuse/core`, `../shared/utils/models` |
| `src/utils/tavilyTools.ts` | Tavily search & extract tool definitions for AI SDK | `tavilySearchTool`, `tavilyExtractTool` | `zod`, `./secureStorage` |
| `src/utils/secureStorage.ts` | AES-GCM encrypted localStorage for API keys | `secureSetItem`, `secureGetItem` | Web Crypto API |

### Models Module Details (`src/shared/utils/models.ts`)

```typescript
export const PROVIDERS = [
  { label: "Vercel AI Gateway", value: "vercel" },
  { label: "OpenCode GO", value: "opencode" },
] as const;

export type ProviderValue = (typeof PROVIDERS)[number]["value"];

export const VERCEL_MODELS = [ /* 4 models */ ] as const;
export const OPENCODE_MODELS = [ /* 3 models */ ] as const;

// Helper functions
export function getModels(provider: ProviderValue): readonly ModelDefinition[];
export function supportsImages(modelId: string): boolean;
export function supportsSearch(modelId: string): boolean;
```

### UseModels Composable (`src/composables/useModels.ts`)

```typescript
export function useModels() {
  const provider = useStorage<ProviderValue>("ai-provider", "vercel");
  const vercelModel = useStorage<string>("vercel-model", "openai/gpt-5.4-nano");
  const opencodeModel = useStorage<string>("opencode-model", "opencode/mimo-v2.5");
  const models = computed(() => getModels(provider.value));
  const model = computed({
    get: () => provider.value === "opencode" ? opencodeModel.value : vercelModel.value,
    set: (val: string) => { /* stores to correct key based on provider */ },
  });
  return { provider, models, model, PROVIDERS };
}
```

## AI Models

Seven models across two providers:

| Label | Provider ID | Images | Search |
|-------|-------------|--------|--------|
| **Vercel AI Gateway** | | | |
| GPT-5.4 Nano | `openai/gpt-5.4-nano` (Vercel) | ✅ | ✅ |
| Gemini 3 Flash | `google/gemini-3-flash` (Vercel) | ✅ | ❌ |
| GPT-5 Nano | `openai/gpt-5-nano` (Vercel) | ✅ | ✅ |
| DeepSeek V4 Flash | `deepseek/deepseek-v4-flash` (Vercel) | ❌ | ❌ |
| **OpenCode GO** | | | |
| Mimo V2.5 | `opencode/mimo-v2.5` (OpenCode) | ✅ | ❌ |
| Qwen 3.5 Plus | `opencode/qwen3.5-plus` (OpenCode) | ✅ | ❌ |
| DeepSeek V4 Flash | `opencode/deepseek-v4-flash` (OpenCode) | ❌ | ❌ |

### Model Resolution

- **Vercel models** pass the full provider-prefixed ID (e.g. `openai/gpt-5.4-nano`) directly to `streamText()`. The Vercel AI Gateway resolves the prefix.
- **OpenCode models** strip the `opencode/` prefix via `model.split("/")[1]` to get the bare model name (e.g. `mimo-v2.5`), which is passed to the OpenAI-compatible Chat Completions endpoint.
- **Anthropic models** (if selected) enable `providerOptions.anthropic.thinking` with an 8000-token budget.

## Data Flow: AI Request

1. **User submits message** → `ChatInput.vue` emits `submit` event with text, files, and webSearch flag
2. **For new chats** (`pages/index.vue`): Save to OPFS via `POST /api/chats` then navigate to `/chat/:id`
3. **For existing chats** (`pages/chat/[id].vue`): `Chat.sendMessage()` via fetch POST to `/api/chats/:id`
4. **Fetch interception** (`main.ts`): `isClientApiRoute()` matches `/api/chats/*` and routes to `apiFetch()`
5. **Provider resolution** (`clientApi.ts`):
   - `getProvider()` reads `localStorage.getItem("ai-provider")` — returns `"vercel"` or `"opencode"`
   - `getApiKey(provider)` reads the corresponding encrypted API key:
     - `"vercel"` → `secureGetItem("ai-gateway-api-key")`
     - `"opencode"` → `secureGetItem("opencode-api-key")`
5b. **Provider instantiation**:
   - **Vercel**: `createGatewayProvider({ apiKey, baseURL })` from `@ai-sdk/gateway` — base URL is `/api/ai-gateway/v3/ai` in dev, `https://ai-gateway.vercel.sh/v3/ai` in production
   - **OpenCode**: `createOpenAICompatible({ name: "opencode", apiKey, baseURL })` from `@ai-sdk/openai-compatible` — base URL is `/api/opencode/go/v1` in dev, uses same path in production
6. **System prompt** built from `BASE_SYSTEM_PROMPT` + optional web research instructions (if Tavily enabled)
7. **Tool registration**: `tavilySearchTool` + `tavilyExtractTool` when web search is enabled and Tavily is the selected search engine with a configured API key
8. **Streaming**: `streamText()` with model, system prompt, prepared messages, tools, and optional transforms (`smoothStream { chunking: "word" }`)
9. **Persistence**: `result.toUIMessageStreamResponse()` streams to the UI; `onFinish` saves the completed chat back to OPFS via `withChatLock` + `saveChat()`

## Web Search

Two search engines available:

### Native Search
- Uses `supportsSearch()` from model definitions
- Only available for models that natively support web search (GPT models via `openai.tools.webSearch()`, Anthropic via `anthropic.tools.webSearch_20250305()`)
- No API key needed — built-in model capability

### Tavily Search
- Available for **all models** when API key is configured
- Configurable: search depth, max results, topic (general/news/finance), time range, exact match, chunks per source
- API key stored encrypted via Web Crypto AES-GCM (`secureStorage`)
- Two tools defined in `src/utils/tavilyTools.ts`:
  - **`tavilySearchTool`** — web search with Zod schema validation (`searchParams`)
    - Parameters: `query` (string, required), `maxResults` (1–20, optional), `timeRange` (day/week/month/year, optional)
  - **`tavilyExtractTool`** — URL content extraction with Zod schema validation (`extractParams`)
    - Parameters: `urls` (string array, 1–20, required), `query` (string, optional), `extractDepth` (basic/advanced, optional)
- User settings (`tavily-options`) merged at runtime via `getOptions()`:
  ```typescript
  const tavilyOptionsSchema = z.object({
    searchDepth: z.enum(['basic', 'advanced', 'fast', 'ultra-fast']).optional(),
    maxResults: z.number().min(1).max(20).optional(),
    includeAnswer: z.enum(['none', 'basic', 'advanced']).optional(),
    includeRawContent: z.enum(['none', 'markdown', 'text']).optional(),
    topic: z.enum(['general', 'news', 'finance']).optional(),
    timeRange: z.enum(['day', 'week', 'month', 'year']).nullable().optional(),
    exactMatch: z.boolean().optional(),
    chunksPerSource: z.number().min(1).max(3).optional(),
  }).catchall(z.unknown());
  ```
- System prompt appended with research instructions when Tavily is active

## API Key Security

```
secureStorage.ts:
  - Master key: AES-GCM 256-bit, generated via Web Crypto, stored in localStorage as JWK
  - Values prefixed with "enc:v1:" before storage
  - Decryption on read; fallback to plain text for legacy values
  - Graceful fallback when Web Crypto unavailable (test environments)
  - Two API key slots: "ai-gateway-api-key" (Vercel) and "opencode-api-key" (OpenCode)
```

## External Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `ai` | AI SDK core (streamText, generateText, tools) | ^6.0.168 |
| `@ai-sdk/vue` | Vue integration for AI SDK (Chat class) | ^3.0.168 |
| `@ai-sdk/openai` | OpenAI provider (native search tool) | ^3.0.53 |
| `@ai-sdk/anthropic` | Anthropic provider (web search + thinking) | ^3.0.71 |
| `@ai-sdk/gateway` | Vercel AI Gateway provider (createGatewayProvider) | ^3.0.104 |
| `@ai-sdk/openai-compatible` | OpenCode GO provider (createOpenAICompatible) | ^2.0.47 |
| `zod` | Tool parameter schema validation | ^4.3.6 |

## Related Areas

- [Frontend Codemap](frontend.md) — Chat UI components, ChatInput, Settings (provider/model selection)
- [Backend Codemap](backend.md) — OPFS persistence for chat data
- [Agent Skills](../../.agents/skills/ai-sdk/SKILL.md) — Agent reference for AI SDK patterns (streamText, tool calling, provider setup)
- [Agent Skills](../../.agents/skills/ai-elements/SKILL.md) — AI Elements component guide
