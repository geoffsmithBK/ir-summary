/**
 * SumIR — UI state machine and orchestration.
 * Files are decoded once per drop; every control change re-runs the (cheap)
 * pipeline and re-renders live.
 */
import { decodeWav, encodeWav } from './wav.js';
import { averageIRs, bandpassIR } from './dsp.js';
import { deriveOutputName, deriveBandpassName } from './naming.js';
import { drawPlot } from './plot.js';
import { resample } from './resample.js';
import { createInfoTooltip, openModal } from './popover.js';
import { TILT_TOOLTIP_COPY, WHY_MODAL_COPY, RENORMALIZE_TOOLTIP_COPY } from './copy.js';

const el = (id) => document.getElementById(id);
const dropzone = el('dropzone');
const fileInput = el('file-input');
const processing = el('processing');
const errorBox = el('error');
const errorMessage = el('error-message');
const controls = el('controls');
const result = el('result');
const singleBox = el('single-candidate');
const canvas = el('plot-canvas');
const saveBtn = el('save-btn');
const dropLead = document.querySelector('.drop-lead');
const bandpassToggle = el('bandpass-toggle');
const bandpassPanel = el('bandpass-panel');
const bpSaveBtn = el('bp-save-btn');
const bpFilename = el('bp-output-filename');

// Decoded state for the current drop (replaced wholesale by a new drop).
let loaded = null; // { names: string[], signals: Float64Array[], sr: number }
let current = null; // last pipeline result + suggested name + encode config
let bandpassMode = false; // single-IR bandpass-only flow toggled on
let bpLoaded = null; // { name, signal: Float64Array, sr }
let bpCurrent = null; // last bandpass result + suggested name + encode config

function show(...els) {
    for (const box of [processing, errorBox, result, singleBox]) {
        box.classList.toggle('hidden', !els.includes(box));
    }
}

function fail(message) {
    errorMessage.textContent = message;
    show(errorBox);
}

// Resolve a high/low-pass corner from a dropdown that may carry an "Enter
// value…" ("custom") option paired with a numeric field <id>-custom. Returns
// null for None / blank / unparseable (dsp.js validates positivity/order/Nyquist).
function resolveHz(selectId) {
    const sel = el(selectId);
    if (!sel) return null;
    if (sel.value === 'custom') {
        const raw = el(`${selectId}-custom`).value.trim();
        if (raw === '') return null;
        const v = parseFloat(raw);
        return Number.isFinite(v) ? v : null;
    }
    return sel.value === '' ? null : parseFloat(sel.value);
}

// Show a corner's numeric field only when its dropdown is on "Enter value…".
function syncCustomFields() {
    for (const id of ['highpass', 'lowpass', 'bp-highpass', 'bp-lowpass']) {
        const sel = el(id);
        const custom = el(`${id}-custom`);
        if (sel && custom) custom.classList.toggle('hidden', sel.value !== 'custom');
    }
}

function readControls() {
    const mode = document.querySelector('input[name="mode"]:checked')?.value ?? 'all';
    const marginRaw = el('margin-db').value.trim();
    return {
        mode: mode === 'all' ? null : mode,
        modeName: mode,
        method: el('method').value,
        weighting: el('weighting').value,
        lowHz: parseFloat(el('low-hz').value) || 250,
        highHz: parseFloat(el('high-hz').value) || 5000,
        marginDb: marginRaw === '' ? null : parseFloat(marginRaw),
        highpass: resolveHz('highpass'),
        lowpass: resolveHz('lowpass'),
        bitDepth: parseInt(el('bit-depth').value, 10),
        sampleRate: el('sample-rate').value,
    };
}

function readBandpassControls() {
    return {
        highpass: resolveHz('bp-highpass'),
        lowpass: resolveHz('bp-lowpass'),
        normalize: el('bp-normalize').checked,
        bitDepth: parseInt(el('bp-bit-depth').value, 10),
        sampleRate: el('bp-sample-rate').value,
    };
}

async function loadFiles(fileList) {
    const wavs = [...fileList].filter((f) => /\.wav$/i.test(f.name));
    const skipped = fileList.length - wavs.length;
    if (wavs.length < 2) {
        fail(
            skipped > 0
                ? `Only ${wavs.length} .wav file(s) among the ${fileList.length} dropped — need at least 2 IRs.`
                : 'Drop at least two .wav IR files.'
        );
        return;
    }
    show(processing);
    await nextPaint();
    const names = [];
    const signals = [];
    const rates = new Set();
    for (const f of wavs) {
        let decoded;
        try {
            decoded = await decodeWav(await f.arrayBuffer());
        } catch (e) {
            fail(`Could not decode "${f.name}": ${e.message}`);
            return;
        }
        names.push(f.name);
        signals.push(decoded.data);
        rates.add(decoded.sampleRate);
    }
    if (rates.size !== 1) {
        fail(`Sample-rate mismatch across files: ${[...rates].join(', ')} Hz. All IRs must share one rate.`);
        return;
    }
    loaded = { names, signals, sr: [...rates][0] };
    if (skipped > 0) {
        console.warn(`Ignored ${skipped} non-.wav file(s).`);
    }
    rerun();
}

function rerun() {
    if (!loaded) return;
    const cfg = readControls();
    let res;
    try {
        res = averageIRs(loaded.signals, loaded.sr, {
            method: cfg.method,
            weighting: cfg.weighting,
            mode: cfg.mode,
            lowHz: cfg.lowHz,
            highHz: cfg.highHz,
            marginDb: cfg.marginDb,
            highpass: cfg.highpass,
            lowpass: cfg.lowpass,
        });
    } catch (e) {
        fail(`Processing failed: ${e.message}`);
        return;
    }

    if (res.status === 'none') {
        fail(
            `No IRs matched --${cfg.modeName} (margin ${res.margin.toFixed(2)} dB). ` +
                'Loosen the margin or switch modes.'
        );
        return;
    }
    if (res.status === 'single') {
        el('single-candidate-message').textContent =
            `Only one IR matches "${cfg.modeName}", so there is nothing to summarize.`;
        el('single-candidate-file').textContent = loaded.names[res.index];
        show(singleBox);
        return;
    }

    const name = deriveOutputName(loaded.names, cfg.modeName, res.keptIndices.length, {
        highpass: cfg.highpass,
        lowpass: cfg.lowpass,
    });
    current = { res, name, cfg };
    el('output-filename').textContent = name;
    show(result);
    drawPlot(canvas, {
        average: res.out,
        averagePre: res.outPre,
        sources: res.aligned,
        dropped: res.dropped,
        sr: loaded.sr,
        L: res.L,
        mode: cfg.mode,
        lowHz: cfg.lowHz,
        highHz: cfg.highHz,
        hpHz: cfg.highpass,
        lpHz: cfg.lowpass,
        title: `${name.replace(/\.wav$/i, '')} — ${res.aligned.length} IRs (grey) vs average (red)` +
            (res.dropped.length ? `; ${res.dropped.length} dropped (dashed)` : ''),
    });
}

async function encodeAndDownload(data, sourceRate, cfg, name) {
    let rate = sourceRate;
    if (cfg.sampleRate !== 'source') {
        const target = parseInt(cfg.sampleRate, 10);
        data = await resample(data, rate, target);
        rate = target;
    }
    const buffer = encodeWav(data, rate, cfg.bitDepth);
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: name,
                types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(buffer);
            await writable.close();
            return;
        } catch (e) {
            if (e.name === 'AbortError') return; // user cancelled
            // fall through to download on any picker failure
        }
    }
    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function save() {
    if (!current) return;
    saveBtn.disabled = true;
    try {
        await encodeAndDownload(current.res.out, loaded.sr, current.cfg, current.name);
    } catch (e) {
        fail(`Save failed: ${e.message}`);
    } finally {
        saveBtn.disabled = false;
    }
}

// ---- single-IR bandpass-only flow ----

function setBandpassMode(on) {
    bandpassMode = on;
    loaded = null;
    current = null;
    bpLoaded = null;
    bpCurrent = null;
    controls.classList.toggle('hidden', on);
    bandpassPanel.classList.toggle('hidden', !on);
    bandpassToggle.textContent = on ? 'Average multiple IRs instead' : 'Bandpass a single IR';
    if (dropLead) {
        dropLead.textContent = on
            ? 'Drop one impulse response on the speaker'
            : 'Drop 2+ impulse responses on the speaker';
    }
    bpSaveBtn.disabled = true;
    bpFilename.textContent = '';
    show(); // clear any notices / prior result
}

async function loadBandpassFile(fileList) {
    const wavs = [...fileList].filter((f) => /\.wav$/i.test(f.name));
    if (wavs.length !== 1) {
        fail(
            wavs.length === 0
                ? 'Drop a single .wav IR to bandpass.'
                : `Drop exactly one IR to bandpass; got ${wavs.length}.`
        );
        return;
    }
    show(processing);
    await nextPaint();
    let decoded;
    try {
        decoded = await decodeWav(await wavs[0].arrayBuffer());
    } catch (e) {
        fail(`Could not decode "${wavs[0].name}": ${e.message}`);
        return;
    }
    bpLoaded = { name: wavs[0].name, signal: decoded.data, sr: decoded.sampleRate };
    show(); // hide the processing notice
    rerunBandpass();
}

function rerunBandpass() {
    if (!bandpassMode || !bpLoaded) return;
    const cfg = readBandpassControls();
    if (cfg.highpass === null && cfg.lowpass === null) {
        fail('Choose or enter a high-pass or low-pass corner to bandpass this IR.');
        bpSaveBtn.disabled = true;
        bpFilename.textContent = '';
        return;
    }
    let out;
    try {
        out = bandpassIR(bpLoaded.signal, bpLoaded.sr, {
            highpass: cfg.highpass,
            lowpass: cfg.lowpass,
            normalize: cfg.normalize, // unchecked = preserve the input's level (#9)
        });
    } catch (e) {
        fail(e.message);
        bpSaveBtn.disabled = true;
        bpFilename.textContent = '';
        return;
    }
    show(); // clear any prior error notice
    const name = deriveBandpassName(bpLoaded.name, { highpass: cfg.highpass, lowpass: cfg.lowpass });
    bpCurrent = { out, name, cfg };
    bpFilename.textContent = name;
    bpSaveBtn.disabled = false;
}

async function saveBandpass() {
    if (!bpCurrent) return;
    bpSaveBtn.disabled = true;
    try {
        await encodeAndDownload(bpCurrent.out, bpLoaded.sr, bpCurrent.cfg, bpCurrent.name);
    } catch (e) {
        fail(`Save failed: ${e.message}`);
    } finally {
        bpSaveBtn.disabled = false;
    }
}

function handleFiles(fileList) {
    if (bandpassMode) loadBandpassFile(fileList);
    else loadFiles(fileList);
}

function nextPaint() {
    return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

// --- wiring ---
dropzone.addEventListener('click', () => fileInput.click());
el('file-select-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});
fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles(fileInput.files);
    fileInput.value = '';
});
['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    })
);
['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
    })
);
dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
});

bandpassToggle.addEventListener('click', (e) => {
    e.stopPropagation(); // don't trigger the dropzone's file picker
    setBandpassMode(!bandpassMode);
});

// live re-render on any control change
controls.addEventListener('change', () => {
    syncCustomFields();
    rerun();
});
controls.addEventListener('input', (e) => {
    // numeric fields re-run as you type; selects/radios handled by 'change'
    if (e.target.matches('input[type="number"]')) rerun();
});
saveBtn.addEventListener('click', save);

// bandpass panel: same live-render wiring, its own pipeline
bandpassPanel.addEventListener('change', () => {
    syncCustomFields();
    rerunBandpass();
});
bandpassPanel.addEventListener('input', (e) => {
    if (e.target.matches('input[type="number"]')) rerunBandpass();
});
bpSaveBtn.addEventListener('click', saveBandpass);

// controls are useful before the first drop too (they apply live after it)
controls.classList.remove('hidden');
syncCustomFields();

// info tooltip + "why?" modal
const modeTooltipSlot = el('mode-tooltip-slot');
modeTooltipSlot?.replaceWith(
    createInfoTooltip(TILT_TOOLTIP_COPY, { label: 'About voicing selection' })
);

const bpNormalizeTooltipSlot = el('bp-normalize-tooltip-slot');
bpNormalizeTooltipSlot?.replaceWith(
    createInfoTooltip(RENORMALIZE_TOOLTIP_COPY, { label: 'About renormalization' })
);

const whyLink = el('why-link');
whyLink?.addEventListener('click', () => {
    openModal(WHY_MODAL_COPY, { title: 'Why SumIR?', triggerEl: whyLink });
});
