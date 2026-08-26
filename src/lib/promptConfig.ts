/**
 * Entrenamiento editable de la IA — ÚNICA fuente de los prompts del sistema.
 *
 * Los tres prompts (chat / análisis por reel / adaptación de virales) se arman
 * acá y SOLO con bloques editables. Lo único que queda cableado es el andamiaje
 * técnico: la línea de rol, el enganche con el dossier de reels y los contratos
 * JSON de análisis y adaptación (si se tocan, se rompe la app en silencio).
 *
 * Reglas que hay que respetar al agregar cosas:
 *
 * 1. UN concepto = UN bloque. Nada de mencionar el embudo, la estructura o los
 *    pilares dentro del texto fijo: si el usuario reescribe su bloque y el
 *    andamiaje sigue diciendo lo viejo, el modelo recibe las dos versiones y
 *    obedece a la más imperativa. Ese era el bug de "borro TOF/MOF/BOF y sigue
 *    apareciendo".
 * 2. Bloque vacío = bloque APAGADO. No entra al prompt. Distinto de "no lo
 *    tocó nunca", que cae al default de `brand.ts`.
 * 3. Agregar un bloque nuevo = agregarlo a BLOCK_DEFS y meterlo en la función
 *    que corresponda. No hace falta migración: `blocks` es JSONB.
 */

import {
  BRAND_IDENTIDAD,
  BRAND_AVATAR,
  BRAND_FRASES,
  BRAND_VOZ,
  BRAND_PILARES,
  BRAND_ANGULOS,
  BRAND_EMBUDO,
  BRAND_ESTRUCTURA,
  BRAND_PRINCIPIOS,
  BRAND_CTA,
  BRAND_REGLAS,
  BRAND_ORDEN_OPERACION,
  BRAND_FORMATO_RESPUESTA,
  BRAND_CRITERIOS_ANALISIS,
  BRAND_ADAPTACION,
  VARIABLES_FUNCIONARON,
  VARIABLES_FALLARON,
} from '@/lib/brand';

export type BlockId =
  | 'identidad'
  | 'avatar'
  | 'frases'
  | 'voz'
  | 'pilares'
  | 'angulos'
  | 'embudo'
  | 'principios'
  | 'ordenOperacion'
  | 'estructura'
  | 'cta'
  | 'reglas'
  | 'variablesOk'
  | 'variablesFail'
  | 'criteriosAnalisis'
  | 'formatoRespuesta'
  | 'adaptacion';

/** Prompts que consumen un bloque (se muestra como etiqueta en el editor). */
export type PromptTarget = 'chat' | 'analisis' | 'adaptar';

export interface BlockDef {
  id: BlockId;
  /** Título en el editor. */
  label: string;
  /** Qué hace este bloque, en criollo, para quien lo edita. */
  hint: string;
  /** Encabezado con el que entra al prompt. */
  heading: string;
  usedIn: PromptTarget[];
  /** Texto por defecto (de `brand.ts`) para quien nunca tocó el bloque. */
  fallback: string;
}

export const BLOCK_DEFS: BlockDef[] = [
  {
    id: 'identidad',
    label: 'Quién sos y qué ofrecés',
    hint: 'Tu identidad, tu oferta y cómo se reparten marca personal y empresa. Es lo primero que lee la IA.',
    heading: '## QUIÉN SOS Y QUÉ OFRECÉS',
    usedIn: ['chat', 'analisis'],
    fallback: BRAND_IDENTIDAD,
  },
  {
    id: 'avatar',
    label: 'A quién le hablás',
    hint: 'Deseos, miedos y creencias de tu audiencia. La IA valida contra esto si una idea sirve o no.',
    heading: '## A QUIÉN LE HABLA EL CONTENIDO',
    usedIn: ['chat', 'analisis'],
    fallback: BRAND_AVATAR,
  },
  {
    id: 'frases',
    label: 'Frases que resuenan',
    hint: 'Vocabulario propio para hooks y guiones. Vacialo si querés que la IA deje de usar estas frases.',
    heading: '## FRASES Y ÁNGULOS QUE RESUENAN',
    usedIn: ['chat'],
    fallback: BRAND_FRASES,
  },
  {
    id: 'voz',
    label: 'Voz y tono',
    hint: 'Cómo suena lo que escribe la IA: persona, ritmo, qué evita.',
    heading: '## VOZ Y TONO',
    usedIn: ['chat', 'analisis', 'adaptar'],
    fallback: BRAND_VOZ,
  },
  {
    id: 'pilares',
    label: 'Pilares de contenido',
    hint: 'Los territorios en los que cae todo lo que publicás. La IA clasifica cada idea contra esta lista.',
    heading: '## PILARES DE CONTENIDO (todo guion debe caer en uno)',
    usedIn: ['chat', 'analisis', 'adaptar'],
    fallback: BRAND_PILARES,
  },
  {
    id: 'angulos',
    label: 'Biblioteca de ángulos',
    hint: 'Las formas distintas de contar la MISMA idea. Cuando pedís hooks, la IA recorre esta biblioteca.',
    heading: '## BIBLIOTECA DE ÁNGULOS (aplicar a cada idea)',
    usedIn: ['chat'],
    fallback: BRAND_ANGULOS,
  },
  {
    id: 'embudo',
    label: 'A quién apunta cada pieza (embudo)',
    hint: 'ÚNICO lugar donde se define el embudo. Si acá no nombrás TOF/MOF/BOF, la IA no los va a usar en ningún prompt. Vacialo para que deje de clasificar por etapa.',
    heading: '## A QUIÉN APUNTA CADA PIEZA',
    usedIn: ['chat', 'adaptar'],
    fallback: BRAND_EMBUDO,
  },
  {
    id: 'principios',
    label: 'Principios de guion',
    hint: 'Lo que hace que un video funcione, más allá del formato. Se aplica antes de escribir.',
    heading: '## PRINCIPIOS DE GUION',
    usedIn: ['chat', 'adaptar'],
    fallback: BRAND_PRINCIPIOS,
  },
  {
    id: 'ordenOperacion',
    label: 'Orden de trabajo de la IA',
    hint: 'Los pasos que sigue la IA antes de responderte. Acá se decide si clasifica la pieza, si te da ángulos o guion, y en qué orden.',
    heading: '## ORDEN DE OPERACIÓN (seguilo siempre)',
    usedIn: ['chat'],
    fallback: BRAND_ORDEN_OPERACION,
  },
  {
    id: 'estructura',
    label: 'Estructura de guion',
    hint: 'ÚNICO esqueleto que sigue todo guion. Si ponés varias estructuras, aclará cuándo usar cada una.',
    heading: '## ESTRUCTURA DE GUION',
    usedIn: ['chat', 'adaptar'],
    fallback: BRAND_ESTRUCTURA,
  },
  {
    id: 'cta',
    label: 'CTA',
    hint: 'Con qué llamada a la acción cierra cada pieza.',
    heading: '## CTA',
    usedIn: ['chat', 'adaptar'],
    fallback: BRAND_CTA,
  },
  {
    id: 'reglas',
    label: 'Reglas duras',
    hint: 'Lo no negociable: palabras prohibidas, promesas que no se hacen, cómo se arranca. La IA no las cruza.',
    heading: '## REGLAS DURAS (no negociables)',
    usedIn: ['chat', 'adaptar'],
    fallback: BRAND_REGLAS,
  },
  {
    id: 'variablesOk',
    label: 'Variables que funcionaron',
    hint: 'Vocabulario con el que la IA etiqueta lo que salió bien. Una por línea o separadas por coma.',
    heading: '## VARIABLES QUE TE FUNCIONARON',
    usedIn: ['chat', 'analisis'],
    fallback: VARIABLES_FUNCIONARON.join(', '),
  },
  {
    id: 'variablesFail',
    label: 'Variables que fallaron',
    hint: 'Vocabulario de lo que hay que evitar. La IA lo usa para diagnosticar los reels flojos.',
    heading: '## VARIABLES QUE TE FALLARON (evitar)',
    usedIn: ['chat', 'analisis'],
    fallback: VARIABLES_FALLARON.join(', '),
  },
  {
    id: 'criteriosAnalisis',
    label: 'Criterios de análisis por reel',
    hint: 'Los ejes que evalúa la IA en cada video. Devuelve un punto por eje, así que agregar o sacar ejes cambia el análisis que ves en cada reel.',
    heading: '## EJES DE ANÁLISIS (uno por punto, en este orden)',
    usedIn: ['analisis'],
    fallback: BRAND_CRITERIOS_ANALISIS,
  },
  {
    id: 'formatoRespuesta',
    label: 'Cómo te responde en el chat',
    hint: 'La forma de la respuesta: largo, si cita reels y números, si usa listas.',
    heading: '## CÓMO RESPONDER',
    usedIn: ['chat'],
    fallback: BRAND_FORMATO_RESPUESTA,
  },
  {
    id: 'adaptacion',
    label: 'Reglas para adaptar virales',
    hint: 'Cómo convierte el reel viral de otro creador en tu versión: qué conserva del original y qué tiene prohibido hacer.',
    heading: '## MODO ADAPTACIÓN',
    usedIn: ['adaptar'],
    fallback: BRAND_ADAPTACION,
  },
];

export type Blocks = Record<BlockId, string>;

export const DEFAULT_BLOCKS: Blocks = BLOCK_DEFS.reduce((acc, def) => {
  acc[def.id] = def.fallback;
  return acc;
}, {} as Blocks);

/**
 * Completa lo que venga de la base con los defaults.
 *
 * La distinción clave: una CLAVE AUSENTE significa "nunca lo tocó" → default.
 * Un STRING VACÍO significa "lo apagó a propósito" → se respeta el vacío y el
 * bloque no entra al prompt. Antes ambos casos caían al default, y por eso
 * borrar un bloque reinstalaba el texto original.
 *
 * Tolera basura: ids desconocidos y valores que no son string caen al default,
 * así que un `ai_settings` corrupto degrada al prompt original en vez de romper.
 */
export function resolveBlocks(stored: unknown): Blocks {
  const out = { ...DEFAULT_BLOCKS };
  if (!stored || typeof stored !== 'object') return out;
  for (const def of BLOCK_DEFS) {
    const raw = (stored as Record<string, unknown>)[def.id];
    if (typeof raw === 'string') out[def.id] = raw.trim();
  }
  return out;
}

/** Bloques que difieren del default (para avisar en la UI qué está tuneado). */
export function customizedBlockIds(blocks: Blocks): BlockId[] {
  return BLOCK_DEFS.filter((d) => blocks[d.id].trim() !== d.fallback.trim()).map((d) => d.id);
}

/** Bloques apagados: el usuario los dejó vacíos y no entran a ningún prompt. */
export function disabledBlockIds(blocks: Blocks): BlockId[] {
  return BLOCK_DEFS.filter((d) => !blocks[d.id].trim()).map((d) => d.id);
}

const byId = new Map(BLOCK_DEFS.map((d) => [d.id, d]));

/**
 * Renderiza un bloque con su encabezado. Devuelve `null` si está vacío, para
 * que el bloque desaparezca del prompt en lugar de dejar un título huérfano.
 */
function block(blocks: Blocks, id: BlockId): string | null {
  const body = (blocks[id] || '').trim();
  if (!body) return null;
  return `${byId.get(id)!.heading}\n${body}`;
}

/** Une las partes salteando las vacías. */
function assemble(parts: (string | null)[]): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join('\n\n');
}

/* --------------------------------------------------------------------------
 * Prompt 1 — el estratega (/api/chat)
 * ------------------------------------------------------------------------ */

export function composeChatSystemPrompt(blocks: Blocks): string {
  return assemble([
    'Sos el estratega de contenido personal de Tony (Antonio Martínez), fundador de Crevy. Trabajás para UNA sola cuenta y la conocés a fondo. Tu misión: hacer crecer su Instagram personal con contenido orgánico que convierta vistas en consultas calificadas.',
    block(blocks, 'identidad'),
    block(blocks, 'avatar'),
    block(blocks, 'voz'),
    block(blocks, 'frases'),
    block(blocks, 'pilares'),
    block(blocks, 'embudo'),
    // Enganche con el dossier: cableado, no editable. Es la garantía de que el
    // modelo no invente métricas.
    `## TUS DATOS
Tenés un dossier con los reels reales de la cuenta: métricas, transcripción de audio y análisis previo de cada uno. Es tu ÚNICA fuente de verdad sobre rendimiento. No inventes datos ni métricas. Si algo no está en el dossier, decilo y pedí qué falta.`,
    block(blocks, 'ordenOperacion'),
    block(blocks, 'principios'),
    block(blocks, 'angulos'),
    block(blocks, 'estructura'),
    block(blocks, 'cta'),
    block(blocks, 'variablesOk'),
    block(blocks, 'variablesFail'),
    block(blocks, 'reglas'),
    block(blocks, 'formatoRespuesta'),
  ]);
}

/* --------------------------------------------------------------------------
 * Prompt 2 — el analista por reel (/api/analyze)
 * ------------------------------------------------------------------------ */

export function composeAnalyzeSystemPrompt(blocks: Blocks): string {
  const vocabulario = assemble([
    blocks.variablesOk.trim()
      ? `Variables que históricamente le FUNCIONARON: ${blocks.variablesOk.trim()}`
      : null,
    blocks.variablesFail.trim()
      ? `Variables que históricamente le FALLARON: ${blocks.variablesFail.trim()}`
      : null,
  ]);

  return assemble([
    'Sos el analista de contenido personal de Tony. Analizás cada Reel suyo contra SU estrategia real, no contra consejos genéricos de Instagram.',
    block(blocks, 'identidad'),
    block(blocks, 'avatar'),
    block(blocks, 'voz'),
    block(blocks, 'pilares'),
    vocabulario ? `## VOCABULARIO DE VARIABLES (etiquetá contra estas listas probadas)\n${vocabulario}` : null,
    block(blocks, 'criteriosAnalisis'),
    // Contrato JSON: cableado. La app parsea esto.
    `## FORMATO DE SALIDA (obligatorio)
Respondé ÚNICAMENTE con un objeto JSON válido (sin texto antes ni después, sin markdown):
{
  "ai_analysis": [ "punto 1", "punto 2", "..." ],
  "improvement": "una sugerencia accionable y concreta"
}

- "ai_analysis": UN string por cada eje de análisis listado arriba, en ese mismo orden.
- "improvement": LA mejora de mayor impacto para el próximo reel, específica y en su voz (no genérica).
Respondé en español rioplatense.`,
  ]);
}

/* --------------------------------------------------------------------------
 * Prompt 3 — adaptación de virales (/api/inspiration/adapt)
 * ------------------------------------------------------------------------ */

export function composeAdaptSystemPrompt(blocks: Blocks): string {
  // `etapa` sale del bloque de embudo: si el usuario lo apagó, el campo pasa a
  // ser opcional en vez de forzar una etiqueta que ya no usa.
  const clasifica = blocks.embudo.trim();

  return assemble([
    'Estás en MODO ADAPTACIÓN. Te paso un reel viral de OTRO creador y hacés "la versión de Tony" de ESE MISMO video. NO estás escribiendo un anuncio de sus servicios: estás recreando el video que funcionó, con su voz.',
    block(blocks, 'adaptacion'),
    block(blocks, 'voz'),
    block(blocks, 'pilares'),
    block(blocks, 'embudo'),
    block(blocks, 'principios'),
    block(blocks, 'estructura'),
    block(blocks, 'cta'),
    block(blocks, 'reglas'),
    // Contrato JSON: cableado. La app parsea esto.
    `## FORMATO DE SALIDA (obligatorio)
Respondé ÚNICAMENTE con un objeto JSON válido (sin texto antes/después, sin markdown) con esta forma exacta:
{
  "tema_del_viral": "El tema concreto detectado en la transcripción, en pocas palabras (ej: 'automatizar envío de PDFs con Claude Code')",
  "mecanica": "El tipo de contenido y por qué funcionó (ej: 'demo en pantalla mostrando la herramienta resolviendo un problema real, paso a paso')",
  "mantiene_tema": true,
  "por_que_viralizo": "2-3 oraciones sobre la mecánica real del viral",
  "aplicabilidad": "Alta" | "Media" | "Baja",
  "etapa_funnel": ${clasifica
    ? '"La etiqueta que corresponda según el bloque \'A QUIÉN APUNTA CADA PIEZA\' de arriba, usando SUS palabras exactas"'
    : '""'},
  "gancho_visual": "Qué se ve en el primer frame (texto en pantalla, qué se muestra, acción) — coherente con la mecánica",
  "hook": "Hook LITERAL listo para grabar, que nace del TEMA del viral (sin presentarse)",
  "angulo": "El giro propio de Tony sobre el MISMO tema/mecánica (1-2 oraciones)",
  "formato": "El MISMO tipo de formato que el original (ej: 'Demo de pantalla, 45-60s') y duración",
  "guion": "GUION COMPLETO listo para grabar, en la voz de Tony, con la MISMA mecánica y tema del viral. 100-180 palabras."
}

"mantiene_tema" debe ser true salvo que el tema del viral realmente no tenga nada que ver con los pilares; en ese caso ponelo en false y explicá el traslado en "angulo".${
      clasifica ? '' : '\n"etapa_funnel" debe ir vacío: esta cuenta no clasifica por etapa de embudo.'
    }`,
  ]);
}
