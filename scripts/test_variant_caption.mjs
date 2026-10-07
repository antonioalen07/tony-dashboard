import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueVariantWithCaption, parseVariantCaption, persistVariantCaption, storedVariantCaption } from '../src/lib/variant-caption.ts';

function memoryDb({ missingCaption = false, queues = [] } = {}) {
  const tables = { video_variants: [{ id: 'variant', params: { saturation: 1, text: { text: 'Título quemado' } } }], publish_queue: structuredClone(queues) };
  const writes = [];
  return {
    tables, writes,
    from(table) {
      let mode = 'read', value, selected = '', max = Infinity, cached;
      const filters = [];
      const run = () => {
        if (cached) return cached;
        if (missingCaption && table === 'publish_queue' && (selected.includes('caption') || value && 'caption' in value)) {
          return cached = { data: null, error: { code: 'PGRST204', message: "Could not find the 'caption' column in the schema cache" } };
        }
        let rows = tables[table].filter((row) => filters.every((filter) => filter(row)));
        if (mode === 'update') {
          writes.push({ table, mode, value: structuredClone(value), ids: rows.map((row) => row.id) });
          rows.forEach((row) => Object.assign(row, structuredClone(value)));
        }
        if (mode === 'insert') {
          const inserted = { id: `queue-${tables[table].length}`, ...structuredClone(value) };
          writes.push({ table, mode, value: structuredClone(value) });
          tables[table].push(inserted); rows = [inserted];
        }
        return cached = { data: rows.slice(0, max), error: null };
      };
      const query = {
        select(columns) { selected = columns; return query; },
        eq(key, expected) { filters.push((row) => row[key] === expected); return query; },
        limit(count) { max = count; return query; },
        update(fields) { mode = 'update'; value = fields; return query; },
        insert(fields) { mode = 'insert'; value = fields; return query; },
        async maybeSingle() { const response = run(); return { ...response, data: response.data?.[0] || null }; },
        async single() { return query.maybeSingle(); },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return query;
    },
  };
}

test('descripción escrita pasa a params y a la cola sin sustituirse por el título quemado', async () => {
  const db = memoryDb();
  const result = await enqueueVariantWithCaption(db, 'variant', ' Descripción editada\n#bako ');
  assert.equal(result.queued.caption, 'Descripción editada\n#bako');
  assert.equal(db.tables.video_variants[0].params.caption, result.queued.caption);
  assert.equal(db.tables.video_variants[0].params.text.text, 'Título quemado');
  assert.equal(result.queued.kind, 'trial_reel');
});
test('descripción vacía explícita queda vacía y no toma el título del video', async () => {
  const db = memoryDb();
  await enqueueVariantWithCaption(db, 'variant', '');
  assert.equal(db.tables.publish_queue[0].caption, '');
  assert.equal(storedVariantCaption(db.tables.video_variants[0].params), '');
  assert.equal(storedVariantCaption({ text: { text: 'Título' } }), null);
  assert.throws(() => parseVariantCaption(null), /texto/);
  assert.throws(() => parseVariantCaption('x'.repeat(2201)), /2200/);
});
test('columna caption ausente detiene el enqueue sin fallback ni ninguna escritura', async () => {
  const db = memoryDb({ missingCaption: true });
  await assert.rejects(enqueueVariantWithCaption(db, 'variant', 'No perder este texto'), (error) => error.status === 428 && error.migrationNeeded);
  assert.equal(db.tables.publish_queue.length, 0);
  assert.equal(db.writes.length, 0);
});
test('guardar una descripción nueva modifica sólo la publicación pendiente', async () => {
  const db = memoryDb({ queues: [
    { id: 'pending', variant_id: 'variant', status: 'pending', caption: 'Antes' },
    { id: 'publishing', variant_id: 'variant', status: 'publishing', caption: 'En proceso' },
    { id: 'published', variant_id: 'variant', status: 'published', caption: 'Publicada' },
  ] });
  await persistVariantCaption(db, 'variant', 'Después');
  assert.deepEqual(db.tables.publish_queue.map((queue) => queue.caption), ['Después', 'En proceso', 'Publicada']);
  assert.equal(db.tables.video_variants[0].params.caption, 'Después');
});
test('reenviar variante pendiente actualiza el snapshot sin crear otra publicación', async () => {
  const db = memoryDb({ queues: [{ id: 'pending', variant_id: 'variant', status: 'pending', caption: 'Anterior' }] });
  const result = await enqueueVariantWithCaption(db, 'variant', 'Actual');
  assert.equal(result.alreadyQueued, true);
  assert.equal(db.tables.publish_queue.length, 1);
  assert.equal(result.queued.caption, 'Actual');
});
