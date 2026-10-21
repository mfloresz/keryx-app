# Plan técnico archivo por archivo para migrar a PocketBase

## Propósito

Definir **cómo** se ejecutará la migración de Supabase a PocketBase en este repo, archivo por archivo, sin implementar aún.

Este documento cubre:

- orden de trabajo
- archivos nuevos
- archivos a modificar
- archivos a eliminar al final
- contratos a preservar
- riesgos por cambio
- pruebas a correr por etapa

---

## Baseline operativa

Este plan asume:

- el frontend sigue usando `/api/*`
- no se toca `static mode`
- no se migra todavía storage real de archivos
- la sesión cloud seguirá basada en bearer token
- `/api/auth/me` sigue siendo el punto autoritativo para consolidar rol/sesión de app

---

## Objetivo técnico

Al terminar la migración:

- `cloud mode` ya no depende de Supabase
- los usuarios cloud autentican contra PocketBase
- el backend cloud valida identidad/rol usando PocketBase
- chats, invitaciones y modelos se persisten en PocketBase
- el frontend cloud conserva sus contratos actuales
- `static mode` sigue funcionando igual

---

# 1. Principios de implementación

## 1.1 Mantener contratos estables
No cambiar, salvo necesidad estricta, las interfaces públicas de:

- `AuthAdapter`
- `ChatRepository`
- payloads de `/api/*`
- tipos del dominio

## 1.2 Mover la implementación, no el comportamiento
La primera migración debe reemplazar infraestructura, no rediseñar funcionalidad.

## 1.3 Reducir duplicación donde el beneficio es claro
La única simplificación estructural que sí conviene hacer en la primera pasada es:

- eliminar la dualidad entre auth user y app user
- usar `users.role` como fuente única de verdad

## 1.4 Cortar por capas
El orden debe ser:
1. introducir clientes/helpers PocketBase
2. migrar auth backend
3. migrar auth frontend
4. migrar stores server-side
5. migrar flujos admin/invitaciones
6. eliminar Supabase

---

# 2. Mapa de archivos

## 2.1 Archivos nuevos previstos

### `src/server/pocketbaseClient.ts`
Responsabilidad:
- inicializar cliente PocketBase para operaciones server-side
- resolver env vars
- exponer helper admin autenticado
- centralizar manejo de errores comunes

### `src/server/pocketbaseAuth.ts`
Responsabilidad:
- leer bearer token
- resolver usuario autenticado desde PocketBase
- construir `AuthContext`

### `src/server/pocketbaseAdmin.ts`
Responsabilidad:
- crear usuarios desde backend
- buscar usuario por email
- actualizar rol
- listar/leer usuarios si hace falta

### opcional: `src/server/pocketbaseMappers.ts`
Responsabilidad:
- mapear records PocketBase → tipos del dominio
- evitar duplicar adaptadores entre `appStore` y `cloudStore`

### opcional: `src/server/pocketbaseErrors.ts`
Responsabilidad:
- normalizar errores frecuentes de PocketBase
- convertirlos a mensajes consistentes de la app

---

## 2.2 Archivos a modificar

### Auth / runtime cloud
- `src/adapters/cloud/cloudAuthAdapter.ts`
- `src/server/authz.ts`
- `src/server/bootstrapAdmin.ts`
- `src/services/runtime.ts` solo si cambia wiring indirecto; idealmente no

### Persistencia cloud
- `src/server/cloudStore.ts`
- `src/server/appStore.ts`

### API principal
- `src/server/chatApi.ts`

### Tests
- `src/adapters/cloud/cloudAuthAdapter.test.ts`
- `src/server/supabaseAuth.test.ts` → reemplazar por tests de `pocketbaseAuth`
- tests que asuman env vars o mensajes Supabase

---

## 2.3 Archivos a eliminar al final

- `src/server/supabaseAuth.ts`
- `src/server/supabaseAdmin.ts`
- `src/server/supabaseRest.ts`
- tests estrictamente específicos de Supabase

---

# 3. Plan por etapa

# Etapa 0 — Preparación

## Objetivo
Dejar listo el terreno para migrar sin romper el runtime actual.

## Trabajo
1. Agregar documento de schema PocketBase.
2. Agregar este plan técnico.
3. Confirmar nombres finales de env vars.
4. Confirmar si `chatId` y `modelKey` serán claves lógicas.

## Entregables
- `docs/pocketbase-schema.md`
- `docs/pocketbase-technical-plan.md`

## Riesgo
Bajo.

---

# Etapa 1 — Introducir cliente PocketBase server-side

## Archivo nuevo: `src/server/pocketbaseClient.ts`

### Objetivo
Centralizar acceso a PocketBase desde el backend cloud.

### Responsabilidades exactas
- leer `POCKETBASE_URL`
- leer credenciales admin/superuser
- crear instancia de cliente PocketBase
- autenticar cliente admin cuando haga falta
- exponer helpers como:
  - `getPocketBaseAdminClient()`
  - `getPocketBaseUrl()`
  - `assertPocketBaseConfigured()`

### Contratos esperados
No expone tipos del dominio. Solo infraestructura.

### Riesgos
- recrear cliente demasiadas veces
- autenticar admin en cada llamada sin cache razonable
- mezclar cliente “admin” y cliente “request scoped”

### Decisión recomendada
Separar dos usos:
1. **admin client** para operaciones server-side privilegiadas
2. **request-scoped auth lookup** para validar bearer tokens de usuario

### Verificación
- el backend puede autenticarse contra PocketBase admin
- el backend puede consultar una colección básica

---

# Etapa 2 — Migrar auth backend

## Archivo nuevo: `src/server/pocketbaseAuth.ts`

### Objetivo
Reemplazar la lógica de `src/server/supabaseAuth.ts`.

### Responsabilidad exacta
Exponer una función equivalente a `getAuthContext(request)` que:
1. lea el bearer token
2. rechace si no hay token
3. resuelva el usuario autenticado en PocketBase
4. verifique que existe y está habilitado
5. devuelva:
   ```ts
   {
     userId: string;
     email?: string;
     role?: "admin" | "user";
   }
   ```

### Decisión crítica
No confiar solo en decodificar localmente el JWT.

#### Razón
Necesitamos que la autorización refleje el estado actual del usuario:
- rol actual
- usuario todavía existente
- `enabled`

### Cambios relacionados
#### `src/server/authz.ts`
Reemplazar import de:
- `./supabaseAuth.js`
por:
- `./pocketbaseAuth.js`

### Nuevo flujo de `requireUser()`
1. llamar `getAuthContext()`
2. resolver user operativo desde PocketBase / `appStore`
3. negar si no existe o está deshabilitado
4. devolver `AppUserRecord` compatible

### Nuevo flujo de `requireAdmin()`
1. llamar `requireUser()`
2. verificar `role === "admin"`

### Riesgos
- errores 401/403 inconsistentes
- reconsultar demasiado PocketBase por request
- romper `/api/auth/me`

### Verificación
- `/api/auth/me` con token válido devuelve `id`, `email`, `role`
- token inválido devuelve 401
- user deshabilitado/inexistente devuelve 403 o 401 según política elegida

---

# Etapa 3 — Migrar auth frontend cloud

## Archivo a modificar: `src/adapters/cloud/cloudAuthAdapter.ts`

### Objetivo
Sustituir Supabase Auth por PocketBase sin cambiar la interfaz `AuthAdapter`.

### Responsabilidades a preservar
- `getSession()`
- `login(email, password)`
- `logout()`
- `getAuthorizationHeaders()`

### Cambios técnicos exactos

#### Reemplazar config
Eliminar dependencia de:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Introducir:
- `VITE_POCKETBASE_URL`

#### Reemplazar persistencia local
Cambiar claves como:
- `supabase-access-token`
- `supabase-refresh-token`

por algo neutral, por ejemplo:
- `pocketbase-access-token`
- o mejor: `cloud-access-token`

### Decisión recomendada
Usar nombres neutrales, no acoplados al proveedor.

#### Recomendación
- `cloud-access-token`
- `cloud-session-user`

### Flujo deseado de `login()`
1. autenticar contra PocketBase con email/password
2. obtener token
3. persistir token localmente
4. llamar `/api/auth/me`
5. construir `AuthSession`

### Flujo deseado de `getSession()`
1. leer token local
2. validar expiración mínima si se puede
3. consolidar sesión llamando `/api/auth/me`
4. cachear el resultado por TTL corto

### Flujo deseado de `logout()`
1. borrar estado local
2. opcionalmente invalidar sesión server-side si PocketBase lo soporta razonablemente para este flujo
3. no fallar si el remote logout falla

### Riesgos
- token persistido pero user borrado
- diferencias entre token local y estado real de app
- tests demasiado acoplados a mensajes/env vars actuales

### Verificación
- login válido
- login inválido
- sesión cacheada válida
- sesión rechazada si `/api/auth/me` falla
- headers `Authorization` siguen saliendo igual

---

# Etapa 4 — Reimplementar `appStore` sobre PocketBase

## Archivo a modificar: `src/server/appStore.ts`

### Objetivo
Mantener la API pública del store, cambiando solo la persistencia interna.

### API actual a preservar en primera instancia
- `countUsers()`
- `listUsers()`
- `countAdmins()`
- `getUserById()`
- `getUserByEmail()`
- `upsertUser()`
- `updateUserRole()`
- `listModels()`
- `setModelEnabled()`
- `getUserModelAccess()`
- `setUserModelAccess()`
- `getAllowedModelsForUser()`
- `listInvitations()`
- `createInvitation()`
- `getInvitationByTokenHash()`
- `markInvitationUsed()`
- `deleteInvitation()`

### Cambio conceptual importante
`AppUserRecord` ya no representará una tabla separada; pasará a mapear la colección `users`.

### Implementación objetivo por bloques

#### Usuarios
Mapear `users` a:
```ts
interface AppUserRecord {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
  updatedAt: string;
}
```

#### Modelos
Mapear `models.modelKey` a `AppModelRecord.id`.

#### Invitaciones
Mapear colección `invitations` manteniendo shape actual.

### Decisiones por función

#### `upsertUser()`
En fase 1 se puede conservar por compatibilidad aunque internamente haga:
- create if not exists
- update role/email si existe

Más adelante podría desaparecer.

#### `getUserModelAccess()` y `setUserModelAccess()`
Si `user_model_access` no existe en fase 1:
- deben degradarse limpiamente
- o marcarse como comportamiento vacío compatible

### Recomendación exacta
En fase 1:
- `getUserModelAccess()` devuelve `[]`
- `setUserModelAccess()` no-op o error controlado si no se usa realmente

Pero antes de decidirlo definitivamente, verificar si la UI admin llama esos flujos.

### Riesgo importante
Si la UI sí depende de estos métodos, habrá que preservar la colección opcional.

### Verificación
- listar usuarios funciona
- contar admins funciona
- actualizar rol funciona
- crear/listar/borrar invitaciones funciona
- listModels/setModelEnabled sigue funcionando

---

# Etapa 5 — Reimplementar `cloudStore` sobre PocketBase

## Archivo a modificar: `src/server/cloudStore.ts`

### Objetivo
Cambiar la persistencia de chats a la colección `chats`.

### API a preservar
- `listChats(ownerId)`
- `getChat(chatId, ownerId)`
- `listFavorites(ownerId)`
- `saveChat(chat, ownerId)`
- `saveChatContent(chat, ownerId)`
- `updateTitle(chatId, ownerId, title)`
- `updateGeneratedTitle(chatId, ownerId, title)`
- `updateVisibility(chatId, ownerId, visibility)`
- `deleteChat(chatId, ownerId)`
- `deleteAllChats(ownerId)`

### Cambio técnico clave
Las búsquedas ya no deben asumir que el id lógico del chat es el `id` del record PB.

### Decisión recomendada
Buscar por `chatId` único.

### Mapeo interno propuesto
Record PB `chats`:
- `chatId`
- `owner`
- `title`
- `visibility`
- `data`
- `createdAtOriginal`

### Estrategia de actualización

#### `saveChat()`
- upsert lógico por `chatId`
- si existe, actualizar
- si no, crear

#### `saveChatContent()`
- localizar por `chatId + owner`
- actualizar `data` y metadata derivada si aplica

#### `updateGeneratedTitle()`
Preservar la semántica actual:
- solo escribir título generado si el título está vacío o null

### Riesgos
- PocketBase no tiene el mismo estilo de upsert que Supabase REST
- hay que implementar el patrón find-then-create/update sin condiciones de carrera groseras
- `deleteAllChats(ownerId)` podría requerir paginación/batch delete

### Verificación
- CRUD completo de chats
- favoritos calculados correctamente
- votos y branches se preservan al serializar

---

# Etapa 6 — Adaptar bootstrap admin

## Archivo a modificar: `src/server/bootstrapAdmin.ts`

### Objetivo
Seguir soportando creación automática del primer admin usando PocketBase.

### Flujo deseado
1. leer `BOOTSTRAP_ADMIN_EMAIL`
2. leer `BOOTSTRAP_ADMIN_PASSWORD`
3. si no hay usuarios, crear primer user en PocketBase
4. asignar `role = admin`
5. operación idempotente

### Cambios exactos
Reemplazar dependencias de:
- `createSupabaseUser`
- `findSupabaseUserByEmail`
- `isSupabaseAdminConfigured`

por equivalentes PocketBase.

### Riesgos
- contar usuarios de forma inconsistente durante arranque
- crear usuario pero no rol
- autenticar contra admin PB antes de que el servicio esté listo

### Verificación
- sin usuarios, crea admin
- con usuarios existentes, no hace nada
- si ya existe el email bootstrap, no duplica

---

# Etapa 7 — Adaptar flujos admin e invitaciones en `chatApi.ts`

## Archivo a modificar: `src/server/chatApi.ts`

### Objetivo
Mantener todos los endpoints actuales, cambiando solo sus dependencias internas.

## Endpoints a preservar

### Auth
- `GET /api/auth/me`

### Invitaciones públicas
- `POST /api/invitations/validate`
- `POST /api/invitations/accept`

### Modelos de usuario
- `GET /api/models/allowed`

### Admin users
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id`

### Admin models
- `GET /api/admin/models`
- `PATCH /api/admin/models/:id`
- `GET /api/admin/models/catalog`

### Admin invitations
- `GET /api/admin/invitations`
- `POST /api/admin/invitations`
- `POST /api/admin/invitations/send`
- `DELETE /api/admin/invitations/:id`

### Chats
- `GET /api/favorites`
- `GET /api/chats`
- `DELETE /api/chats`
- `POST /api/chats`
- `GET /api/chats/:id`
- `DELETE /api/chats/:id`
- `PATCH /api/chats/title/:id`
- `PATCH /api/chats/visibility/:id`
- `DELETE /api/chats/messages/:id`
- `POST /api/chats/branches/:id`
- `GET /api/chats/votes/:id`
- `POST /api/chats/votes/:id`
- `POST /api/chats/:id`
- `POST /api/chats/:id/stream`

## Cambios internos exactos

### `handleInvitationAccept()`
Hoy crea usuario en Supabase y luego sincroniza `appStore`.

Con PocketBase debe:
1. validar invitación
2. verificar email inexistente
3. crear usuario en `users`
4. asignar `role`
5. marcar invitación usada
6. opcionalmente copiar `initialModelAccess` si luego existiera ACL granular real

### `handleAdminUpdateUserRole()`
Reemplazar:
- `updateSupabaseUserRole()`

por equivalente PocketBase.

### `handleAuthMe()`
Debe seguir devolviendo exactamente:
```json
{ "id": "...", "email": "...", "role": "user|admin" }
```

### Riesgos
- romper payloads esperados por frontend
- cambiar mensajes de error y romper tests frágiles

### Verificación
- smoke test de cada endpoint principal
- especial foco en `/api/auth/me`, admin roles e invitaciones

---

# Etapa 8 — Adaptar tests

## Archivos probables
- `src/adapters/cloud/cloudAuthAdapter.test.ts`
- `src/server/supabaseAuth.test.ts`
- cualquier test que hardcodee env vars Supabase

## Trabajo

### `cloudAuthAdapter.test.ts`
Actualizar:
- env vars usadas
- endpoints simulados
- nombres de localStorage keys
- mensajes de error específicos

### `supabaseAuth.test.ts`
Reemplazar por:
- `pocketbaseAuth.test.ts`

### Qué debe probar `pocketbaseAuth.test.ts`
- token ausente
- token inválido
- token válido con user habilitado
- token válido con user admin
- token válido con user inexistente/deshabilitado

### Riesgos
- tests demasiado acoplados al detalle de implementación anterior
- intentar testear la criptografía del JWT local como en Supabase, cuando el flujo PB puede ser distinto

### Recomendación
Testear comportamiento observable, no el algoritmo interno del proveedor.

---

# Etapa 9 — Limpieza final de Supabase

## Archivos a eliminar
- `src/server/supabaseAuth.ts`
- `src/server/supabaseAdmin.ts`
- `src/server/supabaseRest.ts`

## Trabajo adicional
- limpiar imports muertos
- limpiar env vars antiguas en docs
- limpiar tests obsoletos

## Verificación
- `grep` sin referencias operativas a `supabase` en runtime cloud, salvo notas históricas o docs si se conservan

---

# 4. Plan archivo por archivo

## 4.1 `src/server/pocketbaseClient.ts` (nuevo)

### Crear
Sí.

### Funciones sugeridas
- `getPocketBaseUrl()`
- `assertPocketBaseConfigured()`
- `createPocketBaseClient()`
- `getPocketBaseAdminClient()`

### Dependencias
- paquete `pocketbase`

### Riesgo
medio

### Estado esperado tras esta etapa
infraestructura lista, pero aún no conectada al runtime principal

---

## 4.2 `src/server/pocketbaseAuth.ts` (nuevo)

### Crear
Sí.

### Funciones sugeridas
- `getBearerToken(request)`
- `getAuthContext(request)`

### Salida esperada
Equivalente funcional al actual `supabaseAuth.ts`

### Riesgo
medio-alto

---

## 4.3 `src/server/pocketbaseAdmin.ts` (nuevo)

### Crear
Sí.

### Funciones sugeridas
- `isPocketBaseAdminConfigured()`
- `findPocketBaseUserByEmail(email)`
- `createPocketBaseUser({ email, password, role })`
- `updatePocketBaseUserRole({ userId, role })`
- opcional: `listPocketBaseUsers()`

### Riesgo
medio

---

## 4.4 `src/server/authz.ts`

### Modificar
Sí.

### Cambio principal
Cambiar proveedor de auth.

### Contrato a preservar
- `requireUser(request)`
- `requireAdmin(request)`

### Riesgo
alto porque afecta casi todo `/api/*`

---

## 4.5 `src/adapters/cloud/cloudAuthAdapter.ts`

### Modificar
Sí.

### Cambio principal
Cambiar proveedor auth y persistencia local.

### Contrato a preservar
- `AuthAdapter`

### Riesgo
alto porque afecta login y guards frontend

---

## 4.6 `src/server/appStore.ts`

### Modificar
Sí.

### Cambio principal
Reescribir persistencia interna sobre PocketBase.

### Contrato a preservar
API pública del archivo en fase 1.

### Riesgo
alto por amplitud funcional

---

## 4.7 `src/server/cloudStore.ts`

### Modificar
Sí.

### Cambio principal
Reescribir CRUD de chats sobre `chats`.

### Contrato a preservar
`ChatStorage`

### Riesgo
alto por persistencia core del producto

---

## 4.8 `src/server/bootstrapAdmin.ts`

### Modificar
Sí.

### Cambio principal
Crear admin inicial en PocketBase.

### Riesgo
medio

---

## 4.9 `src/server/chatApi.ts`

### Modificar
Sí.

### Cambio principal
Reapuntar dependencias internas y preservar endpoints.

### Riesgo
alto porque centraliza todo el backend cloud

---

## 4.10 `src/server/supabaseAuth.ts`

### Eliminar
Sí, al final.

### Momento
Solo después de que `authz.ts` y tests ya usen `pocketbaseAuth.ts`.

---

## 4.11 `src/server/supabaseAdmin.ts`

### Eliminar
Sí, al final.

### Momento
Solo después de que bootstrap, invitaciones y admin role update estén migrados.

---

## 4.12 `src/server/supabaseRest.ts`

### Eliminar
Sí, al final.

### Momento
Solo cuando `appStore.ts` y `cloudStore.ts` ya no lo usen.

---

# 5. Orden exacto de ejecución recomendado

```text
1. Crear pocketbaseClient.ts
   -> validar conexión admin a PocketBase

2. Crear pocketbaseAuth.ts
   -> validar getAuthContext() con token válido/inválido

3. Reapuntar authz.ts
   -> validar /api/auth/me

4. Crear pocketbaseAdmin.ts
   -> validar create/find/update role de users

5. Adaptar bootstrapAdmin.ts
   -> validar primer admin idempotente

6. Adaptar cloudAuthAdapter.ts
   -> validar login/logout/getSession/getAuthorizationHeaders

7. Reescribir appStore.ts
   -> validar users/models/invitations

8. Reescribir cloudStore.ts
   -> validar CRUD chats/favorites/votes/branches

9. Adaptar chatApi.ts
   -> validar endpoints admin + invitaciones + models + chats

10. Actualizar tests
   -> validar suite relevante

11. Eliminar Supabase runtime files
   -> validar ausencia de referencias activas
```

---

# 6. Matriz de riesgo por archivo

| Archivo | Riesgo | Motivo |
|---|---|---|
| `src/server/pocketbaseClient.ts` | Medio | base infra, pero aislado |
| `src/server/pocketbaseAuth.ts` | Alto | auth y autorización |
| `src/server/pocketbaseAdmin.ts` | Medio | operaciones privilegiadas |
| `src/server/authz.ts` | Alto | afecta casi todo endpoint protegido |
| `src/adapters/cloud/cloudAuthAdapter.ts` | Alto | login/sesión frontend |
| `src/server/appStore.ts` | Alto | users/models/invitations |
| `src/server/cloudStore.ts` | Alto | persistencia core de chats |
| `src/server/bootstrapAdmin.ts` | Medio | solo arranque |
| `src/server/chatApi.ts` | Alto | orquestador central |

---

# 7. Plan de validación por etapa

## Después de Etapa 1
- conexión admin PocketBase funciona

## Después de Etapa 2
- `/api/auth/me` responde correctamente
- 401/403 consistentes

## Después de Etapa 3
- login cloud funciona
- logout limpia sesión
- guard admin frontend sigue operando

## Después de Etapa 4
- usuarios se listan
- roles se actualizan
- invitaciones se crean/listan/borran
- modelos se listan y se habilitan/deshabilitan

## Después de Etapa 5
- chats se crean
- chats se cargan
- títulos se actualizan
- visibilidad se actualiza
- votos/favoritos/branches sobreviven

## Después de Etapa 7
- smoke test completo de endpoints `/api/*` cloud

## Después de Etapa 9
- no hay dependencia activa a Supabase en cloud runtime

---

# 8. Preguntas cerradas y preguntas abiertas

## Cerradas por este plan
- se mantiene `/api/*`
- no se toca `static mode`
- adjuntos siguen inline en fase 1
- `users.role` es la fuente de verdad
- `chats.data` guarda el payload completo
- `models.modelKey` y `chats.chatId` son claves lógicas del dominio

## Abiertas antes de codificar
1. nombre exacto de env vars admin/superuser de PocketBase
2. si `user_model_access` se omite completamente o se deja preparado desde el inicio
3. si fechas de invitación irán como `text` o `date`
4. si la UI admin usa hoy funciones que dependan realmente de `setUserModelAccess()`

---

# 9. Resultado esperado de documentación antes de implementar

Antes de escribir código, el repo debería tener al menos:

- `docs/pocketbase-migration-plan.md`
- `docs/pocketbase-schema.md`
- `docs/pocketbase-technical-plan.md`

Y con eso ya habría suficiente claridad para empezar una implementación controlada por fases.

---

# 10. Recomendación final

La manera correcta de ejecutar esta migración en Keryx es:

- mantener los contratos externos
- reemplazar primero infraestructura y auth
- después reimplementar stores
- por último eliminar Supabase

El error a evitar es intentar rediseñar modelo, auth y UX al mismo tiempo. En este repo, la estrategia más segura es **migración por capas con compatibilidad de contratos**.
