# Plan: Sistema de Consulta Bíblica Frontend-Only

> **Estado:** Borrador inicial para revisión y ajustes antes de la implementación.
> **Fecha:** 2026-04-29

---

## 1. Arquitectura Técnica

### Decisión: `sql.js-httpvfs` (HTTP Range Requests)

Usaremos `sql.js-httpvfs` en lugar de `sql.js` puro para evitar cargar toda la base de datos en RAM.

| | `sql.js` (RAM) | `sql.js-httpvfs` (Paginado) |
|---|---|---|
| **Memoria** | Carga todo el .db (30MB→500MB) | Solo ~1-2MB activos |
| **Descarga** | Todo de golpe | Bajo demanda, por chunks de 4KB |
| **Escalabilidad** | 2-3 biblias máximo | 50+ biblias sin problema |
| **Hosting** | Cualquiera | Cualquiera con Range Requests (Vite lo soporta) |
| **Offline** | No | Parcial (cacheable vía Service Worker) |

**Flujo:** El `.db` se sirve como archivo estático desde `public/`. Cuando el usuario hace una pregunta bíblica, el navegador descarga **solo las páginas de SQLite necesarias** para ejecutar el `SELECT`, no el archivo completo.

---

## 2. Esquema de Base de Datos SQLite

```sql
-- Catálogo
CREATE TABLE versions (
    id TEXT PRIMARY KEY,      -- 'BEP', 'NBLA'
    abbreviation TEXT NOT NULL,
    title TEXT NOT NULL
);

CREATE TABLE books (
    usfm TEXT PRIMARY KEY,    -- 'GEN', 'EXO', 'MAT'
    name TEXT NOT NULL,       -- 'Génesis', 'Éxodo'
    canonical_order INTEGER   -- 1-66 para ordenar
);

-- Contenido unificado (versículos, headings, article_refs, etc.)
CREATE TABLE bible_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id TEXT NOT NULL,
    book_usfm TEXT NOT NULL,
    chapter_number INTEGER NOT NULL,

    item_type TEXT NOT NULL CHECK(item_type IN (
        'heading1', 'heading2', 'chapter_heading',
        'verse', 'label', 'article_ref'
    )),

    verse_number INTEGER,      -- NULL para headings/article_refs
    verse_range TEXT,          -- "1-3" cuando aplica, NULL si es simple

    text TEXT,                 -- Texto bíblico o heading
    rlw_text TEXT,             -- Comentarios/notas (NULL si no aplica)
    rlw_type TEXT,             -- C01-C07 (NULL para NBLA o sin definir)

    sort_order INTEGER NOT NULL -- Preserva orden original del CSV
);

-- Índices de lookup rápido
CREATE INDEX idx_lookup ON bible_content(
    version_id, book_usfm, chapter_number, verse_number
);
CREATE INDEX idx_type ON bible_content(item_type);
CREATE INDEX idx_rlw ON bible_content(rlw_type) WHERE rlw_type IS NOT NULL;

-- Full-Text Search (FTS5) para búsquedas por palabra/frase
CREATE VIRTUAL TABLE bible_fts USING fts5(
    text, rlw_text,
    content='bible_content',
    content_rowid='id'
);

-- Triggers para mantener FTS sincronizado
CREATE TRIGGER bible_content_ai AFTER INSERT ON bible_content BEGIN
    INSERT INTO bible_fts(rowid, text, rlw_text)
    VALUES (new.id, new.text, new.rlw_text);
END;
CREATE TRIGGER bible_content_ad AFTER DELETE ON bible_content BEGIN
    INSERT INTO bible_fts(bible_fts, rowid, text, rlw_text)
    VALUES ('delete', old.id, old.text, old.rlw_text);
END;
CREATE TRIGGER bible_content_au AFTER UPDATE ON bible_content BEGIN
    INSERT INTO bible_fts(bible_fts, rowid, text, rlw_text)
    VALUES ('delete', old.id, old.text, old.rlw_text);
    INSERT INTO bible_fts(rowid, text, rlw_text)
    VALUES (new.id, new.text, new.rlw_text);
END;
```

### Notas sobre `article_ref`
- Por ahora se almacenan como filas con `item_type='article_ref'` y `text='Ver Artículo: X'`.
- Cuando tengamos el contenido completo de los artículos, agregaremos una tabla `articles(id, title, content)` y vincularemos por título o clave.

---

## 3. Pipeline de Migración: CSV → SQLite

### Script: `scripts/build-bible-db.ts`
Ejecutado en Node.js (no en navegador).

### Pasos:
1. Leer `biblias/*.csv` con parser robusto (`csv-parse`, maneja saltos de línea dentro de quoted fields).
2. Extraer catálogo único de libros y versiones.
3. Generar `chapter_number` a partir de `chapter_usfm` (ej: `GEN.1` → `1`).
4. Parsear `verse_numbers` (ej: `"1"`, `"3-5"`) en `verse_number` + `verse_range`.
5. Normalizar `item_type` al enum unificado.
6. Insertar en SQLite (`better-sqlite3` para performance en batch).
7. Construir índices y FTS5.
8. Ejecutar `VACUUM` para compactar.
9. Copiar resultado a `public/bible.db`.

### Archivos de entrada:
- `biblias/biblia_estudio_patristica.csv` → `version_id='BEP'`
- `biblias/NBLA_vid_103.csv` → `version_id='NBLA'`

### Extensibilidad:
Agregar una nueva biblia = añadir una línea al array de entrada en el script.

---

## 4. Capa de Acceso Frontend

Módulo nuevo: `src/lib/bible/`

| Archivo | Responsabilidad |
|---------|-----------------|
| `db.ts` | Inicialización lazy de `sql.js-httpvfs`. Expone la DB worker. |
| `parser.ts` | `parseReference("Génesis 1:1-3")` → `{book: "GEN", chapter: 1, verseStart: 1, verseEnd: 3}` |
| `queries.ts` | Funciones tipadas: `getVerses()`, `searchText()`, `getCommentary()`, `getBooks()` |
| `types.ts` | Interfaces TypeScript: `BibleItem`, `Book`, `BibleReference`, etc. |
| `tools.ts` | Definición de tools Zod para el AI SDK |

### Ejemplo de inicialización (`db.ts`):
```ts
let dbPromise: Promise<any> | null = null;

export async function getBibleDb() {
  if (dbPromise) return dbPromise;

  dbPromise = createDbWorker(
    [{
      from: "inline",
      config: {
        serverMode: "full",
        requestChunkSize: 4096,
        url: "/bible.db"
      }
    }],
    "/sqlite.worker.js",  // Copiado a public/ desde node_modules
    "/sql-wasm.wasm"      // Copiado a public/ desde node_modules
  ).then(w => w.db);

  return dbPromise;
}
```

---

## 5. Tools para el AI SDK

En `src/lib/bible/tools.ts`, definimos 4 tools que el LLM usará automáticamente:

### 1. `bible_get_verses`
```ts
bible_get_verses: tool({
  description: 'Obtiene el texto exacto de versículos bíblicos',
  parameters: z.object({
    reference: z.string().describe('Ej: Génesis 1:1-3, Juan 3:16, Salmo 23'),
    version: z.enum(['BEP', 'NBLA']).optional()
  })
})
```

### 2. `bible_search_text`
```ts
bible_search_text: tool({
  description: 'Busca palabras o frases en la Biblia',
  parameters: z.object({
    query: z.string(),
    version: z.enum(['BEP', 'NBLA']).optional(),
    limit: z.number().default(10)
  })
})
```

### 3. `bible_get_commentary`
```ts
bible_get_commentary: tool({
  description: 'Obtiene comentarios patrísticos y notas de estudio',
  parameters: z.object({
    reference: z.string(),
    version: z.enum(['BEP', 'NBLA']).default('BEP'),
    rlw_type: z.string().optional()
  })
})
```

### 4. `bible_list_books`
```ts
bible_list_books: tool({
  description: 'Lista los libros bíblicos disponibles',
  parameters: z.object({})
})
```

---

## 6. Integración en el Chat

### Modificaciones a `src/utils/clientApi.ts`:

1. **Lazy-load** de la DB bíblica (solo cuando se usa un tool).
2. **Inyectar tools** en `streamText`:
   ```ts
   tools: {
     ...(webSearch && { web_search: ... }),
     ...bibleTools  // <-- NUEVO
   }
   ```
3. **System Prompt** (el usuario lo manejará, sugerencia para incluir):
   ```
   Cuando el usuario haga preguntas sobre contenido bíblico, teológico,
   o solicite citas específicas:
   - USA SIEMPRE las herramientas bíblicas para fundamentar tu respuesta
   - NUNCA inventes citas bíblicas
   - Cuando cites, incluye la referencia completa (Libro Capítulo:Versículo, Versión)
   - Si el usuario pide comentarios, usa bible_get_commentary
   - Si no encuentras una referencia exacta, intenta bible_search_text
   ```

---

## 7. Dependencias Nuevas

| Paquete | Uso | Entorno |
|---------|-----|---------|
| `sql.js-httpvfs` | Motor SQLite paginado en navegador | Runtime |
| `better-sqlite3` | Generar el .db en build time | Build |
| `csv-parse` | Leer CSVs con campos multilínea | Build |
| `tsx` | Ejecutar scripts TypeScript de build | Build (dev) |

---

## 8. Archivos a Crear/Modificar

### Nuevos:
- `scripts/build-bible-db.ts` — Importador CSV→SQLite
- `src/lib/bible/db.ts` — Conexión httpvfs
- `src/lib/bible/parser.ts` — Parser de referencias
- `src/lib/bible/queries.ts` — Funciones SQL
- `src/lib/bible/types.ts` — Tipos TypeScript
- `src/lib/bible/tools.ts` — Tools del AI SDK

### Modificados:
- `package.json` — Nuevas deps + scripts (`build:bible`)
- `.gitignore` — Ignorar `public/bible.db` y assets de sql.js copiados
- `vite.config.ts` — Posiblemente copy de wasm/worker a public/
- `src/utils/clientApi.ts` — Integrar tools y system prompt

---

## 9. Build & Deploy

```bash
# 1. Instalar dependencias
npm install sql.js-httpvfs
npm install -D better-sqlite3 csv-parse tsx

# 2. Generar la base de datos (one-time o en CI)
npm run build:bible
# Output: public/bible.db (~30MB)

# 3. Build de la app (Vite copia public/ a dist/)
npm run build
```

**Importante:** `public/bible.db` **no se versiona en Git** (se añade a `.gitignore`). Cada desarrollador o CI lo genera localmente.

---

## 10. Roadmap y Extensiones Futuras

| Fase | Cuándo | Qué |
|------|--------|-----|
| **Fase 2** | Cuando se definan `rlw_type` | Agregar tabla `rlw_type_defs(code, name, description)` + filtrado |
| **Fase 3** | Cuando se tengan artículos | Tabla `articles(id, title, content)` + relación con `article_ref` |
| **Fase 4** | Nuevas biblias | Añadir entrada al array en `build-bible-db.ts` y regenerar |
| **Fase 5** | Cuando se tenga servidor | Migrar esquema SQL idéntico a PocketBase. Los tools cambian mínimamente. |

---

## Preguntas Abiertas / Ajustes Pendientes

1. **Confirmación de arquitectura:** ¿`sql.js-httpvfs` es la elección final?
2. **Implementación por fases:** ¿Todo de una vez o Fase 1 (DB+import) → Fase 2 (tools+parser) → Fase 3 (integración chat)?
3. **Límite de hosting:** ¿Hay restricción de tamaño para archivos estáticos? (`.db` inicial ~30MB, con 10 biblias podría ser 100-200MB)
4. **Definición de `rlw_type`:** Pendiente definir qué representa cada código C01-C07.
5. **Contenido de artículos:** Pendiente integrar los textos completos de los artículos referenciados en `article_ref`.
