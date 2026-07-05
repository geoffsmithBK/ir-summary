/**
 * Core DSP: port of ir_average.py (align -> magnitude-average -> minimum
 * phase; tilt-based cohort selection). Pure functions, no DOM.
 *
 * Deviation from the Python reference (sanctioned by the design spec): FFTs
 * run at the next power of two >= the needed size instead of numpy's
 * arbitrary-N FFT, so magnitudes agree within a small tolerance rather than
 * bit-exactly.
 */

export function nextPow2(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}

/** In-place iterative radix-2 Cooley-Tukey FFT. re/im length must be 2^k. */
export function fftComplex(re, im) {
    const n = re.length;
    if (n !== im.length || (n & (n - 1)) !== 0) {
        throw new Error(`FFT size must be a power of two, got ${n}`);
    }
    // bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wRe = Math.cos(ang);
        const wIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let curRe = 1;
            let curIm = 0;
            for (let j = 0; j < len / 2; j++) {
                const aRe = re[i + j];
                const aIm = im[i + j];
                const bRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
                const bIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
                re[i + j] = aRe + bRe;
                im[i + j] = aIm + bIm;
                re[i + j + len / 2] = aRe - bRe;
                im[i + j + len / 2] = aIm - bIm;
                const nextRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = nextRe;
            }
        }
    }
}

/** In-place inverse FFT (conjugate trick + 1/N scaling). */
export function ifftComplex(re, im) {
    const n = re.length;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fftComplex(re, im);
    for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= -n;
    }
}

/**
 * In-place FFT for ANY size N — radix-2 when N is a power of two, Bluestein's
 * chirp-z otherwise. Arbitrary N keeps the pipeline on numpy's exact grid
 * (N = L), which matters for parity: rebuilding min-phase on a padded
 * power-of-two grid and truncating deviates audibly once steep filters are
 * involved.
 */
export function fftAnyN(re, im) {
    const N = re.length;
    if ((N & (N - 1)) === 0) {
        fftComplex(re, im);
        return;
    }
    // chirp w[n] = exp(-i*pi*n^2/N); compute n^2 mod 2N in exact integers to
    // keep the angle accurate for large n
    const wRe = new Float64Array(N);
    const wIm = new Float64Array(N);
    for (let n = 0; n < N; n++) {
        const a = (-Math.PI * ((n * n) % (2 * N))) / N;
        wRe[n] = Math.cos(a);
        wIm[n] = Math.sin(a);
    }
    const M = nextPow2(2 * N - 1);
    // a = x * w, zero-padded to M
    const aRe = new Float64Array(M);
    const aIm = new Float64Array(M);
    for (let n = 0; n < N; n++) {
        aRe[n] = re[n] * wRe[n] - im[n] * wIm[n];
        aIm[n] = re[n] * wIm[n] + im[n] * wRe[n];
    }
    // b = conj(w), chirp-symmetric wrap: b[0..N-1] and b[M-n] = b[n]
    const bRe = new Float64Array(M);
    const bIm = new Float64Array(M);
    for (let n = 0; n < N; n++) {
        bRe[n] = wRe[n];
        bIm[n] = -wIm[n];
        if (n > 0) {
            bRe[M - n] = wRe[n];
            bIm[M - n] = -wIm[n];
        }
    }
    fftComplex(aRe, aIm);
    fftComplex(bRe, bIm);
    for (let i = 0; i < M; i++) {
        const r = aRe[i] * bRe[i] - aIm[i] * bIm[i];
        aIm[i] = aRe[i] * bIm[i] + aIm[i] * bRe[i];
        aRe[i] = r;
    }
    ifftComplex(aRe, aIm);
    for (let k = 0; k < N; k++) {
        re[k] = aRe[k] * wRe[k] - aIm[k] * wIm[k];
        im[k] = aRe[k] * wIm[k] + aIm[k] * wRe[k];
    }
}

/** In-place inverse FFT for any size N. */
export function ifftAnyN(re, im) {
    const n = re.length;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fftAnyN(re, im);
    for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= -n;
    }
}

/** |FFT| of x zero-padded to N (any size); returns full two-sided magnitude. */
export function magnitudeSpectrum(x, N) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    re.set(x.length <= N ? x : x.subarray(0, N));
    fftAnyN(re, im);
    const mag = new Float64Array(N);
    for (let i = 0; i < N; i++) mag[i] = Math.hypot(re[i], im[i]);
    return mag;
}

/**
 * Lag maximizing sum_n a[n+lag]*b[n] over mean-subtracted signals —
 * np.correlate(a - a.mean(), b - b.mean(), 'full') semantics, via FFT.
 */
export function crossCorrelateLag(a, b) {
    const n = Math.max(a.length, b.length);
    const M = nextPow2(2 * n);
    let aMean = 0;
    for (const v of a) aMean += v;
    aMean /= a.length;
    let bMean = 0;
    for (const v of b) bMean += v;
    bMean /= b.length;
    // Python zero-pads both to n first, so the mean-subtracted values sit in
    // [0, n) and the padding stays zero (a - mean applies before padding).
    const aRe = new Float64Array(M);
    const aIm = new Float64Array(M);
    const bRe = new Float64Array(M);
    const bIm = new Float64Array(M);
    for (let i = 0; i < a.length; i++) aRe[i] = a[i] - aMean;
    for (let i = 0; i < b.length; i++) bRe[i] = b[i] - bMean;
    fftComplex(aRe, aIm);
    fftComplex(bRe, bIm);
    // A * conj(B)
    const cRe = new Float64Array(M);
    const cIm = new Float64Array(M);
    for (let i = 0; i < M; i++) {
        cRe[i] = aRe[i] * bRe[i] + aIm[i] * bIm[i];
        cIm[i] = aIm[i] * bRe[i] - aRe[i] * bIm[i];
    }
    ifftComplex(cRe, cIm);
    let bestLag = 0;
    let bestVal = -Infinity;
    for (let lag = -(n - 1); lag <= n - 1; lag++) {
        const v = cRe[lag >= 0 ? lag : M + lag];
        if (v > bestVal) {
            bestVal = v;
            bestLag = lag;
        }
    }
    return bestLag;
}

/** Integer-sample shift of x to best match ref (parity with align_to_ref). */
export function alignToRef(x, ref) {
    const lag = crossCorrelateLag(x, ref);
    const n = x.length;
    const aligned = new Float64Array(n);
    if (lag > 0) {
        aligned.set(x.subarray(lag)); // shift left, zero-pad tail
    } else if (lag < 0) {
        aligned.set(x.subarray(0, n + lag), -lag); // shift right
    } else {
        aligned.set(x);
    }
    return { aligned, lag };
}

/** Energy of x within [lo, hi] Hz, in dB (magnitude-based, shift-invariant). */
export function bandLevelDb(x, sr, lo, hi = null) {
    if (hi === null) hi = sr / 2;
    const N = x.length; // numpy grid: rfft with no padding
    const mag = magnitudeSpectrum(x, N);
    let energy = 0;
    // one-sided bins 0..N/2, freq = i * sr / N
    for (let i = 0; i <= N / 2; i++) {
        const f = (i * sr) / N;
        if (f >= lo && f <= hi) energy += mag[i] * mag[i];
    }
    return 10 * Math.log10(Math.max(energy, 1e-20));
}

/**
 * Minimum-phase transfer function {re, im} (complex, full two-sided) for a
 * magnitude spectrum (length must be a power of two). Real-cepstrum method,
 * parity with minimum_phase_spectrum.
 */
export function minimumPhaseSpectrum(mag) {
    const N = mag.length;
    const logRe = new Float64Array(N);
    const logIm = new Float64Array(N);
    for (let i = 0; i < N; i++) logRe[i] = Math.log(Math.max(mag[i], 1e-12));
    ifftAnyN(logRe, logIm); // real cepstrum (imag ~ 0 for symmetric input)
    // fold: keep c[0], double 1..N//2-1, keep N//2 when N is even
    // (exactly mirrors the reference's w[] construction, odd-N quirk included)
    const half = Math.floor(N / 2);
    const cepRe = new Float64Array(N);
    const cepIm = new Float64Array(N);
    cepRe[0] = logRe[0];
    for (let i = 1; i < half; i++) cepRe[i] = 2 * logRe[i];
    if (N % 2 === 0) cepRe[half] = logRe[half];
    fftAnyN(cepRe, cepIm);
    const hRe = new Float64Array(N);
    const hIm = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        const eRe = Math.exp(cepRe[i]);
        hRe[i] = eRe * Math.cos(cepIm[i]);
        hIm[i] = eRe * Math.sin(cepIm[i]);
    }
    return { re: hRe, im: hIm };
}

/** Build a minimum-phase IR from a full two-sided magnitude spectrum. */
export function minimumPhaseFromMag(mag) {
    const { re, im } = minimumPhaseSpectrum(mag);
    ifftAnyN(re, im);
    return re;
}

/**
 * Combined magnitude of a 3rd-order (18 dB/oct) Butterworth high-pass and/or
 * 2nd-order (12 dB/oct) low-pass, sampled at |freqs|. Analytic prototype,
 * -3 dB at each corner. Parity with butterworth_band_mag.
 */
export function butterworthBandMag(freqs, highpass = null, lowpass = null) {
    const g = new Float64Array(freqs.length);
    for (let i = 0; i < freqs.length; i++) {
        const f = Math.abs(freqs[i]);
        let v = 1;
        if (highpass) {
            const r = f / highpass;
            v *= (r * r * r) / Math.sqrt(1 + r ** 6);
        }
        if (lowpass) {
            const r = f / lowpass;
            v /= Math.sqrt(1 + r ** 4);
        }
        g[i] = v;
    }
    return g;
}

/** Full two-sided FFT bin frequencies for size N at sample rate sr (abs value). */
function fftBinFreqs(N, sr) {
    const f = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        f[i] = ((i <= N / 2 ? i : N - i) * sr) / N;
    }
    return f;
}

/**
 * Validate high/low-pass corners against the CLI's rules (parity with the
 * ir_average.py checks): positive, high-pass below low-pass, each below
 * Nyquist. Throws on the first violation. A null corner means "not applied".
 */
export function validateCorners(highpass, lowpass, sr) {
    for (const [label, hz] of [['High-pass', highpass], ['Low-pass', lowpass]]) {
        if (hz === null) continue;
        if (hz <= 0) throw new Error(`${label} must be a positive frequency in Hz.`);
        if (hz >= sr / 2) throw new Error(`${label} (${hz} Hz) must be below Nyquist (${sr / 2} Hz).`);
    }
    if (highpass !== null && lowpass !== null && highpass >= lowpass) {
        throw new Error(`High-pass (${highpass} Hz) must be below low-pass (${lowpass} Hz).`);
    }
}

/**
 * Peak-normalize `out` in place to `normDb` dBFS. If `alsoScale` is given it
 * gets the SAME scalar (so a pre-filter ghost keeps its relative level).
 */
export function normalizeToPeak(out, normDb, alsoScale = null) {
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    if (peak > 0) {
        const scale = Math.pow(10, normDb / 20) / peak;
        for (let i = 0; i < out.length; i++) out[i] *= scale;
        if (alsoScale) for (let i = 0; i < alsoScale.length; i++) alsoScale[i] *= scale;
    }
}

/**
 * Band-shape a SINGLE IR with the Butterworth high/low-pass, preserving the
 * IR's own phase/character. Parity with run_bandpass_only in ir_average.py:
 * the band gain is applied as a minimum-phase spectrum multiplied onto the
 * ORIGINAL waveform's FFT (we do NOT rebuild the IR as minimum-phase), then
 * the result is peak-normalized to -0.2 dBFS. Runs at N = x.length (numpy grid).
 *
 * @param {Float64Array} x - decoded mono IR
 * @param {number} sr
 * @param {Object} opts
 * @param {number|null} [opts.highpass=null] - 18 dB/oct Butterworth high-pass corner (Hz)
 * @param {number|null} [opts.lowpass=null] - 12 dB/oct Butterworth low-pass corner (Hz)
 * @param {boolean} [opts.normalize=true] - peak-normalize to -0.2 dBFS; false
 *   preserves the input's original level (#9 --keep-level parity)
 * @returns {Float64Array} filtered IR (length = x.length)
 */
export function bandpassIR(x, sr, opts = {}) {
    const { highpass = null, lowpass = null, normalize = true } = opts;
    validateCorners(highpass, lowpass, sr);
    if (highpass === null && lowpass === null) {
        throw new Error('Bandpass needs at least one of high-pass or low-pass.');
    }
    const N = x.length;
    const bandGain = butterworthBandMag(fftBinFreqs(N, sr), highpass, lowpass);
    const H = minimumPhaseSpectrum(bandGain);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    re.set(x);
    fftAnyN(re, im);
    for (let i = 0; i < N; i++) {
        const xr = re[i] * H.re[i] - im[i] * H.im[i];
        const xi = re[i] * H.im[i] + im[i] * H.re[i];
        re[i] = xr;
        im[i] = xi;
    }
    ifftAnyN(re, im);
    const out = re.slice(0, N);
    if (normalize) normalizeToPeak(out, -0.2);
    return out;
}

/**
 * Full pipeline: pad -> align -> optional tilt selection -> average ->
 * normalize. Parity with ir_average.py main().
 *
 * @param {Float64Array[]} signals - decoded mono IRs (shared sample rate)
 * @param {number} sr
 * @param {Object} opts
 * @param {'magnitude'|'timealign'} [opts.method='magnitude']
 * @param {'linear'|'power'} [opts.weighting='linear']
 * @param {'bright'|'dark'|'mids'|null} [opts.mode=null]
 * @param {number} [opts.lowHz=250]
 * @param {number} [opts.highHz=5000]
 * @param {number|null} [opts.marginDb=null]
 * @param {number} [opts.normDb=-0.2]
 * @param {number|null} [opts.highpass=null] - 18 dB/oct Butterworth high-pass corner (Hz)
 * @param {number|null} [opts.lowpass=null] - 12 dB/oct Butterworth low-pass corner (Hz)
 * @returns {Object} status 'ok' | 'single' | 'none' plus per-status payload
 */
export function averageIRs(signals, sr, opts = {}) {
    const {
        method = 'magnitude',
        weighting = 'linear',
        mode = null,
        lowHz = 250,
        highHz = 5000,
        marginDb = null,
        normDb = -0.2,
        highpass = null,
        lowpass = null,
    } = opts;

    validateCorners(highpass, lowpass, sr);
    const filtering = Boolean(highpass || lowpass);

    // pad to common length
    const L = Math.max(...signals.map((s) => s.length));
    const padded = signals.map((s) => {
        const p = new Float64Array(L);
        p.set(s);
        return p;
    });

    // align to the earliest-onset signal (parity: threshold 1% of peak)
    const onset = (x) => {
        let peak = 0;
        for (const v of x) peak = Math.max(peak, Math.abs(v));
        const thresh = 0.01 * peak;
        for (let i = 0; i < x.length; i++) {
            if (Math.abs(x[i]) >= thresh) return i;
        }
        return 0;
    };
    let refIdx = 0;
    let refOnset = Infinity;
    padded.forEach((x, i) => {
        const o = onset(x);
        if (o < refOnset) {
            refOnset = o;
            refIdx = i;
        }
    });
    const ref = padded[refIdx];
    let aligned = [];
    let lags = [];
    for (const x of padded) {
        const r = alignToRef(x, ref);
        aligned.push(r.aligned);
        lags.push(r.lag);
    }

    // optional tilt selection
    let keptIndices = padded.map((_, i) => i);
    let dropped = [];
    let tilts = null;
    let meanTilt = null;
    let margin = null;
    if (mode) {
        tilts = aligned.map((x) => bandLevelDb(x, sr, highHz) - bandLevelDb(x, sr, 0, lowHz));
        meanTilt = tilts.reduce((s, t) => s + t, 0) / tilts.length;
        if (marginDb !== null && marginDb !== undefined && !Number.isNaN(marginDb)) {
            margin = marginDb;
        } else if (mode === 'mids') {
            const variance = tilts.reduce((s, t) => s + (t - meanTilt) ** 2, 0) / tilts.length;
            margin = Math.sqrt(variance);
        } else {
            margin = 0;
        }
        const keepMask = tilts.map((t) => {
            if (mode === 'bright') return t >= meanTilt + margin;
            if (mode === 'dark') return t <= meanTilt - margin;
            return Math.abs(t - meanTilt) <= margin; // mids
        });
        keptIndices = [];
        dropped = [];
        keepMask.forEach((keep, i) => {
            if (keep) keptIndices.push(i);
            else dropped.push({ index: i, tilt: tilts[i], aligned: aligned[i] });
        });
        if (keptIndices.length === 0) {
            return { status: 'none', mode, tilts, meanTilt, margin };
        }
        if (keptIndices.length === 1) {
            return { status: 'single', index: keptIndices[0], mode, tilts, meanTilt, margin };
        }
        aligned = keptIndices.map((i) => aligned[i]);
        lags = keptIndices.map((i) => lags[i]);
    }

    // average (outPre keeps the unfiltered summary for the plot's ghost curve).
    // N = L exactly, matching the reference's numpy grid.
    const N = L;
    const bandGain = filtering ? butterworthBandMag(fftBinFreqs(N, sr), highpass, lowpass) : null;
    let out;
    let outPre = null;
    if (method === 'timealign') {
        out = new Float64Array(L);
        for (const x of aligned) {
            for (let i = 0; i < L; i++) out[i] += x[i];
        }
        for (let i = 0; i < L; i++) out[i] /= aligned.length;
        if (filtering) {
            outPre = out;
            const re = new Float64Array(N);
            const im = new Float64Array(N);
            re.set(out);
            fftAnyN(re, im);
            const H = minimumPhaseSpectrum(bandGain);
            for (let i = 0; i < N; i++) {
                const xr = re[i] * H.re[i] - im[i] * H.im[i];
                const xi = re[i] * H.im[i] + im[i] * H.re[i];
                re[i] = xr;
                im[i] = xi;
            }
            ifftAnyN(re, im);
            out = re.slice(0, L);
        }
    } else {
        const avgMag = new Float64Array(N);
        for (const x of aligned) {
            const mag = magnitudeSpectrum(x, N);
            if (weighting === 'power') {
                for (let i = 0; i < N; i++) avgMag[i] += mag[i] * mag[i];
            } else {
                for (let i = 0; i < N; i++) avgMag[i] += mag[i];
            }
        }
        for (let i = 0; i < N; i++) {
            avgMag[i] = weighting === 'power'
                ? Math.sqrt(avgMag[i] / aligned.length)
                : avgMag[i] / aligned.length;
        }
        if (filtering) {
            outPre = minimumPhaseFromMag(avgMag).slice(0, L);
            for (let i = 0; i < N; i++) avgMag[i] *= bandGain[i];
        }
        out = minimumPhaseFromMag(avgMag).slice(0, L);
    }

    // peak-normalize after filtering (dumping out-of-band energy buys
    // headroom); ghost gets the same scalar so passbands overlay on the plot
    normalizeToPeak(out, normDb, outPre);

    return {
        status: 'ok',
        out,
        outPre,
        sr,
        L,
        lags,
        aligned,
        keptIndices,
        dropped,
        tilts,
        meanTilt,
        margin,
        mode,
        highpass,
        lowpass,
    };
}
