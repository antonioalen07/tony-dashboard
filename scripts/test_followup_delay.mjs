import test from 'node:test';
import assert from 'node:assert/strict';
import { followupDelayInput, followupDelayMinutes, followupDelayMaximum, formatFollowupDelay } from '../src/lib/followup-delay.ts';

test('demoras existentes conservan exactamente sus minutos al abrir y guardar', () => {
    for (const minutes of [0, 1, 59, 60, 90, 120, 1439, 1440, 2880, 10080, 20160, 525600]) {
        const input = followupDelayInput(minutes);
        assert.equal(followupDelayMinutes(input.value, input.unit), minutes);
    }
    assert.deepEqual(followupDelayInput(90), { value: '90', unit: 'minutes' });
    assert.deepEqual(followupDelayInput(20160), { value: '2', unit: 'weeks' });
});

test('valor y unidad convierten horas, días y semanas al contrato de minutos', () => {
    assert.equal(followupDelayMinutes('2', 'hours'), 120);
    assert.equal(followupDelayMinutes('2', 'days'), 2880);
    assert.equal(followupDelayMinutes('2', 'weeks'), 20160);
    assert.equal(formatFollowupDelay(60), '1 hora');
    assert.equal(formatFollowupDelay(2880), '2 días');
    assert.equal(formatFollowupDelay(10080), '1 semana');
});

test('demoras vacías, fraccionarias, negativas o mayores al límite no se guardan', () => {
    for (const value of ['', ' ', '-1', '1.5', 'NaN', 'Infinity', '1e3'])
        assert.equal(followupDelayMinutes(value, 'minutes'), null);
    assert.equal(followupDelayMinutes('365', 'days'), 525600);
    assert.equal(followupDelayMinutes('366', 'days'), null);
    assert.equal(followupDelayMinutes('52', 'weeks'), 524160);
    assert.equal(followupDelayMinutes('53', 'weeks'), null);
    assert.equal(followupDelayMaximum('weeks'), 52);
    assert.equal(followupDelayMaximum('hours'), 8760);
});
