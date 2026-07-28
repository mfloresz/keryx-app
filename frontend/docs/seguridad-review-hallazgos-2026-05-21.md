# Informe de Revisión de Seguridad

**Proyecto:** Keryx  
**Revisado:** 2026-05-21  
**Modos de despliegue analizados:** `static` (solo cliente) y `cloud` (con backend Supabase)  
**Alcance:** Autenticación cloud, API server-side, almacenamiento de secretos en cliente, dependencias, configuración de infraestructura

## Resumen

| Severidad | Cantidad |
|---|---|
| Críticos | 0 |
| Altos | 4 |
| Medios | 3 |
| Bajos | 2 |
| **Riesgo General** | **MEDIO** |

---

## 1. Vulnerabilidades en Dependencias

### 1.1 — Múltiples CVEs de severidad alta en dependencias de desarrollo

**Severidad:** ALTA  
**Categoría:** Using Components with Known Vulnerabilities  
**Ubicación:** `package.json` (devDependencies)

| Paquete | Severidad | GHSA / CVE | Problema |
|---|---|---|---|
| `defu` ≤6.1.4 | ALTA | GHSA-737v-mqg7-c878 | Prototype pollution vía `__proto__` |
| `picomatch` 4.0.0–4.0.3 | ALTA | GHSA-3v7f-55p6-f55p, GHSA-c2c7-rcm5-vvqj | Method Injection + ReDoS |
| `postcss` <8.5.10 | MODERADA | GHSA-qx2v-qp2m-jg93 | XSS vía `</style>` sin escapar |
| `rollup` 4.0.0–4.58.0 | ALTA | GHSA-mw96-cpmx-2vgc | Escritura arbitraria de archivos vía path traversal |
| `vite` 7.0.0–7.3.1 | ALTA | Multi (GHSA-4w7w-66w2-5vf9, etc.) | Path traversal, lectura arbitraria de archivos |

**Contexto:** Las cinco son dependencias de build/desarrollo — no se distribuyen a producción. Sin embargo, afectan el entorno de desarrollo y la cadena de build.

**Remediación:**
```bash
npm audit fix        # actualiza postcss, rollup, vite, picomatch
npm update defu      # actualizar defu manualmente
```

---

## 2. Cobertura OWASP Top 10

### 2.1 — Inyección (SQL, NoSQL, Comandos)

**Riesgo:** BAJO  
**Análisis:** El modo cloud usa la API REST de Supabase (PostgREST) exclusivamente a través de `supabaseRest.ts`. Todas las consultas usan parámetros como URL query params (`eq.${value}`, `limit`, `select`). No existe concatenación de SQL crudo. `supabaseAdmin.ts` usa la API Admin de Supabase con cuerpos JSON estructurados.  
**Veredicto:** Uso seguro.

### 2.2 — Autenticación Rota

**Riesgo:** BAJO  
**Análisis:**
- Verificación JWT en `supabaseAuth.ts` soporta HS256, RS256, PS256, ES256, y EdDSA — detección correcta de algoritmo por tipo de clave JWK.
- Obtiene JWKS de Supabase para verificación asimétrica.
- Soporta `SUPABASE_JWT_SECRET` para HMAC simétrico como fallback.
- `authz.ts` provee `requireUser()` y `requireAdmin()` usados consistentemente en todas las rutas protegidas.
- Sistema de invitación hashea tokens con SHA-256 antes de almacenarlos.
- **Nota:** La función `verifyHs256` usa `crypto.subtle as any` para evadir el tipado estricto de TypeScript. Es una brecha de type-safety, no una vulnerabilidad de runtime, pero puede ocultar errores de algoritmo.

### 2.3 — Exposición de Datos Sensibles

**Riesgo:** MEDIO  
**Análisis:**

| Dato | Almacenamiento | Protección |
|---|---|---|
| API keys (AI gateway, OpenCode, Tavily) | `localStorage` vía `secureStorage.ts` | **Cifrado** con AES-GCM-256, clave maestra en entrada opaca de localStorage |
| Tokens de acceso/refresh de Supabase | `localStorage` | **Texto plano** (sin cifrado) |
| JWTs en tránsito | Header HTTP Authorization | Depende de TLS |
| Chats (modo cloud) | Filas en Supabase | Cifrado en reposo por Supabase |
| Chats (modo static) | OPFS (Origin Private File System) | Aislado por origen del navegador |

**Hallazgo:** Los tokens de Supabase (`supabase-access-token` y `supabase-refresh-token`) se almacenan en texto plano en localStorage. Un atacante con XSS o una extensión maliciosa con permisos de almacenamiento podría exfiltrarlos.

**Remediación:** Cifrar los tokens de autenticación usando el mismo patrón AES-GCM de `secureStorage.ts` que ya se usa para las API keys.

### 2.4 — XXE (XML External Entities)

**Riesgo:** NINGUNO  
**Análisis:** No existe parseo de XML en todo el código base. No aplica.

### 2.5 — Control de Acceso Roto

**Riesgo:** BAJO  
**Análisis:**
- **Propiedad de chats:** `cloudStore.ts` filtra por `owner_id: eq.${ownerId}` en toda operación de base de datos — seguridad a nivel de fila correcta.
- **Rutas admin:** Todos los endpoints admin llaman a `requireAdmin()` que verifica `user.role !== "admin"`.
- **Acceso a modelos:** `assertModelAllowed()` se ejecuta antes del streaming de AI, verificando permisos usuario→modelo.
- **Invitaciones:** El hasheo de tokens previene enumeración; `isInvitationValid()` verifica expiración y uso.
- **IDs de chat:** Son UUIDs (no secuenciales) — no hay riesgo de Referencia Directa a Objetos.

### 2.6 — Mala Configuración de Seguridad

**Riesgo:** BAJO  
**Análisis:**
- **Headers de seguridad** presentes en todos los targets de despliegue:
  - `nginx` (`default.conf`): X-Content-Type-Options, X-Frame-Options, CSP, Permissions-Policy, COEP, COOP, Referrer-Policy
  - `Vercel` (`vercel.json`): Mismos headers replicados
  - `index.html`: Meta tag CSP (redundante pero seguro)
- **Divulgación de errores:** Mensaje genérico `"Internal error"` en producción; error completo solo en `import.meta.env.DEV`.
- **CORS:** No expuesto como API pública — solo peticiones same-origin a través del proxy de Vite/nginx.

**Análisis de CSP (Fuerte):**
```
default-src 'self'
script-src 'self' 'wasm-unsafe-eval'
style-src 'self' 'unsafe-inline'
connect-src 'self' https://ai-gateway.vercel.sh https://api.tavily.com https://*.supabase.co ws: wss: blob: data:
```

Notable: `'unsafe-inline'` para estilos es requerido por Vue scoped styles. `'wasm-unsafe-eval'` es necesario para Vite/Rive/shiki. Son tradeoffs aceptables para este tipo de aplicación.

### 2.7 — Cross-Site Scripting (XSS)

**Riesgo:** BAJO  
**Análisis:**
- **Vue 3** escapa automáticamente todo binding `{{ }}` — no hay superficie XSS vía templates.
- **No se encontró `v-html`** en todo el código base.
- **No se encontró `innerHTML`**.
- **No se encontró `eval()`** ni `setTimeout` con strings.
- Los mensajes del chat se renderizan mediante componentes Vue con interpolación estándar.
- CSP fuerte mitiga adicionalmente cualquier riesgo de inyección.

**Veredicto:** La prevención de XSS está bien implementada.

### 2.8 — Deserialización Insegura

**Riesgo:** BAJO  
**Análisis:**
- Todos los cuerpos de peticiones API pasan por `JSON.parse`.
- `safeJsonParse()` en `clientApi.ts` verifica claves `__proto__` y `constructor` para prevenir prototype pollution.
- El servidor cloud `handleApiRequest` **no** tiene esta misma verificación — los cuerpos se parsean directamente via `request.json()`.
- Sin embargo, los objetos se consumen estructuralmente (se verifican campos específicos) y nunca se mezclan en prototipos de forma insegura.

**Remediación (defense-in-depth):** Agregar la misma verificación de prototype pollution al lado servidor.

### 2.9 — Componentes con Vulnerabilidades Conocidas

**Riesgo:** MEDIO  
**Análisis:** Cubierto en Sección 1. Las cinco vulnerabilidades están en herramientas de build/desarrollo. El impacto en producción es nulo, pero representan riesgo en la cadena de suministro durante desarrollo.

### 2.10 — logging y monitoreo insuficientes

**Riesgo:** MEDIO  
**Análisis:**
- **No existe infraestructura de logging estructurado.**
- `console.error` usado solo en desarrollo.
- Los errores del servidor se capturan y devuelven como HTTP 500 con mensaje genérico — no hay registro de auditoría.
- Los intentos de autenticación fallidos no se registran.
- Las operaciones de admin (creación de usuarios, cambios de modelos) no dejan rastro de auditoría.
- El reinicio de `bootstrapPromise` en `ensureBootstrapAdmin` tras fallo podría permitir intentos repetidos.

**Remediación:** Agregar logging estructurado del lado servidor con eventos relevantes de seguridad (fallos de autenticación, acciones admin, uso de invitaciones).

---

## 3. Hallazgos Específicos

### 3.1 — Condición de Carrera en Bootstrap Admin (ALTO)

**Severidad:** ALTO  
**Categoría:** Race Condition  
**Ubicación:** `src/server/bootstrapAdmin.ts`

**Problema:**
```typescript
export async function ensureBootstrapAdmin(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      // ... lógica de creación de usuario ...
    })().finally(() => {
      bootstrapPromise = null;  // ← Se reinicia tanto en fallo como en éxito
    });
  }
  await bootstrapPromise;
}
```

Si `createSupabaseUser` tiene éxito pero `upsertUser` (creación del perfil en la app) falla, la promesa se rechaza, `bootstrapPromise` vuelve a `null`, y la siguiente solicitud reintenta. Sin embargo, el usuario de Supabase ya existe — `findSupabaseUserByEmail` salta la creación, pero `upsertUser` se ejecuta de nuevo. Si el perfil de la app se creó parcialmente, podría llevar a entradas duplicadas o estado inconsistente.

**Impacto:** Un bootstrap de admin parcial podría dejar el sistema en un estado inconsistente con un usuario de Supabase sin un perfil de app correspondiente.

**Remediación:**
- Eliminar `.finally(() => { bootstrapPromise = null; })` — una vez bootstrapped, no reintentar nunca.
- Agregar verificaciones de idempotencia en el perfil de la app.
- Registrar errores en lugar de reintentar silenciosamente.

### 3.2 — Tokens JWT en Texto Plano en localStorage (MEDIO)

**Severidad:** MEDIO  
**Categoría:** Exposición de Datos Sensibles  
**Ubicación:** `src/adapters/cloud/cloudAuthAdapter.ts`

**Problema:**
```typescript
const ACCESS_TOKEN_KEY = "supabase-access-token";
const REFRESH_TOKEN_KEY = "supabase-refresh-token";
localStorage.setItem(ACCESS_TOKEN_KEY, payload.access_token);
```

Los tokens JWT se almacenan en texto plano. Aunque `secureStorage.ts` ya existe en el código base para cifrar API keys, los tokens de autenticación no lo usan.

**Impacto:** Una extensión del navegador con acceso a storage, o una XSS, podría robar la sesión activa del usuario.

**Remediación:** Usar `secureSetItem`/`secureGetItem` para los tokens de autenticación, mismo patrón que el almacenamiento de API keys.

### 3.3 — Falta de Guardia contra Prototype Pollution en el Servidor (MEDIO)

**Severidad:** MEDIO  
**Categoría:** Deserialización Insegura  
**Ubicación:** `src/server/chatApi.ts` (todos los llamados a `readJsonBody`)

**Problema:** El cliente tiene `safeJsonParse` que verifica `__proto__` y `constructor`, pero el servidor no tiene esta misma protección.

```typescript
// Servidor (sin guardia):
async function readJsonBody<T>(request: Request): Promise<T> {
  return await request.json();  // Sin verificación de prototype pollution
}
```

**Impacto:** Aunque el código no mezcla input del usuario en prototipos de forma insegura, un atacante podría pasar `{"__proto__": {"admin": true}}` que podría contaminar `Object.prototype` global dependiendo de la versión de Node.js y el comportamiento de las librerías.

**Remediación:** Agregar la misma guardia de `__proto__`/`constructor` a `readJsonBody`.

### 3.4 — Vulnerabilidades de Build en Imagen Docker de Producción (BAJO)

**Severidad:** BAJO  
**Categoría:** Mala Configuración de Seguridad  
**Ubicación:** `Dockerfile`

```dockerfile
FROM node:22-alpine AS build
RUN npm ci
```

**Problema:** La etapa de build instala todas las dependencias incluyendo paquetes de desarrollo vulnerables. La etapa de producción con nginx solo copia el output compilado, por lo que el riesgo en runtime es mínimo. Sin embargo, el build podría ser secuestrado durante `npm ci` si el registro o una dependencia es comprometida.

### 3.5 — Token de Invitación Expuesto en Respuesta API (BAJO)

**Severidad:** BAJO  
**Categoría:** Exposición de Datos Sensibles  
**Ubicación:** `src/server/chatApi.ts` (`handleAdminCreateInvitation`)

```typescript
return jsonResponse({
  invitation: sanitizeInvitation(invitation),
  invitationUrl: `${getBaseUrl(request)}/invite/${rawToken}`,
});
```

**Problema:** El token de invitación se devuelve en el cuerpo de la respuesta API y en la URL. Ambos se transmiten por HTTPS, pero si algún sistema downstream (logs de acceso del servidor, logs de proxy inverso) captura los cuerpos de respuesta, el token queda expuesto. Compartir la URL es inherentemente riesgoso (las URLs aparecen en el historial del navegador, headers Referrer).

**Remediación:** Documentar que las URLs de invitación deben compartirse por canales seguros (mensajería cifrada, no logs de email). Agregar expiración opcional del token al primer acceso.

---

## 4. Checklist de Seguridad

| Verificación | Estado |
|---|---|
| Sin secretos hardcodeados | ✅ PASÓ — Todas las claves vienen de env vars o almacenamiento cifrado |
| Todos los inputs validados | ✅ PASÓ — Validación de tipos, verificaciones estructurales |
| Prevención de inyección SQL | ✅ PASÓ — Solo consultas parametrizadas vía PostgREST |
| Prevención de XSS | ✅ PASÓ — Sin v-html, sin innerHTML, CSP fuerte |
| Protección CSRF | ⚠️ PARCIAL — Solo same-origin (sin API cross-origin), pero sin tokens CSRF explícitos |
| Autenticación requerida | ✅ PASÓ — `requireUser`/`requireAdmin` en todas las rutas protegidas |
| Autorización verificada | ✅ PASÓ — Filtrado por ownership en datos de chat |
| Rate limiting habilitado | ❌ NO IMPLEMENTADO — Sin rate limiting en endpoints de autenticación |
| HTTPS exigido | ✅ PASÓ — Terminación TLS en nginx/Vercel |
| Headers de seguridad configurados | ✅ PASÓ — CSP, COEP, COOP, X-Frame-Options, etc. |
| Dependencias actualizadas | ⚠️ 5 vulnerabilidades encontradas (4 altas), corregir con `npm audit fix` |
| Paquetes sin vulnerabilidades | ⚠️ Ver arriba |
| Logging sanitizado | ❌ No se observa limpieza de PII en logs |
| Mensajes de error seguros | ✅ PASÓ — Mensajes genéricos en producción |
| Detección de secretos | ✅ PASÓ — API keys cifradas con AES-GCM |
| Web Crypto usado de forma segura | ⚠️ Cast `crypto.subtle as any` en verificación HMAC |

---

## 5. Análisis de los Cuatro Invariantes

| Invariante | Evaluación |
|---|---|
| **¿Dónde vive el estado?** | Sesión: localStorage (cifrado para keys, plano para tokens). Chats: Supabase (cloud) u OPFS (static). Auth: Store Pinia + localStorage. |
| **¿Dónde vive la retroalimentación?** | Sin logging estructurado ni telemetría. Solo `console.error` en desarrollo. Sin logging de eventos de seguridad en el servidor. |
| **¿Qué se rompe si elimino esto?** | Eliminar `supabaseRest.ts` rompe toda persistencia cloud. Eliminar `secureStorage.ts` expone API keys en texto plano. Eliminar `authz.ts` elimina las guardias de autenticación en todas las rutas. |
| **¿Cuándo funciona la temporización?** | `chatWriteLocks` serializa escrituras OPFS. `bootstrapPromise` tiene un fallo de recuperación tras race condition. `withChatLock` serializa correctamente operaciones concurrentes de chat. |

---

## 6. Prioridades de Corrección

### Corregir Ahora (Alto)

1. **Ejecutar `npm audit fix`** — resuelve 4 vulnerabilidades de severidad alta en dependencias de desarrollo.
2. **Arreglar reintento de bootstrap admin** — eliminar `.finally(() => { bootstrapPromise = null; })` para que un bootstrap fallido no reintente desde cero, evitando estados inconsistentes.

### Corregir Pronto (Medio)

3. **Cifrar tokens JWT en localStorage** — reutilizar el patrón AES-GCM existente de `secureStorage.ts` para `supabase-access-token` y `supabase-refresh-token`.
4. **Agregar guardia de prototype pollution en el servidor** en `readJsonBody()` similar a `safeJsonParse` del cliente.
5. **Agregar rate limiting** en los endpoints `/api/invitations/accept` y `/api/auth/*` para prevenir fuerza bruta/password spraying.

### Considerar (Bajo)

6. **Eliminar `crypto.subtle as any`** en `supabaseAuth.ts` y usar parámetros correctamente tipados de Web Crypto API.
7. **Agregar logging estructurado de solicitudes** que capture fallos de autenticación, operaciones de admin y eventos de uso de invitaciones.
8. **Documentar manejo de URLs de invitación** — el token es sensible y debe transmitirse solo por canales seguros.

---

**Conclusión:** La aplicación tiene fundamentos de seguridad sólidos — verificación JWT correcta, API keys cifradas, sin vectores XSS, acceso a bases de datos parametrizado y CSP completa. Los riesgos principales son la condición de carrera en bootstrap admin, los tokens JWT en texto plano en localStorage y las 4 vulnerabilidades altas en dependencias de desarrollo. Abordar esos tres puntos reduciría el riesgo residual a **BAJO**.
