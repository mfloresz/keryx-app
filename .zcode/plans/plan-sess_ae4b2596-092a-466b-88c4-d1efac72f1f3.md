# Adjuntos: conversión de documentos a Markdown con anydoc (WASM)

**Objetivo:** PDF/DOCX/PPTX/XLS/ODT/RTF/EPUB se convierten a Markdown en el navegador (Worker WASM), se guarda original + markdown en un mismo registro (markdown como archivo), el LLM recibe el markdown inline (con presupuesto de truncado) y la UI siempre muestra el original. PDFs escaneados (sin texto) se rechazan al adjuntar.

## Decisiones (acordadas)
- Un registro por adjunto; el markdown es un **FileField** (`converted_file`, MaxSize 50 MB, igual que el original) — sin truncado en almacenamiento, escalable para FTS5 a futuro.
- Dos límites separados: **almacenamiento** = archivo markdown completo; **contexto LLM** = presupuesto de ~200 000 caracteres (≈50k tokens) leído con `io.LimitReader` y marcador de truncado.
- Spinner indeterminado por archivo (conversión + subida); WASM cacheado (singleton worker + caché HTTP).
- PDFs con `needsOcr` → rechazados al adjuntar. Sin retrocompatibilidad especial.

## Backend (Go)

1. **Schema** — `internal/store/store_schema.go`: añadir FileField `converted_file` (MaxSelect 1, MaxSize 50<<20) a la rama de creación de `ensureAttachmentsCollection`. Como esa función hace early-return en BDs existentes, añadir `migrateAttachmentsCollection` con `s.ensureField(...)` (patrón de `migrateChatsCollectionForAgents`) y llamarla desde `EnsureSchema` en `internal/store/store.go`.

2. **Store** — `internal/store/store_attachments.go`: `SaveAttachment` recibe `converted []byte, convertedName string` adicionales (vacíos = sin conversión), guardado con `filesystem.NewFileFromBytes` en el nuevo campo; nuevo `GetAttachmentMarkdown(id, ownerID, maxBytes)` que lee el archivo con streaming (`LimitReader`), mismo guard de ownership que `GetAttachmentData`.

3. **Upload** — `internal/api/router_attachments.go`:
   - Ampliar whitelist: `.pdf, .txt, .md, .csv, .json` + `.doc, .docx, .ppt, .pptx, .xls, .xlsx, .odt, .rtf, .epub`.
   - `validateAttachment` con magic bytes explícitos (DetectContentType devuelve `application/zip` para docx/xlsx y fallaría): `%PDF-`, ZIP `PK\x03\x04` (docx/pptx/xlsx/odt/epub), OLE2 `D0 CF 11 E0 A1 B1 1A E1` (.doc/.xls/.ppt), texto plano.
   - Parsear partes multipart opcionales `converted_{i}` (alineadas por índice con `files`), validadas como texto UTF-8, máx 50 MB, pasadas a `SaveAttachment`.
   - Subir el cap de `MaxBytesReader` a `3*(20MB+50MB)` + margen (el multipart ahora puede traer originales + markdowns grandes).

4. **LLM** — `internal/ai/provider.go`:
   - `ChatAttachment` += `Markdown string \`json:"-"\`` (no se persiste en el JSON del mensaje; `resolveAttachments` lo recarga del registro).
   - `messageParts`: si `a.Markdown != ""` → `PartText` con `formatFileBlock(name, "text/markdown", a.Markdown)` (ya truncado a presupuesto en la resolución) en lugar de `PartFile` base64. Aplica a ambos providers sin cambios (openai.go y google.go consumen `messageParts`).
   - `TitleUserMessage`: usar `Markdown` cuando exista para generar títulos desde el contenido del documento.
   - Nueva constante `MarkdownAttachmentBudget = 200_000` caracteres.

5. **Resolución** — `internal/api/router_chats.go` `resolveAttachments`: además de los bytes, cargar `a.Markdown` vía `GetAttachmentMarkdown(id, userID, MarkdownAttachmentBudget)` con truncado + marcador `[document truncated]`.

6. **Tests** (patrón `internal/ai/provider_test.go`): `messageParts` con Markdown → bloque de texto truncado; sin Markdown → `PartFile`; `validateAttachment` con magic bytes (pdf, zip-based, ole2, rechazo de binario desconocido).

## Frontend (Vue)

7. **Dependencia** — `npm i @firecrawl/anydoc-wasm` (v0.2.4, MIT, sin deps). Spike mínimo: confirmar que `init()` + `toMarkdownBytes()` compilan en un module worker con Vite 7 (wasm-pack `--target web` usa `new URL(...wasm, import.meta.url)`, que Vite resuelve; si el build se queja, ajustar `worker.format`/`optimizeDeps.exclude`).

8. **Worker** — `src/workers/anydoc.worker.ts`: recibe `{buffer}`, hace `await init()` una vez, `toMarkdownBytes(new Uint8Array(buffer))`, responde `{markdown}` o `{code}` (`needsOcr`/`encrypted`/`unsupported`/...). Sin truncado aquí — el markdown completo se sube al backend. Instanciado perezosamente como singleton (`new Worker(new URL('./anydoc.worker.ts', import.meta.url), { type: 'module' })`).

9. **Servicio** — `src/services/documentConversion.ts`: `isConvertible(filename)` (pdf, doc(x), ppt(x), xls(x), odt, rtf, epub), `convertToMarkdown(file): Promise<string>` con error tipado `needsOcr`.

10. **Prompt input** — `src/components/ai-elements/prompt-input/types.ts`: `AttachmentFile` += `converting?: boolean; convertedMarkdown?: string`. En `context.ts`:
    - `addFiles`: para convertibles, marca `converting: true` y lanza conversión sin bloquear (promesa en map interno). `needsOcr` → elimina archivo y `onError({code:'no_text_layer'})`; otros errores → `onError({code:'convert_error'})` y elimina.
    - `submitForm`: antes de procesar, `await` de las conversiones en curso; la subida (conversión+subida juntas bajo el mismo spinner) ocurre dentro del submit.

11. **Spinner UI** — `src/components/prompt-input-attachments-display.vue`: `Loader2` con `animate-spin` junto a `<AttachmentInfo />` cuando `attachment.converting`.

12. **Subida** — `src/adapters/api/apiAttachmentRepository.ts` `uploadFiles`: para cada pending con `convertedMarkdown`, campo FormData `converted_${i}` (nombre de archivo `{original}.md`). `persistFiles` copia solo metadata al file part final (el markdown no viaja en las partes del mensaje, solo el `storageKey`).

13. **Accept + errores** — `ChatInput.vue`: ampliar `DOCUMENT_ACCEPT` con `.ppt,.pptx,.xls,.xlsx,.odt,.rtf,.epub`. En `handleAttachmentError`, toast para `no_text_layer` ("el PDF no contiene texto extraíble") y `convert_error`, claves i18n en/en es.

14. **Test frontend** (vitest): test pequeño para `isConvertible`.

## Fuera de alcance
- Vista de storage de archivos, OCR de escaneados, preview de markdown en UI, indexado FTS5 (queda habilitado por el diseño).

## Verificación
- `go vet ./... && go test ./internal/ai/... && go build ./...`
- `npm run build` (incluye vue-tsc) y `npm test`
- Flujo manual: PDF con texto → spinner → el LLM responde sobre el contenido; PDF escaneado → rechazo con toast; docx → ídem PDF; documento largo → markdown completo guardado como archivo, prompt truncado al presupuesto; txt/imagen → comportamiento actual intacto.