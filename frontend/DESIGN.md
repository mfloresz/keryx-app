---
name: Keryx
description: Chat con IA personal — tipografía serif, paleta cálida terrosa, interfaz silenciosa
colors:
  primary: "oklch(0.6649 0.0912 81.5426)"
  primary-foreground: "oklch(0.982 0.0041 91.4458)"
  secondary: "oklch(0.7004 0.0391 152.5285)"
  secondary-foreground: "oklch(1 0 0)"
  background: "oklch(0.982 0.0041 91.4458)"
  foreground: "oklch(0.3139 0.0109 156.542)"
  card: "oklch(0.9492 0.0152 90.2369)"
  card-foreground: "oklch(0.3139 0.0109 156.542)"
  muted: "oklch(0.9099 0.0195 90.5511)"
  muted-foreground: "oklch(0.4997 0.0155 159.505)"
  accent: "oklch(0.9334 0.0313 92.9508)"
  accent-foreground: "oklch(0.6649 0.0912 81.5426)"
  destructive: "oklch(0.5133 0.1143 29.2251)"
  destructive-foreground: "oklch(1 0 0)"
  border: "oklch(0.8793 0.0197 90.557)"
  input: "oklch(0.9492 0.0152 90.2369)"
  ring: "oklch(0.6649 0.0912 81.5426)"
  sidebar: "oklch(0.964 0.0082 91.4831)"
  sidebar-foreground: "oklch(0.3139 0.0109 156.542)"
  sidebar-primary: "oklch(0.6649 0.0912 81.5426)"
  sidebar-primary-foreground: "oklch(1 0 0)"
  reasoning-foreground: "oklch(0.65 0.03 75)"
  reasoning-border: "oklch(0.85 0.02 85)"
typography:
  display:
    fontFamily: "Spectral, Georgia, serif"
    fontWeight: 700
    letterSpacing: "0.02em"
  body:
    fontFamily: "Merriweather Variable, ui-serif, Georgia, serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.02em"
  label:
    fontFamily: "Merriweather Variable, ui-serif, Georgia, serif"
    fontSize: "0.875rem"
    fontWeight: 500
  mono:
    fontFamily: "Courier Prime, monospace"
rounded:
  sm: "12px"
  md: "14px"
  lg: "16px"
  xl: "20px"
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
  button-outline:
    backgroundColor: "transparent"
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
---

# Design System: Keryx

## 1. Overview

**Creative North Star: "El Escritorio Silencioso"**

Keryx es un escritorio de trabajo ordenado y silencioso — todo en su lugar, sin distracciones. La interfaz transmite calma y competencia: un espacio donde la conversación con la IA fluye sin fricción visual. La personalidad es inteligente, seria y confiable, como una herramienta bien construida que no necesita gritar para demostrar su valor.

El sistema rechaza activamente la estética genérica de herramientas de código (editores con sidebar de chat como accesorio) y los chats corporativos neutros (ChatGPT, Claude). Keryx tiene identidad propia: tipografía serif como declaración de seriedad, paleta cálida terrosa que no busca ser llamativa, espaciado generoso que respeta la lectura.

**Key Characteristics:**
- Serif-forward: Spectral y Merriweather definen la personalidad visual
- Paleta terrosa: ámbar cálido como acento, verdes oliva como base
- Superficies planas con sombras funcionales, no decorativas
- Espaciado generoso que respira, nunca apretado
- Animaciones únicamente funcionales — feedback de estado, orientación espacial

## 2. Colors

La paleta es cálida y terrosa, anclada en un ámbar dorado que evoca miel oscura y cuero envejecido. Los neutros tienen un tinte verde-oliva sutil que evita el gris genérico y da coherencia cromática al conjunto.

### Primary
- **Ámbar Terroso** (oklch(0.6649 0.0912 81.5426)): Color de acento principal. Usado en botones primarios, sidebar activo, links, badges, focus rings, y selección de texto. Es la chispa cálida en un fondo silencioso.
- **Ámbar Brillante — Dark Mode** (oklch(0.7665 0.1387 91.0594)): Versión más saturada para modo oscuro, donde necesita más presencia contra fondos oscuros.

### Secondary
- **Salvia Muted** (oklch(0.7004 0.0391 152.5285)): Verde oliva suave para mensajes de usuario, badges secundarios, y elementos de soporte. Nunca compite con el primario.
- **Salvia Oscura — Dark Mode** (oklch(0.4691 0.0368 156.1246)): Versión oscura para el mismo rol.

### Neutral
- **Página Cálida** (oklch(0.982 0.0041 91.4458)): Background principal. No es blanco puro; tiene un tinte amarillo-verdoso sutil que evita la frialdad.
- **Tinta Verde** (oklch(0.3139 0.0109 156.542)): Texto principal. No es negro; es un verde-oscuro profundo que armoniza con la paleta.
- **Superficie Card** (oklch(0.9492 0.0152 90.2369)): Tarjetas y superficies elevadas. Levemente más oscura que el fondo.
- **Muted Surface** (oklch(0.9099 0.0195 90.5511)): Backgrounds de elementos secundarios — badges, sidebars items en hover, inputs deshabilitados.
- **Muted Text** (oklch(0.4997 0.0155 159.505)): Texto de soporte — descripciones, placeholders, timestamps.
- **Borde Cálido** (oklch(0.8793 0.0197 90.557)): Bordes y separadores. No es gris neutro; tiene el mismo tinte verde de la paleta.
- **Sidebar** (oklch(0.964 0.0082 91.4831)): Fondo del sidebar, levemente más cálido que la página.

### Named Rules
**The Earth-Tone Rule.** Los colores neutros nunca son grises puros. Siempre tienen un tinte hacia la familia cromática de la paleta (verde-oliva en claro, verde-profundo en oscuro). Un gris neutro rompe la coherencia del escritorio.

**The Amber Restraint Rule.** El ámbar primario aparece en ≤15% de cualquier pantalla. Su rareza es su punto — es la chispa que orienta la atención, no el color dominante.

## 3. Typography

**Display Font:** Spectral (con Georgia, serif como fallback)
**Body Font:** Merriweather Variable (con ui-serif, Georgia, Cambria como fallback)
**Label Font:** Merriweather Variable (misma familia que body, peso 500)
**Mono Font:** Courier Prime (para código, kbd, samp)

**Character:** La dupleta serif Serif+Serif no es accidental — Spectral define la jerarquía de display con trazos finos y elegantes, mientras Merriweather carga el cuerpo con una presencia más robusta y legible. Ambas comparten la misma personalidad: seria, culta, sin pretensiones decorativas.

### Hierarchy
- **Display** (bold 700, clamp hasta ~4.5rem, line-height 1.1): Títulos de bienvenida y heroes. Aparece una vez por vista, no se repite.
- **Headline** (semibold 600, 1.25rem, line-height 1.3): Títulos de sección en sidebar, cards, diálogos.
- **Title** (semibold 600, 1rem, line-height 1.4): Títulos de componentes — card titles, tool headers, reasoning triggers.
- **Body** (regular 400, 0.875rem, line-height 1.6): Texto de mensajes, descripciones, contenido principal. Longitud máxima: 65–75ch.
- **Label** (medium 500, 0.875rem, letter-spacing 0.02em): Botones, inputs, badges, etiquetas interactivas.
- **Caption** (medium 500, 0.75rem, letter-spacing 0.02em): Badges pequeños, shortcuts de teclado, timestamps.

### Named Rules
**The Serif Identity Rule.** El serif no es decorativo; es la personalidad de Keryx. Nunca se reemplaza por sans-serif en display o body. Si un elemento necesita sans-serif, es porque no es contenido legible (iconos, badges funcionales).

**The Baseline Size Rule.** El tamaño base es 0.875rem (14px), no 1rem. Esto es deliberado: una herramienta personal de uso intensivo se beneficia de densidad moderada. Nunca se sube a 16px para body text en desktop.

## 4. Elevation

El sistema es **plano con sombras funcionales**. Las superficies se distinguen por tono y borde, no por sombra. Las sombras aparecen únicamente en elementos que se elevan por encima del plano base: diálogos, popovers, dropdowns, y el indicador flotante del chat.

### Shadow Vocabulary
- **Ambient Green** (`0px 4px 20px 0px hsl(140 6.25% 18.82% / 0.08)`): Sombras en modo claro. El tinte verde es intencional — armoniza con la paleta en vez de usar negro puro.
- **Structural Black** (`0px 10px 30px 0px hsl(0 0% 0% / 0.4)`): Sombras en modo oscuro. Más pronunciadas porque los fondos oscuros absorben más luz.
- **Input Shadow** (`shadow-xs`): Inputs y textareas — presencia mínima, solo suficiente para separar del fondo.
- **Card Shadow** (`shadow-sm`): Tarjetas — elevación sutil que no compite con overlays.
- **Overlay Shadow** (`shadow-md` a `shadow-lg`): Popovers, diálogos — elevación clara que dice "esto está encima".

### Named Rules
**The Functional Elevation Rule.** Las sombras no son decorativas. Si un elemento no cambia de nivel (no es un overlay, popover, o feedback de estado), no tiene sombra. Los cards usan borde + tono, no sombra, para definir sus límites.

## 5. Components

### Buttons
- **Shape:** Gently curved (14px radius, `rounded-md`)
- **Primary:** Ámbar terroso de fondo, text near-white. Padding 8px 16px. Transición `transition-all`. Focus: 3px ring con `ring-ring/50`.
- **Hover / Focus:** Primary oscurece 10% (`bg-primary/90`). Ghost y outline reciben accent background. Focus ring consistente en todos los variantes.
- **Outline:** Borde `border-input`, fondo transparente. En dark mode: `bg-input/30`.
- **Ghost:** Sin borde ni fondo. Hover: `bg-accent`.
- **Sizes:** sm (32px h), default (36px h), lg (40px h), icon-sm (32px), icon (36px), icon-lg (40px).

### Inputs / Textarea
- **Style:** Borde 1px `border-input`, fondo transparente, radius 14px. Sombra mínima `shadow-xs`.
- **Height:** Input 36px (`h-9`). Textarea mínimo 64px, auto-resize con `field-sizing-content`.
- **Focus:** Border cambia a `ring`, ring 3px a 50% opacidad. Transición `transition-[color,box-shadow]`.
- **Dark mode:** Fondo `bg-input/30` — transparencia sutil que deja ver el fondo.
- **Placeholder:** `text-muted-foreground` — mismo color que el texto de soporte.

### Cards
- **Corner Style:** Amplio (20px radius, `rounded-xl`)
- **Background:** `bg-card` — superficie levemente tintada sobre el fondo.
- **Shadow Strategy:** `shadow-sm` funcional, no decorativo.
- **Border:** 1px `border` — el borde define los límites, la sombra eleva sutilmente.
- **Internal Padding:** 24px vertical, 24px horizontal en content. Gap 24px entre secciones.

### Sidebar
- **Width:** 288px expandida, 64px colapsada. Transición `duration-300`.
- **Background:** `bg-sidebar` — más cálido que la página principal.
- **Active item:** Fondo `bg-sidebar-primary` (ámbar), texto `text-sidebar-primary-foreground` (blanco).
- **Hover item:** `bg-sidebar-accent` — muted surface como feedback.
- **Border:** 1px `border-r border-border` separando del contenido.
- **Chat list items:** Radius 14px, padding 6px 8px. Acciones aparecen en hover (`opacity-0 group-hover:opacity-100`).
- **Group headers:** `text-xs font-medium uppercase tracking-wider text-muted-foreground`.

### Badges
- **Shape:** Pill completa (`rounded-full`).
- **Default:** Ámbar de fondo, texto near-white.
- **Secondary:** Salvia de fondo, texto white.
- **Outline:** Solo borde visible, texto foreground.
- **Padding:** 2px 8px, font `text-xs font-medium`.

### Chat Messages
- **User messages:** Background `bg-secondary` (salvia), radius 14px, padding 12px 16px. Alineado a la derecha, max-width 80%.
- **Assistant messages:** Sin background bubble. Texto directo sobre el fondo de la página. Alineado a la izquierda.
- **Avatar:** 32px circle con 1px ring en `ring-border`.
- **Actions:** Ghost buttons 32px, visibles solo en hover del grupo.
- **Branch selector:** Pill inline con borde `border-border`, fondo `bg-muted/50`, font `text-xs`.

### ChatInput (PromptInput)
- **Container:** `max-w-3xl mx-auto`, padding 16px horizontal, 16px bottom.
- **InputGroup:** Borde `border-input`, radius 14px, sombra `shadow-xs`.
- **Textarea:** Mínimo 80px, auto-resize hasta `max-h-48`.
- **Submit button:** Primario, 32px icon button, spinner animado durante envío.
- **Model selector:** Outline inline, radius 14px, padding 6px 12px, font `text-xs font-medium`.
- **Search toggle:** Ghost cuando inactivo, primary cuando activo. Globe icon 16px.

## 6. Do's and Don'ts

### Do:
- **Do** usar Spectral/Merriweather como familia tipográfica principal. El serif es la identidad de Keryx.
- **Do** mantener el ámbar primario como acento raro (≤15% de la pantalla). Su rareza orienta la atención.
- **Do** usar sombras solo en overlays (diálogos, popovers, dropdowns). Los cards se definen por borde + tono.
- **Do** aplicar `transition-[color,box-shadow]` en inputs y `transition-all` en buttons. Feedback visual en cada interacción.
- **Do** usar `text-muted-foreground` para placeholders, timestamps, y descripciones secundarias.
- **Do** respetar la densidad base de 14px para body text. Es una herramienta de uso intensivo, no un blog.
- **Do** usar la sombra verde-tintada en modo claro (`hsl(140 6.25% 18.82%)`) — armoniza con la paleta.

### Don't:
- **Don't** usar sans-serif en display o body text. El serif no es negociable en la identidad de Keryx.
- **Don't** usar grises puros para neutros. Siempre tintar hacia la familia verde-oliva de la paleta.
- **Don't** poner sombras en cards, inputs, o badges. Las sombras son para overlays, no para decoración.
- **Don't** exceder 15% de cobertura del ámbar primario en cualquier pantalla.
- **Don't** usar `border-left` o `border-right` mayor a 1px como acento decorativo en cards o list items.
- **Don't** animar propiedades de layout (`width`, `height`, `padding`) en transiciones de estado.
- **Don't** usar gradientes de texto (`background-clip: text`). El énfasis es por peso y tamaño, no por degradado.
- **Don't` redondear cards con radius mayor a 20px. El tope es `rounded-xl`.
- **Don't** parecerse a herramientas de código (Cursor, Windsurf) — Keryx pone el chat como superficie principal, no como sidebar de un IDE.
- **Don't** parecerse a chats corporativos genéricos (ChatGPT, Claude) — Keryx tiene personalidad propia con su serif y paleta terrosa.
