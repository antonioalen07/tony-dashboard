import OpenAI from 'openai';

/**
 * Cliente LLM centralizado, agnóstico de proveedor.
 *
 * - Si existe OPENAI_API_KEY  -> usa OpenAI directo (ChatGPT, modelo gpt-4o-mini).
 * - Si no, y existe OPENROUTER_API_KEY -> usa OpenRouter (claude-3.5-haiku).
 *
 * Para cambiar de proveedor NO hay que tocar código: basta con setear la env var
 * correspondiente (local en .env.local y en Vercel). Se puede forzar el modelo
 * con LLM_MODEL.
 */
const useOpenAI = !!process.env.OPENAI_API_KEY;

export const llm = new OpenAI(
  useOpenAI
    ? { apiKey: process.env.OPENAI_API_KEY || 'placeholder' }
    : {
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY || 'placeholder',
        defaultHeaders: {
          'HTTP-Referer': 'https://crevy.content',
          'X-Title': 'Crevy Content',
        },
      }
);

export const LLM_MODEL =
  process.env.LLM_MODEL || (useOpenAI ? 'gpt-4o-mini' : 'anthropic/claude-3.5-haiku');

export const LLM_PROVIDER = useOpenAI ? 'openai' : 'openrouter';

/** ¿Hay alguna credencial de LLM configurada? */
export const hasLLMKey = () =>
  Boolean(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY);
