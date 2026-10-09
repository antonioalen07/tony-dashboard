import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmWav, prepareAudioFile } from '../src/lib/crm-audio.ts';

test('WAV incluye encabezado mono PCM, frecuencia, longitud y amplitudes sin desbordar', () => {
  const file = pcmWav(new Float32Array([-2, -1, 0, 1, 2, Number.NaN]));
  const bytes = new Uint8Array(file);
  const view = new DataView(file);
  const ascii = (start, end) => new TextDecoder().decode(bytes.slice(start, end));
  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 12), 'WAVE');
  assert.equal(ascii(12, 16), 'fmt ');
  assert.equal(ascii(36, 40), 'data');
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(4, true), file.byteLength - 8);
  assert.equal(view.getUint32(40, true), 12);
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => view.getInt16(44 + index * 2, true)), [-32768, -32768, 0, 32767, 32767, 0]);
});
test('dos minutos de audio están bajo el límite de upload y rechaza mayor duración', () => {
  assert.ok(pcmWav(new Float32Array(16000 * 120)).byteLength < 4_000_000);
  assert.throws(() => pcmWav(new Float32Array(16000 * 120 + 1)), /2 minutos/);
  assert.throws(() => pcmWav(new Float32Array()), /2 minutos/);
  assert.throws(() => pcmWav(new Float32Array(10), 1), /Frecuencia/);
});

test('archivos de tipo vacío se normalizan por extensión y archivos inválidos se rechazan', async () => {
  const wav = new File([pcmWav(new Float32Array([0, 0.5]))], 'grabacion.WAV');
  const prepared = await prepareAudioFile(wav);
  assert.equal(prepared.type, 'audio/wav');
  assert.equal(prepared.size, wav.size);
  await assert.rejects(prepareAudioFile(new File([], 'empty.wav')), /vacío/);
  await assert.rejects(prepareAudioFile(new File([new Uint8Array(4_000_001)], 'big.wav', { type: 'audio/wav' })), /4 MB/);
  await assert.rejects(prepareAudioFile(new File(['invalid'], 'fake.txt', { type: 'text/plain' })), /MP3, OGG/);
});

test('MP3 y OGG usan decodificación local y salen como WAV compatible, liberando AudioContext', async () => {
  const original = { AudioContext: globalThis.AudioContext, OfflineAudioContext: globalThis.OfflineAudioContext };
  let closed = 0; let decoded = 0;
  globalThis.AudioContext = class {
    async decodeAudioData() { decoded++; return { duration: 0.1 }; }
    async close() { closed++; }
  };
  globalThis.OfflineAudioContext = class {
    createBufferSource() { return { connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array([0.1, -0.1]) }; }
  };
  try {
    for (const [name, type] of [['audio.mp3', 'audio/mpeg'], ['audio.ogg', 'audio/ogg'], ['audio.ogg', 'application/ogg']]) {
      const prepared = await prepareAudioFile(new File(['fixture'], name, { type }));
      assert.equal(prepared.type, 'audio/wav');
      assert.match(prepared.name, /\.wav$/);
      assert.equal(new TextDecoder().decode((await prepared.arrayBuffer()).slice(0, 4)), 'RIFF');
    }
    assert.equal(decoded, 3); assert.equal(closed, 3);
  } finally { Object.assign(globalThis, original); }
});

test('audio que el navegador no puede decodificar da error accionable y libera recursos', async () => {
  const original = { AudioContext: globalThis.AudioContext, OfflineAudioContext: globalThis.OfflineAudioContext };
  let closed = false;
  globalThis.AudioContext = class { async decodeAudioData() { throw new Error('Invalid encoding'); } async close() { closed = true; } };
  globalThis.OfflineAudioContext = class {};
  try {
    await assert.rejects(prepareAudioFile(new File(['invalid'], 'audio.ogg', { type: 'audio/ogg' })), /No se pudo leer/);
    assert.equal(closed, true);
  } finally { Object.assign(globalThis, original); }
});
