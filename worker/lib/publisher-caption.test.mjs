import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainerPayload, run } from '../jobs/publisher.mjs';

const videoUrl = 'https://example.com/variant.mp4';

test('publisher: el caption del calendario conserva saltos, hashtags y texto de automatización', () => {
    const caption = 'Primera línea 📩\n\nComentá "GUÍA" y te la mando por DM\n#negocios #b2b';
    const payload = buildContainerPayload({ kind: 'reel', caption: `  ${caption}\n ` }, videoUrl);
    assert.deepEqual(payload, { media_type: 'REELS', video_url: videoUrl, caption });
    const long = buildContainerPayload({ kind: 'trial_reel', caption: 'a'.repeat(2250) }, videoUrl);
    assert.equal(long.caption, 'a'.repeat(2200));
    assert.deepEqual(long.trial_params, { graduation_strategy: 'MANUAL' });
});

test('publisher: null o vacío significa sin caption y nunca incorpora títulos ni textos de la variante', () => {
    for (const caption of [null, '', '  \n  ']) {
        const payload = buildContainerPayload({ kind: 'reel', caption, title: 'Título interno', params: { caption: 'Caption ajeno', text: { text: 'Texto quemado en video' } } }, videoUrl);
        assert.deepEqual(payload, { media_type: 'REELS', video_url: videoUrl });
    }
    const payload = buildContainerPayload({ kind: 'trial_reel', caption: null, title: 'Sin caption' }, videoUrl);
    assert.equal(Object.hasOwn(payload, 'caption'), false);
    assert.deepEqual(payload.trial_params, { graduation_strategy: 'MANUAL' });
});

test('publisher: un esquema sin columna caption falla en lugar de publicar silenciosamente sin texto', () => {
    assert.throws(() => buildContainerPayload({ kind: 'reel', params: { caption: 'No es el caption del calendario' } }, videoUrl), /publish_queue\.caption.*supabase_migration_ai_config\.sql/);
});

function queueDatabase(freshCaption, { captionColumn = true } = {}) {
    const queue = { id: 'queue', variant_id: 'variant', kind: 'trial_reel', scheduled_at: '2020-01-01T00:00:00Z', status: 'pending', ...(captionColumn ? { caption: 'Caption leído antes del reclamo' } : {}) };
    const tables = {
        publish_queue: [queue],
        video_variants: [{ id: 'variant', asset_id: 'asset', params: { caption: 'Caption de params que no se debe usar', text: { text: 'Título quemado en el video' } } }],
        media_assets: [{ id: 'asset', public_url: videoUrl, storage_path: 'variants/job/0.mp4' }],
    };
    const db = {
        from(table) {
            const filters = [];
            let fields, columns = '*', operation = 'read';
            const query = {
                select(value = '*') { columns = value; return query; },
                eq(key, value) { filters.push((row) => row[key] === value); return query; },
                lte(key, value) { filters.push((row) => row[key] <= value); return query; },
                order() { return query; },
                update(value) { fields = value; operation = 'update'; return query; },
                single: () => query.then((result) => ({ data: result.data[0], error: result.error })),
                then(resolve) {
                    if (operation === 'update' && fields.status === 'publishing' && captionColumn) queue.caption = freshCaption;
                    const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
                    if (operation === 'update') rows.forEach((row) => Object.assign(row, fields));
                    // Copias y proyección imitan a PostgREST: el SELECT inicial no
                    // cambia cuando otro cliente edita la fila antes del reclamo.
                    const data = rows.map((row) => columns === '*' ? structuredClone(row) : Object.fromEntries(columns.split(',').map((column) => [column.trim(), row[column.trim()]])));
                    return Promise.resolve({ data, error: null }).then(resolve);
                },
            };
            return query;
        },
    };
    return { db, queue };
}

test('publisher: el dry-run toma el caption fresco confirmado al reclamar la cola, sin solicitudes a Meta', async () => {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('Esta prueba no permite requests de red'); };
    try {
        for (const caption of ['Caption editado antes de publicar\n#actual', null, '']) {
            const { db, queue } = queueDatabase(caption);
            const logs = [];
            await run({ supabase: db, env: { PUBLISH_DRY_RUN: 'true' }, log: (message) => logs.push(message) });
            const logged = logs.find((message) => message.includes('→ payload '));
            assert.ok(logged, 'se registra el payload exacto en modo simulado');
            const payload = JSON.parse(logged.split('→ payload ')[1]);
            if (caption) assert.equal(payload.caption, caption);
            else assert.equal(Object.hasOwn(payload, 'caption'), false, 'borrar el caption después de leer la cola también se respeta');
            assert.equal(queue.status, 'published');
            assert.match(queue.ig_media_id, /^DRYRUN-/);
            assert.equal(queue.caption, caption);
        }
        const { db, queue } = queueDatabase(null, { captionColumn: false });
        await run({ supabase: db, env: { PUBLISH_DRY_RUN: 'true' }, log: () => {} });
        assert.equal(queue.status, 'failed');
        assert.match(queue.error, /publish_queue\.caption/);
        assert.equal(requests, 0);
    } finally { globalThis.fetch = originalFetch; }
});
