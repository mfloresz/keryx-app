Sí: el plan debe tratar el proyecto como **un mismo producto con dos modos de ejecución**, no como dos aplicaciones separadas. La edición actual debe quedar como **Static/Local Mode**, mientras la nueva versión debe implementarse como **Cloud Mode** con Supabase Auth, Turso y Vercel Functions.

El cambio central es este: **la UI debe dejar de depender directamente de OPFS o Turso**. Debe hablar con una capa común de adapters. Cada modo decide internamente si usa OPFS/localStorage o backend cloud.

---

# Plan de implementación revisado: Static Mode + Cloud Mode desde el mismo repositorio

## 0. Objetivo final

El repositorio debe poder generar dos despliegues distintos:

| Modo     | Nombre sugerido           | Persistencia |          Auth |  API keys |        Usuarios | Uso ideal                                     |
| -------- | ------------------------- | -----------: | ------------: | --------: | --------------: | --------------------------------------------- |
| `static` | Local/Self-hosted Edition |         OPFS |            No | Navegador | 1 usuario local | Uso personal, offline/parcial, self-hosted    |
| `cloud`  | Cloud/SaaS Edition        |        Turso | Supabase Auth |  Servidor |    Multiusuario | Roles, invitaciones, permisos, administración |

Vercel permite conectar proyectos a repositorios Git y desplegar automáticamente por rama o producción. También permite configurar variables de entorno por proyecto/entorno, lo que hace viable tener **dos proyectos Vercel apuntando al mismo repositorio** con `VITE_DEPLOY_MODE=static` y `VITE_DEPLOY_MODE=cloud`. ([Vercel][1])

---

# 1. Principio arquitectónico obligatorio

## 1.1. No duplicar el repositorio

No crear:

```txt
keryx-static/
keryx-cloud/
```

Crear una sola base:

```txt
keryx/
  src/
  api/
  package.json
  vite.config.ts
```

Y controlar comportamiento con variables:

```env
VITE_DEPLOY_MODE=static
```

o:

```env
VITE_DEPLOY_MODE=cloud
```

---

## 1.2. No llenar la app de `if (cloud)`

Evitar esto:

```ts
if (import.meta.env.VITE_DEPLOY_MODE === 'cloud') {
  // lógica cloud
} else {
  // lógica OPFS
}
```

repetido por toda la aplicación.

En su lugar, crear **interfaces comunes**:

```ts
ChatRepository
AuthAdapter
ModelRepository
AttachmentRepository
AITransport
```

Y resolver la implementación una sola vez desde un archivo central.

---

# 2. Diagnóstico del proyecto actual

El proyecto actual está fuertemente orientado a modo local:

1. Inicializa OPFS al arrancar la app.
2. Intercepta `fetch` hacia `/api/chats/*` en el navegador.
3. Usa `apiFetch` para simular rutas API del lado cliente.
4. Guarda chats, votos, ramas y adjuntos en OPFS.
5. Persiste proveedor/modelo en `localStorage`.

Esto se ve en `main.ts`, donde se inicializa `initOpfsWorker()` y se interceptan rutas `/api/chats/*` para resolverlas localmente mediante `apiFetch`. 

El shape de datos actual ya contiene una buena base para conservar compatibilidad entre modos:

```ts
ChatRecord {
  id,
  title,
  visibility,
  createdAt,
  messages,
  votes,
  webSearch,
  branches
}
```

Ese tipo incluye mensajes, votos y ramas de conversación, por lo que puede funcionar como contrato común entre OPFS y Turso. 

---

# 3. Estructura objetivo de carpetas

Reorganizar progresivamente hacia esta estructura:

```txt
src/
  app/
    bootstrap.ts
    config.ts

  domain/
    chat/
      types.ts
      ports.ts
    auth/
      types.ts
      ports.ts
    models/
      types.ts
      ports.ts
    attachments/
      types.ts
      ports.ts

  adapters/
    static/
      staticAuthAdapter.ts
      opfsChatRepository.ts
      opfsAttachmentRepository.ts
      browserAITransport.ts
      staticModelRepository.ts

    cloud/
      supabaseAuthAdapter.ts
      cloudChatRepository.ts
      cloudAttachmentRepository.ts
      serverAITransport.ts
      cloudModelRepository.ts

  services/
    chatService.ts
    modelService.ts
    invitationService.ts

  stores/
    chat.ts
    auth.ts
    models.ts

  pages/
    index.vue
    chat/[id].vue
    login.vue
    invite/[token].vue
    admin/
      index.vue
      users.vue
      invitations.vue
      models.vue

api/
  chats/
    index.ts
    [id].ts
    [id]/messages.ts
    [id]/stream.ts
    [id]/votes.ts
    [id]/branches.ts

  auth/
    me.ts

  invitations/
    validate.ts
    accept.ts
    index.ts

  admin/
    users.ts
    models.ts
    user-model-access.ts

  internal/
    title.ts

server/
  db/
    turso.ts
    schema.sql
    queries/
      chats.ts
      messages.ts
      users.ts
      invitations.ts
      models.ts

  auth/
    requireUser.ts
    requireAdmin.ts
    supabaseAdmin.ts

  ai/
    streamChat.ts
    modelAccess.ts
```

---

# 4. Variables de entorno

## 4.1. Variables comunes

```env
VITE_DEPLOY_MODE=static | cloud
VITE_APP_NAME=Keryx
```

---

## 4.2. Static Mode

```env
VITE_DEPLOY_MODE=static
VITE_ENABLE_AUTH=false
VITE_ENABLE_LOCAL_KEYS=true
VITE_ENABLE_OPFS=true
VITE_ENABLE_ADMIN=false
```

En este modo:

* Se permite configurar API keys en el navegador.
* Se usa OPFS.
* No hay login.
* No hay roles.
* No se cargan rutas admin.
* No se llama a Turso ni a Supabase.

---

## 4.3. Cloud Mode

```env
VITE_DEPLOY_MODE=cloud
VITE_ENABLE_AUTH=true
VITE_ENABLE_LOCAL_KEYS=false
VITE_ENABLE_OPFS=false
VITE_ENABLE_ADMIN=true

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

AI_GATEWAY_API_KEY=
TAVILY_API_KEY=
APP_BASE_URL=
INVITATION_SECRET=
```

En este modo:

* Supabase maneja identidad.
* Turso guarda chats y permisos.
* Vercel Functions ejecutan streaming.
* Las API keys nunca llegan al navegador.
* Los modelos se autorizan en backend.

Supabase Auth soporta login con email/password, que encaja con tu requisito de registro por correo y contraseña. ([Supabase][2])

---

# 5. Despliegue en Vercel

## 5.1. Dos proyectos Vercel, mismo repositorio

Crear:

```txt
keryx-static
keryx-cloud
```

Ambos apuntan al mismo repo.

| Proyecto Vercel | Rama   | Variables                 | Resultado       |
| --------------- | ------ | ------------------------- | --------------- |
| `keryx-static`  | `main` | `VITE_DEPLOY_MODE=static` | App local-first |
| `keryx-cloud`   | `main` | `VITE_DEPLOY_MODE=cloud`  | App SaaS        |

Vercel permite configurar variables de entorno fuera del código y diferenciarlas por entorno. ([Vercel][3])

---

## 5.2. Build command

El mismo comando puede servir:

```bash
npm run build
```

Pero internamente debe leer:

```ts
import.meta.env.VITE_DEPLOY_MODE
```

---

## 5.3. Reglas de build

En `static`:

* No debe requerir `SUPABASE_*`.
* No debe requerir `TURSO_*`.
* No debe requerir `AI_GATEWAY_API_KEY`.
* Puede incluir funciones `/api`, pero no debe depender de ellas para chat.

En `cloud`:

* Debe fallar el build si faltan variables server críticas.
* Debe deshabilitar OPFS.
* Debe ocultar configuración de API keys locales.
* Debe mostrar login.

---

# 6. Etapa 1: crear configuración central de modo

Crear:

```ts
// src/app/config.ts

export type DeployMode = 'static' | 'cloud'

export const DEPLOY_MODE = import.meta.env.VITE_DEPLOY_MODE as DeployMode

export const IS_STATIC_MODE = DEPLOY_MODE === 'static'
export const IS_CLOUD_MODE = DEPLOY_MODE === 'cloud'

export const features = {
  auth: import.meta.env.VITE_ENABLE_AUTH === 'true',
  localKeys: import.meta.env.VITE_ENABLE_LOCAL_KEYS === 'true',
  opfs: import.meta.env.VITE_ENABLE_OPFS === 'true',
  admin: import.meta.env.VITE_ENABLE_ADMIN === 'true',
}
```

Añadir validación:

```ts
if (!['static', 'cloud'].includes(DEPLOY_MODE)) {
  throw new Error(`Invalid VITE_DEPLOY_MODE: ${DEPLOY_MODE}`)
}
```

---

# 7. Etapa 2: encapsular bootstrap

Actualmente `main.ts` inicializa OPFS siempre y registra el fetch interceptor para `/api/chats/*`. Eso debe quedar condicionado al modo static. 

Crear:

```ts
// src/app/bootstrap.ts

import { IS_STATIC_MODE } from './config'

export async function bootstrapApp() {
  if (IS_STATIC_MODE) {
    const { initOpfsWorker } = await import('@/utils/opfsWorkerClient')
    const { enableClientApiInterceptor } = await import('@/adapters/static/clientApiInterceptor')

    initOpfsWorker()
    enableClientApiInterceptor()
  }
}
```

Modificar `main.ts`:

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import i18n from './i18n'
import { bootstrapApp } from './app/bootstrap'
import { useTheme } from './composables/useTheme'

useTheme()

await bootstrapApp()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)
app.mount('#app')
```

Resultado esperado:

* En `static`: OPFS + interceptación local.
* En `cloud`: no OPFS, no interceptación local.

---

# 8. Etapa 3: aislar el fetch interceptor

Mover la lógica actual de `main.ts` a:

```txt
src/adapters/static/clientApiInterceptor.ts
```

```ts
import { apiFetch } from '@/utils/clientApi'

const CLIENT_API_ROUTES = [/^\/api\/chats(\/.*)?$/]

function isClientApiRoute(url: string): boolean {
  const pathname = new URL(url, location.href).pathname
  return CLIENT_API_ROUTES.some((re) => re.test(pathname))
}

export function enableClientApiInterceptor() {
  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : String(input)

    if (isClientApiRoute(url)) {
      try {
        const response = await apiFetch(input, init, originalFetch)
        if (response instanceof Response) return response
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error'
        return new Response(JSON.stringify({ message }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
    }

    return originalFetch(input, init)
  }
}
```

Regla:

```txt
Este interceptor solo existe en static mode.
Cloud mode nunca debe interceptar /api/chats.
```

---

# 9. Etapa 4: definir contratos de dominio

Crear tipos compartidos independientes de OPFS/Turso.

```ts
// src/domain/chat/types.ts

export interface ChatRecord {
  id: string
  title: string | null
  visibility: 'public' | 'private'
  createdAt: string
  updatedAt?: string
  messages: UIMessage[]
  votes: VoteRecord[]
  webSearch?: boolean
  branches?: Record<string, ChatBranchState>
}

export interface ChatSummary {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
  lastMessagePreview?: string | null
}

export interface VoteRecord {
  chatId: string
  messageId: string
  isUpvoted: boolean | null
}

export interface ChatBranchSnapshot {
  id: string
  label: string
  createdAt: string
  messages: UIMessage[]
}

export interface ChatBranchState {
  rootMessageId: string
  includeRoot: boolean
  currentSnapshotId: string
  snapshots: ChatBranchSnapshot[]
}
```

Crear puerto:

```ts
// src/domain/chat/ports.ts

export interface ChatRepository {
  listChats(params?: { limit?: number; cursor?: string }): Promise<ChatSummary[]>
  createChat(input: CreateChatInput): Promise<ChatRecord>
  getChat(id: string): Promise<ChatRecord>
  getMessages(chatId: string, params?: MessagePageParams): Promise<UIMessage[]>
  deleteChat(id: string): Promise<void>
  updateTitle(id: string, title: string): Promise<ChatRecord>
  deleteOrBranchMessage(input: DeleteOrBranchMessageInput): Promise<void>
  switchBranch(input: SwitchBranchInput): Promise<ChatRecord>
  getVotes(chatId: string): Promise<VoteRecord[]>
  vote(input: VoteInput): Promise<VoteRecord>
}
```

Regla:

```txt
La UI solo puede depender de ChatRepository.
Nunca debe importar opfsWorkerClient directamente desde pages/components/stores.
```

---

# 10. Etapa 5: crear repository factory

```ts
// src/services/repositories.ts

import { IS_CLOUD_MODE } from '@/app/config'

export async function createChatRepository() {
  if (IS_CLOUD_MODE) {
    const { cloudChatRepository } = await import('@/adapters/cloud/cloudChatRepository')
    return cloudChatRepository
  }

  const { opfsChatRepository } = await import('@/adapters/static/opfsChatRepository')
  return opfsChatRepository
}
```

O con export síncrono si prefieres imports estáticos:

```ts
export const chatRepository: ChatRepository =
  IS_CLOUD_MODE ? cloudChatRepository : opfsChatRepository
```

Preferencia: **factory async** para evitar incluir código cloud en static y viceversa cuando el bundler pueda hacer code splitting.

---

# 11. Etapa 6: adaptar el store de chats

Actualmente el store llama directamente a:

```ts
fetch('/api/chats')
```

Eso funciona porque en static el navegador intercepta `/api/chats`, pero en cloud debe ir al backend real. El store no debería saberlo.

Modificar `src/stores/chat.ts`:

```ts
const chatRepo = await createChatRepository()

async function fetchChats() {
  isLoading.value = true
  try {
    const data = await chatRepo.listChats({ limit: 30 })
    chats.value = data.map((chat) => ({
      id: chat.id,
      label: chat.title || 'Untitled',
      to: `/chat/${chat.id}`,
      createdAt: chat.createdAt,
    }))
  } finally {
    isLoading.value = false
  }
}
```

Regla:

```txt
fetch('/api/chats') solo debe existir dentro de cloudChatRepository.
apiFetch solo debe existir dentro de static mode.
```

---

# 12. Etapa 7: adaptar creación de chat

## 12.1. Static Mode

Mantener flujo actual:

1. Generar `crypto.randomUUID()`.
2. Persistir adjuntos en OPFS.
3. Guardar chat en OPFS.
4. Navegar a `/chat/:id`.
5. Auto-regenerar al montar.

Este es el flujo que ya usa la página inicial: crea ID, persiste el chat y navega a `/chat/:id`. 

---

## 12.2. Cloud Mode

Nuevo flujo:

1. `POST /api/chats`
2. Backend crea chat en Turso.
3. Backend guarda primer mensaje.
4. Backend responde `{ id }`.
5. Frontend navega a `/chat/:id`.
6. Chat page carga mensajes desde Turso.
7. Frontend inicia stream contra `/api/chats/:id/stream`.

Endpoint:

```http
POST /api/chats
Authorization: Bearer <supabase_jwt>
Content-Type: application/json
```

Body:

```json
{
  "message": {
    "role": "user",
    "parts": [{ "type": "text", "text": "..." }]
  },
  "webSearch": false
}
```

Response:

```json
{
  "id": "chat_uuid",
  "title": null,
  "createdAt": "2026-05-19T00:00:00.000Z"
}
```

---

# 13. Etapa 8: auth por modo

## 13.1. Static Auth Adapter

```ts
export const staticAuthAdapter: AuthAdapter = {
  async getSession() {
    return {
      user: {
        id: 'local-user',
        email: null,
        role: 'local',
      },
    }
  },
  async login() {
    return
  },
  async logout() {
    return
  },
}
```

---

## 13.2. Cloud Auth Adapter

Usar Supabase Auth:

```ts
export const cloudAuthAdapter: AuthAdapter = {
  async getSession() {
    const { data } = await supabase.auth.getSession()
    return data.session
  },

  async login(email, password) {
    return supabase.auth.signInWithPassword({ email, password })
  },

  async logout() {
    return supabase.auth.signOut()
  },
}
```

Supabase Auth soporta email/password y expone SDKs/API para administrar usuarios y sesiones. ([Supabase][2])

---

# 14. Etapa 9: router por modo

Rutas comunes:

```txt
/
 /chat/:id
```

Solo cloud:

```txt
/login
/invite/:token
/admin
/admin/users
/admin/invitations
/admin/models
```

Guard:

```ts
router.beforeEach(async (to) => {
  if (IS_STATIC_MODE) {
    if (to.path.startsWith('/admin') || to.path.startsWith('/login') || to.path.startsWith('/invite')) {
      return '/'
    }
    return true
  }

  const session = await authAdapter.getSession()

  if (!session && to.path !== '/login' && !to.path.startsWith('/invite')) {
    return '/login'
  }

  if (to.path.startsWith('/admin')) {
    const me = await authRepository.me()
    if (me.role !== 'admin') return '/'
  }

  return true
})
```

---

# 15. Etapa 10: modelos por modo

El proyecto actual usa `useModels()` con `localStorage` para provider/model y deriva modelos desde `getModels(provider)`. 

## 15.1. Static Mode

Mantener:

* Provider local: Vercel/OpenCode.
* Modelo en `localStorage`.
* API key local.
* Lista estática desde `shared/utils/models`.

---

## 15.2. Cloud Mode

Cambiar:

* No mostrar provider si el usuario no debe elegir provider.
* No permitir API keys locales.
* Obtener modelos permitidos desde backend:

```http
GET /api/models/allowed
```

Response:

```json
[
  {
    "id": "openai/gpt-5.4-nano",
    "provider": "vercel",
    "displayName": "GPT 5.4 Nano",
    "supportsImages": true,
    "supportsSearch": true
  }
]
```

Backend valida otra vez en cada stream:

```ts
await assertModelAllowed(user.id, modelId)
```

Regla:

```txt
En cloud mode, el frontend nunca decide autorización de modelo.
Solo renderiza lo que backend dice que está permitido.
```

---

# 16. Etapa 11: base de datos Turso

Turso/libSQL es apropiado como base SQLite distribuida y tiene cliente TypeScript oficial; para este caso, el acceso debe ocurrir desde Vercel Functions, no desde el navegador. ([Turso][4])

## 16.1. Schema inicial

```sql
create table users (
  id text primary key,
  email text not null unique,
  role text not null check (role in ('admin', 'user')),
  created_at text not null,
  updated_at text not null
);

create table invitations (
  id text primary key,
  email text not null,
  token_hash text not null unique,
  role text not null check (role in ('admin', 'user')) default 'user',
  expires_at text not null,
  used_at text,
  created_by text not null,
  created_at text not null,
  initial_model_access_json text
);

create index idx_invitations_token_hash on invitations(token_hash);
create index idx_invitations_email on invitations(email);

create table models (
  id text primary key,
  provider text not null,
  display_name text not null,
  supports_images integer not null default 0,
  supports_search integer not null default 0,
  enabled integer not null default 1,
  created_at text not null,
  updated_at text not null
);

create table user_model_access (
  user_id text not null,
  model_id text not null,
  created_at text not null,
  primary key (user_id, model_id),
  foreign key (user_id) references users(id) on delete cascade,
  foreign key (model_id) references models(id) on delete cascade
);

create index idx_user_model_access_user_id on user_model_access(user_id);

create table chats (
  id text primary key,
  user_id text not null,
  title text,
  visibility text not null check (visibility in ('private', 'public')) default 'private',
  web_search integer not null default 0,
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  foreign key (user_id) references users(id) on delete cascade
);

create index idx_chats_user_updated on chats(user_id, updated_at desc);

create table messages (
  id text primary key,
  chat_id text not null,
  user_id text not null,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  parts_json text not null,
  metadata_json text,
  sequence integer not null,
  status text not null default 'completed',
  created_at text not null,
  foreign key (chat_id) references chats(id) on delete cascade,
  foreign key (user_id) references users(id) on delete cascade,
  unique(chat_id, sequence)
);

create index idx_messages_chat_sequence on messages(chat_id, sequence);

create table votes (
  chat_id text not null,
  message_id text not null,
  user_id text not null,
  is_upvoted integer,
  created_at text not null,
  updated_at text not null,
  primary key (chat_id, message_id, user_id),
  foreign key (chat_id) references chats(id) on delete cascade,
  foreign key (message_id) references messages(id) on delete cascade,
  foreign key (user_id) references users(id) on delete cascade
);

create table chat_branches (
  id text primary key,
  chat_id text not null,
  root_message_id text not null,
  include_root integer not null,
  current_snapshot_id text not null,
  snapshots_json text not null,
  created_at text not null,
  updated_at text not null,
  foreign key (chat_id) references chats(id) on delete cascade
);

create index idx_chat_branches_chat_id on chat_branches(chat_id);

create table attachments (
  id text primary key,
  chat_id text not null,
  user_id text not null,
  message_id text,
  filename text not null,
  media_type text not null,
  size integer not null,
  storage_provider text not null,
  storage_key text not null,
  created_at text not null,
  foreign key (chat_id) references chats(id) on delete cascade,
  foreign key (user_id) references users(id) on delete cascade
);
```

---

# 17. Etapa 12: Vercel Functions cloud

## 17.1. Middleware de sesión

```ts
// server/auth/requireUser.ts

export async function requireUser(req: Request) {
  const token = extractBearerToken(req)

  if (!token) {
    throw new Response('Unauthorized', { status: 401 })
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !data.user) {
    throw new Response('Unauthorized', { status: 401 })
  }

  const appUser = await getUserById(data.user.id)

  if (!appUser) {
    throw new Response('User profile not found', { status: 403 })
  }

  return appUser
}
```

---

## 17.2. Admin guard

```ts
export async function requireAdmin(req: Request) {
  const user = await requireUser(req)

  if (user.role !== 'admin') {
    throw new Response('Forbidden', { status: 403 })
  }

  return user
}
```

---

## 17.3. Endpoints mínimos

```txt
GET    /api/auth/me

GET    /api/chats
POST   /api/chats
GET    /api/chats/:id
DELETE /api/chats/:id
PATCH  /api/chats/:id/title

GET    /api/chats/:id/messages
POST   /api/chats/:id/stream

GET    /api/chats/:id/votes
POST   /api/chats/:id/votes

POST   /api/chats/:id/branches
DELETE /api/chats/:id/messages

GET    /api/models/allowed

GET    /api/admin/users
GET    /api/admin/models
POST   /api/admin/models
PATCH  /api/admin/models/:id
POST   /api/admin/user-model-access

GET    /api/admin/invitations
POST   /api/admin/invitations
POST   /api/invitations/validate
POST   /api/invitations/accept
```

---

# 18. Etapa 13: streaming cloud

## 18.1. Contrato del endpoint

```http
POST /api/chats/:id/stream
Authorization: Bearer <jwt>
Content-Type: application/json
```

Body:

```json
{
  "messages": [],
  "model": "openai/gpt-5.4-nano",
  "webSearch": false
}
```

Validaciones obligatorias:

```ts
const user = await requireUser(req)
const chat = await getChatById(chatId)

assert(chat.user_id === user.id)
await assertModelAllowed(user.id, model)
```

---

## 18.2. Persistencia durante stream

Orden recomendado:

1. Recibir último mensaje del usuario.
2. Validar propiedad del chat.
3. Validar modelo.
4. Guardar o hacer upsert del mensaje user.
5. Ejecutar `streamText`.
6. Emitir chunks al frontend.
7. En `onFinish`, guardar assistant message.
8. Actualizar `chats.updated_at`.
9. Generar título si aún no existe.

---

## 18.3. Importante sobre fallos

Guardar estado:

```txt
messages.status = completed | streaming | failed
```

Si falla:

* No borrar el mensaje del usuario.
* Guardar assistant message parcial solo si realmente hubo contenido útil.
* Permitir regenerar.

---

# 19. Etapa 14: invitaciones

## 19.1. Requisito

El usuario solo puede registrarse si tiene enlace de invitación.

No basta con ocultar `/signup`. El backend debe bloquear el alta.

---

## 19.2. Flujo admin

```txt
Admin → /admin/invitations
  → email
  → role
  → allowed models
  → expiration
  → create invitation
```

Backend:

1. Genera token aleatorio.
2. Guarda hash del token.
3. Devuelve link completo.
4. Nunca guarda token plano.

```ts
const token = crypto.randomUUID() + crypto.randomUUID()
const tokenHash = await sha256(token)
```

Link:

```txt
https://cloud.keryx.app/invite/<token>
```

---

## 19.3. Validación de invitación

```http
POST /api/invitations/validate
```

Body:

```json
{
  "token": "raw-token"
}
```

Response:

```json
{
  "valid": true,
  "email": "user@example.com",
  "role": "user",
  "expiresAt": "..."
}
```

---

## 19.4. Aceptar invitación

```http
POST /api/invitations/accept
```

Body:

```json
{
  "token": "raw-token",
  "password": "user-password"
}
```

Backend:

1. Valida token.
2. Verifica `used_at is null`.
3. Verifica `expires_at > now`.
4. Crea usuario en Supabase Auth.
5. Crea registro en `users`.
6. Inserta modelos permitidos en `user_model_access`.
7. Marca invitación como usada.
8. Devuelve sesión o pide login.

---

# 20. Etapa 15: adjuntos

## 20.1. Static Mode

Mantener OPFS:

```txt
attachment://<storageKey>
```

El proyecto ya usa una convención `attachment://` para referenciar adjuntos. 

---

## 20.2. Cloud Mode

Usar:

* Supabase Storage, o
* Vercel Blob, o
* S3 compatible.

Recomendación inicial: **Supabase Storage**, porque ya usarás Supabase Auth.

En Turso guardar solo metadata:

```txt
attachments.storage_key
attachments.filename
attachments.media_type
attachments.size
```

En `parts_json`, guardar:

```json
{
  "type": "file",
  "filename": "document.pdf",
  "mediaType": "application/pdf",
  "url": "cloud-attachment://attachment_id"
}
```

Resolver `cloud-attachment://` en backend antes de mandar al modelo.

---

# 21. Etapa 16: compatibilidad con AI SDK Vue

El componente actual usa `Chat` de `@ai-sdk/vue` y `DefaultChatTransport`. Esa parte puede mantenerse, pero el endpoint cambia según modo.

Static:

```ts
api: `/api/chats/${chatId}`
```

Cloud:

```ts
api: `/api/chats/${chatId}/stream`
```

Crear helper:

```ts
export function getChatStreamApi(chatId: string) {
  return IS_CLOUD_MODE
    ? `/api/chats/${chatId}/stream`
    : `/api/chats/${chatId}`
}
```

En cloud, el transport debe enviar Authorization:

```ts
transport: new DefaultChatTransport({
  api: getChatStreamApi(chatId.value),
  headers: async () => ({
    Authorization: `Bearer ${await getAccessToken()}`,
  }),
})
```

---

# 22. Etapa 17: edición, regeneración y ramas

Tu app ya tiene lógica de edición, regeneración y branching. No la elimines; extrae la semántica.

## 22.1. Static Mode

Sigue usando:

```txt
DELETE /api/chats/messages/:id
POST /api/chats/branches/:id
```

interceptado localmente.

---

## 22.2. Cloud Mode

Implementar endpoints equivalentes en Vercel:

```txt
DELETE /api/chats/:id/messages
POST /api/chats/:id/branches
```

Regla de compatibilidad:

```txt
La respuesta JSON debe tener el mismo shape que static mode.
```

---

# 23. Etapa 18: migración interna gradual

No hacer todo de golpe. Orden recomendado:

## Fase A — Preparar dual-mode sin Turso

1. Crear `VITE_DEPLOY_MODE`.
2. Mover interceptor fuera de `main.ts`.
3. Hacer que static mode siga funcionando igual.
4. Añadir guards para que cloud mode no inicialice OPFS.

Criterio de éxito:

```txt
VITE_DEPLOY_MODE=static npm run dev
```

funciona igual que hoy.

---

## Fase B — Introducir adapters

1. Crear interfaces.
2. Crear `opfsChatRepository`.
3. Cambiar stores/pages para usar repository.
4. Mantener implementación OPFS por debajo.

Criterio de éxito:

```txt
La app sigue funcionando en static mode, pero pages/stores ya no importan OPFS directamente.
```

---

## Fase C — Backend cloud mínimo

1. Crear Turso.
2. Crear schema.
3. Crear Supabase Auth.
4. Crear `requireUser`.
5. Crear:

   * `GET /api/chats`
   * `POST /api/chats`
   * `GET /api/chats/:id/messages`

Criterio de éxito:

```txt
Usuario autenticado ve lista de chats vacía y puede crear un chat en Turso.
```

---

## Fase D — Streaming cloud

1. Crear `/api/chats/:id/stream`.
2. Validar sesión.
3. Validar ownership.
4. Guardar user message.
5. Stream assistant.
6. Guardar assistant message.

Criterio de éxito:

```txt
Cloud mode puede conversar y al recargar conserva mensajes desde Turso.
```

---

## Fase E — Model ACL

1. Crear tabla `models`.
2. Crear `user_model_access`.
3. Crear `/api/models/allowed`.
4. Reescribir `useModels()` para cloud.
5. Validar modelo en backend.

Criterio de éxito:

```txt
Un usuario solo ve y solo puede usar modelos asignados.
```

---

## Fase F — Invitaciones

1. Crear tabla `invitations`.
2. Crear admin UI.
3. Crear validate/accept endpoints.
4. Bloquear registro libre.
5. Crear usuario Supabase desde invitación.

Criterio de éxito:

```txt
Sin invitación válida no se puede crear cuenta.
Con invitación válida se crea usuario, rol y permisos de modelos.
```

---

## Fase G — Admin

1. `/admin/users`
2. `/admin/models`
3. `/admin/invitations`
4. Gestión de permisos por usuario.

Criterio de éxito:

```txt
Admin puede crear invitaciones y asignar modelos.
Usuario normal no puede entrar a /admin.
```

---

## Fase H — Adjuntos cloud

1. Subida a Supabase Storage.
2. Metadata en Turso.
3. Resolución server-side.
4. Compatibilidad con imágenes/texto/PDF.

Criterio de éxito:

```txt
Los adjuntos sobreviven a recarga y pueden enviarse al modelo desde cloud mode.
```

---

# 24. Reglas de no contradicción

Estas reglas deben respetarse durante toda la implementación:

## 24.1. Static Mode

```txt
Debe funcionar sin Supabase.
Debe funcionar sin Turso.
Debe permitir API keys locales.
Debe usar OPFS.
No debe requerir login.
No debe mostrar admin.
No debe depender de Vercel Functions para conversar.
```

---

## 24.2. Cloud Mode

```txt
Debe requerir Supabase Auth.
Debe usar Turso como fuente de verdad.
No debe inicializar OPFS.
No debe interceptar fetch.
No debe permitir API keys locales.
No debe confiar en modelos enviados por cliente.
No debe permitir registro sin invitación.
No debe consultar Turso desde el navegador.
```

---

## 24.3. Ambos modos

```txt
Deben compartir UI.
Deben compartir ChatRecord shape tanto como sea posible.
Deben compartir componentes de mensajes.
Deben compartir lógica visual de branching.
Deben compartir ChatInput.
Deben compartir renderizado markdown.
Deben diferir solo en adapters, auth, storage y transport.
```

---

# 25. Testing mínimo por etapa

## Static

```txt
Crear chat nuevo.
Recargar chat.
Cambiar de chat y volver.
Editar mensaje.
Regenerar respuesta.
Cambiar rama.
Votar respuesta.
Adjuntar archivo.
Usar API key local.
```

## Cloud

```txt
Login.
Bloqueo sin sesión.
Crear chat.
Recargar chat desde Turso.
Cargar solo lista reciente.
Abrir chat y cargar mensajes.
Streaming.
Guardar assistant message al finalizar.
Editar.
Regenerar.
Branching.
Votar.
Validar modelo permitido.
Rechazar modelo no permitido.
Crear invitación.
Aceptar invitación.
Bloquear invitación usada.
Bloquear invitación expirada.
Bloquear /admin a usuario normal.
```

---

# 26. Riesgos principales

## 26.1. Mezclar OPFS y cloud accidentalmente

Riesgo: que cloud use interceptor local por error.

Solución:

```ts
if (IS_STATIC_MODE) enableClientApiInterceptor()
```

Y añadir test:

```txt
En cloud mode, window.fetch no debe ser sobrescrito por clientApi.
```

---

## 26.2. Exponer tokens de Turso

Riesgo: usar cliente Turso desde Vue.

Solución:

```txt
Todo acceso a Turso vive en /server o /api.
Nunca en src/adapters/cloud del navegador.
```

`cloudChatRepository` debe llamar a endpoints HTTP propios, no a Turso directamente.

---

## 26.3. Doble fuente de verdad

Riesgo: guardar parcialmente en local y parcialmente en Turso.

Solución:

```txt
Static source of truth: OPFS.
Cloud source of truth: Turso.
Frontend state: cache/render temporal.
```

---

## 26.4. Autorización incompleta

Riesgo: ocultar botones pero no proteger endpoints.

Solución:

```txt
Cada endpoint cloud debe llamar requireUser o requireAdmin.
Cada endpoint de chat debe validar ownership.
Cada stream debe validar model ACL.
```

---

## 26.5. Incompatibilidad de mensajes

Riesgo: `parts_json` no coincide con lo que espera AI SDK.

Solución:

```txt
Crear funciones serializeMessage() y deserializeMessage().
Usarlas en ambos modos.
No guardar variantes diferentes por adapter.
```

---

# 27. Orden concreto de commits sugerido

```txt
01 add-deploy-mode-config
02 move-static-fetch-interceptor
03 conditionally-bootstrap-opfs
04 extract-chat-domain-types
05 introduce-chat-repository-interface
06 implement-opfs-chat-repository
07 refactor-chat-store-to-repository
08 refactor-index-page-to-repository
09 refactor-chat-page-stream-api-helper
10 add-cloud-auth-adapter
11 add-cloud-router-guards
12 add-turso-schema
13 add-server-db-client
14 add-require-user
15 add-cloud-chat-list-and-create-endpoints
16 add-cloud-message-loading
17 add-cloud-stream-endpoint
18 add-cloud-models-acl
19 refactor-use-models-dual-mode
20 add-invitations-schema-and-endpoints
21 add-invite-page
22 add-admin-invitations-ui
23 add-admin-users-models-ui
24 add-cloud-attachments
25 add-e2e-static-tests
26 add-e2e-cloud-tests
```

---

# 28. Resultado esperado

Al final debes poder ejecutar:

```bash
VITE_DEPLOY_MODE=static npm run build
```

y obtener:

```txt
Keryx Static Edition
- OPFS
- API keys locales
- sin login
- sin Turso
- sin Supabase
```

También:

```bash
VITE_DEPLOY_MODE=cloud npm run build
```

y obtener:

```txt
Keryx Cloud Edition
- Supabase Auth
- Turso
- Vercel Functions
- roles
- invitaciones
- permisos por modelo
```

---

# 29. Recomendación final

El plan correcto no es “migrar de OPFS a Turso”, sino **convertir OPFS y Turso en backends intercambiables**. OPFS queda como backend local para la edición static; Turso queda como backend persistente para la edición cloud. La UI, el renderizado de mensajes, el branching, los votos, el input y la experiencia conversacional deben permanecer compartidos.

La importancia de este enfoque es que te permite ofrecer dos productos desde una sola base: una versión local-first para usuarios técnicos y una versión cloud administrada con autenticación, roles, invitaciones y control real de modelos.

[1]: https://vercel.com/docs/git?utm_source=chatgpt.com "Deploying Git Repositories with Vercel"
[2]: https://supabase.com/docs/guides/auth/passwords?utm_source=chatgpt.com "Password-based Auth | Supabase Docs"
[3]: https://vercel.com/docs/environment-variables?utm_source=chatgpt.com "Environment variables"
[4]: https://docs.turso.tech/sdk/ts/reference?utm_source=chatgpt.com "Reference"
