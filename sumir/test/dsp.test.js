import test from 'node:test';
import assert from 'node:assert/strict';
import {
    nextPow2,
    fftComplex,
    ifftComplex,
    fftAnyN,
    ifftAnyN,
    crossCorrelateLag,
    alignToRef,
    bandLevelDb,
    minimumPhaseFromMag,
    butterworthBandMag,
    averageIRs,
    bandpassIR,
} from '../dsp.js';

// Deterministic pseudo-random (no Math.random in tests).
function lcg(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296 - 0.5;
    };
}

function magSpectrum(x, N) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    re.set(x.subarray(0, Math.min(x.length, N)));
    fftComplex(re, im);
    const mag = new Float64Array(N);
    for (let i = 0; i < N; i++) mag[i] = Math.hypot(re[i], im[i]);
    return mag;
}

// Synthetic "IR": decaying exponential with a little deterministic noise.
function synthIR(n, decay, seed) {
    const rnd = lcg(seed);
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        x[i] = Math.pow(decay, i) * (1 + 0.05 * rnd());
    }
    x[0] = 1;
    return x;
}

// Heavy moving-average lowpass => a "dark" IR.
function darken(x, width) {
    const y = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) {
        let sum = 0;
        for (let j = Math.max(0, i - width + 1); j <= i; j++) sum += x[j];
        y[i] = sum / width;
    }
    return y;
}

function delayed(x, d) {
    const y = new Float64Array(x.length);
    y.set(x.subarray(0, x.length - d), d);
    return y;
}

test('nextPow2', () => {
    assert.equal(nextPow2(1), 1);
    assert.equal(nextPow2(2), 2);
    assert.equal(nextPow2(3), 4);
    assert.equal(nextPow2(24000), 32768);
});

test('fft of unit impulse is flat', () => {
    const N = 64;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    re[0] = 1;
    fftComplex(re, im);
    for (let i = 0; i < N; i++) {
        assert.ok(Math.abs(Math.hypot(re[i], im[i]) - 1) < 1e-12, `bin ${i}`);
    }
});

test('fft of a sine concentrates energy at its bin', () => {
    const N = 256;
    const k = 12;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = Math.sin((2 * Math.PI * k * i) / N);
    fftComplex(re, im);
    const mag = Array.from({ length: N }, (_, i) => Math.hypot(re[i], im[i]));
    assert.ok(Math.abs(mag[k] - N / 2) < 1e-9);
    assert.ok(Math.abs(mag[N - k] - N / 2) < 1e-9);
    const rest = mag.reduce((s, m, i) => (i === k || i === N - k ? s : s + m), 0);
    assert.ok(rest < 1e-8);
});

test('ifft(fft(x)) round-trips', () => {
    const N = 512;
    const rnd = lcg(42);
    const x = new Float64Array(N);
    for (let i = 0; i < N; i++) x[i] = rnd();
    const re = Float64Array.from(x);
    const im = new Float64Array(N);
    fftComplex(re, im);
    ifftComplex(re, im);
    for (let i = 0; i < N; i++) {
        assert.ok(Math.abs(re[i] - x[i]) < 1e-12, `re[${i}]`);
        assert.ok(Math.abs(im[i]) < 1e-12, `im[${i}]`);
    }
});

test('fftAnyN matches a direct DFT at non-power-of-two sizes', () => {
    for (const N of [3, 101, 750]) {
        const rnd = lcg(N);
        const x = Float64Array.from({ length: N }, () => rnd());
        const re = Float64Array.from(x);
        const im = new Float64Array(N);
        fftAnyN(re, im);
        // direct DFT
        for (let k = 0; k < N; k++) {
            let dr = 0;
            let di = 0;
            for (let n = 0; n < N; n++) {
                const a = (-2 * Math.PI * k * n) / N;
                dr += x[n] * Math.cos(a);
                di += x[n] * Math.sin(a);
            }
            assert.ok(Math.abs(re[k] - dr) < 1e-8, `N=${N} re[${k}]: ${re[k]} vs ${dr}`);
            assert.ok(Math.abs(im[k] - di) < 1e-8, `N=${N} im[${k}]: ${im[k]} vs ${di}`);
        }
    }
});

test('ifftAnyN round-trips at a large non-power-of-two size', () => {
    const N = 24000;
    const rnd = lcg(99);
    const x = Float64Array.from({ length: N }, () => rnd());
    const re = Float64Array.from(x);
    const im = new Float64Array(N);
    fftAnyN(re, im);
    ifftAnyN(re, im);
    for (let i = 0; i < N; i += 997) {
        assert.ok(Math.abs(re[i] - x[i]) < 1e-9, `re[${i}]`);
        assert.ok(Math.abs(im[i]) < 1e-9, `im[${i}]`);
    }
});

test('crossCorrelateLag matches brute-force np.correlate semantics', () => {
    const rnd = lcg(7);
    const n = 50;
    const a = Float64Array.from({ length: n }, () => rnd());
    const b = Float64Array.from({ length: n }, () => rnd());
    // brute force: lag maximizing sum_n a[n+lag] * b[n], with mean removal
    const am = a.map((v) => v - a.reduce((s, w) => s + w, 0) / n);
    const bm = b.map((v) => v - b.reduce((s, w) => s + w, 0) / n);
    let bestLag = 0;
    let bestVal = -Infinity;
    for (let lag = -(n - 1); lag <= n - 1; lag++) {
        let sum = 0;
        for (let i = 0; i < n; i++) {
            const j = i + lag;
            if (j >= 0 && j < n) sum += am[j] * bm[i];
        }
        if (sum > bestVal) {
            bestVal = sum;
            bestLag = lag;
        }
    }
    assert.equal(crossCorrelateLag(a, b), bestLag);
});

test('alignToRef undoes a pure delay', () => {
    const ref = synthIR(1024, 0.99, 1);
    const { aligned, lag } = alignToRef(delayed(ref, 37), ref);
    assert.equal(lag, 37);
    for (let i = 0; i < 900; i++) {
        assert.ok(Math.abs(aligned[i] - ref[i]) < 1e-9, `sample ${i}`);
    }
});

test('bandLevelDb: low sine has energy below 250 Hz, none above 5 kHz', () => {
    const sr = 48000;
    const n = 4096;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 100 * i) / sr);
    const low = bandLevelDb(x, sr, 0, 250);
    const high = bandLevelDb(x, sr, 5000, null);
    assert.ok(low - high > 40, `expected strong low tilt, got ${low - high}`);
});

test('bandLevelDb is invariant to time shift', () => {
    const sr = 48000;
    const x = synthIR(2048, 0.995, 3);
    const lo1 = bandLevelDb(x, sr, 0, 250);
    const lo2 = bandLevelDb(delayed(x, 100), sr, 0, 250);
    assert.ok(Math.abs(lo1 - lo2) < 0.1);
});

test('minimumPhaseFromMag reproduces a known minimum-phase IR', () => {
    const N = 1024;
    const h = new Float64Array(N);
    for (let i = 0; i < N; i++) h[i] = Math.pow(0.9, i);
    const mag = magSpectrum(h, N);
    const rebuilt = minimumPhaseFromMag(mag);
    for (let i = 0; i < 64; i++) {
        assert.ok(Math.abs(rebuilt[i] - h[i]) < 1e-6, `sample ${i}: ${rebuilt[i]} vs ${h[i]}`);
    }
});

test('minimumPhaseFromMag preserves the magnitude spectrum', () => {
    const N = 2048;
    const h = synthIR(N, 0.97, 9);
    const mag = magSpectrum(h, N);
    const rebuilt = minimumPhaseFromMag(mag);
    const mag2 = magSpectrum(rebuilt, N);
    for (let i = 0; i < N; i++) {
        const db1 = 20 * Math.log10(Math.max(mag[i], 1e-9));
        const db2 = 20 * Math.log10(Math.max(mag2[i], 1e-9));
        assert.ok(Math.abs(db1 - db2) < 0.01, `bin ${i}: ${db1} vs ${db2}`);
    }
});

test('averaging identical IRs returns the same magnitude (normalized)', () => {
    const sr = 48000;
    const x = synthIR(2048, 0.98, 11);
    const res = averageIRs([x, Float64Array.from(x)], sr, {});
    assert.equal(res.status, 'ok');
    assert.deepEqual(res.lags, [0, 0]);
    // peak normalized to -0.2 dBFS
    const peak = Math.max(...res.out.map(Math.abs));
    assert.ok(Math.abs(peak - Math.pow(10, -0.2 / 20)) < 1e-9);
    // magnitude shape matches the source (compare normalized spectra in dB)
    const N = nextPow2(2048);
    const m1 = magSpectrum(x, N);
    const m2 = magSpectrum(res.out, N);
    const ref1 = Math.max(...m1);
    const ref2 = Math.max(...m2);
    for (let i = 0; i < N / 2; i += 7) {
        const db1 = 20 * Math.log10(Math.max(m1[i] / ref1, 1e-6));
        const db2 = 20 * Math.log10(Math.max(m2[i] / ref2, 1e-6));
        if (db1 > -60) {
            assert.ok(Math.abs(db1 - db2) < 0.5, `bin ${i}: ${db1} vs ${db2}`);
        }
    }
});

test('a delayed copy is detected and its lag reported', () => {
    const sr = 48000;
    const x = synthIR(2048, 0.98, 13);
    const res = averageIRs([x, delayed(x, 60)], sr, {});
    assert.equal(res.status, 'ok');
    assert.equal(res.lags[0], 0);
    assert.equal(res.lags[1], 60);
});

test('timealign method averages aligned signals in the time domain', () => {
    const sr = 48000;
    const x = synthIR(1024, 0.98, 17);
    const res = averageIRs([x, delayed(x, 20)], sr, { method: 'timealign' });
    assert.equal(res.status, 'ok');
    // after alignment both are x, so the (normalized) output matches x's shape
    const scale = res.out[0] / x[0];
    for (let i = 0; i < 900; i++) {
        assert.ok(Math.abs(res.out[i] - x[i] * scale) < 1e-6, `sample ${i}`);
    }
});

test('bright mode keeps bright IRs and reports dropped dark ones', () => {
    const sr = 48000;
    const bright1 = synthIR(2048, 0.9, 19);
    const bright2 = synthIR(2048, 0.9, 23);
    const bright3 = synthIR(2048, 0.9, 29);
    const dark = darken(synthIR(2048, 0.9, 31), 64);
    const res = averageIRs([bright1, dark, bright2, bright3], sr, { mode: 'bright' });
    assert.equal(res.status, 'ok');
    assert.deepEqual(res.keptIndices, [0, 2, 3]);
    assert.equal(res.dropped.length, 1);
    assert.equal(res.dropped[0].index, 1);
    assert.ok(res.dropped[0].tilt < res.meanTilt);
});

test('dark mode narrowing to one IR short-circuits to single-candidate', () => {
    const sr = 48000;
    const res = averageIRs(
        [synthIR(2048, 0.9, 19), darken(synthIR(2048, 0.9, 31), 64), synthIR(2048, 0.9, 23)],
        sr,
        { mode: 'dark' }
    );
    assert.equal(res.status, 'single');
    assert.equal(res.index, 1);
});

test('impossible margin yields zero matches', () => {
    const sr = 48000;
    const res = averageIRs(
        [synthIR(2048, 0.9, 19), synthIR(2048, 0.9, 23), synthIR(2048, 0.9, 29)],
        sr,
        { mode: 'bright', marginDb: 500 }
    );
    assert.equal(res.status, 'none');
});

test('mids mode with explicit margin trims both extremes', () => {
    const sr = 48000;
    const mid1 = darken(synthIR(2048, 0.9, 19), 4);
    const mid2 = darken(synthIR(2048, 0.9, 23), 4);
    const bright = synthIR(2048, 0.9, 29);
    const dark = darken(synthIR(2048, 0.9, 31), 64);
    const res = averageIRs([bright, mid1, mid2, dark], sr, { mode: 'mids', marginDb: 3 });
    assert.equal(res.status, 'ok');
    assert.deepEqual(res.keptIndices, [1, 2]);
});

test('butterworthBandMag: -3 dB at corners, 18/12 dB per octave slopes', () => {
    const freqs = [20, 40, 80, 1000, 8000, 16000];
    const g = butterworthBandMag(freqs, 80, 8000);
    const db = (i) => 20 * Math.log10(g[i]);
    const ref = db(3); // 1 kHz passband
    assert.ok(Math.abs(db(2) - ref - -3.01) < 0.15, `HP corner: ${db(2) - ref}`);
    assert.ok(Math.abs(db(1) - ref - -18.13) < 0.15, `HP -1 oct: ${db(1) - ref}`);
    assert.ok(Math.abs(db(0) - ref - -36.12) < 0.15, `HP -2 oct: ${db(0) - ref}`);
    assert.ok(Math.abs(db(4) - ref - -3.01) < 0.15, `LP corner: ${db(4) - ref}`);
    assert.ok(Math.abs(db(5) - ref - -12.3) < 0.15, `LP +1 oct: ${db(5) - ref}`);
});

test('butterworthBandMag: highpass only leaves the top end untouched', () => {
    const g = butterworthBandMag([10000, 20000], 80, null);
    assert.ok(Math.abs(20 * Math.log10(g[0])) < 0.01);
    assert.ok(Math.abs(20 * Math.log10(g[1])) < 0.01);
});

// Filtered summary of two deltas = the filter's own response.
function deltaPair(n) {
    const a = new Float64Array(n);
    a[0] = 0.97;
    return [a, Float64Array.from(a)];
}

function levelAt(x, sr, hz) {
    const N = nextPow2(x.length);
    const mag = magSpectrum(x, N);
    const bin = Math.round((hz * N) / sr);
    return 20 * Math.log10(Math.max(mag[bin], 1e-12));
}

// Analytic filter response in dB at the FFT bin nearest hz (independent
// reimplementation of the Butterworth formulas, evaluated where we measure).
function expectedDb(hz, n, sr, hp, lp) {
    const N = nextPow2(n);
    const f = (Math.round((hz * N) / sr) * sr) / N; // snapped bin frequency
    let g = 1;
    if (hp) {
        const r = f / hp;
        g *= (r * r * r) / Math.sqrt(1 + r ** 6);
    }
    if (lp) {
        const r = f / lp;
        g /= Math.sqrt(1 + r ** 4);
    }
    return 20 * Math.log10(g);
}

test('averageIRs applies highpass/lowpass to the summary', () => {
    const sr = 48000;
    const n = 8192;
    const res = averageIRs(deltaPair(n), sr, { highpass: 80, lowpass: 8000 });
    assert.equal(res.status, 'ok');
    const ref = levelAt(res.out, sr, 1000) - expectedDb(1000, n, sr, 80, 8000);
    for (const hz of [80, 8000, 40, 16000]) {
        const got = levelAt(res.out, sr, hz) - ref;
        const want = expectedDb(hz, n, sr, 80, 8000);
        assert.ok(Math.abs(got - want) < 0.1, `${hz} Hz: got ${got.toFixed(2)}, want ${want.toFixed(2)}`);
    }
    // still peak-normalized to -0.2 dBFS
    const peak = Math.max(...res.out.map(Math.abs));
    assert.ok(Math.abs(peak - Math.pow(10, -0.2 / 20)) < 1e-9);
});

test('filtering exposes the pre-filter average at the same scale', () => {
    const sr = 48000;
    const res = averageIRs(deltaPair(8192), sr, { highpass: 80 });
    assert.ok(res.outPre instanceof Float64Array);
    // passband levels overlay (filter ~unity at 5 kHz for an 80 Hz HP)
    const a = levelAt(res.out, sr, 5000);
    const b = levelAt(res.outPre, sr, 5000);
    assert.ok(Math.abs(a - b) < 0.01, `${a} vs ${b}`);
});

test('no filters means no ghost and unchanged output', () => {
    const res = averageIRs(deltaPair(4096), 48000, {});
    assert.equal(res.outPre, null);
});

test('timealign method also gets filtered', () => {
    const sr = 48000;
    const n = 8192;
    const res = averageIRs(deltaPair(n), sr, { method: 'timealign', highpass: 80, lowpass: 8000 });
    const ref = levelAt(res.out, sr, 1000) - expectedDb(1000, n, sr, 80, 8000);
    for (const hz of [80, 8000]) {
        const got = levelAt(res.out, sr, hz) - ref;
        const want = expectedDb(hz, n, sr, 80, 8000);
        assert.ok(Math.abs(got - want) < 0.1, `${hz} Hz: got ${got.toFixed(2)}, want ${want.toFixed(2)}`);
    }
});

test('highpass at or above lowpass is rejected', () => {
    assert.throws(() => averageIRs(deltaPair(1024), 48000, { highpass: 8000, lowpass: 8000 }), /below/);
});

test('lowpass at or above Nyquist is rejected', () => {
    assert.throws(() => averageIRs(deltaPair(1024), 48000, { lowpass: 24000 }), /Nyquist/);
});

test('inputs of different lengths are padded to the longest', () => {
    const sr = 48000;
    const a = synthIR(1500, 0.98, 37);
    const b = synthIR(2048, 0.98, 41);
    const res = averageIRs([a, b], sr, {});
    assert.equal(res.status, 'ok');
    assert.equal(res.out.length, 2048);
});

// ---- bandpassIR (single-IR bandpass-only flow) ----
// A flat-spectrum delta reveals the filter's own response directly. bandpassIR
// runs at N = x.length, so measure at bins snapped on THAT grid (not nextPow2).
function delta(n) {
    const a = new Float64Array(n);
    a[0] = 0.97;
    return a;
}

function levelAtGrid(x, sr, hz, N) {
    const mag = magSpectrum(x, N);
    const bin = Math.round((hz * N) / sr);
    return 20 * Math.log10(Math.max(mag[bin], 1e-12));
}

function expectedDbAtGrid(hz, N, sr, hp, lp) {
    const f = (Math.round((hz * N) / sr) * sr) / N; // snapped bin frequency
    let g = 1;
    if (hp) {
        const r = f / hp;
        g *= (r * r * r) / Math.sqrt(1 + r ** 6);
    }
    if (lp) {
        const r = f / lp;
        g /= Math.sqrt(1 + r ** 4);
    }
    return 20 * Math.log10(g);
}

test('bandpassIR applies the band at N = length and normalizes to -0.2 dBFS', () => {
    const sr = 48000;
    const n = 8192; // power of two so the test helper magSpectrum can measure it
    const out = bandpassIR(delta(n), sr, { highpass: 80, lowpass: 8000 });
    assert.equal(out.length, n);
    const ref = levelAtGrid(out, sr, 1000, n) - expectedDbAtGrid(1000, n, sr, 80, 8000);
    for (const hz of [80, 8000, 40, 16000]) {
        const got = levelAtGrid(out, sr, hz, n) - ref;
        const want = expectedDbAtGrid(hz, n, sr, 80, 8000);
        assert.ok(Math.abs(got - want) < 0.1, `${hz} Hz: got ${got.toFixed(2)}, want ${want.toFixed(2)}`);
    }
    const peak = Math.max(...out.map(Math.abs));
    assert.ok(Math.abs(peak - Math.pow(10, -0.2 / 20)) < 1e-9);
});

test('bandpassIR preserves the input level when normalize:false (#9)', () => {
    const sr = 48000;
    const n = 8192;
    const norm = bandpassIR(delta(n), sr, { highpass: 80 });
    const raw = bandpassIR(delta(n), sr, { highpass: 80, normalize: false });
    const peakNorm = Math.max(...norm.map(Math.abs));
    const peakRaw = Math.max(...raw.map(Math.abs));
    // normalized path lands exactly on -0.2 dBFS; the preserved path does not
    assert.ok(Math.abs(peakNorm - Math.pow(10, -0.2 / 20)) < 1e-9);
    assert.ok(Math.abs(peakRaw - peakNorm) > 1e-6, `raw ${peakRaw} vs norm ${peakNorm}`);
    // the two differ only by the single normalization scalar
    const k = peakNorm / peakRaw;
    for (let i = 0; i < n; i += 311) {
        assert.ok(Math.abs(norm[i] - raw[i] * k) < 1e-9, `sample ${i}`);
    }
});

test('bandpassIR runs at a non-power-of-two length (numpy grid)', () => {
    const sr = 48000;
    const out = bandpassIR(delta(8000), sr, { highpass: 100 });
    assert.equal(out.length, 8000);
    const peak = Math.max(...out.map(Math.abs));
    assert.ok(Math.abs(peak - Math.pow(10, -0.2 / 20)) < 1e-9);
});

test('bandpassIR rejects invalid corners', () => {
    assert.throws(() => bandpassIR(delta(1024), 48000, { highpass: 8000, lowpass: 8000 }), /below/);
    assert.throws(() => bandpassIR(delta(1024), 48000, { lowpass: 24000 }), /Nyquist/);
    assert.throws(() => bandpassIR(delta(1024), 48000, { highpass: -5 }), /positive/);
    assert.throws(() => bandpassIR(delta(1024), 48000, {}), /at least one/);
});
