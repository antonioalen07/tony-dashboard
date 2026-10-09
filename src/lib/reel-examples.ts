import { canEnrichReel } from '@/lib/reel-curation';
import { normalizeTranscript } from '@/lib/chat-context';

type OwnReelExample = {
    transcript?: string | null;
    is_hidden?: boolean;
    is_duplicate?: boolean;
    transcript_suppressed?: boolean;
};

/** El orden recibido conserva prioridad por vistas; cada narración aporta un ejemplo. */
export function selectOwnReelExamples<T extends OwnReelExample>(rows: T[], limit = 5): T[] {
    const seen = new Set<string>();
    return rows.filter((reel) => {
        if (!canEnrichReel(reel)) return false;
        const transcript = normalizeTranscript(reel.transcript);
        if (!transcript || seen.has(transcript)) return false;
        seen.add(transcript);
        return true;
    }).slice(0, limit);
}
