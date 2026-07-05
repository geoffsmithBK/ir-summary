/**
 * Output filename derivation: longest common token-run across the dropped
 * filenames + mode + count, e.g.
 *   "1976 Deluxe Reverb JBL — Bright Summary (5 IRs).wav"
 * Falls back to "IR Summary (N IRs).wav" when the names share nothing.
 */

const MODE_LABELS = {
    all: 'Summary',
    bright: 'Bright Summary',
    dark: 'Dark Summary',
    mids: 'Mids Summary',
};

function tokenize(filename) {
    const base = filename.replace(/\.[^.]+$/, '');
    return base.split(/[\s\-_]+/).filter(Boolean);
}

/** Longest run of consecutive tokens present (contiguously) in every list. */
function longestCommonTokenRun(tokenLists) {
    const [first, ...rest] = tokenLists;
    const restLower = rest.map((list) => list.map((t) => t.toLowerCase()));
    let best = [];
    for (let start = 0; start < first.length; start++) {
        for (let end = first.length; end > start + best.length; end--) {
            const run = first.slice(start, end);
            const runLower = run.map((t) => t.toLowerCase());
            if (restLower.every((tokens) => containsRun(tokens, runLower))) {
                best = run;
                break; // longer runs from this start are exhausted
            }
        }
    }
    return best;
}

function containsRun(tokens, run) {
    outer: for (let i = 0; i + run.length <= tokens.length; i++) {
        for (let j = 0; j < run.length; j++) {
            if (tokens[i + j] !== run[j]) continue outer;
        }
        return true;
    }
    return false;
}

/** 80 -> "80", 6000 -> "6k", 10000 -> "10k", 6500 -> "6.5k" */
function hzTag(hz) {
    if (hz >= 1000) {
        const k = hz / 1000;
        return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
    }
    return String(hz);
}

/**
 * @param {string[]} filenames - dropped file names
 * @param {'all'|'bright'|'dark'|'mids'} mode
 * @param {number} [countOverride] - IRs actually averaged (defaults to file count)
 * @param {{highpass?: number|null, lowpass?: number|null}} [filters] - applied
 *   band-shaping, tagged into the name (the filename is the only metadata
 *   that survives inside a hardware IR loader)
 * @returns {string} suggested output filename (.wav)
 */
export function deriveOutputName(filenames, mode, countOverride, filters = {}) {
    const label = MODE_LABELS[mode] ?? MODE_LABELS.all;
    const tags = [`${countOverride ?? filenames.length} IRs`];
    if (filters.highpass) tags.push(`HP${hzTag(filters.highpass)}`);
    if (filters.lowpass) tags.push(`LP${hzTag(filters.lowpass)}`);
    const count = `(${tags[0]}${tags.length > 1 ? ', ' + tags.slice(1).join(' ') : ''})`;
    const common = longestCommonTokenRun(filenames.map(tokenize));
    if (common.length === 0) {
        return `IR ${label} ${count}.wav`;
    }
    return `${common.join(' ')} — ${label} ${count}.wav`;
}

/**
 * Output filename for the bandpass-only flow: the input basename plus a filter
 * tag, e.g. "Foo (HP80 LP8k).wav". Uses the same hzTag conventions as
 * deriveOutputName. With no filters it just re-suffixes ".wav".
 *
 * @param {string} filename - the single input file's name
 * @param {{highpass?: number|null, lowpass?: number|null}} [filters]
 * @returns {string} suggested output filename (.wav)
 */
export function deriveBandpassName(filename, filters = {}) {
    const base = filename.replace(/\.[^.]+$/, '');
    const tags = [];
    if (filters.highpass) tags.push(`HP${hzTag(filters.highpass)}`);
    if (filters.lowpass) tags.push(`LP${hzTag(filters.lowpass)}`);
    return tags.length ? `${base} (${tags.join(' ')}).wav` : `${base}.wav`;
}
