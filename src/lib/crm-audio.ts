const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 120;

const FILE_TYPES: Record<string, string> = {
    mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
    m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac',
};

/** MP3 y OGG se convierten a WAV para entregar un adjunto compatible con Instagram. */
export async function prepareAudioFile(file: File): Promise<File> {
    if (!file.size) throw new Error('El archivo de audio está vacío.');
    if (file.size > 4_000_000) throw new Error('El audio debe pesar hasta 4 MB.');
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const mime = file.type.split(';')[0].toLowerCase();
    const inferred = FILE_TYPES[extension];
    const type = mime === '' || mime === 'application/octet-stream' ? inferred : mime;
    if (!type || !['audio/mpeg', 'audio/mp3', 'audio/ogg', 'application/ogg', 'audio/opus', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav'].includes(type)) {
        throw new Error('Elegí un audio MP3, OGG, M4A, WAV o AAC.');
    }
    if (['audio/mpeg', 'audio/mp3', 'audio/ogg', 'application/ogg', 'audio/opus'].includes(type)) {
        return recordedAudioWav(file);
    }
    return file.type === type ? file : new File([file], file.name, { type });
}

/** WAV PCM mono de 16 bits; 120 s a 16 kHz ocupan menos de 4 MB. */
export function pcmWav(samples: Float32Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
    if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) throw new Error('Frecuencia de audio inválida.');
    if (!samples.length || samples.length > sampleRate * MAX_SECONDS) throw new Error('El audio debe durar entre 1 muestra y 2 minutos.');
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const label = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    label(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); label(8, 'WAVE');
    label(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    label(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const sample = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0;
        view.setInt16(44 + i * 2, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
    }
    return buffer;
}

/** Convierte la grabación del navegador a un formato de audio reproducible por Meta. */
export async function recordedAudioWav(blob: Blob): Promise<File> {
    if (typeof AudioContext === 'undefined' || typeof OfflineAudioContext === 'undefined') throw new Error('Este navegador no puede preparar este audio. Probá un archivo WAV, M4A o AAC.');
    const context = new AudioContext();
    try {
        let decoded: AudioBuffer;
        try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
        catch { throw new Error('No se pudo leer el audio. Probá un archivo MP3, OGG, WAV o M4A válido.'); }
        if (!decoded.duration || decoded.duration > MAX_SECONDS + 0.5) throw new Error('La grabación debe durar hasta 2 minutos.');
        const length = Math.min(SAMPLE_RATE * MAX_SECONDS, Math.ceil(decoded.duration * SAMPLE_RATE));
        const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
        const source = offline.createBufferSource();
        source.buffer = decoded; source.connect(offline.destination); source.start();
        const rendered = await offline.startRendering();
        return new File([pcmWav(rendered.getChannelData(0))], `audio-${Date.now()}.wav`, { type: 'audio/wav' });
    } finally { await context.close().catch(() => {}); }
}
