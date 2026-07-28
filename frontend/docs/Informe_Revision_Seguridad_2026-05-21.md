# Informe de Revision de Seguridad

**Proyecto:** Keryx  
**Fecha de revision:** 2026-05-21  
**Idioma:** Espanol  
**Alcance:** autenticacion cloud, API server-side, renderizado de mensajes, almacenamiento de secretos en cliente, cabeceras de despliegue y dependencias

## Resumen Ejecutivo

La revision encontro riesgos reales en la superficie cloud de la aplicacion. Los dos hallazgos mas graves permiten, bajo ciertas condiciones de configuracion o entrada controlada por usuario, romper completamente el modelo de confianza del backend: uno afecta la validacion de JWT y otro habilita SSRF desde el servidor al procesar adjuntos.

Ademas, el proyecto tiene dependencias con vulnerabilidades conocidas de severidad alta, una politica CSP demasiado permisiva para produccion y decisiones de almacenamiento de tokens/llaves en navegador que amplian el impacto de cualquier XSS futuro.

### Conteo de Hallazgos

- Criticos: 2
- Altos: 2
- Medios: 2
- Bajos: 0

### Nivel de Riesgo General

**ALTO**

## Hallazgo 1. Aceptacion de JWT sin firma cuando faltan variables de verificacion (RESUELTO)

**Severidad:** Critica  
**Categoria:** Broken Authentication  
**Ubicacion principal:** [src/server/supabaseAuth.ts](/home/misael/Dev/keryx/src/server/supabaseAuth.ts:226)

### Descripcion

La funcion `getAuthContext()` intenta verificar el token contra:

- `SUPABASE_JWT_SECRET`
- `SUPABASE_JWKS_URL`
- o una URL JWKS derivada de `SUPABASE_URL`

El problema aparece cuando ninguna de esas opciones esta configurada. En ese caso, el codigo cae a una rama de respaldo donde simplemente decodifica el payload del JWT y acepta el `sub` sin validar la firma criptografica.

Eso significa que un atacante no necesita un token emitido por Supabase: le basta construir un JWT arbitrario con el `sub` de la victima.

### Impacto

Si esta ruta se ejecuta en cloud mode, un atacante podria:

- suplantar a cualquier usuario cuyo `userId` conozca o adivine
- acceder a chats ajenos si el `ownerId` coincide con ese `sub`
- intentar alcanzar endpoints administrativos si logra suplantar a un usuario con rol `admin`

Este hallazgo rompe el control de autenticacion del sistema y por eso debe tratarse como bloqueo de salida a produccion.

### Evidencia tecnica

La funcion hace verificacion fuerte solo si encuentra secreto o JWKS. Si no hay configuracion, termina aceptando el payload:

- [src/server/supabaseAuth.ts](/home/misael/Dev/keryx/src/server/supabaseAuth.ts:232)
- [src/server/supabaseAuth.ts](/home/misael/Dev/keryx/src/server/supabaseAuth.ts:246)

### Remediacion recomendada

- Eliminar completamente el fallback que acepta payloads sin firma.
- Fallar en modo cerrado: si no existe configuracion valida de verificacion JWT, devolver `401` o abortar el arranque en cloud mode.
- Agregar una validacion de startup para impedir desplegar cloud mode sin `SUPABASE_JWT_SECRET` o JWKS configurado correctamente.

### Prioridad

**Inmediata**

---

## Hallazgo 2. SSRF server-side mediante URLs de adjuntos controladas por usuario (RESUELTO)

**Severidad:** Critica  
**Categoria:** SSRF / Server-Side Injection  
**Ubicacion principal:** [src/shared/chatCore.ts](/home/misael/Dev/keryx/src/shared/chatCore.ts:467)

### Descripcion

Durante el flujo cloud, los mensajes del usuario se transforman antes de enviarse al modelo. Si el mensaje contiene partes de tipo `file`, la funcion `prepareMessagesForModel()` intenta resolver el contenido del archivo. Para archivos no imagen, puede terminar haciendo `fetch()` sobre `filePart.url`.

El valor de `filePart.url` proviene del payload del cliente. Aunque existe normalizacion para `attachment://` cuando hay `storageKey`, el codigo sigue aceptando cualquier string en `filePart.url` como `resolvedUrl`.

Despues, `extractTextFromFilePart()` y `extractTextFromUrl()` hacen solicitudes server-side a esa URL.

### Impacto

Un usuario malicioso podria forzar al servidor a hacer peticiones hacia:

- servicios internos de la red
- endpoints administrativos no expuestos publicamente
- metadata services o direcciones internas del proveedor
- hosts externos usados para exfiltrar comportamiento o contenido

Ademas, el texto obtenido puede terminar incrustado dentro del prompt enviado al modelo, lo que abre la puerta a exfiltracion indirecta.

### Evidencia tecnica

- `prepareMessagesForModel()` acepta `filePart.url` directamente: [src/shared/chatCore.ts](/home/misael/Dev/keryx/src/shared/chatCore.ts:489)
- `extractTextFromFilePart()` hace `fetch(resolvedUrl)`: [src/shared/chatCore.ts](/home/misael/Dev/keryx/src/shared/chatCore.ts:280)
- `extractTextFromUrl()` hace `fetch(url)`: [src/shared/chatCore.ts](/home/misael/Dev/keryx/src/shared/chatCore.ts:242)
- La ruta cloud usa esa preparacion antes del `streamText()`: [src/server/chatApi.ts](/home/misael/Dev/keryx/src/server/chatApi.ts:534)

### Remediacion recomendada

- Rechazar cualquier `filePart.url` arbitraria enviada por el cliente.
- Permitir solo `attachment://<id>` generados por el propio sistema.
- Si se necesitan URLs remotas, aplicar allowlist estricta por esquema, host y path.
- Bloquear expresamente `http:`, `https:`, `file:`, `ftp:`, `gopher:` y direcciones privadas salvo casos controlados.
- Registrar y alertar intentos de adjuntos con URLs externas en cloud mode.

### Prioridad

**Inmediata**

---

## Hallazgo 3. Dependencias con vulnerabilidades conocidas de severidad alta

**Severidad:** Alta  
**Categoria:** Using Components With Known Vulnerabilities  
**Ubicacion principal:** [package.json](/home/misael/Dev/keryx/package.json:1)

### Descripcion

Se ejecuto `npm audit --audit-level=high` y el reporte devolvio vulnerabilidades activas en dependencias del proyecto.

Los paquetes afectados reportados fueron:

- `vite`
- `rollup`
- `picomatch`
- `defu`
- `postcss` con severidad moderada

### Impacto

No todas estas vulnerabilidades tienen el mismo alcance. Algunas impactan sobre todo el entorno de desarrollo o build. Aun asi, las de Vite son especialmente importantes porque incluyen lecturas arbitrarias de archivos y bypasses del dev server, lo cual puede ser explotable en entornos de desarrollo compartidos, previews inseguros o estaciones de trabajo comprometidas.

### Evidencia tecnica

Dependencias relevantes:

- [package.json](/home/misael/Dev/keryx/package.json:66)

Resultado del audit:

- `defu`: prototype pollution
- `picomatch`: ReDoS / method injection
- `rollup`: arbitrary file write
- `vite`: path traversal / arbitrary file read / bypasses del dev server
- `postcss`: XSS moderado en stringify de CSS

### Remediacion recomendada

- Ejecutar `npm audit fix`.
- Verificar manualmente que `vite`, `rollup` y transitivas queden fuera de los rangos vulnerables.
- Repetir `npm audit --audit-level=high` como criterio minimo antes de liberar.
- Si algun paquete no puede actualizarse de inmediato, documentar compensaciones y reducir exposicion del dev server.

### Prioridad

**Alta**

---

## Hallazgo 4. CSP de produccion demasiado permisiva

**Severidad:** Media  
**Categoria:** Security Misconfiguration  
**Ubicaciones principales:** [default.conf](/home/misael/Dev/keryx/default.conf:12), [vercel.json](/home/misael/Dev/keryx/vercel.json:14)

### Descripcion

La politica CSP incluye:

- `'unsafe-inline'`
- `'unsafe-eval'`

en `script-src`.

Esto reduce significativamente el valor defensivo de la CSP en produccion. Aunque hoy no se observo un sink XSS evidente en el chat, una CSP fuerte sirve como segunda linea de defensa cuando aparece un bug nuevo o una dependencia introduce renderizado inseguro.

### Impacto

Si un atacante logra introducir JavaScript ejecutable por otra via, esta CSP ofrece mucha menos contencion de la que deberia. En la practica, hace mas sencilla la explotacion de XSS.

### Evidencia tecnica

- Nginx: [default.conf](/home/misael/Dev/keryx/default.conf:12)
- Vercel headers: [vercel.json](/home/misael/Dev/keryx/vercel.json:14)

### Remediacion recomendada

- Eliminar `'unsafe-inline'` y `'unsafe-eval'` de produccion si el stack lo permite.
- Usar `nonce` o `hash` para cualquier script inline estrictamente necesario.
- Mantener configuraciones relajadas solo en desarrollo, no en despliegue final.

### Prioridad

**Media**

---

## Hallazgo 5. Tokens de acceso y refresh persistidos en localStorage

**Severidad:** Media  
**Categoria:** Sensitive Data Exposure  
**Ubicacion principal:** [src/adapters/cloud/cloudAuthAdapter.ts](/home/misael/Dev/keryx/src/adapters/cloud/cloudAuthAdapter.ts:29)

### Descripcion

El adaptador cloud guarda:

- `supabase-access-token`
- `supabase-refresh-token`

en `localStorage`.

Esto es comun en SPAs, pero desde seguridad sigue siendo una eleccion sensible porque cualquier XSS exitoso o extension maliciosa con acceso al DOM puede leer ambos valores.

### Impacto

Si llega a existir una XSS en cualquier parte de la app o en una dependencia con acceso al mismo origen, un atacante podria robar sesiones y mantener acceso usando el refresh token.

### Evidencia tecnica

- Lectura de sesion: [src/adapters/cloud/cloudAuthAdapter.ts](/home/misael/Dev/keryx/src/adapters/cloud/cloudAuthAdapter.ts:29)
- Escritura del access token: [src/adapters/cloud/cloudAuthAdapter.ts](/home/misael/Dev/keryx/src/adapters/cloud/cloudAuthAdapter.ts:155)
- Escritura del refresh token: [src/adapters/cloud/cloudAuthAdapter.ts](/home/misael/Dev/keryx/src/adapters/cloud/cloudAuthAdapter.ts:156)

### Remediacion recomendada

- Preferir cookies `HttpOnly`, `Secure` y `SameSite` cuando exista backend intermedio.
- Si se mantiene el modelo SPA puro, reducir al minimo la vida util de tokens y revisar rotacion.
- Tratar la prevencion de XSS como requisito critico, porque aqui el impacto de una XSS seria toma de cuenta.

### Prioridad

**Media**

---

## Hallazgo 6. El “secure storage” de llaves en navegador no ofrece secreto real

**Severidad:** Media  
**Categoria:** Sensitive Data Exposure / Security Design  
**Ubicacion principal:** [src/utils/secureStorage.ts](/home/misael/Dev/keryx/src/utils/secureStorage.ts:1)

### Descripcion

El modulo `secureStorage` cifra valores con AES-GCM antes de guardarlos en `localStorage`, pero la clave maestra tambien se persiste en `localStorage`.

Eso significa que el esquema da ofuscacion y defensa parcial frente a inspecciones accidentales, pero no protege de un atacante con capacidad de ejecutar JavaScript en el origen ni de una extension con permisos suficientes. En otras palabras, no debe considerarse almacenamiento seguro de secretos.

El caso mas claro de uso es la llave de Tavily:

- [src/utils/tavilyTools.ts](/home/misael/Dev/keryx/src/utils/tavilyTools.ts:6)

### Impacto

- Puede crear una falsa sensacion de seguridad en el equipo.
- Una XSS podria leer tanto la clave cifrada como la clave maestra y recuperar el secreto.
- Llaves de terceros usadas en cliente quedan expuestas al contexto del navegador.

### Evidencia tecnica

- La clave maestra se guarda en `localStorage`: [src/utils/secureStorage.ts](/home/misael/Dev/keryx/src/utils/secureStorage.ts:46)
- La llave de Tavily se recupera desde ese mecanismo: [src/utils/tavilyTools.ts](/home/misael/Dev/keryx/src/utils/tavilyTools.ts:6)

### Remediacion recomendada

- Ajustar la documentacion y comentarios para no describirlo como proteccion fuerte.
- Evitar guardar secretos verdaderos de terceros en cliente cuando sea posible.
- Mover integraciones sensibles a un backend controlado por la aplicacion.

### Prioridad

**Media**

---

## Hallazgos No Confirmados Como Vulnerabilidad

Durante la revision no encontre evidencia clara de:

- secretos hardcodeados reales dentro del repositorio
- uso directo de `v-html` o `innerHTML` para mensajes del chat
- bypass obvio del control server-side de admin una vez que `requireAdmin()` recibe un usuario autenticado valido

El renderizado Markdown parece intentar endurecimiento de enlaces y no expone, en esta revision, una ruta directa de XSS basada en HTML crudo. Aun asi, ese punto depende en parte del comportamiento de dependencias externas y de mantener una CSP mas estricta.

## Orden Recomendado de Correccion

1. Corregir la aceptacion de JWT sin firma.
2. Bloquear SSRF por URLs de adjuntos.
3. Actualizar dependencias vulnerables.
4. Endurecer CSP de produccion.
5. Revisar estrategia de almacenamiento de tokens y llaves en navegador.

## Checklist de Seguridad

- [ ] No aceptar JWT sin verificacion criptografica
- [ ] No permitir `fetch()` server-side sobre URLs arbitrarias del usuario
- [ ] Mantener `npm audit` sin hallazgos altos o criticos
- [ ] Endurecer CSP de produccion
- [ ] Minimizar tokens sensibles en `localStorage`
- [ ] No presentar cifrado local como proteccion fuerte de secretos

## Conclusiones

El proyecto tiene una base razonable en varias areas, pero la superficie cloud todavia presenta fallas que pueden comprometer autenticacion y aislamiento del backend. Los dos hallazgos criticos deben corregirse antes de considerar este flujo apto para produccion.

Las mejoras restantes no son cosmeticas: reducen la probabilidad de explotacion y, sobre todo, limitan el impacto si aparece una XSS o una mala configuracion futura.
