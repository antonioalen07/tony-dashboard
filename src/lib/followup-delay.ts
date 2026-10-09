export const MAX_FOLLOWUP_DELAY_MINUTES = 525600;
export const FOLLOWUP_DELAY_UNITS = {
    minutes: { label: 'Minutos', singular: 'minuto', factor: 1 },
    hours: { label: 'Horas', singular: 'hora', factor: 60 },
    days: { label: 'Días', singular: 'día', factor: 1440 },
    weeks: { label: 'Semanas', singular: 'semana', factor: 10080 },
} as const;
export type FollowupDelayUnit = keyof typeof FOLLOWUP_DELAY_UNITS;

/** No redondear una secuencia existente al cambiar cómo se muestra su demora. */
export function followupDelayInput(minutes: number): { value: string; unit: FollowupDelayUnit } {
    if (minutes > 0) {
        for (const unit of ['weeks', 'days', 'hours'] as const) {
            const factor = FOLLOWUP_DELAY_UNITS[unit].factor;
            if (Number.isInteger(minutes / factor)) return { value: String(minutes / factor), unit };
        }
    }
    return { value: String(minutes), unit: 'minutes' };
}

export function followupDelayMinutes(value: string, unit: FollowupDelayUnit): number | null {
    if (!/^\d+$/.test(value.trim())) return null;
    const amount = Number(value);
    const minutes = amount * FOLLOWUP_DELAY_UNITS[unit].factor;
    return Number.isSafeInteger(minutes) && minutes >= 0 && minutes <= MAX_FOLLOWUP_DELAY_MINUTES ? minutes : null;
}

export function followupDelayMaximum(unit: FollowupDelayUnit): number {
    return Math.floor(MAX_FOLLOWUP_DELAY_MINUTES / FOLLOWUP_DELAY_UNITS[unit].factor);
}

export function formatFollowupDelay(minutes: number): string {
    const input = followupDelayInput(minutes);
    const label = Number(input.value) === 1 ? FOLLOWUP_DELAY_UNITS[input.unit].singular : FOLLOWUP_DELAY_UNITS[input.unit].label.toLocaleLowerCase('es-AR');
    return `${input.value} ${label}`;
}
