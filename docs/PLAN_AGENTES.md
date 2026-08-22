# Plan — Feature Agentes

> Fecha: 2026-08-22 · Estado: **Ajustado tras aclaraciones** · No OPFS (legacy descartado)

## 0. Resumen

System prompts específicos por tarea (Agentes) que **sobrescriben** el prompt base. Existen agentes **globales** (admin) y **custom por usuario**. El admin además gestiona los prompts globales **Base** y **Título** embebidos en código (`internal/config/prompts.go:7`, `:80`), con override en DB y **Reset** que borra el registro y vuelve al embebido. Los usuarios no pueden editar globales; para editar un agente admin deben **duplicarlo** como copia propia. Los campos de edición/creación de agentes exponen **tags insertables** `{username}`, `{datetime}`, `{language}` que se resuelven en backend vía `applyUserContext` (`internal/api/router_chats.go:782`). Selección de agente vía botón `+` del `PromptInput`; agente activo se muestra al lado del selector de modo (Rápido/Reflexionar/Extendido) con `X` al hover para salir.

---

## 1. Decisiones confirmadas (no ambiguas)

| Requisito | Decisión |
|---|---|
| **Composición** | **Sobrescribe**, no aditivo. Si `agentId != null` → `effectiveSystemPrompt = agent.system_prompt`; si `null` → `basePrompt` efectivo. `buildSearchSystemPrompt()` (`internal/api/web_search.go:224`) y `applyUserContext()` se aplican **después**, sobre el ganador. |
| **Tags** | Campos `system_prompt` (agentes) y `prompt_overrides.prompt` deben soportar placeholders `{username}`, `{datetime}`, `{language}`. UI expone chips/botones para insertar tags en cursor. Backend resuelve todos vía `applyUserContext` + `languageName`. |
| **OPFS** | Descartado. Solo backend Go + PocketBase. Toda persistencia en colecciones PocketBase. |
| **Selector agente** | Botón `+` (`PromptInputActionMenu` en `frontend/src/components/chat/ChatInput.vue:164`) añade ítem `Agentes`. Al seleccionar, `ChatInput.vue` emite `update:agentId`. Display: badge al lado del `Select` de preset (`ChatInput.vue:184`) con nombre + `X` visible en `group-hover`. |
| **Reset** | Solo para **prompts globales** (`prompt_overrides` keys `base`/`title`). `DELETE /api/admin/prompt-overrides/{key}` borra registro → fallback a embebido. Para agentes built-in, `DELETE`/`POST reset` borra override global y vuelve a catálogo embebido. |
| **Colección chats** | Añadir `agent_id` (`TextField`, nullable) a `ChatsCollection` (`internal/store/store_schema.go:130`) para persistir selección por chat. |

---

## 2. Topología — 4 Invariantes (ajustada a sobrescritura)

### State — ¿Dónde vive el estado?
- **Embebidos (source of truth código):** `defaultBaseSystemPrompt`, `defaultTitleGenerationSystemPrompt` (`internal/config/prompts.go`), y nuevo `DefaultAgents []BuiltinAgent` en `internal/config/agents.go`.
- **Overrides DB:**
  - `prompt_overrides` — singleton por `key` (`base`|`title`). Si no existe registro → embebido. Admin-only (`TitleGenerationPolicyCollection` pattern `:251`).
  - `agents` — una colección, `owner` nullable. `owner=null` = global (visible a todos). `owner=userId` = privado. `builtin_id` identifica override de catálogo. `GetEffective*` hace `FindFirst` en DB primero.
- **Chat:** `chats.agent_id` persiste elección. `null` = sin agente (usa base). Si el agente referenciado se borra → stream hace fallback a base + `slog.Warn`.

### Feedback — ¿Dónde vive el feedback?
- `auditLog()` (`internal/api/router_admin.go:16`) para toda mutación admin (`prompt_override.set/delete`, `agent.create/update/delete/reset`).
- `slog.Info/Warn` en `handleChatStream` (`router_chats.go:581,600`) loguear `effectivePromptSource: embedded|override`, `agentId`, `agentSource: builtin|global_override|user_custom|none`, `hasTags`.
- Frontend: toasts existentes (`useToast` en `admin/index.vue:5`) + badge `override` en admin indicando origen.

### Coupling — ¿Qué se rompe si borro esto?
- Borrar `prompt_overrides` → seguro, fallback embebido (mismo que `store_title_policy.go:10`).
- Borrar `agents` global usado por chats → degradación a base, no 500. Handler `GetAgentForStream` retorna `ErrNotFound` → fallback.
- `KeryxChatTransport.ts:114` envía `agentId`. Clientes viejos sin `agentId` siguen funcionando (backend trata `""` como `null`).
- Admin lista dependiente de catálogo embebido: si se renombra un `builtin_id`, overrides huérfanos quedan ocultos pero no rompen.

### Timing — ¿Cuándo puede fallar el orden?
- Edición concurrente de `prompt_overrides` por 2 admins → last-write-wins (igual que `SetTitleGenerationPolicy:27`). Aceptable; `adminLimiter` (`router.go:46`) mitiga.
- `agents` user concurrente creando mismo `builtin_id` → índice único `unique(owner, builtin_id)` evita duplicado override. `sync.Map` chat locks (`router.go:30`) no needed aquí, pero `agent_id` en chat se guarda con lock existente (`lockChat` en `router_chats.go:62`).

---

## 3. Catálogo embebido + Tags

**`internal/config/agents.go` (nuevo):**
```go
type BuiltinAgent struct {
  ID           string // ej. "general", "code-reviewer", "legal", "writing"
  Name         string
  Description  string
  Icon         string // lucide name ej. "code", "scale"
  SystemPrompt string
}
var DefaultAgents = []BuiltinAgent{
  {ID: "general", Name: "General", SystemPrompt: defaultBaseSystemPrompt},
  {ID: "code-reviewer", Name: "Revisor de Código", ...},
  {ID: "legal", ...},
  {ID: "writing", ...},
}
```

**Tags disponibles (mismo motor que `applyUserContext`):**
- `{username}` — `authStore.userName || userEmail` o `Store.GetUserByID` fallback (`router_chats.go:785`)
- `{datetime}` — `new Date().toISOString()` del cliente o `time.Now()` server, localizado a `timezone` (`router_chats.go:799`)
- `{language}` — `locale.value` → `languageName()` (`router_chats.go:827`)
- (Interno) `{language}` también usado en `titlePrompt` (`router_chats.go:760`)

UI de edición/creación: fila de chips ` {username} · {datetime} · {language}` que inserta en `textarea` en posición de cursor + tooltip explicando resolución.

---

## 4. Modelo de datos (PocketBase)

### 4.1 `prompt_overrides`
```
name: prompt_overrides
fields:
  key        TextField(required, max 20, unique) // "base" | "title"
  prompt     TextField(required, max 20000)
  updated_by RelationField(users, maxSelect 1, optional)
  + autodate (created/updated)
rules: ListRule/ViewRule/CreateRule/UpdateRule/DeleteRule = adminOnly
       adminOnly = "@request.auth.id != '' && @collection.users.id = @request.auth.id && @collection.users.role = 'admin'"
index: idx_key_unique true (key)
```
Helpers `internal/store/store_prompt_overrides.go`:
- `GetEffectiveBasePrompt() string` → `FindFirst(key="base")` else `config.defaultBaseSystemPrompt`
- `GetEffectiveTitlePrompt() string` → idem con `defaultTitleGenerationSystemPrompt`
- `SetPromptOverride(key, prompt, actorID)` / `DeletePromptOverride(key)` (reset)

Seed: no hay; vacío = embebido.

### 4.2 `agents`
```
name: agents
fields:
  builtin_id    TextField(max 80, optional, index) // null si custom puro
  owner         RelationField(users, maxSelect 1, optional) // null=global
  name          TextField(required, max 80)
  description   TextField(max 300, optional)
  system_prompt TextField(required, max 10000)
  icon          TextField(max 40, optional)
  + autodate
rules:
  list/view: "@request.auth.id != '' && (owner = null || owner = @request.auth.id)"
  create:    "@request.auth.id != '' && (owner = @request.auth.id || (@request.auth.role='admin' && owner = null))"
  update/delete: "owner = @request.auth.id || (@request.auth.role='admin' && owner = null)"
indexes:
  idx_owner_builtin unique (owner, builtin_id) where builtin_id != ''
  idx_owner_name    unique (owner, name)
```
**Resolución efectiva** `internal/store/store_agents.go`:
- `ListEffectiveAgents(userID, role) []EffectiveAgent` — merge: por cada `DefaultAgents`, buscar `FindFirst(builtin_id=id && owner=null)` → si existe usar override, sino builtin; + `FindRecords(owner=null && builtin_id=''||null)` (globales custom) + `FindRecords(owner=userID)` (privados). Retorna con campo `source: builtin|override|global_custom|user_custom`.
- `GetAgentForStream(agentID, userID, role) (*Agent, error)` — valida visibilidad (`owner=null` o `owner=userID`).
- `DuplicateAgent(fromID, userID)` — copia global a `owner=userID`, `builtin_id=null`, `name = orig.name + " (copia)"`.

### 4.3 `chats` — migración
En `ensureChatsCollection` (`store_schema.go:130`) añadir:
```go
c.Fields.Add(&core.TextField{Name: "agent_id", Max: 80})
```
Para colecciones existentes `ensureField` lo añade. `store_chats.go:SaveChat`/`chatFromRecord` incluir `AgentID`.

---

## 5. Backend — Flujo de resolución en `handleChatStream` (`router_chats.go:600`)

**Antes:**
```go
systemPrompt = req.System; if "" { systemPrompt = Cfg.BaseSystemPrompt }
systemPrompt += buildSearchSystemPrompt()
systemPrompt = applyUserContext(...)
```

**Después (sobrescritura + tags):**
```go
var systemPrompt string
if req.AgentID != "" {
  if ag, err := s.Store.GetAgentForStream(req.AgentID, userID, role); err == nil {
    systemPrompt = ag.SystemPrompt
    slog.Info("stream agent", "agentId", ag.ID, "source", ag.Source, "chat", chatID)
  } else {
    slog.Warn("agent not found, fallback to base", "agentId", req.AgentID, "chat", chatID)
    systemPrompt = s.Store.GetEffectiveBasePrompt()
  }
} else if req.System != "" {
  systemPrompt = req.System // backward compat
} else {
  systemPrompt = s.Store.GetEffectiveBasePrompt()
}
if webSearchActive { systemPrompt += s.buildSearchSystemPrompt() }
systemPrompt = s.applyUserContext(systemPrompt, req.Username, req.Datetime, req.Language, req.Timezone, userID)
```

`GenerateTitle` (`router_chats.go:759`):
```go
titlePrompt := s.Store.GetEffectiveTitlePrompt()
titlePrompt = strings.ReplaceAll(titlePrompt, "{language}", languageName(lang))
```

Campos request `handleChatStream` añadir `AgentID string \`json:"agentId"\``.

Persistencia: `persistUserMessage`/`appendAssistantMessage` no necesitan cambios salvo `chats.agent_id` se actualiza vía `PATCH /api/chats/{id}/agent`.

---

## 6. API

### Admin (`adminRoute` en `router.go:155`, `adminLimiter`)
```
GET    /api/admin/prompt-overrides
       → { base: {prompt, source: embedded|override, updatedAt}, title: {...} }
PUT    /api/admin/prompt-overrides/{key}  key=base|title  body {prompt: string 1..20000}
DELETE /api/admin/prompt-overrides/{key}  → 200 {success:true} (reset = borra, fallback)

GET    /api/admin/agents
       → []EffectiveAgent {id, builtinId, owner, name, description, icon, systemPrompt, source, created, updated}
POST   /api/admin/agents  body {name, description?, systemPrompt, icon?, builtinId?}
       // si builtinId set → crea override de catálogo
PUT    /api/admin/agents/{id}  body {name?, description?, systemPrompt?, icon?}
       // solo si owner=null, rechaza si caller no admin
DELETE /api/admin/agents/{id}
       // si builtin_id != "" → borra override (reset a catálogo); sino borra global custom
```

### User (`withAuth`, `accountLimiter`/`streamLimiter`)
```
GET    /api/agents            → lista visible (merge globales + propios)
GET    /api/agents/{id}       → detalle si visible
POST   /api/agents            body {name, description?, systemPrompt, icon?}
PUT    /api/agents/{id}       // solo owner==me
DELETE /api/agents/{id}       // solo owner==me
POST   /api/agents/{id}/duplicate  // copia global a privado
```

### Chat
```
PATCH  /api/chats/{id}/agent  body {agentId: string|null}
POST   /api/chats/{id}/stream body += {agentId?: string}
GET    /api/agents ya cubre selector
```

Validaciones: `systemPrompt` 1..10000, `name` 1..80, max 50 agentes por user (enforced en handler), sanitizar no-ejecutable (no HTML, igual que `prompts.go:67`).

---

## 7. Frontend — Admin (`frontend/src/pages/admin/index.vue:1`)

Ubicación: nueva Sección **E. Prompts & Agentes** debajo de Model Presets (grid `xl:grid-cols-2` existente `:829`).

**Card Prompts Generales:**
- 2 bloques: `Prompt Base` / `Prompt Título`, cada uno `Textarea` (shadcn) con contador chars, badges `Embebido`/`Override`, botones `Guardar` (disabled sin cambios) y `Restablecer` (visible solo si `source==override`, confirma con `Dialog`).
- Fila de chips tags insertables debajo de cada textarea: `{username} {datetime} {language}` → `insertAtCursor()`.
- Estado: `promptOverrides` ref, `originalPromptOverrides`, `isSavingPrompt`, `hasPromptChanges` computed (mismo patrón `titleGenHasChanges:300`).
- `apiFetch` helper ya existente `:143` + `assertOk` `:158`.

**Card Agentes Globales:**
- Tabla `Nombre | Descripción | Origen | Acciones` (Origen: `Catálogo`/`Override`/`Custom`).
- Botón `Crear agente` → Dialog con campos `name`, `description`, `icon` (select lucide), `systemPrompt` (textarea grande) + chips tags.
- Editar: mismo Dialog pre-llenado. Para `source==builtin` mostrar hint "Esto creará un override en DB".
- Acciones row: `Editar` / `Restablecer` (si override) / `Eliminar` (si custom).

### Frontend — Chat

**`frontend/src/components/chat/ChatInput.vue:1` (selector):**
- Props nuevos: `agentId: string|null`, `agents: Agent[]`, `selectedAgent?: Agent`.
- En `PromptInputActionMenuContent` (`:166`) añadir `MenuItem` "Agentes" → submenú o `Dialog` lista de agentes (filtrados por `GET /api/agents`). Incluir opción "Sin agente (Base)".
- Emit: `update:agentId`.
- Toolbar derecha (`:182`): al lado del `Select` de preset, renderizar `AgentBadge` si `selectedAgent`:
  ```vue
  <div v-if="selectedAgent" class="group flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs">
    <span class="max-w-[120px] truncate">{{ selectedAgent.name }}</span>
    <button class="opacity-0 group-hover:opacity-100 transition-opacity" @click="emit('update:agentId', null)">
      <XIcon :size="12" />
    </button>
  </div>
  ```

**`frontend/src/pages/chat/[id].vue:1` y `frontend/src/pages/index.vue`:**
- Fetch `GET /api/agents` en `onMounted` (mismo patrón que presets `:440`).
- Estado `selectedAgentId` (inicial desde `chatData.agent_id` o `route.query.agentId`).
- `buildSearchRequestBody()` (`:111`) añade `agentId: selectedAgentId.value ?? undefined`.
- `KeryxChatTransport.ts:114` ya reenvía `body.agentId` → incluir `agentId` en JSON del `fetch`.
- `handleSubmit` persiste `agentId` vía `PATCH /api/chats/{id}/agent` si cambió.

**`frontend/src/services/keryxChatTransport.ts:54`:** añadir `agentId = body.agentId as string|undefined` en `JSON.stringify` payload.

**Locales `frontend/src/locales/es.json:206`:** añadir `admin.prompts.*`, `admin.agents.*`, `chat.agent.*` (ver §9).

---

## 8. Plan por fases (sin OPFS)

### Fase 0 — Revisión & scaffolding (0.5 día)
- Crear `docs/PLAN_AGENTES.md` (este doc), `internal/config/agents.go` con `DefaultAgents` + tests.
- Verificar `applyUserContext` cubre `{username}/{datetime}/{language}` y añadir helper `AvailablePromptTags = []string{"{username}","{datetime}","{language}"}`.
- *Verify:* `go vet ./...`, `go test ./internal/config -run TestBaseSystemPrompt`.

### Fase 1 — Backend: `prompt_overrides` (1 día)
1. `internal/store/store_prompt_overrides.go` + `ensurePromptOverridesCollection()` en `store.go:22`.
2. Endpoints `GET/PUT/DELETE /api/admin/prompt-overrides` en `internal/api/router_admin.go`, wire en `router.go:131`.
3. Migrar `handleChatStream` base/title a `GetEffective*` con fallback embebido.
4. *Verify:* `go vet`, `go test ./internal/store`, `curl` flujo `PUT base → GET → stream usa override → DELETE → GET usa embebido`.

### Fase 2 — Backend: `agents` + `chats.agent_id` (2 días)
1. `internal/store/store_agents.go`, `ensureAgentsCollection()`, `ListEffectiveAgents`, `GetAgentForStream`, `DuplicateAgent`.
2. `internal/store/store_schema.go:130` añadir `agent_id` con `ensureField`.
3. Endpoints admin/user/agents + `PATCH /api/chats/{id}/agent`, extender `ChatRecord` con `AgentID`.
4. `handleChatStream` sobrescritura + tags + logging + fallback.
5. *Verify:* tests visibilidad (A no ve custom de B, user no puede PUT global), duplicar, stream con/sin agente, `govulncheck`.

### Fase 3 — Frontend: Admin (1 día)
1. `frontend/src/pages/admin/index.vue` Sec. E (Prompts + Agentes), chips tags, dialogs, `PromptInsert` helper.
2. Locales `es.json`.
3. *Verify:* `bun run build`, flujo manual admin edita base → nuevo chat usa override; Reset → vuelve embebido; crear/editar agente global.

### Fase 4 — Frontend: Chat selector (1 día)
1. `frontend/src/components/chat/ChatInput.vue` menú `+` → Agentes, badge al lado de preset con `X` hover.
2. `frontend/src/pages/chat/[id].vue` + `frontend/src/pages/index.vue` wiring `agentId`, `keryxChatTransport.ts`.
3. Persistencia `PATCH /api/chats/{id}/agent`.
4. *Verify:* seleccionar agente → badge visible → hover X → vuelve a base; crear agente user → solo visible para ese user; duplicar admin → copia editable.

### Fase 5 — Hardening (0.5 día)
- Rate limits (`adminLimiter`/`accountLimiter`), validación longitudes, `auditLog` completo.
- Docs `frontend/docs/CODEMAPS`, `AGENTS.md` si aplica.
- *Verify:* `bun test`, `go fix -diff ./...`, `go vet ./...`, `go run golang.org/x/vuln/cmd/govulncheck@latest ./...`.

**Estimación total: 6 días 1 dev.** Orden estricto 0→1→2→3→4→5; Fase 1 puede shippar sola (valor sin agentes).

---

## 9. i18n (claves nuevas `es.json`)

```json
"admin": {
  "prompts": {
    "title": "Prompts del sistema",
    "description": "Edita los prompts globales Base y Título. Si no hay override en DB se usan los embebidos del código.",
    "baseLabel": "Prompt Base (chat)",
    "titleLabel": "Prompt de Títulos",
    "availableTags": "Tags disponibles",
    "tagUsername": "{username}",
    "tagDatetime": "{datetime}",
    "tagLanguage": "{language}",
    "tagHint": "Se reemplazan al enviar el mensaje",
    "saveButton": "Guardar", "saving": "Guardando…",
    "resetButton": "Restablecer", "resetConfirm": "¿Borrar override y volver al embebido?",
    "sourceEmbedded": "Embebido", "sourceOverride": "Override",
    "saveSuccess": "Prompt guardado", "saveError": "No se pudo guardar",
    "resetSuccess": "Prompt restablecido", "resetError": "No se pudo restablecer"
  },
  "agents": {
    "title": "Agentes Globales",
    "description": "Gestiona agentes visibles para todos. Los usuarios pueden duplicarlos pero no editarlos.",
    "createTitle": "Crear agente", "editTitle": "Editar agente",
    "nameLabel": "Nombre", "descriptionLabel": "Descripción", "iconLabel": "Icono",
    "promptLabel": "System Prompt", "promptPlaceholder": "Eres un experto en...",
    "sourceBuiltin": "Catálogo", "sourceOverride": "Override", "sourceCustom": "Custom",
    "resetButton": "Restablecer", "duplicateHint": "Crea un override en DB"
  }
},
"chat": {
  "agent": { "selectPlaceholder": "Sin agente (Base)", "selected": "Agente: {name}", "clear": "Quitar agente", "duplicate": "Duplicar", "duplicated": "Agente duplicado" }
}
```

---

## 10. Riesgos y diferidos

- **Prompt injection:** `system_prompt` user es superficie de inyección. Separar con delimitador `\n\n[AGENT INSTRUCTIONS]\n` y no interpolar sin escapar. Revisión `security-review` antes de ship.
- **Token bloat:** `base` + `agent` + `search` largo puede exceder `MaxContext` (`ai/registry.go`). Enforce `max 10k` + contador en UI (ya hay `tokenlens`).
- **Falta de versiónado:** Reset es destructivo (borra). V1 no guarda historial; diferir si se necesita.
- **Built-in rename:** requiere migración manual de `builtin_id` huérfanos; documentar como breaking si se renombra.
- **No hacer en V1:** historial de prompts, marketplace, permisos por agente, búsqueda/filtro de agentes.

---

## 11. Criterios de aceptación

- [ ] `GET /api/admin/prompt-overrides` muestra `source` correcto; `DELETE` vuelve a embebido y stream lo usa.
- [ ] Chips `{username}/{datetime}/{language}` insertan en cursor y se resuelven en stream (verificado con `slog`).
- [ ] `+` → Agentes lista globales+propios; badge al lado de preset con `X` hover limpia selección.
- [ ] User no puede `PUT/DELETE` agente `owner=null`; `POST /duplicate` crea copia privada editable.
- [ ] Chats nuevos y existentes persisten `agent_id`; cambiar agente afecta solo streams futuros.
- [ ] `go vet` + `govulncheck` + `bun run build` + `bun test` green.

