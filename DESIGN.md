# Design

## Theme

Doble tema **oscuro (default)** y **claro**, con toggle persistente (`data-theme` en `<html>` + localStorage). Registro product: superficie de analista, densa pero calmada. El oscuro es el modo de trabajo principal (uso nocturno, foco en datos); el claro para revisión diurna/compartir pantalla.

## Color

Estrategia: **Restrained, monocroma**. Negro + grafito, sin matiz de marca. Lo que señala acción/selección/estado es el **contraste**, no el color: el acento se define como un salto de luminancia contra la superficie, así que se invierte con el tema.

Acento (grafito):
- Oscuro → sube: `--accent-primary: #e4e4e7`, botón primario `--accent-strong: #e8e8ec` sobre `--on-accent: #0a0a0b`
- Claro → baja: `--accent-primary: #26262a`, botón primario `--accent-strong: #1c1c1f` sobre `--on-accent: #ffffff`
- `--accent-soft`: neutro a 7–8% para chips/halos/selección
- `--accent-glow`: halo neutro (no de color) para hover de `.interactive`
- `--accent-secondary` / `--accent-tertiary`: escalones de la misma rampa de grises, no matices

Oscuro (`:root`):
- bg `#070708` · sidebar `#0d0d0f` · card `#131315` · elevated `#18181b` · border `rgba(255,255,255,.07)`
- texto primario `#f0f0f2` · secundario `#9a9aa2`

Claro (`[data-theme="light"]`):
- bg `#f6f6f7` · sidebar `#ffffff` · card `#ffffff` · border `#e4e4e7`
- texto primario `#101012` · secundario `#62626b`

Semánticos (único matiz del sistema, desaturado): `--accent-positive` `#74b58c` / `#2f7d52`, `--accent-negative` `#e0645c` / `#c0392f`. Charts en escala de grises: `--chart-line` neutro de máximo contraste, `--chart-line-2` gris medio.

Excepción: el editor de Historias usa colores saturados (pincel, resaltado, guías de alineación) porque son **contenido** del usuario y overlays funcionales sobre el lienzo, no cromo de la app.

## Logo

Monograma **DC** monolineal sobre badge grafito (`#17171a`, radio 17/64, filo de luz superior). D en `#fafafa` (primaria) y C en `#a1a1aa` (secundaria): la jerarquía es de luminancia, no de color, así que el badge funciona igual sobre fondo claro u oscuro. Mismo dibujo en `src/app/icon.svg` y en `favicon.ico` (16/32/48/64) con trazo algo más grueso.

## Typography

**Inter** para UI y **Manrope** (`--font-display`) para títulos. Escala fija en rem (no fluida), ratio ~1.2. Pesos 400/500/600/700 para jerarquía. Labels en mayúsculas solo ≤4 palabras.

## Components

- **Panel (`.glass-panel`)**: glass iOS — card-bg translúcido + `backdrop-filter: blur(20px)`, borde fino e inner-glow, radius 18px.
- **MetricCard**: cifra grande (peso 700) + label secundario; icono en halo neutro suave. Sin gradientes.
- **Top Contenidos**: lista con miniatura real (portada del reel), índice de ranking, título real (1 línea), métricas (vistas, ER). Hover eleva sutil.
- **Botones**: default/hover/focus/active/disabled/loading. Acento solo en primarios.
- Estados: skeleton en carga, empty states que enseñan, error inline.

## Motion

150–250ms, ease-out. Solo transmite estado (hover, selección, carga, entrada de panel). Sin secuencias de carga orquestadas. `@media (prefers-reduced-motion: reduce)` → transiciones instantáneas/crossfade.

## Layout

App-shell: sidebar fija (segundo nivel neutro) + contenido. Grids responsivos con `auto-fit minmax`. Responsive estructural, no tipografía fluida.
