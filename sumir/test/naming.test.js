import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOutputName, deriveBandpassName } from '../naming.js';

test('common leading tokens become the base name', () => {
    const name = deriveOutputName(
        ['1976 DR JBL Cap Edge SM57.wav', '1976 DR JBL Cap Edge R121.wav'],
        'all'
    );
    assert.equal(name, '1976 DR JBL Cap Edge — Summary (2 IRs).wav');
});

test('mode is reflected in the name', () => {
    const name = deriveOutputName(
        ['Cab A.wav', 'Cab B.wav', 'Cab C.wav'],
        'bright'
    );
    assert.equal(name, 'Cab — Bright Summary (3 IRs).wav');
});

test('common run in the middle of the names is found', () => {
    const name = deriveOutputName(
        ['57 Deluxe Mix One.wav', '121 Deluxe Mix Two.wav'],
        'all'
    );
    assert.equal(name, 'Deluxe Mix — Summary (2 IRs).wav');
});

test('no common tokens falls back to generic name', () => {
    const name = deriveOutputName(['alpha.wav', 'beta.wav', 'gamma.wav'], 'all');
    assert.equal(name, 'IR Summary (3 IRs).wav');
});

test('separators - and _ are treated as token breaks', () => {
    const name = deriveOutputName(
        ['Mesa_412-V30_SM57.wav', 'Mesa_412-V30_MD421.wav'],
        'mids'
    );
    assert.equal(name, 'Mesa 412 V30 — Mids Summary (2 IRs).wav');
});

test('token matching is case-insensitive but keeps first spelling', () => {
    const name = deriveOutputName(['CAB test one.wav', 'cab test two.wav'], 'all');
    assert.equal(name, 'CAB test — Summary (2 IRs).wav');
});

test('explicit count overrides the filename count (tilt-dropped IRs)', () => {
    const name = deriveOutputName(
        ['Cab A.wav', 'Cab B.wav', 'Cab C.wav', 'Cab D.wav'],
        'bright',
        3
    );
    assert.equal(name, 'Cab — Bright Summary (3 IRs).wav');
});

test('filters are tagged into the name', () => {
    const name = deriveOutputName(['Cab A.wav', 'Cab B.wav'], 'all', 2, { highpass: 80, lowpass: 8000 });
    assert.equal(name, 'Cab — Summary (2 IRs, HP80 LP8k).wav');
});

test('a single filter tags alone', () => {
    assert.equal(
        deriveOutputName(['Cab A.wav', 'Cab B.wav'], 'bright', 2, { highpass: 120 }),
        'Cab — Bright Summary (2 IRs, HP120).wav'
    );
    assert.equal(
        deriveOutputName(['Cab A.wav', 'Cab B.wav'], 'all', 2, { lowpass: 6000 }),
        'Cab — Summary (2 IRs, LP6k).wav'
    );
});

test('filter tag also lands on the fallback name', () => {
    assert.equal(
        deriveOutputName(['alpha.wav', 'beta.wav'], 'all', 2, { highpass: 50, lowpass: 10000 }),
        'IR Summary (2 IRs, HP50 LP10k).wav'
    );
});

test('single meaningless common token (e.g. a number) still works', () => {
    const name = deriveOutputName(['1 a.wav', '1 b.wav'], 'dark');
    assert.equal(name, '1 — Dark Summary (2 IRs).wav');
});

// ---- deriveBandpassName (single-IR bandpass-only flow) ----
test('bandpass name appends both filter tags to the basename', () => {
    assert.equal(deriveBandpassName('Foo.wav', { highpass: 80, lowpass: 8000 }), 'Foo (HP80 LP8k).wav');
});

test('bandpass name with a single filter', () => {
    assert.equal(deriveBandpassName('My IR.wav', { highpass: 120 }), 'My IR (HP120).wav');
    assert.equal(deriveBandpassName('My IR.wav', { lowpass: 6000 }), 'My IR (LP6k).wav');
});

test('bandpass name with no filters just re-suffixes .wav', () => {
    assert.equal(deriveBandpassName('Foo.wav', {}), 'Foo.wav');
});

test('bandpass name keeps fractional-k tags', () => {
    assert.equal(deriveBandpassName('Cab.wav', { lowpass: 6500 }), 'Cab (LP6.5k).wav');
});
