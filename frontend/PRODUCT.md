# Product

## Register

product

## Users

Solo el desarrollador (uso personal). Contexto: escritorio o laptop, sesiones de trabajo donde necesita un asistente de IA confiable y rápido para productividad general — búsqueda, redacción, programación, organización de ideas. Sin necesidad de autenticación multiusuario ni collaboration features.

## Product Purpose

Keryx es un chat con IA completamente client-side que centraliza conversaciones con múltiples proveedores (Vercel AI Gateway, OpenCode GO) en una interfaz propia, sin depender de clientes de terceros. Persiste todo localmente (OPFS), cifra claves API, y permite organizar conversaciones con ramas. El éxito se mide por utilidad diaria: ¿es la primera app que abro para hablar con IA?

## Brand Personality

Inteligente, seria, confiable. Tono de herramienta personal bien construida — ni fría ni decorativa. La interfaz transmite calma y competencia: tipografía serif como señal de seriedad, paleta cálida sin ser llamativa, espaciado generoso que respeta la lectura.

## Anti-references

- **Herramientas de código** (Cursor, Windsurf, Copilot):Interfaces centradas en editor/terminal con chat como accesorio. Keryx pone el chat como superficie principal, no como sidebar de un IDE.
- **ChatGPT / Claude / Gemini web**:Interfaces genéricas de chat masivo con diseño neutro corporativo. Keryx tiene personalidad propia y está diseñada para una sola persona, no para millones.

## Design Principles

1. **Una sola persona, una sola interfaz** — Cada decisión de diseño asume un usuario en su escritorio. Sin abstracciones para multitenancy, sin configuración de equipo, sin permisos.
2. **Los datos son tuyos** — OPFS local, cifrado de claves, sin backend. La interfaz refleja esta filosofía: no hay indicadores de "nube", sync, ni colaboración.
3. **Tipografía como identidad** — El serif (Spectral/Merriweather) no es decorativo; es la personalidad visual de Keryx. Lo distingue de la masa de chats sans-serif.
4. **Rápida en memoria, lenta en decoración** — Animaciones funcionales, no decorativas. Cada transición tiene un propósito (feedback de estado, orientación espacial).
5. **Confiable antes que vistosa** — Si algo puede fallar, se maneja con gracia. Empty states, errores claros, loading states. La app nunca se siente rota.

## Accessibility & Inclusion

WCAG 2.1 AA como mínimo. Contraste de texto ≥ 4.5:1 verificado en todos los tokens actuales. Navegación por teclado completa. Soporte para `prefers-reduced-motion`. Labels ARIA en interactivos. i18n en inglés y español.
