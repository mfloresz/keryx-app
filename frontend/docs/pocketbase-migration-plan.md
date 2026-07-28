# Plan de migración completo: de Supabase a PocketBase

## Objetivo

Reemplazar Supabase por PocketBase en el modo `cloud` para cubrir:

- autenticación
- autorización por rol
- almacenamiento de chats
- invitaciones
- catálogo de modelos y control de acceso
- bootstrap del primer admin
- opcionalmente archivos reales más adelante

Sin romper:

- `static mode`
- el contrato actual del frontend contra `/api/*`
- la estructura general del runtime split `static` vs `cloud`

---

## Baseline asumido

Este plan asume lo siguiente:

- migración total en `cloud mode`
- se mantiene el contrato actual `/api/*`
- `static mode` queda intacto
- fase 1 mantiene adjuntos inline
- PocketBase pasa a ser la fuente de verdad de auth + datos cloud
- se acepta relogin al cortar de Supabase a PocketBase

---

## 1. Estado actual del sistema

### Componentes hoy acoplados a Supabase

#### Auth cliente
- `src/adapters/cloud/cloudAuthAdapter.ts`

#### Verificación auth backend
- `src/server/supabaseAuth.ts`
- `src/server/authz.ts`

#### Persistencia cloud
- `src/server/cloudStore.ts`
- `src/server/appStore.ts`
- `src/server/supabaseRest.ts`

#### Admin / gestión de usuarios
- `src/server/supabaseAdmin.ts`
- `src/server/bootstrapAdmin.ts`

#### Integración en API principal
- `src/server/chatApi.ts`

---

## 2. Hallazgos importantes del codebase

### 2.1 Supabase no está solo en auth
Supabase hoy soporta:

- login y sesión
- validación de bearer tokens
- gestión admin de usuarios
- tablas de aplicación
- bootstrap del admin inicial
- invitaciones indirectamente, a través de creación de usuarios

### 2.2 El “storage de archivos” cloud no está realmente en Supabase Storage
En `src/adapters/cloud/cloudAttachmentRepository.ts`, los adjuntos cloud se convierten a `data:` URLs inline.

Eso significa que la primera migración no necesita resolver buckets ni URLs firmadas. El cambio fuerte está en:

- auth
- modelo de datos
- persistencia cloud
- admin / invitaciones

### 2.3 Hay duplicación entre identidad y perfil de app
Hoy la identidad vive en Supabase Auth, pero el rol y perfil operativo viven además en tablas de app.

En PocketBase conviene eliminar esa duplicación y consolidar en la colección auth `users`.

---

## 3. Topología objetivo

### Antes
- identidad: Supabase Auth
- perfil/rol: tabla app users separada
- datos cloud: tablas Supabase REST
- admin bootstrap: Supabase Admin API + tabla app users

### Después
- identidad: PocketBase `users` auth collection
- rol: campo `role` dentro de `users`
- datos cloud: colecciones PocketBase
- autorización: backend valida token PB y resuelve usuario desde PocketBase
- frontend sigue hablando con `/api/*`

### Principio clave
Eliminar la doble escritura entre “usuario auth” y “usuario app”, salvo que una necesidad real obligue a mantenerla.

---

## 4. Decisiones arquitectónicas recomendadas

### 4.1 Mantener `/api/*`
**Recomendación: sí.**

#### Razones
- minimiza blast radius en frontend
- no rompe repositorios cloud
- mantiene `chatApi.ts` como frontera estable
- permite cambiar backend sin rediseñar la UI

### 4.2 Fase 1 sin usar file storage real
**Recomendación: sí.**

#### Razones
- hoy los adjuntos cloud ya van inline
- evita mezclar migración de auth/db con migración de archivos
- reduce riesgo y tamaño del primer corte

### 4.3 `users.role` como fuente única de verdad
**Recomendación: sí.**

#### Razones
- elimina la duplicación actual
- simplifica autorización
- reduce inconsistencias entre metadata auth y tablas app

### 4.4 Mantener Node/Vite como backend orquestador en la primera etapa
**Recomendación: sí.**

#### Razones
- permite migración progresiva
- evita mover demasiada lógica a rules/hooks de PocketBase de golpe
- mantiene las invariantes actuales visibles desde el mismo punto de entrada

---

## 5. Modelo de datos objetivo en PocketBase

## 5.1 Collection `users`
Tipo: `auth`

### Campos sugeridos
- `role` → `select`: `admin`, `user`
- `enabled` → `bool`, default `true`
- `displayName` → `text`, opcional

### Campos built-in de PocketBase
- `id`
- `email`
- `password`
- `created`
- `updated`

### Reglas sugeridas
- list: solo admins
- view: el propio usuario o admin
- create: controlado por backend o flujo de invitación
- update: el propio usuario para campos no sensibles; `role` solo admin/backend
- delete: solo admin

---

## 5.2 Collection `chats`
Tipo: `base`

### Campos
- `owner` → relation a `users` (required, single)
- `title` → `text`
- `visibility` → `select`: `public`, `private`
- `data` → `json`
- `createdAtOriginal` → `date` o `text` ISO para preservar el dominio

### Notas
PocketBase ya tiene `created` y `updated`, pero el dominio de chats ya trae su propio `createdAt`. Mantener `createdAtOriginal` evita mezclar semánticas.

### Reglas sugeridas
- list/view/update/delete: `owner = @request.auth.id`
- create: `owner = @request.auth.id`
- admins pueden ver todo solo si realmente hace falta

---

## 5.3 Collection `invitations`
Tipo: `base`

### Campos
- `email` → `email`
- `tokenHash` → `text`
- `role` → `select`: `admin`, `user`
- `expiresAt` → `date`
- `usedAt` → `date`, opcional
- `createdBy` → relation a `users`
- `initialModelAccess` → `json` o relación múltiple a `models`

### Reglas sugeridas
- list/create/update/delete: solo admin
- validate/accept: mejor resolverlos desde backend, no abrir reglas públicas complejas

---

## 5.4 Collection `models`
Tipo: `base`

### Campos
- `modelKey` → `text`, único
- `provider` → `select`
- `displayName` → `text`
- `supportsImages` → `bool`
- `supportsSearch` → `bool`
- `enabled` → `bool`

### Reglas sugeridas
- list/view: usuarios autenticados
- create/update/delete: solo admin/backend

---

## 5.5 Collection `user_model_access` (opcional)
Tipo: `base`

### Campos
- `user` → relation a `users`
- `model` → relation a `models`

### Cuándo mantenerla
Solo si realmente necesitas ACL granular por usuario/modelo. Si no, conviene simplificar y usar:

- `models.enabled` global
- y quizá un campo JSON directo en `users` o `invitations` si el set es pequeño

---

## 6. Mapeo de código actual → objetivo

| Actual | Objetivo PocketBase |
|---|---|
| `src/server/supabaseAuth.ts` | `src/server/pocketbaseAuth.ts` |
| `src/server/supabaseAdmin.ts` | `src/server/pocketbaseAdmin.ts` |
| `src/server/supabaseRest.ts` | `src/server/pocketbaseClient.ts` + repos específicos |
| `src/server/cloudStore.ts` | `src/server/cloudStore.ts` reimplementado sobre PB |
| `src/server/appStore.ts` | `src/server/appStore.ts` reimplementado sobre PB |
| `src/adapters/cloud/cloudAuthAdapter.ts` | mismo archivo, adaptado a PocketBase |
| `src/server/bootstrapAdmin.ts` | mismo archivo, adaptado a PocketBase |
| `src/server/authz.ts` | mismo archivo, nueva verificación |
| `src/server/chatApi.ts` | mismo archivo, sin cambiar contrato HTTP |

---

## 7. Estrategia de migración por fases

## Fase 0 — Preparación y diseño

### Objetivo
Definir el backend objetivo sin tocar aún el flujo productivo.

### Tareas
1. Agregar dependencia cliente de PocketBase si hace falta.
2. Definir env vars nuevas.
3. Diseñar collections y reglas.
4. Decidir si PocketBase correrá como servicio separado o embebido en tu infra.
5. Crear documento de migración y checklist.

### Entregables
- schema PocketBase definido
- variables de entorno definidas
- estrategia de despliegue definida

### Riesgos
- diseñar mal reglas de acceso
- dejar ambigua la fuente de verdad del rol

---

## Fase 1 — Introducir capa PocketBase sin cortar Supabase

### Objetivo
Crear clientes y utilidades PocketBase para que el código pueda empezar a migrar por capas.

### Archivos nuevos sugeridos
- `src/server/pocketbaseClient.ts`
- `src/server/pocketbaseAuth.ts`
- `src/server/pocketbaseAdmin.ts`
- opcional: `src/server/pocketbaseCollections.ts`

### Responsabilidades
#### `pocketbaseClient.ts`
- inicializar cliente admin/server
- resolver base URL
- helpers comunes
- manejo de errores comunes de PocketBase

#### `pocketbaseAuth.ts`
- leer bearer token
- validar usuario actual
- devolver contexto auth con `userId`, `email`, `role`

#### `pocketbaseAdmin.ts`
- crear usuario
- buscar usuario por email
- actualizar rol
- listar usuarios si hace falta

### Verificación
- poder autenticar/consultar un usuario de PB desde backend
- poder crear usuario admin de prueba

### Blast radius
Bajo, si todavía no sustituyes el wiring activo.

---

## Fase 2 — Migrar auth del cliente cloud

### Objetivo
Reemplazar el uso de Supabase Auth en el frontend cloud por PocketBase Auth sin romper el contrato de `AuthAdapter`.

### Archivo principal
- `src/adapters/cloud/cloudAuthAdapter.ts`

### Cambios esperados
1. Reemplazar:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. Introducir config PB:
   - `VITE_POCKETBASE_URL`
3. Reemplazar login actual por `authWithPassword`.
4. Reemplazar persistencia local de tokens por el token de PB.
5. Mantener `getSession()` y `getAuthorizationHeaders()` con la misma interfaz.
6. Mantener `/api/auth/me` como verificación autoritativa del rol.

### Invariante a preservar
El resto del frontend no debería notar el cambio si `AuthAdapter` conserva la misma semántica.

### Riesgos
- expiración/refresh del token
- diferencias entre sesión local y validación backend

### Recomendación
Seguir usando `/api/auth/me` como confirmación de sesión “aprobada por la app”.

---

## Fase 3 — Migrar autorización backend

### Objetivo
Sustituir `supabaseAuth.ts` en el backend por validación basada en PocketBase.

### Archivos afectados
- `src/server/authz.ts`
- `src/server/supabaseAuth.ts` → reemplazo por `src/server/pocketbaseAuth.ts`

### Diseño recomendado
#### `getAuthContext(request)`
Debe devolver algo como:
- `userId`
- `email`
- `role`

#### `requireUser(request)`
Debe:
1. leer bearer token
2. validar token o resolver usuario actual desde PB
3. verificar que el usuario existe y está habilitado
4. devolver el user operativo

#### `requireAdmin(request)`
Debe verificar `role === 'admin'`

### Riesgos
- confiar solo en el token sin revalidar estado del usuario
- permitir usuarios deshabilitados o borrados

### Recomendación
Aunque el token sea válido, volver a resolver el user actual desde PB o desde tu store derivado para garantizar consistencia.

---

## Fase 4 — Migrar `appStore` a PocketBase

### Objetivo
Reemplazar tablas Supabase de usuarios, invitaciones, modelos y accesos por colecciones PocketBase.

### Archivo afectado
- `src/server/appStore.ts`

### Estrategia
Mantener la API pública del archivo lo más estable posible:

- `countUsers()`
- `listUsers()`
- `countAdmins()`
- `getUserById()`
- `getUserByEmail()`
- `upsertUser()`
- `updateUserRole()`
- `createInvitation()`
- `listInvitations()`
- `markInvitationUsed()`
- `listModels()`
- `setModelEnabled()`
- etc.

Reescribir solo la implementación interna.

### Recomendación estructural
Si `users.role` ya es fuente de verdad, varias funciones de `appStore` pueden pasar a operar directamente sobre la colección `users`, y `upsertUser()` podría simplificarse mucho o incluso desaparecer más adelante.

### Riesgos
- arrastrar diseño viejo y duplicado dentro de PB
- mantener APIs que ya no hacen sentido estructural

### Recomendación
Primero compatibilidad. Luego limpieza.

---

## Fase 5 — Migrar `cloudStore` a PocketBase

### Objetivo
Guardar chats cloud en la colección `chats` de PocketBase.

### Archivo afectado
- `src/server/cloudStore.ts`

### Operaciones a migrar
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

### Diseño recomendado
Mapear cada record PocketBase a tu `ChatRecord` actual, preservando la forma del dominio.

### Observación
Como hoy `data` ya guarda el chat entero, la migración es conceptualmente directa: PocketBase solo reemplaza el contenedor persistente.

### Riesgos
- filtros por owner mal implementados
- pérdida de ordenamiento consistente
- diferencias entre `created`, `updated` y timestamps del dominio

---

## Fase 6 — Migrar admin bootstrap

### Objetivo
Seguir soportando el primer admin automático sin Supabase.

### Archivo afectado
- `src/server/bootstrapAdmin.ts`

### Flujo objetivo
1. leer `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD`
2. si no existe ningún usuario, crear el primero en PocketBase
3. asignar `role = admin`
4. no duplicar escritura innecesaria en otro store paralelo

### Entorno sugerido
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `POCKETBASE_URL`
- credenciales admin de PB si las necesitas para operaciones server-side

### Riesgos
- crear admin más de una vez
- depender de orden de arranque

### Recomendación
Mantener el patrón actual con promesa singleton y operación idempotente.

---

## Fase 7 — Migrar invitaciones

### Objetivo
Preservar el flujo actual de invitaciones usando PocketBase.

### Archivo afectado
- `src/server/chatApi.ts`
- `src/server/appStore.ts`
- `src/server/pocketbaseAdmin.ts`

### Flujo actual a preservar
1. admin crea invitación
2. se guarda token hasheado
3. usuario valida invitación
4. usuario acepta invitación con password
5. se crea cuenta y se marca la invitación como usada

### Flujo objetivo en PB
1. invitación queda en colección `invitations`
2. `validate` busca por `tokenHash`
3. `accept` crea usuario en collection `users`
4. asigna `role`
5. marca `usedAt`

### Riesgos
- carrera entre aceptar invitación y email duplicado
- invitaciones reusadas
- token válido pero usuario ya creado

### Recomendación
Mantener checks transaccionales o lo más atómicos posible desde backend.

---

## Fase 8 — Migrar catálogo de modelos y access control

### Objetivo
Mantener la lógica actual de modelos habilitados y permitidos.

### Archivos relacionados
- `src/server/appStore.ts`
- `src/server/modelAccess.ts`
- `src/server/chatApi.ts`

### Estrategia
1. migrar colección `models`
2. reimplementar sync del catálogo
3. mantener `enabled`
4. decidir si `user_model_access` sigue existiendo o se simplifica

### Riesgos
- sincronización entre catálogo hardcoded del repo y base de datos
- modelos huérfanos o ya no existentes

### Recomendación
Conservar primero el comportamiento actual y luego simplificar.

---

## Fase 9 — Corte final de Supabase

### Objetivo
Eliminar dependencias activas a Supabase.

### Archivos a eliminar o dejar obsoletos
- `src/server/supabaseAuth.ts`
- `src/server/supabaseAdmin.ts`
- `src/server/supabaseRest.ts`

### Limpieza adicional
- variables de entorno Supabase
- tests específicos de Supabase que ya no apliquen
- docs antiguas

### Riesgos
- dejar imports muertos
- dejar config zombie en runtime cloud

---

## Fase 10 — Fase opcional de archivos reales en PocketBase

### Objetivo
Pasar de adjuntos inline a archivos reales usando storage de PocketBase.

### Archivo afectado
- `src/adapters/cloud/cloudAttachmentRepository.ts`

### Estrategia
1. crear colección o campo file asociado a chats/attachments
2. subir archivos reales con `FormData`
3. guardar URL o referencia estable
4. mantener compatibilidad con adjuntos históricos inline si hace falta

### Beneficios
- payloads menores
- chats más livianos
- mejor escalabilidad

### Riesgos
- permisos de archivos
- URLs protegidas o expuestas
- migración de datos históricos

### Recomendación
Hacerlo solo después de estabilizar auth + chats + admin.

---

## 8. Variables de entorno propuestas

## Cliente
- `VITE_POCKETBASE_URL`

## Servidor
- `POCKETBASE_URL`
- `POCKETBASE_ADMIN_EMAIL`
- `POCKETBASE_ADMIN_PASSWORD`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

### Opcionales
- `POCKETBASE_PUBLIC_URL` si difiere del interno
- flags de transición si quieres rollout gradual

---

## 9. Estrategia de despliegue

## Opción recomendada
PocketBase como servicio separado detrás de reverse proxy.

### Razones
- despliegue claro
- backups más directos
- lifecycle desacoplado del frontend Vite server

### Requisitos operativos
- persistencia de `pb_data`
- backups programados
- HTTPS detrás de nginx/caddy
- rotación y resguardo de credenciales admin

### Nota de producción
PocketBase usa SQLite; para este proyecto probablemente está bien, pero conviene revisar:
- volumen esperado de usuarios
- concurrencia de escritura
- estrategia de backup/restore

---

## 10. Estrategia de migración de datos

## Caso A — No hay usuarios reales ni datos importantes
La más simple.

### Pasos
1. levantar PocketBase limpio
2. crear schema
3. cambiar código
4. redeploy
5. relogin general

## Caso B — Hay datos reales que migrar
Necesitas una migración de contenido.

### Datos a migrar
- usuarios
- roles
- invitaciones pendientes
- chats
- modelos y flags `enabled`
- relaciones de acceso por usuario/modelo

### Estrategia recomendada
1. exportar datos desde Supabase
2. transformarlos al shape de PB
3. importar primero `users`
4. importar luego `models`
5. importar `invitations`
6. importar `chats` preservando owner ids
7. validar conteos y muestreos

### Nota crítica
Las passwords generalmente no se migran de forma simple entre providers. Si ya hay usuarios reales, probablemente necesites:
- reset de password
- o estrategia explícita de reprovisionamiento

---

## 11. Plan de pruebas

## 11.1 Pruebas de auth
- login válido
- login inválido
- logout
- sesión persistida
- token inválido
- `/api/auth/me` devuelve user correcto
- admin detectado correctamente

## 11.2 Pruebas de autorización
- usuario normal no accede a `/admin`
- admin sí accede
- usuario no puede leer chats de otro usuario
- usuario no puede modificar modelos si no es admin

## 11.3 Pruebas de datos cloud
- crear chat
- listar chats
- actualizar título
- actualizar visibilidad
- borrar chat
- borrar todos los chats
- favoritos siguen funcionando

## 11.4 Pruebas de invitaciones
- validar invitación válida
- rechazar token inválido
- aceptar invitación crea usuario
- invitación usada no se puede reutilizar
- email duplicado da conflicto

## 11.5 Pruebas de modelos
- sync de catálogo
- list de modelos
- enable/disable
- acceso por usuario según reglas actuales

## 11.6 Pruebas de regresión de frontend
- router guard de `/admin`
- login screen
- invite screen
- chat create/load/delete
- cloud mode completo

---

## 12. Riesgos y mitigaciones

## Riesgo 1 — Duplicar estructura vieja dentro de PocketBase
### Problema
Migrar “tal cual” puede conservar deuda innecesaria.

### Mitigación
Consolidar `role` y perfil en `users` desde el inicio.

## Riesgo 2 — Reglas PocketBase mal configuradas
### Problema
Abrir acceso sin querer o bloquear operaciones legítimas.

### Mitigación
Empezar con reglas cerradas y abrir selectivamente.

## Riesgo 3 — Desalineación entre token y estado actual del usuario
### Problema
Un token válido podría pertenecer a un usuario ya deshabilitado.

### Mitigación
Resolver usuario actual desde backend al autorizar.

## Riesgo 4 — Migración de usuarios reales
### Problema
No puedes asumir traslado transparente de passwords.

### Mitigación
Planificar reset/reinvitation.

## Riesgo 5 — Cambiar demasiadas capas a la vez
### Problema
Difícil aislar fallos.

### Mitigación
Migrar en fases con contratos estables.

---

## 13. Orden exacto de implementación recomendado

```text
1. Crear schema y entorno PocketBase
   -> verificar: puedes crear/login usuarios manualmente

2. Introducir cliente server-side PocketBase
   -> verificar: backend puede leer/escribir PB

3. Implementar pocketbaseAuth + adaptar authz
   -> verificar: /api/auth/me funciona con token PB

4. Adaptar cloudAuthAdapter
   -> verificar: login/logout/session funcionan en frontend cloud

5. Reimplementar appStore sobre PB
   -> verificar: users/invitations/models/admin siguen operando

6. Reimplementar cloudStore sobre PB
   -> verificar: CRUD de chats en cloud mode

7. Adaptar bootstrap admin
   -> verificar: primer admin se crea una sola vez

8. Adaptar chatApi a nuevas operaciones admin/auth
   -> verificar: invitaciones, admin role update, model management

9. Ejecutar suite de tests + pruebas manuales cloud
   -> verificar: flujos principales estables

10. Eliminar Supabase del runtime activo
   -> verificar: no quedan imports/envs/referencias operativas
```

---

## 14. Refactor mínimo vs refactor bueno

## Refactor mínimo
Cambiar implementación interna y conservar interfaces actuales casi intactas.

### Pros
- menos riesgo
- menos cambios frontend
- rollout más rápido

### Contras
- puedes arrastrar APIs diseñadas para Supabase

## Refactor bueno
Además de migrar, simplificar modelo y stores.

### Pros
- menor deuda a futuro
- menos duplicación
- backend más coherente

### Contras
- más trabajo inicial
- mayor blast radius

## Recomendación
Hacer primero el **refactor mínimo estructuralmente sano**:
- conservar contratos externos
- simplificar solo donde el beneficio es claro (`users.role`)

---

## 15. Criterio de éxito

La migración se considera exitosa si:

- `cloud mode` funciona sin Supabase
- login/logout/session operan con PocketBase
- admin y users mantienen roles correctos
- chats se guardan y cargan correctamente
- invitaciones siguen funcionando
- catálogo de modelos sigue operativo
- `static mode` no se rompe
- no quedan referencias activas a Supabase en el runtime cloud

---

## 16. Checklist operativo

### Preparación
- [ ] definir schema PocketBase
- [ ] definir reglas de acceso
- [ ] definir variables de entorno
- [ ] definir estrategia de despliegue y backups

### Implementación
- [ ] crear cliente PocketBase server-side
- [ ] crear auth backend PocketBase
- [ ] migrar `cloudAuthAdapter`
- [ ] migrar `authz`
- [ ] migrar `appStore`
- [ ] migrar `cloudStore`
- [ ] migrar `bootstrapAdmin`
- [ ] adaptar `chatApi`

### Validación
- [ ] probar login/logout/session
- [ ] probar `/api/auth/me`
- [ ] probar guard admin
- [ ] probar invitaciones
- [ ] probar CRUD chats
- [ ] probar modelos
- [ ] correr tests relevantes

### Corte
- [ ] eliminar imports Supabase activos
- [ ] eliminar env vars Supabase
- [ ] actualizar documentación
- [ ] planificar reset/relogin si aplica

---

## 17. Recomendación final

Sí, PocketBase encaja bien en este proyecto y probablemente reduzca superficie operativa a medio plazo, especialmente porque:

- ya tienes una separación clara entre `static` y `cloud`
- el frontend cloud ya depende de tu propia API `/api/*`
- no hay integración fuerte con Supabase Storage que complique el corte
- el modelo actual se presta a consolidar auth + datos en un único backend

La clave es no tratarlo como “cambiar SDK y listo”, sino como una migración por capas donde:

- la fuente de verdad quede clara
- el contrato externo se mantenga estable
- el blast radius se controle fase por fase

---

## 18. Siguiente paso recomendado

El siguiente paso ideal es producir dos artefactos concretos:

1. **Diseño del schema PocketBase**
   - colecciones
   - campos
   - relaciones
   - reglas

2. **Plan técnico archivo por archivo**
   - qué cambiar en cada archivo
   - qué funciones conservar
   - qué tests tocar

Si se desea ejecutar la migración, ese debería ser el siguiente documento/entregable antes de editar código.
