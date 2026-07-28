# Plan de implementación — Optimización de rendering de reasoning en chats

## Estado
- **No ejecutar todavía.**
- Este documento describe el plan de implementación para que otro subagente lo ejecute después.
- Objetivo: replicar un patrón tipo "Pensando" dentro del mensaje del asistente, mostrando por defecto solo una vista compacta del reasoning y evitando que reasonings largos ralenticen la ventana.

---

## 1. Resumen ejecutivo

La aplicación ya separa el reasoning del contenido principal del mensaje:
- `keryx/src/components/chat/ChatMessageItem.vue` filtra `message.parts` con `type === 'reasoning'`.
- `keryx/src/components/ai-elements/reasoning/ReasoningContent.vue` renderiza el reasoning usando `vue-stream-markdown`.
- `keryx/src/components/ai-elements/message/MessageResponse.vue` también usa `vue-stream-markdown` para la respuesta principal.

El problema actual no es que el reasoning no exista como canal separado, sino que **el reasoning completo se monta/renderiza aunque el usuario no necesite verlo completo**. En streams largos, eso puede afectar:
- parseo markdown repetido
- tamaño del DOM
- costo de layout/reflow
- fluidez de scroll en conversaciones largas

### Decisión recomendada
Implementar una mejora por fases:

1. **Fase 1 (obligatoria)**: mantener `vue-stream-markdown`, pero cambiar la UI del reasoning para que:
   - esté colapsada por defecto
   - muestre solo una preview barata (últimas 5 líneas)
   - renderice el markdown completo solo cuando el bloque se expanda

2. **Fase 2 (opcional y posterior)**: si después de Fase 1 aún hay lag visible, evaluar un experimento aislado con `incremark` **solo para reasoning**, no para todo el chat.

---

## 2. Topología verificada

### 2.1 State ownership
- **Fuente de verdad del reasoning**: `message.parts` dentro de cada `UIMessage`.
- **Estado derivado actual**:
  - `reasoningParts`
  - `reasoningText`
  - `hasReasoning`
  - `isReasoningStreaming`
- **Nuevo estado local recomendado**:
  - `isReasoningExpanded` por mensaje
  - `reasoningPreviewText` derivado de `reasoningText`

### 2.2 Feedback / observabilidad
El usuario necesita ver:
- que el asistente está pensando
- una vista compacta del reasoning activo
- si el reasoning sigue streameando o ya terminó
- affordance clara para expandir/colapsar

### 2.3 Blast radius
Cambio acotado principalmente a UI de mensajes:
- `keryx/src/components/chat/ChatMessageItem.vue`
- `keryx/src/components/ai-elements/reasoning/ReasoningContent.vue`
- componente nuevo sugerido para preview (`ReasoningPreview.vue` o equivalente)

No debería requerir cambios en:
- persistencia OPFS
- store de chats
- backend de stream
- estructura de `UIMessage`

### 2.4 Timing / streaming safety
Durante streaming:
- el reasoning puede crecer por chunks
- la preview debe actualizarse sin montar el markdown completo
- el markdown completo solo debe montarse al expandir
- el contenido no debe perderse ni desincronizarse al cambiar de estado expandido/colapsado

---

## 3. Objetivo funcional

Replicar un patrón visual tipo:
- bloque interno dentro del mensaje de assistant
- título/trigger estilo `Pensando`
- vista compacta con las últimas ~5 líneas del reasoning
- expand/collapse manual
- contenido completo visible solo bajo demanda

### Requisitos funcionales mínimos
1. Si un mensaje assistant tiene `reasoning parts`, se muestra un bloque de reasoning.
2. El bloque está colapsado por defecto.
3. Colapsado:
   - se muestran las últimas 5 líneas no vacías del reasoning
   - no se renderiza el markdown completo
4. Expandido:
   - se renderiza el reasoning completo con `vue-stream-markdown`
5. Si el reasoning sigue streameando:
   - el bloque debe reflejar estado activo visualmente
   - la preview debe seguir actualizándose
6. La respuesta principal del assistant no debe cambiar de comportamiento.

---

## 4. No-objetivos

No hacer en esta tarea:
- migrar todo el chat de `vue-stream-markdown` a `incremark`
- tocar backend de `streamText()` o `toUIMessageStreamResponse()`
- reescribir `MessageResponse.vue`
- virtualizar toda la lista de mensajes del chat
- refactorizar stores o persistencia
- cambiar diseño visual de mensajes fuera del bloque de reasoning

---

## 5. Diseño propuesto

## 5.1 Enfoque general
Separar el rendering del reasoning en dos modos:

### Modo colapsado
Render barato:
- texto plano o preformateado
- últimas 5 líneas
- sin `Markdown` completo
- con fade opcional y estilo secundario

### Modo expandido
Render completo:
- `ReasoningContent.vue`
- `vue-stream-markdown`
- markdown completo

Esto evita pagar el costo del renderer completo cuando el usuario no lo abrió.

---

## 5.2 Componentes

### A. `ChatMessageItem.vue`
Responsabilidades nuevas:
- derivar preview del reasoning
- mantener estado expandido del reasoning para ese mensaje
- decidir si renderiza preview o full content

### B. Nuevo componente sugerido: `ReasoningPreview.vue`
Responsabilidades:
- renderizar preview compacta de reasoning
- aceptar texto ya truncado/preparado
- no usar parser markdown pesado salvo necesidad estricta

Alternativa aceptable:
- implementar preview inline en `ChatMessageItem.vue`
- pero el componente dedicado es preferible para claridad y reutilización

### C. `ReasoningContent.vue`
Mantener responsabilidad actual:
- renderizar markdown completo del reasoning
- no agregar lógica de truncado ahí

---

## 5.3 API propuesta interna

### `ChatMessageItem.vue`
Agregar derivados computados:

- `fullReasoningText: string`
- `reasoningLines: string[]`
- `reasoningPreviewText: string`
- `isReasoningExpanded: Ref<boolean>`

Pseudológica:

```ts
const fullReasoningText = computed(() =>
  reasoningParts.value.map(p => p.text).join('\n')
)

const reasoningLines = computed(() =>
  fullReasoningText.value
    .split(/\r?\n/)
    .map(line => line.trimEnd())
)

const reasoningPreviewText = computed(() => {
  const nonEmpty = reasoningLines.value.filter(line => line.trim().length > 0)
  return nonEmpty.slice(-5).join('\n')
})
```

Notas:
- Preferir `trimEnd()` y no `trim()` para no destruir indentación útil.
- Filtrar líneas completamente vacías solo para preview.
- El contenido completo no debe alterarse.

---

## 5.4 Comportamiento visual sugerido

### Colapsado
- Header con ícono/label (`Pensando` o traducción existente del sistema si aplica)
- Indicador de streaming si `isReasoningStreaming === true`
- Caja compacta secundaria
- `whitespace-pre-wrap`
- `line-clamp` no es suficiente por sí sola; el preview debe ser un texto ya truncado

### Expandido
- Mantener `ReasoningContent`
- Markdown completo
- misma estructura de collapsible si ya existe en `ai-elements/reasoning`

---

## 6. Plan de ejecución detallado

## Fase 1 — Implementación mínima segura

### Paso 1. Inspeccionar componentes de reasoning existentes
Archivos:
- `keryx/src/components/chat/ChatMessageItem.vue`
- `keryx/src/components/ai-elements/reasoning/Reasoning.vue`
- `keryx/src/components/ai-elements/reasoning/ReasoningTrigger.vue`
- `keryx/src/components/ai-elements/reasoning/ReasoningContent.vue`

Objetivo:
- confirmar cómo se maneja el open/close actual
- decidir si el estado expandido vive en el componente wrapper existente o localmente en `ChatMessageItem`

Criterio:
- usar el patrón ya existente en `ai-elements/reasoning` si no obliga a montar siempre el contenido pesado

---

### Paso 2. Crear preview de reasoning barata
Archivo nuevo sugerido:
- `keryx/src/components/ai-elements/reasoning/ReasoningPreview.vue`

Props sugeridas:
- `content: string`
- `class?: HTMLAttributes['class']`
- opcional: `isStreaming?: boolean`

Comportamiento:
- renderizar texto simple/pre-wrap
- no usar `Markdown`
- estilo visual consistente con el bloque de reasoning

Criterio:
- el preview debe ser visualmente claro pero barato de render

---

### Paso 3. Derivar preview en `ChatMessageItem.vue`
Cambios:
- crear `fullReasoningText`
- crear `reasoningPreviewText`
- crear `isReasoningExpanded`

Criterio:
- preview siempre refleja las últimas 5 líneas no vacías del reasoning
- no mutar `message.parts`

---

### Paso 4. Montaje condicional del reasoning completo
Cambiar el template de `ChatMessageItem.vue` para que:
- colapsado: renderice `ReasoningPreview`
- expandido: renderice `ReasoningContent`

Importante:
- usar `v-if`/`v-else` de forma que el contenido completo **no se monte** cuando está colapsado
- evitar un simple ocultamiento con CSS

Criterio:
- inspeccionando el template debe quedar claro que el renderer markdown no se crea mientras esté colapsado

---

### Paso 5. Mantener el trigger/UX actual
Conservar si es posible:
- `Reasoning`
- `ReasoningTrigger`
- estilos actuales del sistema `ai-elements`

Ajustar si hace falta:
- texto del trigger
- estado inicial colapsado
- indicador `streaming`

Criterio:
- no romper consistencia visual con el resto del sistema de mensajes

---

### Paso 6. Validación funcional
Validar manualmente y/o con build:
- mensaje con reasoning corto
- mensaje con reasoning largo
- reasoning en streaming
- expandir y colapsar repetidamente
- confirmar que el contenido completo sigue visible al expandir

Comando recomendado:
- `rtk err bun build`

Si hay tests adecuados de UI ya existentes, evaluar agregar uno; si no los hay, no forzar una infraestructura de test nueva solo para esta tarea.

---

## Fase 2 — Refinamiento opcional

### Paso 7. Mejoras visuales del preview
Opcionales:
- fade inferior
- badge `Pensando`
- indicador `streaming`
- contador de líneas visibles o `Ver todo`

Solo si no aumenta complejidad innecesaria.

---

### Paso 8. Posible throttle del preview
Solo si la Fase 1 todavía muestra lag durante streaming muy agresivo.

Idea:
- amortiguar updates del preview cada 50–100 ms
- no tocar el contenido fuente, solo el derivado visible

No hacerlo preventivamente.

---

## Fase 3 — Spike opcional con Incremark

**Esta fase no se ejecuta salvo que Fase 1 no sea suficiente.**

### Hipótesis
Si el cuello sigue siendo el parseo incremental del markdown completo del reasoning cuando está expandido, `incremark` podría mejorar ese caso.

### Alcance
Probar `incremark` solo en reasoning expandido.

No tocar:
- `MessageResponse.vue`
- render principal del chat

### Pasos del spike
1. Agregar dependencia:
   - `@incremark/vue`
   - `@incremark/theme` si es necesario
2. Crear un renderer experimental solo para reasoning.
3. Comparar comportamiento visual y costo percibido.
4. Medir si vale la pena frente a la complejidad extra.

### Criterio de adopción
Adoptar solo si:
- la mejora es visible en reasonings largos reales
- el styling no degrada demasiado la UX
- el blast radius sigue acotado

Si no, mantener `vue-stream-markdown`.

---

## 7. Archivos a tocar

## Cambios probables
- `keryx/src/components/chat/ChatMessageItem.vue`
- `keryx/src/components/ai-elements/reasoning/ReasoningContent.vue` (solo si hace falta limpiar responsabilidades)
- `keryx/src/components/ai-elements/reasoning/index.ts` (si se exporta componente nuevo)
- `keryx/src/components/ai-elements/reasoning/ReasoningPreview.vue` (nuevo)

## Posibles archivos auxiliares
- tests si ya existe patrón equivalente para componentes UI
- estilos utilitarios si el preview requiere clases específicas

---

## 8. Criterios de aceptación

La tarea se considera completada si:

1. El reasoning aparece en un bloque interno dentro del mensaje assistant.
2. Por defecto, el bloque está colapsado.
3. Colapsado, solo se muestran las últimas 5 líneas del reasoning.
4. El markdown completo del reasoning no se monta mientras el bloque está colapsado.
5. Al expandir, se ve el reasoning completo correctamente.
6. El streaming del reasoning sigue funcionando.
7. La respuesta principal del assistant no cambia de comportamiento.
8. `bun build` pasa.

---

## 9. Riesgos y mitigaciones

## Riesgo 1. El componente actual `Reasoning` controla internamente el open state de forma rígida
Mitigación:
- inspeccionar API actual
- si no permite control fino, manejar preview/full desde `ChatMessageItem.vue`

## Riesgo 2. El preview pierde formato útil
Mitigación:
- aceptar preview como texto simple; es un resumen operativo, no la vista final
- conservar indentación razonable con `pre-wrap`

## Riesgo 3. El markdown completo se sigue montando por accidente
Mitigación:
- revisar template final para asegurar `v-if` real alrededor de `ReasoningContent`

## Riesgo 4. Expand/collapse reinicia estados visuales no deseados
Mitigación:
- mantener estado local por mensaje
- probar durante streaming y después de finalizar

## Riesgo 5. Se intenta resolver con CSS solamente
Mitigación:
- recordar que esconder con CSS no cumple el objetivo de performance

---

## 10. Validación sugerida

## Build
```bash
rtk err bun build
```

## Test puntual si aplica
Si se agrega o adapta test de componente:
```bash
rtk test bun test
```

## Validación manual mínima
- abrir un chat con reasoning largo
- verificar que colapsado solo se ve preview
- expandir y ver markdown completo
- colapsar de nuevo
- repetir mientras stream sigue activo si es posible

---

## 11. Entregable esperado del subagente que ejecute esto

El subagente debe devolver:
1. Resumen breve de los cambios
2. Lista exacta de archivos modificados
3. Confirmación explícita de si el markdown completo quedó sin montarse en modo colapsado
4. Resultado de `bun build`
5. Riesgos o follow-ups pendientes

---

## 12. Decisión final recomendada

### Implementar ahora
- preview colapsado de reasoning
- render full solo al expandir
- mantener `vue-stream-markdown`

### Diferir
- migración a `incremark`
- virtualización general del chat
- refactors más amplios de renderer markdown

---

## 13. Nota para el siguiente subagente

No optimices prematuramente fuera del alcance.

El objetivo de esta tarea **no** es rediseñar el renderer completo del chat, sino introducir una separación clara entre:
- **preview barata del reasoning**
- **render completo bajo demanda**

Si la Fase 1 resuelve la ralentización perceptible, detenerse ahí.
