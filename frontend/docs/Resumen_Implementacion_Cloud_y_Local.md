# Resumen de implementación: Static Mode + Cloud Mode

## Qué se implementó

- Se añadió una configuración explícita de despliegue con `VITE_DEPLOY_MODE=static|cloud`.
- Se mantuvo `static` como modo local con OPFS y fetch interception.
- Se habilitó `cloud` como modo con backend server-side reutilizable y soporte para desarrollo local.
- Se evitó que la UI dependa directamente de OPFS para persistencia de chats y adjuntos.
- Se añadió un backend compartido para rutas `/api/chats/*` que sirve tanto en Vercel como en `vite dev` cuando el modo es cloud.

## Archivos nuevos

- [`src/app/config.ts`](/home/misael/Dev/keryx/src/app/config.ts)
- [`src/utils/chatPersistence.ts`](/home/misael/Dev/keryx/src/utils/chatPersistence.ts)
- [`src/shared/chatCore.ts`](/home/misael/Dev/keryx/src/shared/chatCore.ts)
- [`src/server/cloudStore.ts`](/home/misael/Dev/keryx/src/server/cloudStore.ts)
- [`src/server/supabaseAuth.ts`](/home/misael/Dev/keryx/src/server/supabaseAuth.ts)
- [`src/server/chatApi.ts`](/home/misael/Dev/keryx/src/server/chatApi.ts)
- [`api/[...path].ts`](/home/misael/Dev/keryx/api/[...path].ts)

## Archivos modificados

- [`src/main.ts`](/home/misael/Dev/keryx/src/main.ts)
- [`vite.config.ts`](/home/misael/Dev/keryx/vite.config.ts)
- [`src/pages/index.vue`](/home/misael/Dev/keryx/src/pages/index.vue)
- [`src/pages/chat/[id].vue`](/home/misael/Dev/keryx/src/pages/chat/[id].vue)
- [`src/utils/chatAttachments.ts`](/home/misael/Dev/keryx/src/utils/chatAttachments.ts)
- [`src/utils/clientApi.ts`](/home/misael/Dev/keryx/src/utils/clientApi.ts)
- [`src/utils/secureStorage.ts`](/home/misael/Dev/keryx/src/utils/secureStorage.ts)
- [`src/i18n.ts`](/home/misael/Dev/keryx/src/i18n.ts)
- [`tsconfig.app.json`](/home/misael/Dev/keryx/tsconfig.app.json)
- [`src/composables/useAppFont.test.ts`](/home/misael/Dev/keryx/src/composables/useAppFont.test.ts)
- [`src/composables/useSearchSettings.test.ts`](/home/misael/Dev/keryx/src/composables/useSearchSettings.test.ts)

## Cambios funcionales clave

- `static`:
  - Sigue inicializando OPFS.
  - Sigue interceptando `/api/chats/*` en el navegador.
  - Los adjuntos se guardan en OPFS como antes.

- `cloud`:
  - No inicializa OPFS.
  - No intercepta `fetch` en el navegador.
  - Usa un backend compartido para `/api/chats/*`.
  - Persiste chats en Turso cuando existen `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`.
  - Usa almacenamiento local temporal en `/tmp` como fallback para desarrollo local sin Turso.
  - Verifica tokens de Supabase cuando se configuran `SUPABASE_JWT_SECRET` o `SUPABASE_JWKS_URL`.

## Adjunto y persistencia

- En `static`, los adjuntos siguen resolviéndose vía OPFS.
- En `cloud`, los adjuntos nuevos se serializan como `data:` URLs para que el backend pueda persistirlos sin depender de OPFS.
- La lógica de mensajes, ramas, votos y sanitización se comparte entre cliente y servidor desde `src/shared/chatCore.ts`.

## Validación realizada

- `bun test`
- `bun run build`

Ambos terminaron correctamente al final del trabajo.

## Notas de entorno

- `VITE_DEPLOY_MODE=static` para la edición local/self-hosted.
- `VITE_DEPLOY_MODE=cloud` para la edición SaaS/cloud.
- En cloud, se recomiendan además:
  - `AI_GATEWAY_API_KEY`
  - `OPENCODE_API_KEY` si se usa ese proveedor
  - `TURSO_DATABASE_URL`
  - `TURSO_AUTH_TOKEN`
  - `SUPABASE_JWT_SECRET` o `SUPABASE_JWKS_URL`

