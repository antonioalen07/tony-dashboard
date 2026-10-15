/** Lado largo máximo: Instagram muestra los adjuntos a ~1080 px; 1920 deja margen sin pesar de más. */
const MAX_SIDE = 1920;
const MAX_BYTES = 8_000_000;

/**
 * Deja la imagen lista para Instagram (PNG, JPEG o GIF de hasta 8 MB).
 * Los GIF se mandan tal cual para no perder la animación; el resto (incluidas
 * WEBP y, en Safari, HEIC) se reduce y se convierte a JPEG.
 */
export async function prepareImageFile(file: File): Promise<File> {
    if (!file.size) throw new Error('La imagen está vacía.');
    const type = file.type.split(';')[0].toLowerCase();
    if (type === 'image/gif') {
        if (file.size > MAX_BYTES) throw new Error('El GIF debe pesar hasta 8 MB.');
        return file;
    }
    if (type && !type.startsWith('image/')) throw new Error('Elegí una imagen JPG, PNG, GIF o WEBP.');
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error('Este navegador no puede abrir esa imagen. Probá con un JPG o PNG.'); }
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo preparar la imagen.');
    // Fondo blanco: un PNG con transparencia no queda negro al pasar a JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.88, 0.75, 0.6]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= MAX_BYTES) return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    }
    throw new Error('La imagen sigue pesando más de 8 MB. Probá con una más chica.');
}

/** Sube una imagen ya preparada y devuelve su URL pública. */
export async function uploadImageFile(file: File, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.set('file', file);
    const response = await fetch('/api/automations/inbox/image', { method: 'POST', body: form, signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo subir la imagen. Volvé a intentar.');
    if (typeof data.url !== 'string' || !data.url.startsWith('https://')) throw new Error('No se recibió el enlace de la imagen. Volvé a intentar.');
    return data.url;
}
