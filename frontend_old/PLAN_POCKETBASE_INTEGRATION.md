# Plan de Integración de PocketBase como Backend en Modo Cloud

## Resumen Ejecutivo

Este documento describe el plan para reemplazar Supabase por **PocketBase** como backend en modo cloud para Keryx, manteniendo la arquitectura actual y agregando las capacidades específicas requeridas:

- Verificación de URL de PocketBase al inicio (con solicitud si no existe)
- Autenticación multiusuario
- Todas las colecciones con prefijo `keryx_` para evitar conflictos
- El superadmin de PocketBase **NO** es el superadmin de Keryx (Keryx gestiona sus propios roles)

---

## 1. Arquitectura Actual (Supabase)

### Componentes Clave

```
src/server/
├── supabaseAuth.ts      # Verificación JWT, contexto de autenticación
├── supabaseRest.ts      # Operaciones CRUD REST contra Supabase
├── supabaseAdmin.ts     # Funciones admin (crear usuarios, roles)
├── appStore.ts          # Lógica de negocio (usuarios, invitaciones, modelos)
├── cloudStore.ts        # Almacenamiento de chats
├── authz.ts             # Autorización (requireUser, requireAdmin)
├── bootstrapAdmin.ts    # Creación de admin inicial
└── chatApi.ts           # API principal

src/adapters/cloud/
├── cloudAuthAdapter.ts # Adaptador de autenticación lado cliente
└── cloudChatRepository.ts

src/services/runtime.ts  # Selección de repositorios/adaptadores
src/app/config.ts        # Configuración de modo deploy
```

### Tablas Actuales (con prefijo keryx_)
- `keryx_app_users` - Usuarios de la aplicación
- `keryx_invitations` - Invitaciones
- `keryx_models` - Catálogo de modelos
- `keryx_user_model_access` - Acceso usuario-modelo
- `keryx_chats` - Chats almacenados

---

## 2. Arquitectura Propuesta (PocketBase)

### Nuevos Archivos

```
src/server/
├── pocketbaseClient.ts    # Cliente PocketBase singleton
├── pocketbaseAuth.ts      # Autenticación PocketBase (reemplaza supabaseAuth.ts)
├── pocketbaseRest.ts      # Operaciones CRUD PocketBase (reemplaza supabaseRest.ts)
├── pocketbaseAdmin.ts     # Funciones admin PocketBase (reemplaza supabaseAdmin.ts)
├── pocketbaseConfig.ts    # Configuración de URL y validación
└── pocketbaseBootstrap.ts # Bootstrap de colecciones Keryx

src/adapters/cloud/
├── pocketbaseAuthAdapter.ts # Adaptador lado cliente (reemplaza cloudAuthAdapter.ts)
└── ... (el resto sigue igual, usando los nuevos servicios server-side)
```

### Colecciones PocketBase (con prefijo keryx_)

| Colección | Tipo | Descripción | Campos clave |
|-----------|------|-------------|--------------|
| `keryx_app_users` | Base | Usuarios de Keryx | id, email, role, created_at, updated_at |
| `keryx_invitations` | Base | Invitaciones pendientes | id, email, token_hash, role, expires_at, used_at, created_by, created_at, initial_model_access |
| `keryx_models` | Base | Catálogo de modelos AI | id, provider, display_name, supports_images, supports_search, enabled, created_at, updated_at |
| `keryx_user_model_access` | Base | Relación usuario-modelo | user_id, model_id, created_at |
| `keryx_chats` | Base | Chats almacenados | id, owner_id, title, visibility, created_at, updated_at, data (JSON) |

> **NOTA IMPORTANTE**: PocketBase tiene su propia colección `users` para autenticación. **NO la usaremos directamente**. Crearemos nuestra propia colección `keryx_app_users` que referencia el ID de PocketBase.

---

## 3. Flujo de Configuración y Arranque

### 3.1 Configuración de URL de PocketBase

**Requisito**: Al iniciar, comprobar si existe la URL de PocketBase guardada. Si no, pedirla.

#### Implementación en `src/server/pocketbaseConfig.ts`

```typescript
// Variable para almacenar la URL configurada
let pocketbaseUrl: string | null = null;

// Clave en localStorage para persistir la URL
const POCKETBASE_URL_KEY = 'keryx-pocketbase-url';

export interface PocketBaseConfig {
  url: string;
}

/**
 * Obtiene la URL de PocketBase desde el entorno o almacenamiento
 */
export function getPocketBaseUrl(): string | null {
  // 1. Prioridad: Variable de entorno (para producción)
  if (pocketbaseUrl) {
    return pocketbaseUrl;
  }
  
  // 2. Desde process.env (configuración server-side)
  const envUrl = process.env.POCKETBASE_URL || process.env.VITE_POCKETBASE_URL;
  if (envUrl) {
    pocketbaseUrl = envUrl.replace(/\/$/, '');
    return pocketbaseUrl;
  }
  
  // 3. Para modo desarrollo, intentar desde localStorage (client-side)
  //    Esto se manejará en el frontend
  return null;
}

/**
 * Establece la URL de PocketBase (solo para modo desarrollo)
 */
export function setPocketBaseUrl(url: string): void {
  pocketbaseUrl = url.replace(/\/$/, '');
}

/**
 * Valida que la URL de PocketBase sea accesible
 */
export async function validatePocketBaseUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Verifica si PocketBase está configurado
 */
export function isPocketBaseConfigured(): boolean {
  return Boolean(getPocketBaseUrl());
}
```

### 3.2 Middleware de Configuración

Modificar `vite.config.ts` para agregar un middleware que verifique la configuración antes de procesar requests:

```typescript
// En vite.config.ts, en el cloudApiPlugin
async function handleCloudApiRequest(req: any, res: any, next: any) {
  // Verificar configuración de PocketBase
  if (!isPocketBaseConfigured()) {
    // Si no está configurado y es una request API (no la página de configuración)
    if (req.url?.startsWith('/api/') && !req.url?.startsWith('/api/config')) {
      return sendConfigRequiredResponse(res);
    }
  }
  
  // ... resto del middleware existente
}

function sendConfigRequiredResponse(res: any) {
  res.statusCode = 400;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    error: 'PocketBase URL not configured',
    requiresSetup: true
  }));
}
```

### 3.3 Página de Configuración Inicial (Frontend)

Crear un nuevo componente o modificar la página de login para solicitar la URL si no está configurada:

```typescript
// src/pages/setup.vue (nuevo)
<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue/router';

const router = useRouter();
const pbUrl = ref('');
const error = ref('');
const isValidating = ref(false);

async function handleSubmit() {
  if (!pbUrl.value.trim()) {
    error.value = 'URL is required';
    return;
  }
  
  isValidating.value = true;
  error.value = '';
  
  try {
    // Validar la URL
    const response = await fetch('/api/config/validate-pocketbase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: pbUrl.value.trim() })
    });
    
    if (!response.ok) {
      throw new Error('Invalid PocketBase URL');
    }
    
    // Guardar en localStorage para persistencia
    localStorage.setItem('keryx-pocketbase-url', pbUrl.value.trim());
    
    // Redirigir a login
    router.push('/login');
  } catch (e) {
    error.value = 'Unable to connect to PocketBase. Please check the URL.';
  } finally {
    isValidating.value = false;
  }
}
</script>
```

Modificar el router para redirigir a `/setup` si no hay configuración:

```typescript
// En src/router/index.ts
import { isPocketBaseConfigured } from '@/server/pocketbaseConfig';

router.beforeEach(async (to) => {
  // En modo cloud, verificar configuración
  if (IS_CLOUD_MODE && !isPocketBaseConfigured()) {
    // Permitir acceso a /setup y /api/config/*
    if (to.path !== '/setup' && !to.path.startsWith('/api/config')) {
      return '/setup';
    }
  }
  // ... lógica existente
});
```

---

## 4. Autenticación con PocketBase

### 4.1 Cliente PocketBase (Singleton)

```typescript
// src/server/pocketbaseClient.ts
import PocketBase from 'pocketbase';

let clientInstance: PocketBase | null = null;

export function getPocketBaseClient(): PocketBase {
  if (!clientInstance) {
    const url = getPocketBaseUrl();
    if (!url) {
      throw new Error('PocketBase URL not configured');
    }
    clientInstance = new PocketBase(url);
  }
  return clientInstance;
}

export function resetPocketBaseClient(): void {
  clientInstance = null;
}
```

### 4.2 Autenticación Server-Side

```typescript
// src/server/pocketbaseAuth.ts
import { getPocketBaseClient } from './pocketbaseClient';
import { getPocketBaseUrl } from './pocketbaseConfig';

export interface AuthContext {
  userId: string;
  email?: string;
}

function getBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }
  return token;
}

/**
 * Obtiene el contexto de autenticación desde el token PocketBase
 */
export async function getAuthContext(request: Request): Promise<AuthContext | null> {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  try {
    const pb = getPocketBaseClient();
    
    // Verificar el token con PocketBase
    pb.authStore.save(token);
    
    // Obtener el usuario autenticado
    const user = pb.authStore.model;
    if (!user?.id) {
      return null;
    }
    
    return {
      userId: user.id,
      email: user.email,
    };
  } catch {
    return null;
  }
}

/**
 * Verifica si el token es válido (para middleware)
 */
export async function verifyToken(token: string): Promise<AuthContext | null> {
  try {
    const pb = getPocketBaseClient();
    pb.authStore.save(token);
    
    const user = pb.authStore.model;
    if (!user?.id) {
      return null;
    }
    
    return {
      userId: user.id,
      email: user.email,
    };
  } catch {
    return null;
  }
}
```

### 4.3 Relación entre Usuarios PocketBase y Usuarios Keryx

**IMPORTANTE**: PocketBase tiene su propia colección `users` para autenticación. Keryx usará:

1. **Autenticación**: PocketBase maneja el login/logout (email/password)
2. **Usuarios de Aplicación**: Colección `keryx_app_users` almacena los metadatos de Keryx
3. **Relación**: `keryx_app_users.id` = `users.id` de PocketBase

```typescript
// En src/server/pocketbaseAdmin.ts
import { getPocketBaseClient } from './pocketbaseClient';
import type { AppUserRecord } from './appStore';

export interface PocketBaseUser {
  id: string;
  email: string;
  // ... otros campos de PocketBase
}

/**
 * Crea un usuario en PocketBase (para autenticación)
 */
export async function createPocketBaseUser(params: {
  email: string;
  password: string;
}): Promise<PocketBaseUser> {
  const pb = getPocketBaseClient();
  
  const user = await pb.collection('users').create({
    email: params.email,
    password: params.password,
    passwordConfirm: params.password,
  });
  
  return user;
}

/**
 * Actualiza el rol de un usuario en Keryx (en keryx_app_users)
 * NO modifica los permisos de PocketBase
 */
export async function updatePocketBaseUserRole(params: {
  userId: string;
  role: 'admin' | 'user';
}): Promise<void> {
  const pb = getPocketBaseClient();
  
  // Actualizar en keryx_app_users
  await pb.collection('keryx_app_users').update(params.userId, {
    role: params.role,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Obtiene un usuario de Keryx por email
 */
export async function getPocketBaseUserByEmail(email: string): Promise<PocketBaseUser | null> {
  const pb = getPocketBaseClient();
  
  try {
    const result = await pb.collection('users').getFirstListItem(
      `email = "${email}"`
    );
    return result;
  } catch {
    return null;
  }
}

/**
 * Lista todos los usuarios de PocketBase
 */
export async function listPocketBaseUsers(): Promise<PocketBaseUser[]> {
  const pb = getPocketBaseClient();
  
  const result = await pb.collection('users').getFullList({
    sort: '-created',
  });
  
  return result;
}
```

---

## 5. Operaciones REST con PocketBase

### 5.1 Reemplazo de supabaseRest.ts

```typescript
// src/server/pocketbaseRest.ts
import { getPocketBaseClient } from './pocketbaseClient';
import type { RecordModel } from 'pocketbase';

/**
 * Ejecuta una consulta de selección
 */
export async function selectRows<T>(
  collection: string,
  options: {
    select?: string;
    filter?: string;
    order?: string;
    limit?: string | number;
    page?: number;
    [key: string]: string | number | undefined;
  } = {}
): Promise<T[]> {
  const pb = getPocketBaseClient();
  
  const { select, filter, order, limit, page, ...rest } = options;
  
  const query = pb.collection(collection).getList(
    page || 1,
    limit ? Number(limit) : 100,
    {
      sort: order,
      filter: filter,
      expand: select,
      ...rest,
    }
  );
  
  const result = await query;
  return result.items as T[];
}

/**
 * Inserta filas (con soporte para upsert)
 */
export async function insertRows<T>(
  collection: string,
  payload: Record<string, any> | Array<Record<string, any>>,
  options?: { upsert?: boolean; onConflict?: string }
): Promise<T[]> {
  const pb = getPocketBaseClient();
  
  if (Array.isArray(payload)) {
    const results = await Promise.all(
      payload.map(item => pb.collection(collection).create(item))
    );
    return results as T[];
  }
  
  // Para upsert, primero intentar crear, si falla actualizar
  if (options?.upsert && options.onConflict) {
    try {
      const result = await pb.collection(collection).create(payload);
      return [result] as T[];
    } catch (error: any) {
      if (error.status === 400) {
        // Duplicado, hacer update
        const conflictField = options.onConflict;
        const existing = await pb.collection(collection).getFirstListItem(
          `${conflictField} = "${payload[conflictField]}"`
        );
        if (existing) {
          const result = await pb.collection(collection).update(existing.id, payload);
          return [result] as T[];
        }
      }
      throw error;
    }
  }
  
  const result = await pb.collection(collection).create(payload);
  return [result] as T[];
}

/**
 * Actualiza filas
 */
export async function updateRows<T>(
  collection: string,
  filters: Record<string, string>,
  payload: Record<string, any>
): Promise<T[]> {
  const pb = getPocketBaseClient();
  
  // Convertir filtros a formato PocketBase
  const filterParts = Object.entries(filters).map(([key, value]) => {
    if (value.startsWith('eq.')) {
      return `${key} = "${value.substring(3)}"`;
    }
    if (value.startsWith('neq.')) {
      return `${key} != "${value.substring(4)}"`;
    }
    // ... otros operadores
    return `${key} = "${value}"`;
  });
  
  const filter = filterParts.join(' && ');
  
  const result = await pb.collection(collection).update(
    filter,
    payload
  );
  
  return result as T[];
}

/**
 * Elimina filas
 */
export async function deleteRows(
  collection: string,
  filters: Record<string, string>
): Promise<void> {
  const pb = getPocketBaseClient();
  
  // Obtener los IDs primero
  const filterParts = Object.entries(filters).map(([key, value]) => {
    if (value.startsWith('eq.')) {
      return `${key} = "${value.substring(3)}"`;
    }
    return `${key} = "${value}"`;
  });
  
  const items = await pb.collection(collection).getFullList({
    filter: filterParts.join(' && '),
    requestKey: 'delete_rows',
  });
  
  // Eliminar todos los items
  for (const item of items) {
    await pb.collection(collection).delete(item.id);
  }
}
```

---

## 6. Adaptación de appStore.ts

No se requieren cambios significativos en `appStore.ts` ya que:
1. Ya usa el prefijo `keryx_` para todas las tablas
2. Las funciones son genéricas y usan `selectRows`, `insertRows`, `updateRows`, `deleteRows`

Solo hay que asegurar que las importaciones apunten a los nuevos archivos:

```typescript
// En src/server/appStore.ts
// Cambiar:
// import { deleteRows, insertRows, selectRows, updateRows } from "./supabaseRest.js";
// Por:
import { deleteRows, insertRows, selectRows, updateRows } from "./pocketbaseRest.js";
```

---

## 7. Adaptador de Autenticación Lado Cliente

### 7.1 Reemplazo de cloudAuthAdapter.ts

```typescript
// src/adapters/cloud/pocketbaseAuthAdapter.ts
import type { AuthAdapter } from '@/domain/auth/ports';
import type { AuthSession } from '@/domain/auth/types';

const ACCESS_TOKEN_KEY = 'pocketbase-access-token';
const REFRESH_TOKEN_KEY = 'pocketbase-refresh-token';

let cachedSession: AuthSession | null = null;
let cachedSessionToken: string | null = null;
let cachedSessionAt = 0;
const SESSION_CACHE_TTL_MS = 30_000;

function getLocalStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function getPocketBaseUrl(): string {
  // Leer desde localStorage primero (para modo desarrollo)
  const storage = getLocalStorage();
  const storedUrl = storage?.getItem('keryx-pocketbase-url');
  if (storedUrl) {
    return storedUrl.replace(/\/$/, '');
  }
  
  // Luego desde variables de entorno
  return (
    import.meta.env.VITE_POCKETBASE_URL ||
    import.meta.env.POCKETBASE_URL ||
    ''
  );
}

interface JwtPayload {
  sub?: string;
  email?: string;
  exp?: number;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    return JSON.parse(
      atob(part.replace(/-/g, '+').replace(/_/g, '/')),
    ) as JwtPayload;
  } catch {
    return null;
  }
}

function clearStoredSession(): void {
  const storage = getLocalStorage();
  storage?.removeItem(ACCESS_TOKEN_KEY);
  storage?.removeItem(REFRESH_TOKEN_KEY);
  cachedSession = null;
  cachedSessionToken = null;
  cachedSessionAt = 0;
}

function isExpired(payload: JwtPayload): boolean {
  if (typeof payload.exp !== 'number') {
    return false;
  }
  return payload.exp <= Math.floor(Date.now() / 1000);
}

function readStoredSession(): AuthSession | null {
  const token = getLocalStorage()?.getItem(ACCESS_TOKEN_KEY);
  if (!token) {
    return null;
  }

  const payload = decodeJwtPayload(token);
  if (!payload?.sub || isExpired(payload)) {
    if (payload && isExpired(payload)) {
      clearStoredSession();
    }
    return null;
  }

  return {
    accessToken: token,
    user: {
      id: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email : null,
      role: 'user', // Se obtendrá del backend
    },
  };
}

async function fetchAppSession(accessToken: string): Promise<AuthSession | null> {
  try {
    const response = await fetch('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return {
      accessToken,
      user: {
        id: String(payload.id),
        email: typeof payload.email === 'string' ? payload.email : null,
        role: payload.role === 'admin' ? 'admin' : 'user',
      },
    };
  } catch {
    return null;
  }
}

export const pocketbaseAuthAdapter: AuthAdapter = {
  async getSession() {
    const stored = readStoredSession();
    if (!stored?.accessToken) {
      return null;
    }

    const accessToken = stored.accessToken;
    const now = Date.now();
    if (
      cachedSessionToken === accessToken &&
      now - cachedSessionAt < SESSION_CACHE_TTL_MS
    ) {
      return cachedSession;
    }

    const appSession = await fetchAppSession(accessToken);
    if (appSession) {
      cachedSession = appSession;
      cachedSessionToken = accessToken;
      cachedSessionAt = Date.now();
      return appSession;
    }

    return stored;
  },

  async login(email: string, password: string) {
    const url = getPocketBaseUrl();
    if (!url) {
      throw new Error('PocketBase URL not configured');
    }

    const response = await fetch(`${url}/api/collection/users/auth-with-password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.token) {
      const message =
        typeof payload?.msg === 'string'
          ? payload.msg
          : typeof payload?.message === 'string'
          ? payload.message
          : 'Unable to sign in';
      throw new Error(message);
    }

    const storage = getLocalStorage();
    storage?.setItem(ACCESS_TOKEN_KEY, payload.token);
    
    // PocketBase devuelve el usuario en el payload
    const appSession = {
      accessToken: payload.token,
      user: {
        id: String(payload.record.id),
        email: payload.record.email,
        role: 'user', // Se validará con el backend
      },
    };

    // Obtener el rol real del usuario desde Keryx
    const verifiedSession = await fetchAppSession(payload.token);
    if (verifiedSession) {
      cachedSession = verifiedSession;
      cachedSessionToken = payload.token;
      cachedSessionAt = Date.now();
      return verifiedSession;
    }

    cachedSession = appSession;
    cachedSessionToken = payload.token;
    cachedSessionAt = Date.now();
    return appSession;
  },

  async logout() {
    const token = getLocalStorage()?.getItem(ACCESS_TOKEN_KEY);
    clearStoredSession();

    const url = getPocketBaseUrl();
    if (!token || !url) {
      return;
    }

    try {
      await fetch(`${url}/api/collection/users/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      // Ignorar errores de logout
    }
  },

  async getAuthorizationHeaders() {
    const stored = readStoredSession();
    const headers: Record<string, string> = {};
    if (stored?.accessToken) {
      headers.Authorization = `Bearer ${stored.accessToken}`;
    }
    return headers;
  },
};
```

---

## 8. Bootstrap de la Aplicación

### 8.1 Bootstrap Admin (modificado)

```typescript
// src/server/pocketbaseBootstrap.ts
import { getPocketBaseClient } from './pocketbaseClient';
import { getPocketBaseUrl } from './pocketbaseConfig';
import { countUsers, getUserByEmail, upsertUser } from './appStore';
import type { AppUserRecord } from './appStore';

let bootstrapPromise: Promise<void> | null = null;

function getEnv(name: string): string {
  return process.env[name] || '';
}

/**
 * Crea las colecciones de Keryx si no existen
 */
async function ensureCollectionsExist(): Promise<void> {
  const pb = getPocketBaseClient();
  
  const collectionsToCreate = [
    {
      name: 'keryx_app_users',
      schema: [
        { name: 'email', type: 'email', required: true },
        { name: 'role', type: 'select', options: { choices: [{ value: 'admin' }, { value: 'user' }] }, required: true },
        { name: 'created_at', type: 'date-time', required: true },
        { name: 'updated_at', type: 'date-time', required: true },
      ],
      indexes: [
        { field: 'email', type: 'unique' },
        { field: 'role' },
        { field: 'created_at' },
      ],
    },
    {
      name: 'keryx_invitations',
      schema: [
        { name: 'email', type: 'email', required: true },
        { name: 'token_hash', type: 'text', required: true },
        { name: 'role', type: 'select', options: { choices: [{ value: 'admin' }, { value: 'user' }] }, required: true },
        { name: 'expires_at', type: 'date-time', required: true },
        { name: 'used_at', type: 'date-time' },
        { name: 'created_by', type: 'text', required: true },
        { name: 'created_at', type: 'date-time', required: true },
        { name: 'initial_model_access', type: 'json', options: { default: '[]' } },
      ],
      indexes: [
        { field: 'token_hash', type: 'unique' },
        { field: 'email' },
        { field: 'created_by' },
        { field: 'expires_at' },
        { field: 'used_at' },
      ],
    },
    {
      name: 'keryx_models',
      schema: [
        { name: 'id', type: 'text', required: true },
        { name: 'provider', type: 'text', required: true },
        { name: 'display_name', type: 'text', required: true },
        { name: 'supports_images', type: 'bool', options: { default: false } },
        { name: 'supports_search', type: 'bool', options: { default: false } },
        { name: 'enabled', type: 'bool', options: { default: true } },
        { name: 'created_at', type: 'date-time', required: true },
        { name: 'updated_at', type: 'date-time', required: true },
      ],
      indexes: [
        { field: 'id', type: 'unique' },
        { field: 'provider' },
        { field: 'enabled' },
      ],
    },
    {
      name: 'keryx_user_model_access',
      schema: [
        { name: 'user_id', type: 'text', required: true },
        { name: 'model_id', type: 'text', required: true },
        { name: 'created_at', type: 'date-time', required: true },
      ],
      indexes: [
        { field: 'user_id' },
        { field: 'model_id' },
        { field: ['user_id', 'model_id'], type: 'unique' },
      ],
    },
    {
      name: 'keryx_chats',
      schema: [
        { name: 'id', type: 'text', required: true },
        { name: 'owner_id', type: 'text', required: true },
        { name: 'title', type: 'text' },
        { name: 'visibility', type: 'select', options: { choices: [{ value: 'public' }, { value: 'private' }] }, required: true },
        { name: 'created_at', type: 'date-time', required: true },
        { name: 'updated_at', type: 'date-time', required: true },
        { name: 'data', type: 'json', required: true },
      ],
      indexes: [
        { field: 'id', type: 'unique' },
        { field: 'owner_id' },
        { field: 'created_at' },
        { field: 'updated_at' },
      ],
    },
  ];

  // Verificar y crear colecciones
  for (const collectionDef of collectionsToCreate) {
    try {
      const existing = await pb.collections.getOneByName(collectionDef.name);
      // Colección ya existe
      continue;
    } catch {
      // Colección no existe, crearla
      await pb.collections.create({
        name: collectionDef.name,
        type: 'base',
        schema: collectionDef.schema,
        indexes: collectionDef.indexes,
      });
      console.log(`[pocketbase-bootstrap] Created collection: ${collectionDef.name}`);
    }
  }
}

/**
 * Crea el usuario admin inicial si no existe
 */
async function bootstrapAdmin(): Promise<void> {
  const email = getEnv('BOOTSTRAP_ADMIN_EMAIL').trim().toLowerCase();
  const password = getEnv('BOOTSTRAP_ADMIN_PASSWORD');
  
  if (!email || !password) {
    console.log('[pocketbase-bootstrap] No BOOTSTRAP_ADMIN_EMAIL/PASSWORD configured, skipping');
    return;
  }

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    console.log('[pocketbase-bootstrap] Admin user already exists');
    return;
  }

  const userCount = await countUsers();
  if (userCount > 0) {
    console.log('[pocketbase-bootstrap] Users already exist, skipping admin creation');
    return;
  }

  // Verificar que PocketBase esté configurado
  if (!getPocketBaseUrl()) {
    throw new Error('POCKETBASE_URL is required for admin bootstrap');
  }

  const pb = getPocketBaseClient();
  
  // Crear usuario en PocketBase (para autenticación)
  const pbUser = await pb.collection('users').create({
    email,
    password,
    passwordConfirm: password,
  });

  const now = new Date().toISOString();
  
  // Crear usuario en keryx_app_users
  await upsertUser({
    id: pbUser.id,
    email,
    role: 'admin',
    createdAt: now,
    updatedAt: now,
  });
  
  console.log(`[pocketbase-bootstrap] Created admin user: ${email}`);
}

async function bootstrap(): Promise<void> {
  // 1. Asegurar que las colecciones existen
  await ensureCollectionsExist();
  
  // 2. Crear admin inicial si es necesario
  await bootstrapAdmin();
}

export async function ensureBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap()
      .catch((error) => {
        console.error('[pocketbase-bootstrap] failed', error);
      })
      .finally(() => {
        bootstrapPromise = null;
      });
  }

  await bootstrapPromise;
}
```

---

## 9. Modificación de chatApi.ts

Cambios mínimos en `chatApi.ts`:

```typescript
// Cambiar importaciones
// De:
// import { getAuthContext } from './supabaseAuth';
// import { createSupabaseUser, updateSupabaseUserRole } from './supabaseAdmin';
// Por:
import { getAuthContext } from './pocketbaseAuth';
import { createPocketBaseUser, updatePocketBaseUserRole } from './pocketbaseAdmin';

// El resto del código permanece igual, ya que:
// - getAuthContext tiene la misma signatura
// - createSupabaseUser y updateSupabaseUserRole se reemplazan con equivalentes de PocketBase
// - appStore.ts ya usa las funciones genéricas
```

---

## 10. Configuración de API Rules en PocketBase

### 10.1 Reglas para keryx_app_users

```javascript
// Solo accesible por admin de Keryx (no por superadmin de PocketBase)
// El admin de Keryx tiene role = 'admin' en keryx_app_users

// GET /api/collections/keryx_app_users/records
rule: "@request.auth.id != '' && (@collection.keryx_app_users:filter(@request.auth.id).role = 'admin')"

// POST /api/collections/keryx_app_users/records
rule: "@request.auth.id != '' && (@collection.keryx_app_users:filter(@request.auth.id).role = 'admin')"

// PATCH /api/collections/keryx_app_users/records/{id}
rule: "@request.auth.id != '' && (@collection.keryx_app_users:filter(@request.auth.id).role = 'admin')"

// DELETE /api/collections/keryx_app_users/records/{id}
rule: "@request.auth.id != '' && (@collection.keryx_app_users:filter(@request.auth.id).role = 'admin')"
```

### 10.2 Reglas para keryx_invitations

```javascript
// GET /api/collections/keryx_invitations/records
rule: "@request.auth.id != '' && (@collection.keryx_app_users:filter(@request.auth.id).role = 'admin')"

// POST /api/collections/keryx_invitations/records
rule: "@request.auth.id != '' && (@collection.keryx_app_users:filter(@request.auth.id).role = 'admin')"

// PATCH /api/collections/keryx_invitations/records/{id}
rule: "@request.auth.id != '' && (@collection.keryx_app_users:filter(@request.auth.id).role = 'admin')"

// DELETE /api/collections/keryx_invitations/records/{id}
rule: "@request.auth.id != '' && (@collection.keryx_app_users:filter(@request.auth.id).role = 'admin')"
```

### 10.3 Reglas para keryx_chats

```javascript
// GET /api/collections/keryx_chats/records
rule: "@request.auth.id = owner_id"

// POST /api/collections/keryx_chats/records
rule: "@request.auth.id != ''"

// PATCH /api/collections/keryx_chats/records/{id}
rule: "@request.auth.id = owner_id"

// DELETE /api/collections/keryx_chats/records/{id}
rule: "@request.auth.id = owner_id"
```

### 10.4 Reglas para keryx_models

```javascript
// GET /api/collections/keryx_models/records
rule: "@request.auth.id != ''"

// POST /api/collections/keryx_models/records
rule: "@request.auth.id != '' && (@collection.keryx_app_users:filter(@request.auth.id).role = 'admin')"

// PATCH /api/collections/keryx_models/records/{id}
rule: "@request.auth.id != '' && (@collection.keryx_app_users:filter(@request.auth.id).role = 'admin')"

// DELETE /api/collections/keryx_models/records/{id}
rule: "@request.auth.id != '' && (@collection.keryx_app_users:filter(@request.auth.id).role = 'admin')"
```

---

## 11. Configuración de Entorno

### Variables de Entorno Requeridas

```bash
# Configuración de PocketBase
VITE_DEPLOY_MODE=cloud
VITE_POCKETBASE_URL=http://localhost:8090        # URL de PocketBase
POCKETBASE_URL=http://localhost:8090          # Para server-side

# Configuración de admin inicial (opcional)
BOOTSTRAP_ADMIN_EMAIL=admin@keryx.app
BOOTSTRAP_ADMIN_PASSWORD=secure-password

# Configuración de AI (existente)
AI_GATEWAY_API_KEY=your-gateway-key
OPENCODE_API_KEY=your-opencode-key
APP_BASE_URL=http://localhost:5173
```

---

## 12. Pasos de Implementación

### Fase 1: Preparación (1-2 días)
1. ✅ Crear documento de plan (este archivo)
2. ⏳ Instalar dependencia de PocketBase SDK: `bun add pocketbase`
3. ⏳ Crear estructura de directorios para nuevos archivos

### Fase 2: Implementación del Cliente (1 día)
4. ⏳ Crear `src/server/pocketbaseClient.ts`
5. ⏳ Crear `src/server/pocketbaseConfig.ts`
6. ⏳ Crear `src/server/pocketbaseRest.ts`

### Fase 3: Autenticación (2 días)
7. ⏳ Crear `src/server/pocketbaseAuth.ts`
8. ⏳ Crear `src/server/pocketbaseAdmin.ts`
9. ⏳ Crear `src/adapters/cloud/pocketbaseAuthAdapter.ts`
10. ⏳ Modificar `src/server/authz.ts` para usar `pocketbaseAuth`

### Fase 4: Bootstrap (1 día)
11. ⏳ Crear `src/server/pocketbaseBootstrap.ts`
12. ⏳ Modificar `src/server/chatApi.ts` para usar nuevas funciones

### Fase 5: Configuración UI (1 día)
13. ⏳ Crear página de configuración `src/pages/setup.vue`
14. ⏳ Modificar router para redirigir a setup si no hay configuración
15. ⏳ Actualizar `vite.config.ts` con nuevo middleware

### Fase 6: Migración de Datos (opcional)
16. ⏳ Crear script de migración desde Supabase a PocketBase
17. ⏳ Probar migración con datos de prueba

### Fase 7: Pruebas (2 días)
18. ⏳ Probar autenticación
19. ⏳ Probar CRUD de chats
20. ⏳ Probar admin functions
21. ⏳ Probar flujo completo

### Fase 8: Documentación (1 día)
22. ⏳ Actualizar AGENTS.md
23. ⏳ Actualizar README.md
24. ⏳ Crear guía de despliegue

---

## 13. Puntos de Atención

### 13.1 Diferencias Clave con Supabase

| Aspecto | Supabase | PocketBase |
|---------|----------|------------|
| Autenticación | JWT + JWKS | JWT (simpler) |
| REST API | PostgREST | Propia (simpler) |
| Relaciones | PostgreSQL joins | Relación fields |
| Upsert | `on_conflict` | `update` manual o crear si no existe |
| Transacciones | Soportado | Soportado (v0.36+) |
| Realtime | WebSockets | SSE (Server-Sent Events) |

### 13.2 Consideraciones de Seguridad

1. **El superadmin de PocketBase NO tiene acceso automático a Keryx**
   - El superadmin de PocketBase solo tiene acceso a la administración de PocketBase
   - Los permisos de Keryx se gestionan en `keryx_app_users.role`
   - Las API Rules de PocketBase usan `@collection.keryx_app_users:filter(@request.auth.id).role = 'admin'`

2. **Aislamiento de Datos**
   - Todas las colecciones tienen prefijo `keryx_`
   - Los usuarios solo pueden acceder a sus propios chats (`owner_id = @request.auth.id`)

3. **Almacenamiento de Tokens**
   - Los tokens se almacenan en localStorage (igual que Supabase)
   - Se validan en cada request

### 13.3 Limitaciones de PocketBase

1. **Sin manejo de roles nativo para aplicaciones externas**
   - Solución: Gestionamos roles en `keryx_app_users`

2. **Sin búsquedas full-text nativas**
   - Solución: Usar campos de texto y filtros, o implementar búsqueda externa

3. **Sin soporte para JSONB avanzado**
   - Solución: Usar campo `json` para datos estructurados como `data` en chats

4. **Limitaciones de escalabilidad**
   - PocketBase usa SQLite por defecto
   - Para producción con alta carga, considerar:
     - Usar modo `--sqlite-path` con disco rápido
     - Configurar `GOMEMLIMIT` adecuadamente
     - Usar reverse proxy con caching

---

## 14. Estructura Final de Archivos

```
src/
├── server/
│   ├── pocketbaseClient.ts      # Cliente PocketBase singleton
│   ├── pocketbaseConfig.ts      # Configuración y validación de URL
│   ├── pocketbaseAuth.ts        # Autenticación server-side
│   ├── pocketbaseRest.ts        # Operaciones CRUD
│   ├── pocketbaseAdmin.ts       # Funciones admin
│   ├── pocketbaseBootstrap.ts   # Bootstrap de colecciones y admin
│   ├── supabaseAuth.ts          # [DEPRECATED]
│   ├── supabaseRest.ts          # [DEPRECATED]
│   ├── supabaseAdmin.ts         # [DEPRECATED]
│   ├── appStore.ts              # [MODIFICADO: importaciones]
│   ├── cloudStore.ts            # [SIN CAMBIOS]
│   ├── authz.ts                 # [MODIFICADO: usar pocketbaseAuth]
│   ├── bootstrapAdmin.ts        # [DEPRECATED: reemplazado por pocketbaseBootstrap]
│   └── chatApi.ts               # [MODIFICADO: importaciones]
│
├── adapters/
│   └── cloud/
│       ├── pocketbaseAuthAdapter.ts  # [NUEVO]
│       ├── cloudAuthAdapter.ts       # [DEPRECATED]
│       └── cloudChatRepository.ts    # [SIN CAMBIOS]
│
├── services/
│   └── runtime.ts               # [MODIFICADO: apuntar a nuevos adaptadores]
│
├── pages/
│   ├── setup.vue                # [NUEVO] Configuración inicial
│   └── ...
│
├── app/
│   └── config.ts                # [MODIFICADO: agregar POCKETBASE_URL]
│
└── vite.config.ts               # [MODIFICADO: middleware de configuración]
```

---

## 15. Pruebas Requeridas

### 15.1 Unit Tests

1. `pocketbaseConfig.test.ts` - Validación de URL
2. `pocketbaseAuth.test.ts` - Autenticación JWT
3. `pocketbaseRest.test.ts` - Operaciones CRUD
4. `pocketbaseBootstrap.test.ts` - Creación de colecciones

### 15.2 Integration Tests

1. Flujo de login/logout
2. Creación de usuario admin inicial
3. CRUD de chats
4. Gestión de invitaciones
5. Control de acceso por roles

### 15.3 E2E Tests

1. Flujo completo: setup → login → crear chat → guardar mensajes
2. Flujo admin: crear invitación → usuario acepta → login
3. Validación de reglas de acceso

---

## 16. Despliegue

### 16.1 Despliegue de PocketBase

```yaml
# docker-compose.yml
version: '3'
services:
  pocketbase:
    image: ghcr.io/pocketbase/pocketbase:latest
    ports:
      - "8090:8090"
    volumes:
      - ./pb_data:/pb_data
      - ./pb_public:/pb_public
    environment:
      - GOMEMLIMIT=2G
    command: serve --dir /pb_data --public /pb_public
    restart: unless-stopped
```

### 16.2 Despliegue de Keryx

```bash
# Configurar variables de entorno
VITE_DEPLOY_MODE=cloud
VITE_POCKETBASE_URL=https://pocketbase.yourdomain.com
BOOTSTRAP_ADMIN_EMAIL=admin@yourdomain.com
BOOTSTRAP_ADMIN_PASSWORD=your-secure-password

# Build y deploy
bun run build:cloud
# ... (deploy de archivos estáticos)
```

### 16.3 Configuración de PocketBase

1. Crear backup de datos existente
2. Configurar CORS para el dominio de Keryx
3. Configurar API Rules según la sección 10
4. (Opcional) Configurar OAuth2 providers

---

## 17. Rollback Plan

Si la migración falla:

1. Mantener Supabase funcionando
2. Tener backup de todas las tablas
3. Script para migrar datos de vuelta a Supabase
4. Alternativa: Modo híbrido temporal (ambos backends disponibles)

---

## 18. FAQ

### ¿Por qué prefijo keryx_?
Para evitar conflictos con:
- Colección `users` de PocketBase (autenticación)
- Otras aplicaciones que usen la misma instancia de PocketBase
- Colecciones del sistema de PocketBase

### ¿Qué pasa si el superadmin de PocketBase intenta acceder a Keryx?
Nada. El superadmin de PocketBase no tiene automáticamente rol 'admin' en `keryx_app_users`. Debe ser agregado explícitamente como admin de Keryx.

### ¿Cómo se manejan las migraciones de esquema?
Usando el bootstrap automático en `pocketbaseBootstrap.ts` que verifica y crea colecciones al inicio.

### ¿PocketBase soporta transacciones?
Sí, desde la versión 0.36+ con `RunInTransaction`.

### ¿Cómo escalar PocketBase?
- Usar disco SSD rápido para SQLite
- Configurar `GOMEMLIMIT` adecuadamente
- Usar reverse proxy (Nginx, Caddy) con caching
- Para muy alta carga, considerar replicación manual o migrar a PostgreSQL (PocketBase no soporta esto nativamente)

---

## 19. Referencias

- [PocketBase Documentation](https://pocketbase.io/docs/)
- [PocketBase API Rules](https://pocketbase.io/docs/security/api-rules/)
- [PocketBase SDK](https://pocketbase.io/docs/client-sdk/)
- [Arquitectura Actual Keryx](https://github.com/mfloresz/keryx/blob/main/AGENTS.md)

---

*Documento generado para implementación de PocketBase en Keryx*
*Fecha: 2026-07-21*
