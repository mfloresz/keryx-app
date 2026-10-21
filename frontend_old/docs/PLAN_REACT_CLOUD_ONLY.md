# Plan completo: migración de Keryx a React en modo Cloud-only

## 0. Decisión arquitectónica

Este documento define cómo replicar Keryx en React eliminando el modo `static/local`. La nueva versión debe ser **Cloud-only**: autenticación obligatoria, persistencia remota, streaming ejecutado en backend y claves de proveedor únicamente en variables de entorno del servidor.

La migración no debe ser una traducción literal de archivos `.vue` a `.tsx`. El objetivo es reconstruir Keryx con una arquitectura más limpia:

```txt
React UI
  ↓
Application services
  ↓
Domain contracts
  ↓
Server API routes
  ↓
Auth + Database + Storage + AI providers
```

## 1. Alcance

### Incluido

1. React como capa visual.
2. Cloud-only desde el inicio.
3. Login obligatorio.
4. Registro restringido por invitación.
5. Persistencia remota de chats, mensajes, votos, ramas y adjuntos.
6. Streaming de IA desde backend.
7. Control de modelos por usuario/rol.
8. Panel admin.
9. Eliminación de OPFS como dependencia de ejecución.
10. Eliminación de claves locales en el navegador.

### Excluido

1. Modo offline/local.
2. OPFS para persistencia principal.
3. Interceptor local de `fetch`.
4. API keys configuradas por usuario en `localStorage`.
5. Doble build `static | cloud`.
6. Compatibilidad obligatoria con el layout interno de Vue.

## 2. Stack recomendado

### Base

```txt
Next.js App Router
React
TypeScript
Tailwind CSS
shadcn/ui
AI SDK React
AI SDK Core
Supabase Auth
Turso/libSQL
Vercel Functions
```

### Motivo

1. Next.js permite tener UI React y API routes en el mismo proyecto.
2. AI SDK React cubre la capa cliente de streaming mediante `useChat`.
3. AI SDK Core cubre `streamText`, tools y `toUIMessageStreamResponse` en backend.
4. Supabase Auth resuelve email/password, sesiones y recuperación de contraseña.
5. Turso/libSQL funciona bien para datos relacionales de chats, mensajes, ramas y permisos.
6. Vercel Functions encaja con streaming y variables server-side.

## 3. Principios obligatorios

### 3.1. Cloud-only real

No mantener banderas como:

```ts
VITE_DEPLOY_MODE = 'static' | 'cloud'
```

En la versión React, el modo debe asumirse como cloud siempre. Si en el futuro se quiere restaurar modo local, debe hacerse como producto separado o adapter separado, no como condición global en toda la app.

### 3.2. Ninguna API key en cliente

El navegador nunca debe recibir:

```txt
AI_GATEWAY_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
TAVILY_API_KEY
TURSO_AUTH_TOKEN
SUPABASE_SERVICE_ROLE_KEY
```

Solo se permite exponer variables públicas como:

```txt
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_APP_NAME
```

### 3.3. La UI no accede directo a la base de datos

La UI solo llama endpoints internos:

```txt
/api/chats
/api/chats/:id
/api/chats/:id/stream
/api/chats/:id/messages
/api/chats/:id/votes
/api/chats/:id/branches
/api/models
/api/auth/me
/api/invitations/accept
/api/admin/*
```

La base de datos se consume desde `server/`.

### 3.4. Dominio antes que componentes

Primero se definen tipos y casos de uso; después se implementan componentes React.

## 4. Estructura objetivo

```txt
keryx-react/
  app/
    layout.tsx
    page.tsx
    login/page.tsx
    invite/[token]/page.tsx
    chat/[id]/page.tsx
    admin/page.tsx
    admin/users/page.tsx
    admin/models/page.tsx
    api/
      auth/me/route.ts
      chats/route.ts
      chats/[id]/route.ts
      chats/[id]/stream/route.ts
      chats/[id]/messages/route.ts
      chats/[id]/votes/route.ts
      chats/[id]/branches/route.ts
      attachments/route.ts
      attachments/[id]/route.ts
      invitations/validate/route.ts
      invitations/accept/route.ts
      admin/users/route.ts
      admin/models/route.ts
      admin/invitations/route.ts

  components/
    chat/
      ChatShell.tsx
      ChatMessages.tsx
      ChatMessageItem.tsx
      ChatInput.tsx
      MessageActions.tsx
      BranchSelector.tsx
      AttachmentPreview.tsx
    layout/
      AppSidebar.tsx
      AppHeader.tsx
      AppLayout.tsx
    settings/
      SettingsDialog.tsx
      ModelSelector.tsx
      SearchSettings.tsx
    auth/
      LoginForm.tsx
      InviteAcceptForm.tsx
    admin/
      UsersTable.tsx
      InvitationsTable.tsx
      ModelAccessTable.tsx
    ui/
      ...shadcn/ui

  domain/
    chat/
      types.ts
      ports.ts
      branching.ts
      message-normalization.ts
    auth/
      types.ts
      ports.ts
    models/
      types.ts
      ports.ts
    attachments/
      types.ts
      ports.ts

  services/
    chat-service.ts
    auth-service.ts
    model-service.ts
    invitation-service.ts
    attachment-service.ts

  server/
    db/
      client.ts
      schema.sql
      migrations/
      queries/
        chats.ts
        messages.ts
        votes.ts
        branches.ts
        attachments.ts
        users.ts
        invitations.ts
        models.ts
    auth/
      supabase.ts
      require-user.ts
      require-admin.ts
      session.ts
    ai/
      providers.ts
      stream-chat.ts
      title.ts
      tools.ts
      model-access.ts
    storage/
      attachments.ts

  lib/
    env.ts
    utils.ts
    errors.ts
    http.ts

  tests/
    unit/
    integration/
    e2e/
```

## 5. Mapeo Vue → React

| Keryx Vue actual | React Cloud-only |
|---|---|
| `src/main.ts` | `app/layout.tsx` + providers React |
| `src/App.vue` | `components/layout/AppLayout.tsx` |
| `src/router/index.ts` | App Router file-system routing |
| `src/pages/index.vue` | `app/page.tsx` |
| `src/pages/chat/[id].vue` | `app/chat/[id]/page.tsx` + `ChatShell.tsx` |
| `src/components/chat/ChatInput.vue` | `components/chat/ChatInput.tsx` |
| `src/components/chat/ChatMessages.vue` | `components/chat/ChatMessages.tsx` |
| `src/components/chat/ChatMessageItem.vue` | `components/chat/ChatMessageItem.tsx` |
| `src/components/layout/AppSidebar.vue` | `components/layout/AppSidebar.tsx` |
| `src/components/settings/SettingsModal.vue` | `components/settings/SettingsDialog.tsx` |
| `src/stores/chat.ts` | React Query/SWR store + server state |
| Pinia | React Query/SWR + small Zustand store if needed |
| Vue Router | Next.js App Router |
| `@ai-sdk/vue` Chat | `@ai-sdk/react` `useChat` |
| `clientApi.ts` local interceptor | Real server route handlers |
| `opfsWorkerClient.ts` | Removed from runtime |
| `opfs.worker.ts` | Removed from runtime |
| `secureStorage.ts` local keys | Removed; server env only |

## 6. Variables de entorno

```env
# Public
NEXT_PUBLIC_APP_NAME=Keryx
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Supabase server
SUPABASE_SERVICE_ROLE_KEY=

# Turso
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

# AI
AI_GATEWAY_API_KEY=
OPENCODE_API_KEY=
TAVILY_API_KEY=

# App
APP_BASE_URL=
INVITATION_SECRET=
SESSION_COOKIE_NAME=keryx_session
ADMIN_EMAILS=
```

Regla: toda variable sin `NEXT_PUBLIC_` solo puede importarse desde `server/` o `app/api/**/route.ts`.

## 7. Modelo de datos

### 7.1. `users`

```sql
create table users (
  id text primary key,
  email text not null unique,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);
```

### 7.2. `invitations`

```sql
create table invitations (
  id text primary key,
  email text,
  token_hash text not null unique,
  role text not null default 'user' check (role in ('user', 'admin')),
  expires_at text not null,
  accepted_at text,
  accepted_by_user_id text,
  created_by_user_id text not null,
  created_at text not null default (datetime('now')),
  foreign key (accepted_by_user_id) references users(id),
  foreign key (created_by_user_id) references users(id)
);
```

### 7.3. `chats`

```sql
create table chats (
  id text primary key,
  user_id text not null,
  title text,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  web_search integer not null default 0,
  last_usage_json text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  foreign key (user_id) references users(id)
);

create index idx_chats_user_updated on chats(user_id, updated_at desc);
```

### 7.4. `messages`

```sql
create table messages (
  id text primary key,
  chat_id text not null,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  parts_json text not null,
  metadata_json text,
  ordinal integer not null,
  created_at text not null default (datetime('now')),
  foreign key (chat_id) references chats(id) on delete cascade
);

create unique index idx_messages_chat_ordinal on messages(chat_id, ordinal);
create index idx_messages_chat_created on messages(chat_id, created_at);
```

### 7.5. `votes`

```sql
create table votes (
  chat_id text not null,
  message_id text not null,
  user_id text not null,
  is_upvoted integer,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  primary key (chat_id, message_id, user_id),
  foreign key (chat_id) references chats(id) on delete cascade,
  foreign key (message_id) references messages(id) on delete cascade,
  foreign key (user_id) references users(id)
);
```

### 7.6. `chat_branches`

```sql
create table chat_branches (
  id text primary key,
  chat_id text not null,
  root_message_id text not null,
  include_root integer not null default 0,
  current_snapshot_id text not null,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  foreign key (chat_id) references chats(id) on delete cascade
);
```

### 7.7. `branch_snapshots`

```sql
create table branch_snapshots (
  id text primary key,
  branch_id text not null,
  label text not null,
  messages_json text not null,
  created_at text not null default (datetime('now')),
  foreign key (branch_id) references chat_branches(id) on delete cascade
);
```

### 7.8. `attachments`

```sql
create table attachments (
  id text primary key,
  chat_id text not null,
  user_id text not null,
  filename text not null,
  media_type text not null,
  size_bytes integer not null,
  storage_key text not null unique,
  created_at text not null default (datetime('now')),
  foreign key (chat_id) references chats(id) on delete cascade,
  foreign key (user_id) references users(id)
);
```

### 7.9. `models`

```sql
create table models (
  id text primary key,
  provider text not null,
  label text not null,
  model_id text not null,
  supports_images integer not null default 0,
  supports_search integer not null default 0,
  enabled integer not null default 1,
  created_at text not null default (datetime('now'))
);
```

### 7.10. `user_model_access`

```sql
create table user_model_access (
  user_id text not null,
  model_id text not null,
  created_at text not null default (datetime('now')),
  primary key (user_id, model_id),
  foreign key (user_id) references users(id) on delete cascade,
  foreign key (model_id) references models(id) on delete cascade
);
```

## 8. Contratos TypeScript

### 8.1. Chat

```ts
import type { UIMessage, LanguageModelUsage } from 'ai';

export interface ChatRecord {
  id: string;
  userId: string;
  title: string | null;
  visibility: 'public' | 'private';
  createdAt: string;
  updatedAt: string;
  messages: UIMessage[];
  votes: VoteRecord[];
  webSearch?: boolean;
  lastUsage?: LanguageModelUsage;
  branches?: Record<string, ChatBranchState>;
}

export interface ChatSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview?: string | null;
}

export interface VoteRecord {
  chatId: string;
  messageId: string;
  userId: string;
  isUpvoted: boolean | null;
}

export interface ChatBranchSnapshot {
  id: string;
  label: string;
  createdAt: string;
  messages: UIMessage[];
}

export interface ChatBranchState {
  rootMessageId: string;
  includeRoot: boolean;
  currentSnapshotId: string;
  snapshots: ChatBranchSnapshot[];
}
```

### 8.2. Modelos

```ts
export interface ModelDefinition {
  id: string;
  provider: 'vercel' | 'opencode' | 'openai' | 'anthropic';
  label: string;
  modelId: string;
  supportsImages: boolean;
  supportsSearch: boolean;
  enabled: boolean;
}

export interface UserModelAccess {
  userId: string;
  modelIds: string[];
}
```

### 8.3. Auth

```ts
export interface SessionUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
}
```

## 9. API routes

### 9.1. `GET /api/auth/me`

Devuelve el usuario autenticado.

```json
{
  "user": {
    "id": "...",
    "email": "user@example.com",
    "role": "user",
    "status": "active"
  }
}
```

### 9.2. `GET /api/chats`

Lista chats del usuario actual.

Query params:

```txt
limit?: number
cursor?: string
```

Respuesta:

```json
{
  "items": [],
  "nextCursor": null
}
```

### 9.3. `POST /api/chats`

Crea chat vacío o con primer mensaje.

```json
{
  "id": "uuid",
  "message": {
    "role": "user",
    "parts": [{ "type": "text", "text": "..." }]
  },
  "model": "openai/gpt-...",
  "webSearch": false
}
```

### 9.4. `GET /api/chats/:id`

Carga chat completo con mensajes, votos y ramas anotadas.

### 9.5. `POST /api/chats/:id/stream`

Endpoint usado por `useChat`.

Entrada:

```json
{
  "model": "openai/gpt-...",
  "messages": [],
  "webSearch": false
}
```

Salida: `UIMessageStreamResponse`.

Reglas:

1. Requiere sesión.
2. Verifica propiedad del chat.
3. Verifica acceso al modelo.
4. Normaliza attachments.
5. Persiste último mensaje del usuario antes del stream.
6. Ejecuta `streamText`.
7. Persiste mensajes finales en `onFinish`.
8. Guarda `lastUsage`.
9. Actualiza ramas.

### 9.6. `DELETE /api/chats/:id/messages`

Usado para editar/regenerar.

Entrada:

```json
{
  "messageId": "...",
  "type": "edit" | "regenerate"
}
```

### 9.7. `POST /api/chats/:id/branches`

Cambia snapshot activo.

```json
{
  "rootMessageId": "...",
  "snapshotId": "..."
}
```

### 9.8. `POST /api/chats/:id/votes`

```json
{
  "messageId": "...",
  "isUpvoted": true
}
```

### 9.9. `GET /api/models`

Devuelve solo los modelos habilitados para el usuario.

## 10. Streaming en React

### 10.1. Cliente

`components/chat/ChatShell.tsx` debe ser un Client Component.

Responsabilidades:

1. Recibir `initialChat` desde server component.
2. Inicializar `useChat`.
3. Usar `DefaultChatTransport` apuntando a `/api/chats/${chatId}/stream`.
4. Renderizar `messages` por `parts`.
5. Manejar `status`, `stop`, `regenerate`, `error`.
6. Sincronizar sidebar al terminar el stream.

Pseudoestructura:

```tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export function ChatShell({ initialChat, selectedModel }) {
  const chat = useChat({
    id: initialChat.id,
    messages: initialChat.messages,
    transport: new DefaultChatTransport({
      api: `/api/chats/${initialChat.id}/stream`,
      body: {
        model: selectedModel,
        webSearch: initialChat.webSearch ?? false,
      },
    }),
  });

  return (
    <div>
      <ChatMessages messages={chat.messages} status={chat.status} />
      <ChatInput
        status={chat.status}
        onSubmit={(text) => chat.sendMessage({ text })}
        onStop={chat.stop}
      />
    </div>
  );
}
```

### 10.2. Servidor

`app/api/chats/[id]/stream/route.ts`:

```ts
import { streamChat } from '@/server/ai/stream-chat';

export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  return streamChat({ chatId: id, body, request: req });
}
```

## 11. Servicio `streamChat`

Responsabilidades:

1. `requireUser(req)`.
2. `getChatForUser(chatId, user.id)`.
3. Validar modelo.
4. Validar permisos de modelo.
5. Preparar mensajes para modelo.
6. Resolver herramientas de búsqueda.
7. Ejecutar `streamText`.
8. Devolver `toUIMessageStreamResponse`.
9. Persistir en `onFinish`.

Pseudoestructura:

```ts
export async function streamChat(input: StreamChatInput): Promise<Response> {
  const user = await requireUser(input.request);
  const chat = await getChatForUser(input.chatId, user.id);
  if (!chat) return jsonError('Chat not found', 404);

  await assertUserCanUseModel(user.id, input.body.model);

  const normalizedMessages = normalizeMessageAttachments(input.body.messages);
  await persistLastUserMessage(chat.id, normalizedMessages, input.body.webSearch);

  const provider = createProviderForModel(input.body.model);
  const tools = await resolveTools({ user, model: input.body.model, webSearch: input.body.webSearch });

  const result = streamText({
    model: provider.model,
    system: buildSystemPrompt({ webSearch: input.body.webSearch, tools }),
    messages: await convertToModelMessages(
      await prepareMessagesForModel(normalizedMessages, input.body.model, chat.id),
    ),
    tools: tools.definitions,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: normalizedMessages,
    onFinish: async ({ messages }) => {
      await persistFinishedMessages({
        chatId: chat.id,
        messages: sanitizeMessagesForStorage(messages),
        usage: await result.totalUsage,
      });
    },
  });
}
```

## 12. Attachments

### 12.1. Cambio conceptual

En Vue local, attachments usan OPFS y URLs `attachment://`. En React Cloud-only, `attachment://` puede mantenerse como identificador lógico, pero debe resolverse desde storage remoto.

Formato recomendado:

```txt
attachment://<attachment_id>
```

La tabla `attachments` guarda `storage_key`.

### 12.2. Flujo

1. Usuario selecciona archivo.
2. `POST /api/attachments` recibe archivo.
3. Backend valida tamaño, MIME y sesión.
4. Backend sube a storage.
5. Backend crea fila en `attachments`.
6. Cliente inserta file part con:

```ts
{
  type: 'file',
  filename,
  mediaType,
  url: `attachment://${attachmentId}`,
  providerMetadata: {
    keryx: { storageKey: attachmentId }
  }
}
```

7. `prepareMessagesForModel` resuelve `attachment://` desde storage antes de llamar al proveedor.

### 12.3. Storage

Opciones válidas:

1. Supabase Storage.
2. Cloudflare R2.
3. Vercel Blob.

Para mantener independencia, crear:

```ts
export interface AttachmentStorage {
  put(input: PutAttachmentInput): Promise<StoredAttachment>;
  getDataUrl(attachmentId: string): Promise<string>;
  getBase64(attachmentId: string): Promise<string>;
  deleteByChat(chatId: string): Promise<void>;
}
```

## 13. Autenticación e invitaciones

### 13.1. Login

Usar Supabase Auth email/password.

Rutas:

```txt
/login
/invite/[token]
```

### 13.2. Registro restringido

Flujo:

1. Admin genera invitación.
2. Backend crea token aleatorio.
3. Se guarda `hash(token)` en `invitations`.
4. Usuario abre `/invite/:token`.
5. Frontend llama `POST /api/invitations/validate`.
6. Usuario crea cuenta con email/password.
7. Backend marca invitación como usada.
8. Backend crea/actualiza fila en `users`.

### 13.3. Guards

En Next.js:

1. Middleware para proteger rutas privadas.
2. `requireUser` en todos los route handlers privados.
3. `requireAdmin` en `/admin/*` y `/api/admin/*`.

## 14. Model access

### 14.1. Regla

El cliente no decide qué modelos puede usar. El endpoint `/api/models` devuelve modelos permitidos según usuario.

### 14.2. Validación server-side

Antes de cada stream:

```ts
await assertUserCanUseModel(user.id, requestedModel);
```

Si no tiene acceso:

```txt
403 Forbidden
```

### 14.3. Admin

Panel admin debe permitir:

1. Activar/desactivar modelos globales.
2. Asignar modelos a usuario.
3. Revocar modelos.
4. Ver proveedor y capacidades.

## 15. UI React

### 15.1. Componentes esenciales

```txt
ChatShell
ChatMessages
ChatMessageItem
ChatInput
MessageActions
BranchSelector
AttachmentPreview
AppSidebar
SettingsDialog
ModelSelector
SearchSettings
```

### 15.2. Estado

Usar dos tipos de estado:

1. Server state: React Query o SWR para chats, modelos, usuario.
2. UI state: Zustand o React Context para sidebar, tema, layout, preferencias temporales.

No usar Zustand para duplicar toda la base de datos en cliente.

### 15.3. Render de mensajes

Renderizar por `message.parts`, no por `message.content`.

Casos mínimos:

```txt
text
reasoning
tool-call
tool-result
file
source/url
```

## 16. Migración de lógica reutilizable

Se pueden portar casi directamente:

1. `cloneJson`.
2. `syncCurrentBranchSnapshots`.
3. `ensureBranchState`.
4. `openNewBranch`.
5. `annotateBranchMetadata`.
6. `upsertUserMessage`.
7. `prepareMessagesForModel`.
8. `normalizeMessageAttachments`.
9. `sanitizeMessagesForStorage`.
10. Definiciones de modelos.
11. Prompts base.
12. Tools Tavily.

Pero deben moverse a carpetas independientes de Vue:

```txt
domain/chat/branching.ts
domain/chat/message-normalization.ts
server/ai/prepare-messages.ts
server/ai/tools.ts
server/ai/providers.ts
```

## 17. Eliminaciones explícitas

Eliminar de la nueva versión React:

```txt
src/workers/opfs.worker.ts
src/utils/opfsWorkerClient.ts
src/adapters/static/clientApiInterceptor.ts
src/utils/secureStorage.ts para API keys
VITE_DEPLOY_MODE
VITE_ENABLE_OPFS
VITE_ENABLE_LOCAL_KEYS
```

No se recomienda portar estos archivos salvo como referencia histórica.

## 18. Orden de implementación

### Fase 1: base React

1. Crear proyecto Next.js + TypeScript.
2. Configurar Tailwind.
3. Instalar shadcn/ui.
4. Crear layout base.
5. Crear tema claro/oscuro.
6. Crear rutas `/login`, `/`, `/chat/[id]`, `/admin`.

### Fase 2: dominio

1. Crear `domain/chat/types.ts`.
2. Crear `domain/chat/branching.ts`.
3. Crear `domain/chat/message-normalization.ts`.
4. Crear `domain/models/types.ts`.
5. Crear `domain/auth/types.ts`.

### Fase 3: base de datos

1. Crear schema SQL.
2. Crear cliente Turso.
3. Crear queries de users.
4. Crear queries de chats.
5. Crear queries de messages.
6. Crear queries de votes.
7. Crear queries de branches.
8. Crear queries de models/access.

### Fase 4: auth

1. Configurar Supabase.
2. Crear login.
3. Crear `requireUser`.
4. Crear `requireAdmin`.
5. Crear invitaciones.
6. Proteger rutas.

### Fase 5: chats sin IA

1. `GET /api/chats`.
2. `POST /api/chats`.
3. `GET /api/chats/:id`.
4. `PATCH /api/chats/:id`.
5. `DELETE /api/chats/:id`.
6. Sidebar funcional.
7. Chat page con mensajes persistidos.

### Fase 6: streaming

1. Crear `server/ai/providers.ts`.
2. Crear `server/ai/stream-chat.ts`.
3. Crear `/api/chats/:id/stream`.
4. Conectar `useChat`.
5. Persistir último mensaje de usuario.
6. Persistir mensajes finales en `onFinish`.
7. Guardar `lastUsage`.

### Fase 7: edición, regeneración y branches

1. Portar branching.
2. Implementar `DELETE /api/chats/:id/messages`.
3. Implementar `POST /api/chats/:id/branches`.
4. Renderizar selector de ramas.
5. Añadir pruebas de snapshots.

### Fase 8: attachments

1. Crear storage adapter.
2. Crear `/api/attachments`.
3. Crear `/api/attachments/:id`.
4. Portar normalización de file parts.
5. Resolver imágenes/textos en backend.
6. Añadir límites de tamaño.

### Fase 9: búsqueda web

1. Portar Tavily tools.
2. Crear settings de búsqueda.
3. Guardar preferencia por usuario.
4. Validar `webSearch` server-side.
5. Inyectar instrucciones de investigación en system prompt.

### Fase 10: administración

1. Panel de usuarios.
2. Panel de invitaciones.
3. Panel de modelos.
4. Asignación de modelos por usuario.
5. Desactivación de usuarios.

### Fase 11: hardening

1. Rate limits.
2. Logs de errores.
3. Validación Zod en todos los endpoints.
4. Tests unitarios.
5. Tests de integración API.
6. Tests E2E básicos.
7. Revisión de exposición de variables.

## 19. Pruebas mínimas

### Unitarias

1. `branching.test.ts`.
2. `message-normalization.test.ts`.
3. `model-access.test.ts`.
4. `invitation-service.test.ts`.
5. `chat-queries.test.ts`.

### Integración

1. Crear chat autenticado.
2. Rechazar chat sin sesión.
3. Cargar solo chats propios.
4. Rechazar modelo no autorizado.
5. Persistir stream completo.
6. Regenerar respuesta y crear branch.
7. Cambiar snapshot.
8. Votar mensaje.
9. Subir attachment.

### E2E

1. Login.
2. Crear chat.
3. Enviar mensaje.
4. Ver streaming.
5. Recargar página y ver mensajes persistidos.
6. Regenerar respuesta.
7. Admin crea invitación.
8. Usuario acepta invitación.

## 20. Riesgos principales

| Riesgo | Mitigación |
|---|---|
| Perder comportamiento de branches | Portar primero `branching.ts` con tests. |
| Streaming no persiste al terminar | Cubrir `onFinish` con integración. |
| Doble fuente de verdad entre `useChat` y DB | DB es fuente persistente; `useChat` solo estado transitorio. |
| Exposición de API keys | Validar imports server-only y variables sin `NEXT_PUBLIC_`. |
| Model access manipulable desde cliente | Validar siempre en backend. |
| Attachments rotos | Mantener `attachment://id` como contrato lógico. |
| UI demasiado grande | Componentizar por mensaje, acciones, input y sidebar. |
| Migración lenta | Implementar vertical slice: auth → chats → stream → branches. |

## 21. Vertical slice inicial recomendado

La primera versión funcional debe tener solo:

1. Login.
2. Usuario autenticado.
3. Crear chat.
4. Listar chats.
5. Abrir chat.
6. Enviar mensaje.
7. Streaming.
8. Persistencia final.
9. Recargar y ver historial.

No incluir todavía:

1. Attachments.
2. Branches.
3. Admin.
4. Tavily.
5. Votos.
6. i18n.
7. Settings avanzados.

Esto reduce riesgo y valida el núcleo React Cloud-only.

## 22. Criterio de aceptación final

La migración React Cloud-only se considera completa cuando:

1. No existe dependencia runtime de OPFS.
2. No existe interceptor local de `fetch`.
3. El usuario no puede usar la app sin login.
4. El registro requiere invitación.
5. Todos los chats se guardan en DB remota.
6. El streaming ocurre desde backend.
7. Las API keys no llegan al navegador.
8. Los modelos se autorizan en backend.
9. Admin puede gestionar usuarios, invitaciones y modelos.
10. La UI React cubre creación, lectura, edición, regeneración, ramas, votos y attachments.
11. Los tests cubren dominio, API y flujo principal E2E.

## 23. Recomendación final

La migración debe ejecutarse como una reconstrucción controlada, no como conversión automática de Vue a React. La pieza crítica no es el framework visual, sino preservar el contrato de conversación: mensajes `UIMessage`, `parts`, attachments, branches, votos, permisos de modelo y persistencia al finalizar el stream.

El camino correcto es construir primero el núcleo Cloud-only en React con un vertical slice mínimo y después portar gradualmente las capacidades avanzadas de Keryx.
