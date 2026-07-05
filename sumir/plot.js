/**
 * Canvas magnitude-response plot, mirroring the Python PNG conventions:
 * grey sources, crimson average, dashed steelblue dropped IRs, dotted
 * orange tilt-band markers, log frequency axis with readable ticks,
 * y axis -40..+6 dB relative to the average's peak.
 */
import { magnitudeSpectrum } from './dsp.js';

const TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const Y_MIN = -40;
const Y_MAX = 6;

const TITLE_FONT = '600 12px "IBM Plex Mono", ui-monospace, monospace';
const TITLE_LINE_H = 15;

// Greedy word-wrap so long titles (filter tags, dropped counts) aren't
// clipped at the canvas edges; the top margin grows per extra line.
function wrapTitle(ctx, text, maxW) {
    ctx.font = TITLE_FONT;
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(candidate).width > maxW) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }
    if (line) lines.push(line);
    return lines;
}

function dbCurve(x, N, sr) {
    const mag = magnitudeSpectrum(x, N);
    const half = N / 2;
    const db = new Float64Array(half + 1);
    for (let i = 0; i <= half; i++) {
        db[i] = 20 * Math.log10(Math.max(mag[i], 1e-9));
    }
    return db;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Object} p
 * @param {Float64Array} p.average - summary IR (post-filter when filtering)
 * @param {Float64Array|null} [p.averagePre] - unfiltered summary (ghost curve)
 * @param {Float64Array[]} p.sources - kept aligned IRs
 * @param {{aligned: Float64Array}[]} p.dropped - tilt-dropped IRs
 * @param {number} p.sr
 * @param {number} p.L
 * @param {string|null} p.mode - active tilt mode or null
 * @param {number} p.lowHz
 * @param {number} p.highHz
 * @param {number|null} [p.hpHz] - high-pass corner (marker)
 * @param {number|null} [p.lpHz] - low-pass corner (marker)
 * @param {string} p.title
 */
export function drawPlot(canvas, {
    average, averagePre = null, sources, dropped, sr, L,
    mode, lowHz, highHz, hpHz = null, lpHz = null, title,
}) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 800;
    const cssH = canvas.clientHeight || 400;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Dark instrument-panel theme (matches styles.css tokens).
    const theme = {
        bg: '#16171a',
        text: '#97938a',
        title: '#e8e5dc',
        grid: 'rgba(232, 229, 220, 0.07)',
        source: '#5c5f66',
        average: '#e5484d',
        dropped: '#7aa2c4',
        band: '#dfa64f',
        ghost: 'rgba(229, 72, 77, 0.35)',
        filter: '#63b3a4',
    };

    const titleLines = wrapTitle(ctx, title, cssW - 24);
    const margin = { left: 46, right: 12, top: 16 + TITLE_LINE_H * titleLines.length, bottom: 34 };
    const plotW = cssW - margin.left - margin.right;
    const plotH = cssH - margin.top - margin.bottom;
    const fMin = 20;
    const fMax = sr / 2;
    const xOf = (f) => margin.left + (Math.log10(f / fMin) / Math.log10(fMax / fMin)) * plotW;
    const yOf = (db) => margin.top + ((Y_MAX - db) / (Y_MAX - Y_MIN)) * plotH;

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    // grid + tick labels
    ctx.strokeStyle = theme.grid;
    ctx.fillStyle = theme.text;
    ctx.lineWidth = 1;
    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (const t of TICKS) {
        if (t > fMax) continue;
        const x = xOf(t);
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, margin.top + plotH);
        ctx.stroke();
        ctx.fillText(t.toLocaleString('en-US'), x, cssH - margin.bottom + 16);
    }
    ctx.textAlign = 'right';
    for (let db = Y_MIN; db <= Y_MAX; db += 10) {
        const y = yOf(db);
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + plotW, y);
        ctx.stroke();
        ctx.fillText(String(db), margin.left - 6, y + 4);
    }
    ctx.textAlign = 'center';
    ctx.fillText('Hz', margin.left + plotW / 2, cssH - 4);
    ctx.save();
    ctx.translate(11, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('dB', 0, 0);
    ctx.restore();

    // N = L exactly: the summary is built on the L-point circular grid, and
    // zero-padding to another size shows spurious interpolation ripple
    const N = L;
    const avgDb = dbCurve(average, N, sr);
    let refDb = -Infinity;
    for (const v of avgDb) refDb = Math.max(refDb, v);

    const drawCurve = (db, color, width, dash) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        let started = false;
        for (let i = 1; i <= N / 2; i++) {
            const f = (i * sr) / N;
            if (f < fMin || f > fMax) continue;
            const x = xOf(f);
            const y = yOf(Math.max(Y_MIN, Math.min(Y_MAX, db[i] - refDb)));
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.setLineDash([]);
    };

    // clip curves to the plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(margin.left, margin.top, plotW, plotH);
    ctx.clip();
    for (const x of sources) drawCurve(dbCurve(x, N, sr), theme.source, 1);
    for (const d of dropped) drawCurve(dbCurve(d.aligned, N, sr), theme.dropped, 1.2, [6, 4]);
    // pre-filter average as a ghost, so you can see what the filters removed
    if (averagePre) drawCurve(dbCurve(averagePre, N, sr), theme.ghost, 1.4, [4, 3]);
    drawCurve(avgDb, theme.average, 2.2);
    if (hpHz || lpHz) {
        ctx.strokeStyle = theme.filter;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1;
        for (const f of [hpHz, lpHz]) {
            if (!f || f < fMin || f > fMax) continue;
            ctx.beginPath();
            ctx.moveTo(xOf(f), margin.top);
            ctx.lineTo(xOf(f), margin.top + plotH);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }
    if (mode) {
        ctx.strokeStyle = theme.band;
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        for (const f of [lowHz, highHz]) {
            if (f < fMin || f > fMax) continue;
            ctx.beginPath();
            ctx.moveTo(xOf(f), margin.top);
            ctx.lineTo(xOf(f), margin.top + plotH);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }
    ctx.restore();

    // title + legend
    ctx.fillStyle = theme.title;
    ctx.font = TITLE_FONT;
    ctx.textAlign = 'center';
    titleLines.forEach((line, i) => {
        ctx.fillText(line, margin.left + plotW / 2, 16 + TITLE_LINE_H * i);
    });

    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    let lx = margin.left + 10;
    const ly = margin.top + 14;
    const legend = [
        [theme.source, `${sources.length} sources`, []],
        [theme.average, 'AVERAGE', []],
    ];
    if (averagePre) legend.splice(1, 0, [theme.ghost, 'pre-filter', [4, 3]]);
    if (dropped.length) legend.push([theme.dropped, `dropped (--${mode})`, [6, 4]]);
    if (hpHz || lpHz) {
        const parts = [];
        if (hpHz) parts.push(`HP ${Math.round(hpHz)}`);
        if (lpHz) parts.push(`LP ${Math.round(lpHz)}`);
        legend.push([theme.filter, `filters: ${parts.join(' / ')} Hz`, [5, 4]]);
    }
    if (mode) legend.push([theme.band, `tilt bands: <${Math.round(lowHz)} / >${Math.round(highHz)} Hz`, [2, 3]]);
    for (const [color, label, dash] of legend) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(lx, ly - 4);
        ctx.lineTo(lx + 18, ly - 4);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillText(label, lx + 24, ly);
        lx += 24 + ctx.measureText(label).width + 18;
    }
}
