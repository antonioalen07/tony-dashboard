# Design

## Theme

Doble tema **oscuro (default)** y **claro**, con toggle persistente (`data-theme` en `<html>` + localStorage). Registro product: superficie de analista, densa pero calmada. El oscuro es el modo de trabajo principal (uso nocturno, foco en datos); el claro para revisión diurna/compartir pantalla.

## Color

Estrategia: **Restrained**. Neutros + un acento teal de marca. El acento solo señala acción/selección/estado.

Acento de marca (ambos temas):
- `--accent-primary: #14b8a6` (teal 500)
- `--accent-hover: #0f9d8f`
- `--accent-bright: #2dd4bf` (series de datos sobre fondo oscuro)
- `--accent-soft`: teal a baja opacidad para fondos de badges/halos

Oscuro (`:root`):
- bg `#0a0e0e` · sidebar `#0f1413` · card `#141a19` · border `#222b29`
- texto primario `#f4f6f5` · secundario `#9aa6a3`

Claro (`[data-theme="light"]`):
- bg `#f6f8f7` · sidebar `#ffffff` · card `#ffffff` · border `#e3e9e7`
- texto primario `#0e1413` · secundario `#5a6663`

Semánticos: `--accent-positive: #14b8a6`, `--accent-negative: #ef4444`. Variables de chart: `--chart-grid`, `--chart-axis`, `--chart-line` derivadas del tema.

## Typography

Una sola familia: **Inter** (sans). Escala fija en rem (no fluida), ratio ~1.2. Pesos 400/500/600/700 para jerarquía. Sin display fonts en UI. Labels en mayúsculas solo ≤4 palabras.

## Components

- **Panel (`.glass-panel`)**: superficie sólida (card-bg + border 1px + radius 16px), sin blur decorativo. Sombra sutil solo en claro.
- **MetricCard**: cifra grande (peso 700) + label secundario; icono en halo teal suave. Sin gradientes.
- **Top Contenidos**: lista con miniatura real (portada del reel), índice de ranking, título real (1 línea), métricas (vistas, ER). Hover eleva sutil.
- **Botones**: default/hover/focus/active/disabled/loading. Acento solo en primarios.
- Estados: skeleton en carga, empty states que enseñan, error inline.

## Motion

150–250ms, ease-out. Solo transmite estado (hover, selección, carga, entrada de panel). Sin secuencias de carga orquestadas. `@media (prefers-reduced-motion: reduce)` → transiciones instantáneas/crossfade.

## Layout

App-shell: sidebar fija (segundo nivel neutro) + contenido. Grids responsivos con `auto-fit minmax`. Responsive estructural, no tipografía fluida.
