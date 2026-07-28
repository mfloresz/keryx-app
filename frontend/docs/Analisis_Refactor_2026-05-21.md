# Análisis de Refactor y Código Muerto — Keryx

> **Fecha:** 2026-05-21
> **Propósito:** Identificar código duplicado, exportaciones no utilizadas, dependencias innecesarias y puntos de refactor en el proyecto.
> **Deployments:** `static` (cliente) y `cloud` (servidor + Supabase)

---

## Resumen Ejecutivo

El proyecto tiene una arquitectura limpia con separación clara entre modos `static` y `cloud`, manejada via `VITE_DEPLOY_MODE`. Sin embargo, se descubrió **duplicación masiva de código** (~500 líneas) entre dos archivos clave del pipeline de mensajes, lo que representa la mayor fuente de deuda técnica.

---

## 1. DUPLICACIÓN CRÍTICA: `chatCore.ts` ↔ `clientApi.ts`

### 1.1 El problema

`src/shared/chatCore.ts` fue diseñado como la implementación **compartida** (usada por `server/chatApi.ts`), pero `src/utils/clientApi.ts` (cliente estático) **copia las mismas funciones** en lugar de importarlas.

### 1.2 Funciones duplicadas

| Función | `chatCore.ts` | `clientApi.ts` | Diferencias |
|---|---|---|---|
| `BASE_SYSTEM_PROMPT` | ✅ Exportada | ✅ Copia | Ninguna |
| `cloneJson()` | ✅ Exportada | ✅ Copia | Ninguna |
| `syncCurrentBranchSnapshots()` | ✅ Exportada | ✅ Copia | `clientApi` usa tipo `UIMessage` |
| `ensureBranchState()` | ✅ Exportada | ✅ Copia | Ninguna |
| `openNewBranch()` | ✅ Exportada | ✅ Copia | Ninguna |
| `annotateBranchMetadata()` | ✅ Exportada | ✅ Copia | Ninguna |
| `upsertUserMessage()` | ✅ Exportada | ✅ Copia | `clientApi` usa tipo `UIMessage` |
| `sanitizeMessagesForStorage()` | ✅ Exportada | ✅ Copia | Ninguna |
| `normalizeMessageAttachments()` | ✅ Exportada | ✅ Copia | Ninguna |
| `prepareMessagesForModel()` | ✅ Exportada | ✅ Copia | `clientApi` tiene parámetro extra `chatId` |
| `getFileLanguage()` | 🔒 Interna | 🔒 Copia | Ninguna |
| `TEXT_FILE_EXTENSIONS` | 🔒 Interna | 🔒 Copia | Ninguna |
| `getFileExtension()` | 🔒 Interna | 🔒 Copia | Ninguna |
| `isTextLikeFile()` | 🔒 Interna | 🔒 Copia | Ninguna |
| `extractTextFromUrl()` | 🔒 Interna | 🔒 Copia | Ninguna |
| `extractTextFromFilePart()` | 🔒 Interna | 🔒 Copia | Ninguna |
| `getAttachmentMetadata()` | 🔒 Interna | 🔒 Copia | Ninguna |

### 1.3 Impacto

- **~500 líneas duplicadas** entre ambos archivos
- Cualquier bug fix o mejora debe aplicarse en **ambos archivos**
- Ya existe **divergencia**: `clientApi.ts` usa `UIMessage` y tiene parámetro `chatId` extra en `prepareMessagesForModel`
- Dificulta el mantenimiento y aumenta el riesgo de regresiones

### 1.4 Recomendación

Refactorizar `clientApi.ts` para **importar desde `chatCore.ts`** en lugar de duplicar. La función `prepareMessagesForModel` puede recibir un wrapper delgado para el parámetro `chatId` extra.

---

## 2. DUPLICACIÓN DE HELPERS DE ATTACHMENTS

### 2.1 `getAttachmentStorageKey()` — 3 lugares

| Ubicación | Visibilidad |
|---|---|
| `src/utils/opfs.ts` | ✅ Exportada |
| `src/shared/chatCore.ts` | 🔒 Interna |
| `src/utils/clientApi.ts` | 🔒 Interna |

### 2.2 `getAttachmentMetadata()` — 4 lugares

| Ubicación | Visibilidad |
|---|---|
| `src/utils/opfs.ts` | 🔒 Interna |
| `src/shared/chatCore.ts` | 🔒 Interna |
| `src/utils/clientApi.ts` | 🔒 Interna |
| `src/workers/opfs.worker.ts` | 🔒 Interna (como `getAttachmentIdFromPart`) |

### 2.3 Recomendación

Centralizar ambas funciones en `src/utils/opfs.ts` y exportarlas. Los demás archivos deben importarlas desde allí.

---

## 3. DUPLICACIÓN DE LÓGICA TAVILY

### 3.1 Archivos implicados

- `src/composables/useSearchSettings.ts` — carga opciones como estado reactivo Vue
- `src/utils/tavilyTools.ts` — carga opciones con schema Zod propio

Ambos leen `tavily-options` desde `localStorage` con lógica de parseo independiente. Si se añade una nueva opción, ambos deben actualizarse.

### 3.2 Recomendación

Crear un helper compartido `getTavilyOptions()` que ambos archivos importen.

---

## 4. DUPLICACIÓN DE `jsonResponse` / `errorResponse`

### 4.1 Archivos implicados

- `src/server/chatApi.ts` — tiene `jsonResponse()` y `errorResponse()`
- `src/utils/clientApi.ts` — tiene `jsonResponse()` y `errorResponse()` (exportadas)

### 4.2 Recomendación

Mover a `src/shared/chatCore.ts` o crear `src/shared/httpHelpers.ts`.

---

## 5. ARCHIVOS/DIRECTORIOS NO UTILIZADOS

### 5.1 Directorio vacío

| Ruta | Estado |
|---|---|
| `src/utils/tools/` | 🗑️ Vacío — sin archivos ni imports |

### 5.2 Assets no referenciados

| Ruta | Estado |
|---|---|
| `public/vite.svg` | 🗑️ Logo Vite default — no se referencia (favicon usa `/logo.svg`) |
| `src/assets/vue.svg` | 🗑️ Logo Vue default — no se referencia |

---

## 6. CÓDIGO CONDICIONAL POR MODO DE DEPLOYMENT

### 6.1 Modo Static: código cloud que nunca se ejecuta

```
src/server/chatApi.ts
src/server/authz.ts
src/server/bootstrapAdmin.ts
src/server/cloudStore.ts
src/server/modelAccess.ts
src/server/supabaseAdmin.ts
src/server/supabaseAuth.ts
src/server/supabaseAuth.test.ts
src/server/supabaseRest.ts
src/server/appStore.ts
src/adapters/cloud/cloudAttachmentRepository.ts
src/adapters/cloud/cloudAuthAdapter.ts
src/adapters/cloud/cloudChatRepository.ts
src/adapters/cloud/cloudModelRepository.ts
src/pages/login.vue
src/pages/invite/[token].vue
src/pages/admin/index.vue
src/pages/admin/invitations.vue
src/pages/admin/models.vue
src/pages/admin/users.vue
src/components/auth/AuthShell.vue
```

### 6.2 Modo Cloud: código static que nunca se ejecuta

```
src/adapters/static/clientApiInterceptor.ts
src/adapters/static/opfsAttachmentRepository.ts
src/adapters/static/opfsChatRepository.ts
src/adapters/static/staticAuthAdapter.ts
src/adapters/static/staticModelRepository.ts
src/utils/opfs.ts
src/utils/opfsWorkerClient.ts
src/workers/opfs.worker.ts
src/workers/opfs-protocol.ts
```

### 6.3 Nota

Esto **no es código muerto** per se — es parte del diseño arquitectónico. Sin embargo, vale la pena verificar que:

- `vite build` con `VITE_DEPLOY_MODE=static` no incluya código server (Node.js `process.env`, `crypto.subtle`) en el bundle cliente
- `vue-tsc -b` type-checkee correctamente ambos modos sin errores falsos

---

## 7. MAPEO DE INVARIANTES

### 7.1 Static Mode

| Invariante | Estado |
|---|---|
| **State ownership** | OPFS Worker — única fuente de verdad en archivos OPFS |
| **Feedback/observabilidad** | `useToast` composable + stream de AI SDK |
| **Blast radius** | Interceptación de fetch → `clientApi.ts` → OPFS Worker |
| **Timing/ordering** | `withChatLock` en `clientApi.ts` previene race conditions |

### 7.2 Cloud Mode

| Invariante | Estado |
|---|---|
| **State ownership** | Supabase (PostgreSQL) vía `chatApi.ts` server |
| **Feedback/observabilidad** | `useToast` composable + stream de AI SDK |
| **Blast radius** | Backend server + Supabase REST API |
| **Timing/ordering** | Manejo secuencial en `handleChatRoutes()` |

---

## 8. PLAN DE ACCIÓN PRIORIZADO

| # | Hallazgo | Severidad | Esfuerzo | Acción |
|---|---|---|---|---|
| 1 | Duplicación `chatCore.ts` ↔ `clientApi.ts` (~500 loc) | 🔴 Alta | 2-3h | Refactor: importar desde `chatCore.ts` |
| 2 | `getAttachmentStorageKey()` en 3 lugares | 🟡 Media | 30min | Unificar en `opfs.ts` |
| 3 | `getAttachmentMetadata()` en 4 lugares | 🟡 Media | 30min | Unificar en `opfs.ts` |
| 4 | Lógica Tavily duplicada | 🟡 Media | 30min | Helper compartido `getTavilyOptions()` |
| 5 | `jsonResponse`/`errorResponse` duplicados | 🟡 Media | 15min | Mover a shared |
| 6 | `src/utils/tools/` vacío | 🟢 Baja | 5min | Eliminar directorio |
| 7 | `public/vite.svg` no usado | 🟢 Baja | 2min | Eliminar archivo |
| 8 | `src/assets/vue.svg` no usado | 🟢 Baja | 2min | Eliminar archivo |

---

## 9. DEPENDENCIAS npm — VERIFICACIÓN PENDIENTE

Las herramientas de detección automática (`knip`, `depcheck`, `ts-prune`) no pudieron ejecutarse en el entorno actual (timeout por `node_modules`). Se recomienda ejecutar localmente:

```bash
npx knip
npx depcheck
npx ts-prune
```

Dependencias que requieren verificación manual (posiblemente no usadas directamente):

| Dependencia | Uso potencial |
|---|---|
| `@ai-sdk/openai-compatible` | No se encontró import directo; verificar si lo usa AI SDK internally |
| `class-variance-authority` | Usado indirectamente por shadcn-vue |

---

## 10. CONCLUSIÓN

El mayor hallazgo es la **duplicación masiva entre `chatCore.ts` y `clientApi.ts`**, que debería priorizarse para refactor. Los demás hallazgos son de menor impacto y pueden abordarse incrementalmente.

El diseño arquitectónico con dos modos de deployment es sólido, pero se beneficiaría de una verificación explícita de tree-shaking para asegurar que cada modo no incluya código del otro en producción.
