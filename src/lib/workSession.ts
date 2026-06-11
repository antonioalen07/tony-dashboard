/**
 * Caché de sesión de trabajo (sessionStorage): sobrevive a la navegación entre
 * secciones y a recargas dentro de la misma pestaña, sin persistir en DB.
 * Evita re-buscar referentes o regenerar guiones (= gastar APIs) al saltar
 * de Inspiración al Chat y volver.
 */

const PREFIX = 'crevy:ws:';

export function loadWork<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveWork(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // cuota llena o storage bloqueado: la caché es best-effort, no rompemos nada
  }
}

export function clearWork(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {}
}
