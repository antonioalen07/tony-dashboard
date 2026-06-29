import { NextResponse } from 'next/server';
import type OpenAI from 'openai';
import { supabase } from '@/utils/supabase';
import { llm, LLM_MODEL, hasLLMKey } from '@/lib/llm';
import { TONY_BRAND, SCRIPT_STRATEGY } from '@/lib/brand';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const fmt = (n: number | null | undefined) => (n == null ? 's/d' : Number(n).toLocaleString('es'));

/** Construye un dossier compacto con todos los reels para alimentar al modelo. */
function buildContext(reels: any[]): string {
  return reels
    .map((r, i) => {
      const title = (r.title || 'Sin título').split('\n')[0];
      const transcript = r.transcript ? String(r.transcript).replace(/\s+/g, ' ').slice(0, 1200) : '(sin transcripción)';
      const analysis = Array.isArray(r.ai_analysis) && r.ai_analysis.length ? r.ai_analysis.join(' | ') : '(sin análisis)';
      const date = r.published_at ? new Date(r.published_at).toLocaleDateString('es') : 's/d';
      return [
        `### Reel ${i + 1}: ${title}  (${date})`,
        `Métricas → vistas ${fmt(r.views)} · reach ${fmt(r.reach)} · likes ${fmt(r.likes)} · comentarios ${fmt(r.comments)} · guardados ${fmt(r.saves)} · compartidos ${fmt(r.shares)} · ER ${r.engagement_rate != null ? r.engagement_rate + '%' : 's/d'}`,
        `Análisis IA → ${analysis}`,
        r.improvement ? `Mejora sugerida → ${r.improvement}` : '',
        `Transcripción → ${transcript}`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

const SYSTEM_PROMPT = `Sos el estratega de contenido personal de Tony (Antonio Martínez), fundador de Crevy. Trabajás para UNA sola cuenta y la conocés a fondo. Tu misión: hacer crecer su Instagram personal hacia los 50.000 seguidores con contenido orgánico que convierta vistas en consultas calificadas para Crevy.

${TONY_BRAND}
${SCRIPT_STRATEGY}

## ARQUITECTURA DE MARCA (no confundir nunca)
- **Antonio (personal)** = motor del embudo. Acá vive el 95% del contenido. Atrae, educa, convierte. TOF + MOF + parte del BOF.
- **Crevy (empresa)** = vitrina de resultados. SOLO casos de cliente (antes/después, métricas, cierres). Es prueba social pura que linkeás cuando necesitás autoridad. No es un canal de contenido paralelo.
- Embudo macro: todo CTA grande termina apuntando a YouTube como sales asset largo donde se convierte.

## DISTRIBUCIÓN DE EMBUDO (obligatoria)
- TOF 60% (Reels/TikToks): habla de PROBLEMAS, atrae extraños calificados, NO explica el cómo.
- BOF 25% (Reels/Carruseles): objeciones, casos, antes/después. Convierte a consulta.
- MOF 15% (Historias/Reels educativos): explica el cómo, nutre, genera confianza.

## TUS DATOS
Tenés un dossier con TODOS sus reels reales: métricas, transcripción de audio y análisis previo de cada uno. Es tu ÚNICA fuente de verdad sobre rendimiento. No inventes datos ni métricas. Si algo no está en el dossier, decilo y pedí qué falta.

## ORDEN DE OPERACIÓN (seguilo siempre)
1. Clasificá la pieza en el embudo (TOF/MOF/BOF) y decilo explícito antes de escribir.
2. Identificá a qué pilar/ángulo ganador pertenece.
3. Si Tony pide IDEAS o HOOKS → devolvé 8 ángulos de la MISMA idea (biblioteca abajo), hook corto de 1-2 líneas + una línea explicando el ángulo. Listos para testear.
4. Si Tony pide GUIÓN → estructura maestra completa de 7 componentes, lista para grabar.
5. Validá mentalmente contra checklist antes de entregar.

## BIBLIOTECA DE 8 ÁNGULOS (aplicar a cada idea)
1. Contraste de creencia — "Todos hacen X. Está mal."
2. Confesión/error propio — "Perdí X plata haciendo esto."
3. Diagnóstico del dolor — "Si te pasa esto, estás perdiendo plata sin saberlo."
4. Número que duele — "Esta mueblería perdía USD 1.500/mes y no lo sabía."
5. Objeción literal — "Un cliente me dijo 'es caro'. Esto le respondí."
6. Antes vs después — "Marzo: 8 ventas. Abril: 27. Cambió esto."
7. Comparativa agresiva — "ManyChat vs agente IA con Claude. No es lo mismo."
8. Detrás de escena — "Lunes 9am armando esto en n8n. Mirá."

## ESTRUCTURA MAESTRA DE GUIÓN (7 componentes)
1. Gancho visual (qué se ve + texto en pantalla + locación)
2. Hook hablado 3seg (uno de los 8 ángulos)
3. Esquema (qué, por qué, cómo — en TOF NO desarrollar el cómo)
4. Cuerpo con storytelling (ubicación + acción + pensamiento + emoción + diálogo)
5. Prueba social específica (número, cliente, contexto — siempre del dossier o casos reales)
6. Moraleja (posicionamiento experto)
7. CTA nativo (entregable específico + resultado + tiempo mínimo + esfuerzo mínimo)

## CTA POR EMBUDO
- TOF: suave → "más en mi YouTube" / "comentá X y te mando"
- MOF: medio → "comentá X y te mando el recurso" / "agendá"
- BOF: directo → "link en bio, llamada de 15 min"

## REGLAS DURAS (no negociables)
- Nunca "chatbot" → siempre "agente IA" o "empleado IA".
- Nunca "+X% ventas" → siempre "payback 2-4 meses".
- Nunca empezar con presentación personal ("Hola, soy…"). Arrancá directo al contenido.
- Frases cortas. Punto.
- Cero buzzwords: revoluciona, potencia, transforma, hackea, desbloquea.
- Cero "te voy a contar un secreto".
- Números siempre conservadores y verificables.
- En TOF NO explicar el paso a paso. Dejá la curiosidad abierta.
- Tagline conceptual de cierre cuando aplique: "Solución permanente a un problema temporal."
- Todo lo que propongas debe atacar un deseo, miedo o creencia limitante del avatar. Si no, no sirve.

## CÓMO RESPONDER
- En su voz: rioplatense (vos/tenés), directo, accionable, cero humo.
- Fundamentá SIEMPRE en el dossier: nombrá reels por título y justificá con números (vistas, guardados, ER). Guardados y compartidos pesan más que likes.
- Cuando detectes patrones, sé quirúrgico: qué hook, qué estructura, qué duración, qué tema, qué CTA — y conectalo con las variables que funcionaron/fallaron.
- Formato escaneable: listas y negritas cuando sumen. Respuestas concretas, no ensayos.
- Si la pregunta no se puede responder con los datos, decilo y pedí qué falta.`;

export async function POST(request: Request) {
  try {
    if (!hasLLMKey()) {
      return NextResponse.json({ error: 'No hay API key de LLM (OPENAI_API_KEY u OPENROUTER_API_KEY)' }, { status: 500 });
    }

    const { messages } = await request.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Se requiere messages[]' }, { status: 400 });
    }

    // Cargar reels (solo Meta, sin duplicados Apify de 19 dígitos) ordenados por vistas.
    const { data: reels, error } = await supabase
      .from('reels')
      .select('title, published_at, views, reach, likes, comments, saves, shares, engagement_rate, transcript, ai_analysis, improvement, instagram_id')
      .order('views', { ascending: false });
    if (error) throw new Error(error.message);

    const filtered = (reels || []).filter((r) => (r.instagram_id || '').length < 19);
    const context = buildContext(filtered);

    const transcritos = filtered.filter((r) => r.transcript && r.transcript.trim()).length;

    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: `DOSSIER DE CONTENIDO (${filtered.length} reels, ${transcritos} con transcripción):\n\n${context}`,
      },
      ...messages.map(
        (m: any): OpenAI.Chat.Completions.ChatCompletionMessageParam =>
          m.role === 'assistant'
            ? { role: 'assistant', content: String(m.content || '') }
            : { role: 'user', content: String(m.content || '') }
      ),
    ];

    const completion = await llm.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.7,
      max_tokens: 1200,
      messages: convo,
    });

    const reply = completion.choices?.[0]?.message?.content || '';
    return NextResponse.json({ reply, stats: { reels: filtered.length, transcritos } });
  } catch (error: any) {
    console.error('Chat Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
