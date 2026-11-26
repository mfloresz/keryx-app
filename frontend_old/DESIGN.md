---
name: Keryx
description: Chat con IA personal — papel cálido, tinta azul, tipografía serif, interfaz silenciosa
colors:
  primary: "oklch(0.485 0.175 259)"
  primary-foreground: "oklch(0.985 0.005 88)"
  secondary: "oklch(0.915 0.018 88)"
  secondary-foreground: "oklch(0.255 0.025 258)"
  background: "oklch(0.965 0.012 88)"
  foreground: "oklch(0.205 0.025 258)"
  card: "oklch(0.995 0.005 88)"
  card-foreground: "oklch(0.205 0.025 258)"
  popover: "oklch(0.995 0.005 88)"
  popover-foreground: "oklch(0.205 0.025 258)"
  muted: "oklch(0.925 0.014 88)"
  muted-foreground: "oklch(0.405 0.025 258)"
  accent: "oklch(0.90 0.045 250)"
  accent-foreground: "oklch(0.255 0.055 258)"
  destructive: "oklch(0.55 0.19 25)"
  destructive-foreground: "oklch(0.985 0.005 88)"
  success: "oklch(0.53 0.14 155)"
  success-foreground: "oklch(0.985 0.005 88)"
  border: "oklch(0.865 0.018 88)"
  input: "oklch(0.94 0.012 88)"
  ring: "oklch(0.60 0.16 259)"
  chart-1: "oklch(0.53 0.18 259)"
  chart-2: "oklch(0.60 0.16 35)"
  chart-3: "oklch(0.65 0.15 145)"
  chart-4: "oklch(0.58 0.16 80)"
  chart-5: "oklch(0.56 0.18 320)"
  sidebar: "oklch(0.945 0.018 88)"
  sidebar-foreground: "oklch(0.205 0.025 258)"
  sidebar-primary: "oklch(0.485 0.175 259)"
  sidebar-primary-foreground: "oklch(0.985 0.005 88)"
  sidebar-accent: "oklch(0.90 0.045 250)"
  sidebar-accent-foreground: "oklch(0.255 0.055 258)"
  sidebar-border: "oklch(0.865 0.018 88)"
  sidebar-ring: "oklch(0.60 0.16 259)"
  reasoning-foreground: "oklch(0.48 0.05 75)"
  reasoning-border: "oklch(0.80 0.04 85)"
typography:
  display:
    fontFamily: "Spectral, Georgia, serif"
    fontWeight: 700
  body:
    fontFamily: '"Merriweather Variable", ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.02em"
  label:
    fontFamily: '"Merriweather Variable", ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'
    fontSize: "0.875rem"
    fontWeight: 500
  mono:
    fontFamily: "Courier Prime, monospace"
  serif:
    fontFamily: "Cormorant Garamond, Georgia, serif"
rounded:
  sm: "9.6px"
  md: "11.6px"
  lg: "13.6px"
  xl: "17.6px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  sidebar-item:
    backgroundColor: "transparent"
    textColor: "{colors.sidebar-foreground}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  message-user:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
---

# Design System: Keryx

## Overview

**Creative North Star: "El Escritorio Silencioso"**

Keryx es un escritorio de trabajo ordenado y silencioso — todo en su lugar, sin distracciones. La interfaz transmite calma y competencia: un espacio donde la conversación con la IA fluye sin fricción visual. La personalidad es inteligente, seria y confiable, como una herramienta bien construida que no necesita gritar para demostrar su valor.

El sistema se apoya en un contraste de **papel y tinta**: superficies de papel cálido (matiz 88) contra tinta azul profunda (matiz 258). El ámbar cálido de la etapa anterior sobrevive en un solo lugar — el bloque de pensamiento del modelo (reasoning) — como una nota cálida deliberada dentro de un sistema frío por lo demás. La tipografía serif (Merriweather Variable por defecto, Spectral para acentos display) es la declaración de seriedad: Keryx no parece un chat corporativo.

El sistema rechaza activamente la estética genérica de herramientas de código (editores con sidebar de chat como accesorio) y los chats corporativos neutros (ChatGPT, Claude). Keryx tiene identidad propia: serif como voz, papel y tinta como paleta, y un radius compacto derivado de un único token.

**Key Characteristics:**
- Papel cálido, tinta azul: neutros cálidos (hue 88) + texto con tinte azul (hue 258)
- Serif-first: Merriweather Variable como fuente de app, Spectral para acentos display
- Burbuja de usuario en azul tinta (`bg-primary`); el asistente escribe directo sobre la página
- Ámbar reservado exclusivamente para el reasoning del modelo
- Radius compacto derivado de `--radius: 0.85rem` (~14px base)
- Superficies planas con sombras funcionales; en claro, sombras con tinte azul (hsl 220)

## Colors

La paleta es **papel y tinta**: neutros cálidos de papel (matiz 88) y textos con tinte azul (matiz 258), con un azul profundo como primary. El ámbar cálido queda reservado al reasoning. Ningún neutro es gris puro.

### Primary
- **Azul Tinta** (oklch(0.485 0.175 259)): Color de acento principal. Botones primarios, burbuja del mensaje de usuario, item activo del sidebar, links, selección de texto y focus rings. Es la tinta que firma la interfaz.
- **Azul Claro — Dark Mode** (oklch(0.72 0.145 254)): Versión brillante para modo oscuro, con fuerza contra los fondos azul-negro profundos. Su foreground es tinta oscura (oklch(0.16 0.025 258)).

### Secondary
- **Superficie Cálida** (oklch(0.915 0.018 88)): Superficie neutra cálida para botones y badges secundarios, y para el item de favoritos activo. Ya no tiñe la burbuja de usuario — ese rol lo tomó el primary.

### Accent
- **Cielo Tenue** (oklch(0.90 0.045 250)): Tinte azul muy claro para hovers de botones ghost/outline y del sidebar. Es el único azul "pastel" del sistema.

### Neutral
- **Papel Cálido** (oklch(0.965 0.012 88)): Background principal. No es blanco puro; tiene un tinte amarillo-verdoso sutil que evita la frialdad.
- **Papel Blanco** (oklch(0.995 0.005 88)): Cards y popovers — prácticamente blanco, con el mínimo tinte cálido.
- **Tinta Azul** (oklch(0.205 0.025 258)): Texto principal. No es negro; es un azul-oscuro profundo que armoniza con el primary.
- **Muted Cálido** (oklch(0.925 0.014 88)): Fondos secundarios — kbd chips, superficies deshabilitadas.
- **Muted Text** (oklch(0.405 0.025 258)): Texto de soporte — descripciones, placeholders, timestamps. Azul apagado.
- **Borde Cálido** (oklch(0.865 0.018 88)): Bordes y separadores. Cálido como el papel.
- **Input** (oklch(0.94 0.012 88)): Borde de campos de texto.
- **Sidebar** (oklch(0.945 0.018 88)): Fondo del sidebar, levemente más cálido que la página.
- **Destructive** (oklch(0.55 0.19 25)): Errores y votos negativos. **Success** (oklch(0.53 0.14 155)): Estados de éxito.

### Reasoning (accento cálido)
- **Ámbar de Razón** (oklch(0.48 0.05 75), borde oklch(0.80 0.04 85)): Texto y borde del bloque de pensamiento del modelo. Es la única presencia cálida del sistema — deliberada.

### Named Rules
**The Paper & Ink Rule.** Los neutros nunca son grises puros. Las superficies son papel cálido (matiz 88); el texto es tinta azul (matiz 258). Un gris neutro rompe el contraste de papel y tinta.

**The Amber Exclusivity Rule.** El ámbar cálido aparece únicamente en el reasoning del modelo. Si un elemento no es pensamiento, no es ámbar. Su rareza lo hace legible como "esto es el modelo pensando".

**The Blue Restraint Rule.** El azul tinta (primary) se concentra en acciones y en la burbuja de usuario — nunca en fondos de página ni en el texto de lectura. La página permanece en papel cálido.

## Typography

**App Font (default):** Merriweather Variable (con ui-serif, Georgia, Cambria, Times como fallback)
**Display Font (`font-sans`):** Spectral (con Georgia, serif como fallback)
**Serif Font (`font-serif`):** Cormorant Garamond (con Georgia, serif como fallback) — declarado, aún no cargado en `main.ts`
**Mono Font:** Courier Prime (código, kbd, filenames)

**Character:** La dupleta serif no es accidental — Merriweather Variable carga el cuerpo con una presencia robusta y legible, mientras Spectral aporta elegancia de display con trazos finos. Ambas comparten la misma personalidad: seria, culta, sin pretensiones decorativas. El serif es la voz por defecto, pero el usuario puede elegir entre 9 familias (spectral, manrope, geist, montserrat, etc.) en ajustes — la identidad es la voz serif por defecto, no una prohibición.

### Hierarchy
- **Welcome** (semibold 600, 1.875rem `text-3xl`, tracking-tight): Título de bienvenida en el empty state. La pieza más grande de la app.
- **Group headers** (medium 500, 0.75rem `text-xs`, tracking-wider): Agrupaciones de fechas en el sidebar.
- **Title** (semibold 600, 1rem, line-height 1.4): Card titles, tool headers, diálogos.
- **Body** (regular 400, 0.875rem, line-height 1.6, letter-spacing 0.02em): Mensajes, descripciones, contenido principal. El contenido markdown usa line-height 1.7. Longitud máxima: 65–75ch.
- **Label** (medium 500, 0.875rem, letter-spacing 0.02em): Botones, inputs, badges, etiquetas interactivas.
- **Caption** (medium 500, 0.75rem): Badges pequeños, shortcuts de teclado (`text-[10px]` en kbd), timestamps.

### Named Rules
**The Serif First Rule.** La voz por defecto de Keryx es serif (Merriweather Variable). Las alternativas sans (geist, manrope, open-sans, …) son elección explícita del usuario en ajustes, nunca la opción por defecto del sistema.

**The Baseline Size Rule.** El tamaño base es 0.875rem (14px), no 1rem. Esto es deliberado: una herramienta personal de uso intensivo se beneficia de densidad moderada. Nunca se sube a 16px para body text en desktop.

## Layout

- **App shell:** Sidebar fijo de 288px expandido (`w-72`) y 64px colapsado (`w-16`), con transición de ancho `duration-300`. El contenido ocupa el resto del viewport.
- **Columna de chat:** Cada mensaje vive en una fila `max-w-[80%]`; la fila de usuario se alinea a la derecha (`ml-auto`) con el avatar invertido (`flex-row-reverse`).
- **Composer:** Contenido centrado con `max-w-3xl mx-auto`; padding 16px horizontal y 16px inferior sobre `bg-background`. El textarea crece con `field-sizing-content` hasta `max-h-36`.
- **Ritmo de espaciado:** Escala Tailwind 4/8/12/16/24px. Mensajes `py-4`; items del sidebar `px-2 py-1.5`; secciones de card separadas por `gap-6` (24px).
- **Densidad:** Base 14px. `min-width: 320px` en body; inputs `text-base md:text-sm`.

## Elevation & Depth

El sistema es **plano con sombras funcionales**. Las superficies se distinguen por tono (papel cálido vs. papel blanco) y borde de 1px, no por sombra. Las sombras aparecen únicamente donde el elemento cambia de nivel: inputs, cards, popovers, diálogos.

### Shadow Vocabulary
Las sombras se construyen sobre `--shadow-color` con alfa progresivo:

- **Claro — tinte azul** (`hsl(220 30% 15%)`): la base es azulada, no negra — armoniza con la tinta azul de la paleta.
- **Oscuro — negro puro** (`hsl(0 0% 0%)`): más pronunciadas porque los fondos oscuros absorben más luz.

Escala completa (claro): `shadow-2xs` `0 1px 2px / 0.04` · `shadow-xs` `0 2px 6px / 0.06` · `shadow-sm` `0 4px 12px / 0.07 + 0 1px 2px / 0.04` · `shadow` `0 8px 24px / 0.08` · `shadow-md` `0 12px 32px / 0.10` · `shadow-lg` `0 20px 48px / 0.12` · `shadow-xl` `0 28px 64px / 0.14` · `shadow-2xl` `0 36px 80px / 0.18`.

Roles:
- **Input Shadow** (`shadow-xs`): Inputs, textareas, composer.
- **Card Shadow** (`shadow-sm`): Cards — elevación sutil que no compite con overlays.
- **Overlay Shadow** (`shadow-md` a `shadow-lg`): Popovers, dropdowns, diálogos.
- **Floating** (`shadow`): Botón de stop durante el streaming.

### Named Rules
**The Functional Elevation Rule.** Las sombras no son decorativas. Si un elemento no cambia de nivel (no es un overlay, popover, input o card), no tiene sombra. Los cards usan borde + tono, no sombra, para definir sus límites.

## Shapes

- **Radius base:** `--radius: 0.85rem` (13.6px). Toda la escala deriva de él: `sm` 9.6px, `md` 11.6px, `lg` 13.6px, `xl` 17.6px, `full` píldora.
- **Cards:** `rounded-xl` (17.6px) — el radio más generoso del sistema.
- **Botones e inputs:** `rounded-md` (11.6px).
- **Burbuja de usuario:** `rounded-lg` (13.6px).
- **Badges y pills:** `rounded-full` — incluyendo el selector de rama del chat.
- **Bordes:** 1px `border`/`input` definen los límites de las superficies. El reasoning usa `border-l-2` como acento de línea.

### Named Rules
**The Compact Radius Rule.** Ninguna esquina se define con un radio hardcodeado; todo deriva de `--radius` (0.85rem). El tope de cards es `xl` (17.6px).

## Components

### Buttons
- **Shape:** Suavemente curvados (`rounded-md`, 11.6px).
- **Default (Primary):** `bg-primary` (azul tinta), texto `primary-foreground` (casi blanco). Padding 8px 16px (`px-4 py-2`), alto 36px (`h-9`). Transición `transition-all`.
- **Hover / Focus:** Primary oscurece 10% (`bg-primary/90`). Outline recibe `bg-background` + `shadow-xs` y al hover `bg-accent`. Ghost recibe `bg-accent` al hover. Focus ring consistente en todos los variantes: 3px `ring-ring/50`.
- **Variants:** `outline` (borde + fondo de página), `secondary` (superficie cálida), `ghost` (sin borde ni fondo), `destructive` (rojo), `link` (texto con subrayado).
- **Sizes:** sm 32px (`h-8`), default 36px (`h-9`), lg 40px (`h-10`), icon-sm 32px (`size-8`), icon 36px (`size-9`), icon-lg 40px (`size-10`).

### Inputs / Fields
- **Style:** Borde 1px `border-input`, fondo transparente, `rounded-md` (11.6px), `shadow-xs`. Alto 36px (`h-9`).
- **Focus:** El borde cambia a `ring`, ring 3px al 50%. Transición `transition-[color,box-shadow]`.
- **Dark mode:** Fondo `bg-input/30` — transparencia sutil que deja ver el fondo.
- **Placeholder:** `text-muted-foreground`. Selección de texto: `bg-primary` con texto claro.

### Composer (PromptInput / ChatInput)
- **Contenedor:** `max-w-3xl mx-auto`, padding 16px horizontal, 16px inferior.
- **InputGroup:** Borde `border-input`, `rounded-md` (11.6px), `shadow-xs`. En dark, `bg-input/30`. Focus en cualquier control interno: `border-ring` + ring 3px.
- **Textarea:** Fondo transparente, mínimo 48px (`min-h-[3rem]`), crece con `field-sizing-content` hasta `max-h-36`. Placeholder en overlay absoluto que no afecta la altura.
- **Submit:** Botón primario `icon-sm` (32px); el icono cambia según estado (send → spinner → stop → error).
- **Selector de preset:** `Select` compacto `h-8 px-3 text-xs`.
- **Web search toggle:** Ghost cuando inactivo, default cuando activo. Icono globe 16px.

### Cards
- **Corner Style:** Amplio (`rounded-xl`, 17.6px).
- **Background:** `bg-card` (papel blanco). **Border:** 1px `border`. **Shadow:** `shadow-sm`.
- **Padding:** `py-6` vertical y `px-6` horizontal; `gap-6` (24px) entre secciones.

### Sidebar
- **Width:** 288px expandida, 64px colapsada. Transición `transition-[width] duration-300`.
- **Background:** `bg-sidebar` — más cálido que la página. Borde derecho `border-r border-border`.
- **Active item:** `bg-sidebar-primary` (azul tinta), texto claro. **Hover:** `bg-sidebar-accent` (cielo tenue).
- **Items:** `rounded-md` (11.6px), `px-2 py-1.5`, `text-sm`.
- **Group headers:** `text-xs font-medium text-muted-foreground tracking-wider`.
- **Kbd chip:** `rounded border bg-muted px-1.5 font-mono text-[10px]`.
- **Nuevo chat / búsqueda / favoritos:** Buttons full-width `size-sm` (32px de alto).

### Badges
- **Shape:** Píldora (`rounded-full`), `px-2 py-0.5`, `text-xs font-medium`, borde 1px.
- **Default:** `bg-primary` (azul tinta). **Secondary:** `bg-secondary` (superficie cálida). **Destructive:** rojo. **Outline:** solo borde, texto foreground.

### Messages
- **User:** Fila `max-w-[80%] ml-auto flex-row-reverse`; burbuja `bg-primary` (azul tinta), `rounded-lg` (13.6px), `px-4 py-3`, texto claro.
- **Assistant:** Sin burbuja. Texto directo sobre el fondo de la página (`text-foreground`), renderizado con `markdown-content`.
- **Avatar:** 32px (`size-8`) círculo con `ring-1 ring-border`.
- **Actions:** Botones ghost 32px, visibles solo en hover/focus del grupo (`opacity-0 group-hover:opacity-100`).
- **Branch selector:** Pill `rounded-full border border-border bg-muted/50 px-2 py-1 text-xs`.
- **Reasoning:** Trigger `text-sm text-reasoning-foreground` con chevron rotativo; contenido `border-l-2 border-reasoning-border pl-4 text-sm text-reasoning-foreground`. Preview en Spectral (`font-sans`).

## Do's and Don'ts

### Do:
- **Do** mantener el contraste papel cálido (superficies) + tinta azul (texto). Es la identidad cromática de Keryx.
- **Do** usar el serif por defecto (Merriweather Variable) y Spectral para acentos display.
- **Do** reservar el ámbar para el reasoning del modelo — es la única nota cálida.
- **Do** usar la burbuja de usuario en azul tinta (`bg-primary`) y el asistente sin burbuja.
- **Do** usar sombras solo donde hay cambio de nivel (inputs, cards, overlays). En claro, sombras con tinte azul (`hsl(220 30% 15%)`).
- **Do** derivar todo radio de `--radius` (0.85rem). El tope de cards es `xl` (17.6px).
- **Do** aplicar `transition-[color,box-shadow]` en inputs y `transition-all` en botones; ring de focus de 3px.
- **Do** respetar la densidad base de 14px para body text — es una herramienta de uso intensivo, no un blog.

### Don't:
- **Don't** usar grises puros para neutros — siempre papel cálido (hue 88) o tinta azul (hue 258).
- **Don't** usar ámbar fuera del reasoning del modelo.
- **Don't** poner sombras decorativas en elementos que no cambian de nivel.
- **Don't** usar sans-serif como fuente por defecto del sistema — solo por elección explícita del usuario.
- **Don't** redondear cards con radius mayor a `xl` (17.6px).
- **Don't** usar gradientes de texto (`background-clip: text`) — el énfasis es por peso y tamaño, no por degradado.
- **Don't** animar propiedades de layout (`width`, `height`, `padding`) en transiciones de estado — excepto la transición de ancho del sidebar.
- **Don't** parecerse a herramientas de código (Cursor, Windsurf) — Keryx pone el chat como superficie principal, no como sidebar de un IDE.
- **Don't** parecerse a chats corporativos genéricos (ChatGPT, Claude) — Keryx tiene personalidad propia con su serif y su paleta de papel y tinta.
