# Product

## Register

product

## Users

Antonio (creador de contenido en Instagram, marca personal "Crevy") y su equipo. Contexto de uso: revisar el rendimiento de sus Reels para decidir qué contenido replicar. Trabajo a realizar: ver de un vistazo métricas reales (seguidores, reach, guardados, ER), identificar los mejores contenidos, y obtener transcripción + análisis IA de cada reel para mejorar el próximo.

## Product Purpose

Dashboard Content es un panel de inteligencia de contenido de Instagram. Centraliza métricas privadas (Meta API) y públicas por reel, las transcribe (ElevenLabs) y las analiza con IA (Claude vía OpenRouter) para producir recomendaciones accionables de crecimiento. Éxito = el usuario entiende por qué un reel funcionó y qué cambiar en el siguiente, sin salir del panel.

## Brand Personality

Analítico, directo, confiable. Voz en español rioplatense neutro. Tres palabras: nítido, accionable, sin ruido. La interfaz debe sentirse como una herramienta de analista (Linear/Stripe), no como un dashboard decorativo.

## Anti-references

- Dashboards "hero-metric" sobrecargados de gradientes y tarjetas idénticas.
- Glassmorphism decorativo por defecto.
- Plantillas genéricas de admin con widgets que no se usan.

## Design Principles

1. **El dato manda**: cada cifra que se muestra es real y persistida; nada de placeholders.
2. **Jerarquía por contraste, no por adorno**: peso y escala antes que color o sombras.
3. **El acento grafito solo señala acción o estado**, nunca decora.
4. **La herramienta desaparece en la tarea**: familiaridad ganada, affordances estándar.
5. **Estados completos**: cada acción tiene loading/empty/error que enseñan.

## Accessibility & Inclusion

Contraste WCAG AA (≥4.5:1 en texto). Soporte de `prefers-reduced-motion`. Toggle claro/oscuro persistente. Foco visible en todos los interactivos.
