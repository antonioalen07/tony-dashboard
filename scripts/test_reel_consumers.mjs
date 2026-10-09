import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as curation from '../src/lib/reel-curation.ts';
import * as chatContext from '../src/lib/chat-context.ts';

// Se ejecutan módulos y callbacks reales, extraídos con TypeScript/AST. Los
// mocks sólo reemplazan IO: no hay DB, Apify, STT ni llamadas al modelo, y no
// se copia una implementación que pueda divergir de la usada en la app.
function moduleExports(path, dependencies) {
    const exported = {};
    const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('exports', 'require', code)(exported, (name) => {
        assert.ok(name in dependencies, `Dependencia mock declarada: ${name}`);
        return dependencies[name];
    });
    return exported;
}
const { selectOwnReelExamples } = moduleExports('../src/lib/reel-examples.ts', {
    '@/lib/reel-curation': curation,
    '@/lib/chat-context': chatContext,
});

function uiCallback(path, name, variables) {
    const raw = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    const source = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let expression;
    function walk(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && ts.isCallExpression(node.initializer)) {
            expression = node.initializer.arguments[0];
        }
        ts.forEachChild(node, walk);
    }
    walk(source);
    assert.ok(expression, `Callback real ${name}`);
    const code = ts.transpileModule(`const callback = ${expression.getText(source)};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    return new Function(...Object.keys(variables), `${code}\nreturn callback;`)(...Object.values(variables));
}

test('ejemplos filtran ocultos, repetidos y suprimidos antes del cupo y deduplican la narración completa', () => {
    const hidden = Array.from({ length: 7 }, (_, i) => ({ id: `hidden-${i}`, transcript: `oculto ${i}`, is_hidden: true }));
    const source = [...hidden,
        { id: 'duplicate', transcript: 'duplicado', is_duplicate: true },
        { id: 'suppressed', transcript: 'suprimido', transcript_suppressed: true },
        { id: 'empty', transcript: ' \n ' },
        { id: 'original', transcript: '  Hola\nMUNDO １.' },
        { id: 'same', transcript: 'hola mundo 1.' },
        { id: 'different', transcript: 'Hola mundo 2.' },
        { id: 'punctuation', transcript: 'Hola mundo 1!' },
        { id: 'four', transcript: 'Otro ejemplo' },
        { id: 'five', transcript: 'El quinto' },
        { id: 'six', transcript: 'El sexto' },
    ];
    assert.deepEqual(selectOwnReelExamples(source).map((r) => r.id), ['original', 'different', 'punctuation', 'four', 'five']);
    assert.equal(source.length, 17, 'la selección conserva todas las publicaciones originales');
});

test('TopContentList oculta sólo la lista y conserva las métricas del array compartido', () => {
    const reels = [
        { id: 'hidden', is_hidden: true, views: 9000 },
        { id: 'duplicate', is_duplicate: true, views: 8000 },
        { id: 'suppressed', transcript_suppressed: true, views: 7 },
        ...Array.from({ length: 4 }, (_, i) => ({ id: `visible-${i}`, views: i + 1 })),
    ];
    const snapshot = structuredClone(reels);
    const select = uiCallback('../src/components/TopContentList.tsx', 'topReels', { controlled: true, reels, fetched: [], isActiveReel: curation.isActiveReel });
    assert.deepEqual(select().map((r) => r.id), ['suppressed', 'visible-3', 'visible-2', 'visible-1']);
    assert.deepEqual(reels, snapshot);
    assert.equal(reels.reduce((sum, r) => sum + r.views, 0), 17017);
});

test('selector de variantes conserva disponibles aunque los primeros 60 estén ocultos', async () => {
    const rows = [
        ...Array.from({ length: 65 }, (_, i) => ({ id: `hidden-${i}`, is_hidden: true })),
        { id: 'duplicate', is_duplicate: true },
        { id: 'legacy', title: 'Sin marcas nuevas' },
        { id: 'suppressed', transcript_suppressed: true },
    ];
    const calls = [];
    const query = { then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); } };
    for (const method of ['select', 'not', 'order', 'limit']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
    let selected, loaded;
    const load = uiCallback('../src/app/variantes/page.tsx', 'loadReels', {
        supabase: { from(table) { assert.equal(table, 'reels'); return query; } },
        setLoadingReels() {}, setReels(value) { selected = value; }, setReelsLoaded(value) { loaded = value; },
        isActiveReel: curation.isActiveReel, toast() { assert.fail('No hubo error de lectura'); },
    });
    await load();
    assert.deepEqual(selected.map((r) => r.id), ['legacy', 'suppressed']);
    assert.equal(loaded, true);
    assert.deepEqual(calls.find((call) => call[0] === 'select'), ['select', '*']);
    assert.equal(calls.some((call) => call[0] === 'limit'), false);
});

function importRoute(reel) {
    let imports = 0;
    const calls = [];
    const query = { single: async () => ({ data: reel, error: null }) };
    for (const method of ['select', 'eq']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
    const route = moduleExports('../src/app/api/assets/from-reel/route.ts', {
        'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
        '@/utils/supabase': { supabase: { from: () => query } },
        '@/lib/reel-curation': curation,
        '@/lib/importVideo': { ImportError: class extends Error {}, importVideoFromUrl: async () => { imports++; return { id: 'asset' }; } },
    });
    return { route, calls, imports: () => imports };
}

test('from-reel rechaza ocultos/repetidos antes de importar y generar gastos', async () => {
    for (const flags of [{ is_hidden: true }, { is_duplicate: true }]) {
        const fixture = importRoute({ id: 'reel', title: 'Ejemplo', video_url: 'https://www.instagram.com/reel/example/', ...flags });
        const result = await fixture.route.POST({ json: async () => ({ reelId: 'reel' }) });
        assert.equal(result.status, 409);
        assert.match(result.body.error, /oculto|duplicado/);
        assert.equal(fixture.imports(), 0);
    }
});

test('from-reel permanece compatible con filas sin migración y con sólo STT desactivado', async () => {
    for (const flags of [{}, { transcript_suppressed: true }]) {
        const fixture = importRoute({ id: 'reel', title: 'Ejemplo', video_url: 'https://www.instagram.com/reel/example/', ...flags });
        const result = await fixture.route.POST({ json: async () => ({ reelId: 'reel' }) });
        assert.equal(result.status, 200);
        assert.equal(fixture.imports(), 1);
        assert.deepEqual(fixture.calls.find((call) => call[0] === 'select'), ['select', '*']);
    }
});
