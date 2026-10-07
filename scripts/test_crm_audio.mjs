import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmWav } from '../src/lib/crm-audio.ts';

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
