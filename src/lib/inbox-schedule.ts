const MAX_DELAY_MS = 365 * 24 * 60 * 60_000;

/** UTC del envío; los datetime-local se convierten a ISO en el navegador. */
export function scheduledSendAt(value: unknown, now = Date.now()): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
        throw new Error('Elegí una fecha y hora válidas para programar el mensaje.');
    }
    const when = Date.parse(value);
    if (!Number.isFinite(when) || when <= now) throw new Error('La fecha programada debe estar en el futuro.');
    if (when - now > MAX_DELAY_MS) throw new Error('Podés programar un mensaje hasta un año por adelantado.');
    return new Date(when).toISOString();
}

export function localDateTime(value: number): string {
    const date = new Date(value);
    const part = (number: number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}
