# Plan de migración rediseñado: JSON monolítico → DAG conversacional sobre OPFS

Basado en el análisis del código actual: `ChatRecord`, `ChatBranchSnapshot`, `clientApi.ts`, `opfs.worker.ts`, `ChatMessageItem.vue`, `[id].vue`, y el adapter AI SDK.

---

# Principios rectores del rediseño

1. **Adapter primero** — Toda la UI sigue consumiendo `UIMessage[]`. El DAG es infraestructura interna.
2. **Sin regresión observable** — Streaming, branching, edición, regeneración, votes, attachments y sidebar deben funcionar idénticos durante toda la migración.
3. **Granularidad de OPFS** — Cada operación en el worker debe ser batching-aware.
4. **Recovery ante corrupción** — OPFS no tiene transacciones; se necesita estrategia de consistencia.
5. **El worker es la autoridad** — El main thread nunca lee archivos OPFS directamente; siempre pide al worker.

---

# FASE 0 — Contrato de adapter

## Objetivo

Definir la interfaz que separa el mundo DAG del mundo UI, **antes de tocar cualquier persistencia**.

## Crear `src/utils/chatAdapter.ts`

```ts
export interface FlatChatView {
  id: string
  title: string | null
  visibility: 'public' | 'private'
  createdAt: string
  messages: UIMessage[]
  votes: VoteRecord[]
  webSearch: boolean
  branchMetadata: Record<string, KeryxBranchMeta>
}

export interface KeryxBranchMeta {
  rootMessageId: string
  currentSnapshotId: string
  currentIndex: number
  snapshotCount: number
  snapshots: Array<{ id: string; label: string }>
}

export function buildFlatView(chat: ChatRecord): FlatChatView
export function injectBranchMetadata(chat: ChatRecord): ChatRecord
```

## Implementación

`buildFlatView` y `injectBranchMetadata` extraen la lógica que hoy está inline en `clientApi.ts:459-502` (`annotateBranchMetadata`) y en `[id].vue:92-107` (carga de votes).

**Por qué primero**: Este adapter es el único punto por donde la UI consume datos del chat. Una vez existe, todas las fases posteriores pueden cambiar el storage sin tocar la UI.

## Cómo se usa hoy vs cómo se usará

```ts
// ANTES (esparcido en clientApi.ts)
const chat = await getChat(chatId)
return jsonResponse({ ...annotateBranchMetadata(chat), isOwner: true })

// DESPUÉS
const chat = await getChat(chatId)
return jsonResponse(buildFlatView(chat))
```

---

# FASE 1 — Tipos del DAG

## Objetivo

Definir los tipos sin cambiar persistencia. Conviven con `ChatRecord`.

## `src/types/messageNode.ts`

```ts
export interface MessageNode {
  id: string
  chatId: string
  role: 'user' | 'assistant' | 'system'
  parts: any[]
  createdAt: string
  parentId: string | null
  childrenIds: string[]
  metadata?: Record<string, any>
}
```

## `src/types/branch.ts`

```ts
export interface BranchState {
  id: string
  chatId: string
  rootMessageId: string
  includeRoot: boolean
  leafMessageId: string
  label: string
  createdAt: string
}
```

## `src/types/chatMeta.ts`

```ts
export interface ChatMeta {
  id: string
  title: string | null
  visibility: 'public' | 'private'
  createdAt: string
  activeBranchId: string
  webSearch: boolean
}
```

**Nota**: `BranchState.leafMessageId` reemplaza a `ChatBranchSnapshot.messages[]`. No incluye `snapshots` ni `currentSnapshotId` — esos se derivan navegando `childrenIds` del nodo root.

---

# FASE 2 — Worker operations para DAG

## Objetivo

Agregar operaciones granulares al worker OPFS **sin eliminar las existentes**. Ambas APIs conviven.

## Nuevas operaciones en `opfs-protocol.ts`

```ts
| { reqId: string; type: 'dag-get-chat-chain'; chatId: string; branchId: string }
| { reqId: string; type: 'dag-save-message'; chatId: string; node: MessageNode }
| { reqId: string; type: 'dag-get-message'; chatId: string; messageId: string }
| { reqId: string; type: 'dag-create-branch'; chatId: string; branch: BranchState }
| { reqId: string; type: 'dag-get-branch'; chatId: string; branchId: string }
| { reqId: string; type: 'dag-update-branch-leaf'; chatId: string; branchId: string; leafMessageId: string }
| { reqId: string; type: 'dag-append-child'; chatId: string; parentId: string; childId: string }
| { reqId: string; type: 'dag-migrate-chat'; chatId: string }
| { reqId: string; type: 'dag-save-chat-meta'; chatId: string; meta: ChatMeta }
```

## Estructura OPFS del DAG

```
opfs/
└── chats/
    ├── index.json
    └── {chatId}/
        ├── chat.json          ← ChatMeta (sin messages, sin branches)
        ├── index.json          ← { branchIds[], activeBranchId, messageCount }
        ├── messages/
        │   ├── {msgId}.json
        │   └── ...
        ├── branches/
        │   ├── {branchId}.json
        │   └── ...
        ├── votes.json
        └── attachments → (sin cambio, ya funciona por chatId)
```

## Batch read: `dag-get-chat-chain`

Esta es la operación crítica para no degradar rendimiento.

```ts
async function dagGetChatChain(
  chatId: string,
  branchId: string,
): Promise<{ meta: ChatMeta; branch: BranchState; nodes: MessageNode[]; votes: VoteRecord[] } | null>
```

El worker:

1. Lee `chat.json` (1 read)
2. Lee `branches/{branchId}.json` (1 read)
3. Sigue `leafMessageId` → lee `messages/{leafId}.json` → sigue `parentId` hasta null (N reads, donde N = profundidad de la chain)
4. Lee `votes.json` si existe (1 read)
5. Retorna todo en **un solo postMessage**

**Total**: 3 + N reads en el worker, pero **1 sola comunicación** con el main thread.

## Nuevo proxy en `opfsWorkerClient.ts`

```ts
// ... operaciones existentes sin cambio ...

// Operaciones DAG
export function dagGetChatChain(chatId: string, branchId: string) { ... }
export function dagSaveMessage(chatId: string, node: MessageNode) { ... }
export function dagGetMessage(chatId: string, messageId: string) { ... }
export function dagCreateBranch(chatId: string, branch: BranchState) { ... }
export function dagGetBranch(chatId: string, branchId: string) { ... }
export function dagUpdateBranchLeaf(chatId: string, branchId: string, leafMessageId: string) { ... }
export function dagAppendChild(chatId: string, parentId: string, childId: string) { ... }
export function dagMigrateChat(chatId: string) { ... }
export function dagSaveChatMeta(chatId: string, meta: ChatMeta) { ... }
```

---

# FASE 3 — Message cache en el worker

## Objetivo

Evitar que el DAG degrade el rendimiento por N lecturas.

## `src/workers/opfs.worker.ts` — Cache LRU

```ts
const messageCache = new Map<string, MessageNode>()
const MAX_CACHE = 500

function cachedReadMessage(chatId: string, messageId: string): Promise<MessageNode | null> {
  const key = `${chatId}/${messageId}`
  const cached = messageCache.get(key)
  if (cached) return Promise.resolve(cached)

  return readMessageFile(chatId, messageId).then(msg => {
    if (msg) {
      if (messageCache.size >= MAX_CACHE) {
        const first = messageCache.keys().next().value!
        messageCache.delete(first)
      }
      messageCache.set(key, msg)
    }
    return msg
  })
}
```

Se invalida por chatId cuando se cambia de branch o se detecta que el chat fue modificado externamente (checking `chat.json` mtime o hash).

---

# FASE 4 — Consistencia: write-ahead flag

## Objetivo

Mitigar la falta de transacciones en OPFS.

## Estrategia

Un `writing` flag en `chat.json`:

```json
{
  "id": "chat_123",
  "title": "...",
  "activeBranchId": "main",
  "writing": true
}
```

### Algoritmo

```
1. Escribir chat.json con writing: true
2. Escribir messages/{msgId}.json
3. Escribir branches/{branchId}.json
4. Escribir chat.json con writing: false
```

### Recovery

Al abrir un chat en `dag-get-chat-chain`:

```ts
if (meta.writing) {
  // Scan messages/ y branches/ para reconstruir estado consistente
  // Eliminar nodos huérfanos (sin parent referenciable)
  // Si leafMessageId apunta a nodo inexistente, retroceder
  //   hasta encontrar un nodo válido
  meta.writing = false
  await writeChatMeta(meta)
}
```

---

# FASE 5 — Migración lazily

## Objetivo

Convertir chats viejos al formato DAG cuando se abren, sin migration batch.

## `dag-migrate-chat` en el worker

```ts
async function dagMigrateChat(chatId: string): Promise<void> {
  // 1. Leer chat viejo
  const legacy = await readChat(chatId)
  if (!legacy) return

  // 2. Check if already migrated
  const metaFile = await tryReadChatMeta(chatId)
  if (metaFile) return  // ya migrado

  // 3. Crear estructura de directorios
  await getDir(['chats', chatId, 'messages'])
  await getDir(['chats', chatId, 'branches'])

  // 4. Convertir messages lineales a MessageNodes
  const nodes: MessageNode[] = []
  for (let i = 0; i < legacy.messages.length; i++) {
    const msg = legacy.messages[i]
    const node: MessageNode = {
      id: msg.id,
      chatId,
      role: msg.role,
      parts: msg.parts,
      createdAt: msg.createdAt ?? new Date().toISOString(),
      parentId: i > 0 ? legacy.messages[i - 1].id : null,
      childrenIds: i < legacy.messages.length - 1 ? [legacy.messages[i + 1].id] : [],
      metadata: {},
    }
    nodes.push(node)
    await writeMessageFile(chatId, node)
  }

  // 5. Convertir branches
  for (const [rootId, branchState] of Object.entries(legacy.branches ?? {})) {
    const currentSnapshot = branchState.snapshots.find(
      s => s.id === branchState.currentSnapshotId
    )
    if (!currentSnapshot || currentSnapshot.messages.length === 0) continue

    const branchId = rootId
    const lastMsg = currentSnapshot.messages[currentSnapshot.messages.length - 1]

    // Escribir nodos del snapshot como nuevos MessageNodes
    // con parentId apuntando al chain existente
    let prevId = rootId
    for (let i = 0; i < currentSnapshot.messages.length; i++) {
      const snapMsg = currentSnapshot.messages[i]
      if (i === 0 && branchState.includeRoot) {
        // El root ya existe, solo skipear
        prevId = snapMsg.id
        continue
      }

      const snapNode: MessageNode = {
        id: snapMsg.id,
        chatId,
        role: snapMsg.role,
        parts: snapMsg.parts,
        createdAt: snapMsg.createdAt ?? new Date().toISOString(),
        parentId: prevId,
        childrenIds: [],
        metadata: {},
      }
      await writeMessageFile(chatId, snapNode)

      // Agregar como child del padre
      const parent = await cachedReadMessage(chatId, prevId)
      if (parent && !parent.childrenIds.includes(snapNode.id)) {
        parent.childrenIds.push(snapNode.id)
        await writeMessageFile(chatId, parent)
      }
      prevId = snapMsg.id
    }

    const branch: BranchState = {
      id: branchId,
      chatId,
      rootMessageId: rootId,
      includeRoot: branchState.includeRoot,
      leafMessageId: lastMsg.id,
      label: currentSnapshot.label,
      createdAt: currentSnapshot.createdAt,
    }
    await writeBranchFile(chatId, branch)
  }

  // Branch "main" si no existe
  if (!legacy.branches || !legacy.branches['main']) {
    const mainBranch: BranchState = {
      id: 'main',
      chatId,
      rootMessageId: nodes[0]?.id ?? '',
      includeRoot: true,
      leafMessageId: nodes[nodes.length - 1]?.id ?? '',
      label: 'Original',
      createdAt: legacy.createdAt,
    }
    await writeBranchFile(chatId, mainBranch)
  }

  // 6. Persistir meta
  const meta: ChatMeta = {
    id: chatId,
    title: legacy.title,
    visibility: legacy.visibility ?? 'private',
    createdAt: legacy.createdAt,
    activeBranchId: Object.keys(legacy.branches ?? {})[0] ?? 'main',
    webSearch: legacy.webSearch ?? false,
  }
  await writeChatMeta(chatId, meta)

  // 7. Guardar votes por separado
  await writeVotesFile(chatId, legacy.votes ?? [])

  // 8. Escribir index del chat
  await writeChatIndex(chatId, {
    branchIds: Object.keys(legacy.branches ?? {}),
    activeBranchId: meta.activeBranchId,
    messageCount: nodes.length,
  })

  // 9. NO eliminar el archivo viejo todavía
  // Se elimina en FASE 8 cuando toda la app usa DAG
}
```

**Preserva**: `votes`, `webSearch`, `visibility`, `title`.

---

# FASE 6 — Adapter DAG → FlatChatView

## Objetivo

Conectar el DAG con `Chat` del AI SDK y con la UI.

## `src/utils/chatAdapter.ts` — Extensión completa

```ts
import type { UIMessage } from 'ai'
import type { ChatRecord } from './opfs'
import type { MessageNode, BranchState, ChatMeta } from '../types'

export interface FlatChatView {
  id: string
  title: string | null
  visibility: 'public' | 'private'
  createdAt: string
  messages: UIMessage[]
  votes: VoteRecord[]
  webSearch: boolean
  branchMetadata: Record<string, KeryxBranchMeta>
}

export function nodesToUIMessages(nodes: MessageNode[]): UIMessage[] {
  return nodes.map(node => ({
    id: node.id,
    role: node.role,
    parts: node.parts,
    createdAt: node.createdAt,
    metadata: node.metadata ?? {},
  }))
}

export function buildBranchMeta(
  nodes: MessageNode[],
  branch: BranchState,
  allBranches: BranchState[],
): KeryxBranchMeta {
  const root = nodes.find(n => n.id === branch.rootMessageId)
  const siblingBranches = allBranches.filter(b => b.rootMessageId === branch.rootMessageId)

  return {
    rootMessageId: branch.rootMessageId,
    currentSnapshotId: branch.id,
    currentIndex: 0, // Calculado por posición en siblingBranches
    snapshotCount: siblingBranches.length,
    snapshots: siblingBranches.map(b => ({ id: b.id, label: b.label })),
  }
}

export function buildFlatViewFromDAG(
  meta: ChatMeta,
  nodes: MessageNode[],
  branch: BranchState,
  allBranches: BranchState[],
  votes: VoteRecord[],
): FlatChatView {
  const messages = nodesToUIMessages(nodes)

  const branchMetadata: Record<string, KeryxBranchMeta> = {}

  // Solo inyectar keryxBranch en el mensaje donde hay bifurcación
  const root = nodes.find(n => n.id === branch.rootMessageId)
  if (root && root.childrenIds.length > 1) {
    const branchMeta = buildBranchMeta(nodes, branch, allBranches)
    const rootMsg = messages.find(m => m.id === branch.rootMessageId)
    if (rootMsg) {
      rootMsg.metadata = {
        ...rootMsg.metadata,
        keryxBranch: branchMeta,
      }
    }
  }

  return {
    id: meta.id,
    title: meta.title,
    visibility: meta.visibility,
    createdAt: meta.createdAt,
    messages,
    votes,
    webSearch: meta.webSearch,
    branchMetadata,
  }
}

/**
 * Construye FlatChatView desde el formato legacy (ChatRecord).
 * Se usa durante la transición donde ambos formatos conviven.
 */
export function buildFlatViewFromLegacy(chat: ChatRecord): FlatChatView {
  return injectBranchMetadata(chat) // reutiliza la función existente
}
```

## Integration con AI SDK `Chat`

El punto clave: `[id].vue` usa `new Chat({ messages, transport })` y hace `watch(() => chatData.value?.messages, ...)`.

Estrategia: **No tocar la instancia de Chat**. El adapter produce `UIMessage[]` y alimenta `chatData.value.messages`, igual que hoy. El `Chat` del AI SDK sigue manejando el streaming internamente.

---

# FASE 7 — clientApi.ts: operaciones DAG

## Objetivo

Reescribir las operaciones de `clientApi.ts` para usar DAG internamente, manteniendo el mismo API HTTP).

### Streaming (`POST /api/chats/:id`)

```ts
// ANTES (simplificado):
latestChat.messages = finishedMessages
syncCurrentBranchSnapshots(latestChat)
await saveChat(latestChat)

// DESPUÉS:
// 1. Obtener branch activo
const chain = await dagGetChatChain(chatId, activeBranchId)
// 2. Convertir newMessages a MessageNodes
for (const msg of finishedMessages) {
  const existingNode = await dagGetMessage(chatId, msg.id)
  if (existingNode) {
    // Actualizar nodo existente (ej: assistant que hizo streaming)
    existingNode.parts = msg.parts
    await dagSaveMessage(chatId, existingNode)
  } else {
    // Nuevo nodo
    const parentId = chain.nodes.length > 0
      ? chain.nodes[chain.nodes.length - 1].id
      : null
    const node: MessageNode = {
      id: msg.id,
      chatId,
      role: msg.role,
      parts: msg.parts,
      createdAt: msg.createdAt,
      parentId,
      childrenIds: [],
      metadata: {},
    }
    await dagSaveMessage(chatId, node)
    if (parentId) {
      await dagAppendChild(chatId, parentId, msg.id)
    }
    // Actualizar branch leaf
    await dagUpdateBranchLeaf(chatId, activeBranchId, msg.id)
  }
}
```

### Regeneración (`DELETE /api/chats/messages/:id` con `type: 'regenerate'`)

```ts
// ANTES:
openNewBranch(chat, rootMessageId, includeRoot, branchStartIndex, 'Regeneration')
chat.messages = chat.messages.slice(0, targetIndex)

// DESPUÉS:
// El nuevo assistant se creará cuando el stream termine (FASE 7 streaming).
// Aquí solo necesitamos crear el branch.
const newBranchId = crypto.randomUUID()
const newBranch: BranchState = {
  id: newBranchId,
  chatId,
  rootMessageId: parentMessage.id,
  includeRoot: !hasUserParent,
  leafMessageId: parentMessage.id, // Se actualizará cuando llegue la respuesta
  label: `Regeneration ${snapshotNumber}`,
  createdAt: new Date().toISOString(),
}
await dagCreateBranch(chatId, newBranch)
// Actualizar meta con activeBranchId
await dagSaveChatMeta(chatId, { ...meta, activeBranchId: newBranchId })
```

### Edición (`DELETE /api/chats/messages/:id` con `type: 'edit'`)

```ts
// ANTES:
openNewBranch(chat, messageId, true, targetIndex, 'Edit')
chat.messages = chat.messages.slice(0, targetIndex + 1)

// DESPUÉS:
// El mensaje editado se envía como nuevo user message.
// El branch apunta el leaf al mensaje existente,
// y se crea un nuevo branch que parte del mensaje anterior al editado.
const editBranchId = crypto.randomUUID()
const parentChain = await dagGetChatChain(chatId, activeBranchId)
const targetNodeIdx = parentChain.nodes.findIndex(n => n.id === messageId)
// La chain del branch nuevo es: [...nodes hasta targetIndex]
// Se creará un nuevo MessageNode para el mensaje editado cuando el usuario lo envíe.
const editBranch: BranchState = {
  id: editBranchId,
  chatId,
  rootMessageId: messageId,
  includeRoot: true,
  leafMessageId: messageId, // Se actualizará con la nueva respuesta
  label: `Edit ${snapshotNumber}`,
  createdAt: new Date().toISOString(),
}
await dagCreateBranch(chatId, editBranch)
await dagSaveChatMeta(chatId, { ...meta, activeBranchId: editBranchId })
```

### Branch switching (`POST /api/chats/branches/:id`)

```ts
// ANTES:
// Reemplazar chat.messages con snapshot.messages + inicio
chat.messages = [
  ...chat.messages.slice(0, startIndex),
  ...cloneJson(snapshot.messages),
]

// DESPUÉS:
// Simplemente cambiar activeBranchId y pedir la chain
await dagSaveChatMeta(chatId, { ...meta, activeBranchId: snapshotId })
const result = await dagGetChatChain(chatId, snapshotId)
return buildFlatViewFromDAG(result.meta, result.nodes, result.branch, result.allBranches, result.votes)
```

---

# FASE 8 — Streaming incremental

## Objetivo

Durante streaming, **no reescribir todo el chat**. Solo actualizar el nodo del assistant.

## Estrategia

El AI SDK `Chat` maneja el streaming internamente (agrega parts al `UIMessage` en memoria). No tocamos eso. El cambio es **solo en persistencia**:

### Antes

```ts
onFinish: async ({ messages: finishedMessages }) => {
  latestChat.messages = sanitizeMessagesForStorage(finishedMessages)
  syncCurrentBranchSnapshots(latestChat)
  await saveChat(latestChat)
}
```

### Después

```ts
onFinish: async ({ messages: finishedMessages }) => {
  await withChatLock(chatId, async () => {
    // Solo guardar los mensajes nuevos/actualizados
    for (const msg of finishedMessages) {
      const existing = await dagGetMessage(chatId, msg.id)
      if (existing) {
        existing.parts = sanitizeParts(msg.parts)
        await dagSaveMessage(chatId, existing)
      } else {
        // Nuevo mensaje — crear node y append al chain
        const chain = await dagGetChatChain(chatId, meta.activeBranchId)
        const parentId = chain.nodes.length > 0
          ? chain.nodes[chain.nodes.length - 1].id
          : null
        const node: MessageNode = {
          id: msg.id,
          chatId,
          role: msg.role,
          parts: sanitizeParts(msg.parts),
          createdAt: msg.createdAt ?? new Date().toISOString(),
          parentId,
          childrenIds: [],
          metadata: {},
        }
        await dagSaveMessage(chatId, node)
        if (parentId) await dagAppendChild(chatId, parentId, msg.id)
        await dagUpdateBranchLeaf(chatId, meta.activeBranchId, msg.id)
      }
    }
  })
}
```

### Mid-stream debounce

Opcionalmente, se puede agregar un flush debounced durante streaming:

```ts
let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush(chatId: string, msgId: string, parts: any[]) {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(async () => {
    const node = await dagGetMessage(chatId, msgId)
    if (node) {
      node.parts = parts
      await dagSaveMessage(chatId, node)
    }
  }, 500)
}
```

---

# FASE 9 — Vue reactivity minimalista

## Objetivo

Eliminar `deep: true` watch sobre el array completo de mensajes.

## Antes (`[id].vue:131-136`)

```ts
watch(
  () => chatData.value?.messages,
  (messages) => {
    chat.messages = messages ? cloneJson(messages) : []
  },
  { immediate: true, deep: true },
)
```

## Después

```ts
// chatData ahora es un FlatChatView producido por el adapter
// El adapter ya produce UIMessage[] sin deep cloning

const flatView = ref<FlatChatView | null>(null)

// Carga inicial y branch switching
async function loadChat(branchId?: string) {
  const result = await dagGetChatChain(chatId.value, branchId ?? 'main')
  if (!result) return
  flatView.value = result.flatView
  chat.messages = result.flatView.messages
}

// Cuando el AI SDK actualiza messages internamente (streaming),
// solo necesitamos sincronizar al final:
watch(() => chat.status, async (status, prev) => {
  if ((prev === 'streaming' || prev === 'submitted') && status === 'ready') {
    await nextTick()
    setTimeout(async () => {
      const result = await dagGetChatChain(chatId.value, flatView.value?.activeBranchId ?? 'main')
      if (result) {
        flatView.value = result.flatView
        chat.messages = result.flatView.messages
        await loadVotes()
      }
    }, 0)
  }
})
```

**Elimina `cloneJson`** del watch. El adapter produce `UIMessage[]` directamente desde los nodos, sin deep clone.

---

# FASE 10 — Limpieza del formato legacy

## Objetivo

Eliminar `ChatRecord.messages`, `ChatRecord.branches`, `ChatBranchSnapshot` y las funciones que los manipulan.

### Checklist

- [ ] Eliminar `syncCurrentBranchSnapshots()` de `clientApi.ts`
- [ ] Eliminar `ensureBranchState()` de `clientApi.ts`
- [ ] Eliminar `openNewBranch()` de `clientApi.ts`
- [ ] Eliminar `annotateBranchMetadata()` de `clientApi.ts`
- [ ] Eliminar `cloneJson()` de `clientApi.ts` (la FASE 9 ya la eliminó)
- [ ] Eliminar `ChatBranchSnapshot` y `ChatBranchState` de `opfs.ts`
- [ ] Eliminar `ChatRecord.messages`, `Votes[]`, `branches` (reemplazado por `ChatMeta`)
- [ ] En el worker: eliminar `readChat()`, `saveChat()` (la versión legacy) — solo si ya no hay chats sin migrar
- [ ] Eliminar el archivo `{chatId}.json` legacy después de migrar
- [ ] Actualizar tests

### Limpieza OPFS

```ts
// En dag-migrate-chat, al final:
// Verificar que todo está bien
const chain = await dagGetChatChain(chatId, meta.activeBranchId)
if (chain) {
  // Eliminar archivo viejo
  try {
    const dir = await getDir([CHATS_DIR])
    await dir.removeEntry(`${chatId}.json`)
  } catch { /* ignorar */ }
}
```

---

# FASE 11 — Eliminar `JSON.parse(JSON.stringify())` del worker

## Objetivo

El worker usa `cloneJson` en `hydrateChatRecord` (línea 142). Con el DAG, la hidratación cambia:

### Antes

```ts
const hydrated = cloneJson(chat)  // Deep clone de todo el chat
// ... hidratar cada mensaje, cada snapshot ...
```

### Después

```ts
// Solo hidratar la chain activa
async function dagHydrateChain(
  chatId: string,
  nodes: MessageNode[],
): Promise<UIMessage[]> {
  const hydrated: UIMessage[] = []
  for (const node of nodes) {
    const parts = await hydrateMessageParts(node.parts, chatId)
    hydrated.push({
      id: node.id,
      role: node.role,
      parts,
      createdAt: node.createdAt,
      metadata: node.metadata ?? {},
    })
  }
  return hydrated
}
```

**Elimina deep clone** y **solo hidrata la branch activa** en vez de todas las branches.

---

# FASE 12 — Background indexing y sidebar

## Objetivo

El sidebar hoy usa `index.json` que contiene `{ id, title, createdAt }`. Se extiende con metadata del DAG.

### `chats/{chatId}/index.json`

```json
{
  "branchIds": ["main", "branch_2"],
  "activeBranchId": "main",
  "messageCount": 423,
  "lastMessagePreview": "Último texto del assistant..."
}
```

### Sidebar sin cargar el chat completo

El sidebar ya usa `listChats()` que lee `chats/index.json`. No necesita cambios inmediatos, pero se puede agregar `lastMessagePreview` en un futuro para previews.

---

# FASE 13 — Index.json del sidebar extendido

## (Opcional, sin blockers)

Extender `ChatIndexEntry` con metadata del DAG:

```ts
export interface ChatIndexEntry {
  id: string
  title: string | null
  createdAt: string
  messageCount?: number       // NUEVO
  lastActiveAt?: string       // NUEVO
  lastBranchId?: string       // NUEVO
}
```

Actualización lazy: al guardar un mensaje, actualizar el index sin leer todo el directorio.

---

# Orden de ejecución

```
FASE 0  → Definir adapter (contracto)
FASE 1  → Tipos DAG
FASE 2  → Worker operations (convive con legacy)
FASE 3  → Message cache en worker
FASE 4  → Write-ahead flag + recovery
FASE 5  → Migración lazily
FASE 6  → Adapter DAG → FlatChatView (bidireccional)
FASE 7  → clientApi.ts operaciones DAG
FASE 8  → Streaming incremental
FASE 9  → Vue reactivity minimalista
FASE 10 → Limpieza legacy
FASE 11 → Eliminar cloneJson del worker
FASE 12 → Background indexing
FASE 13 → Sidebar extendido
```

**Cada fase es deployable independientemente.** Las fases 0-6 conviven con el formato legacy. La fase 7 es el punto de switching. Las fases 8-9 son optimizaciones que requieren la 7. La fase 10 es limpieza que solo se hace cuando la 8-9 están estables.

---

# Resumen de cambios vs plan original

| Aspecto | Plan original | Plan rediseñado |
|---|---|---|
| **Orden** | Fase 6 (adapter) al final | Fase 0 (adapter) primero |
| **AI SDK compat** | No mencionada | Adapter bidireccional explícito |
| **`keryxBranch` contract** | No mencionado | Preservado en `buildBranchMeta` |
| **Batch reads** | No mencionado | `dagGetChatChain` retorna todo en 1 call |
| **Cache en worker** | Fase genérica | Fase 3, con invalidación por chatId |
| **OPFS atomicidad** | No mencionada | Fase 4: write-ahead flag + recovery |
| **Votes** | Eliminados sin reemplazo | `votes.json` separado |
| **Migración** | Sin preservar `votes`, `webSearch`, `visibility` | Preserva todo |
| **Hidratación attachments** | No mencionada | Fase 11: solo branch activa |
| **Eliminación `cloneJson`** | Fase genérica | Fase 9 (Vue) + Fase 11 (worker) |
| **Sidebar** | Fase 12 genérica | Sin cambios hasta Fase 12-13, opcional |
| **`MessageNode` sin `branchId`** | `branchId` en MessageNode | Eliminado del tipo (se deriva de `BranchState`) |
