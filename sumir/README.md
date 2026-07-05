# SumIR

SumIR is the browser port of `ir_average.py`: drag 2+ impulse-response WAVs onto the page,
get a magnitude-averaged minimum-phase summary IR plus an in-app magnitude
plot. Fully client-side — no uploads, no build step.

## Running it

ES modules don't load over `file://`, so serve the folder and open it:

```bash
cd sumir
python3 -m http.server 8000
# then visit http://localhost:8000
```

Any static host works the same way (the save picker needs HTTPS or localhost).

## Usage

1. Drop 2+ IR `.wav` files onto the dropzone (or click to select)
2. Pick a mode: All / Bright / Dark / Mids (tilt-based cohort selection)
3. Adjust Advanced options if needed — everything re-renders live
4. Save — native save dialog where supported, download otherwise

Output format (Advanced): 16/24-bit PCM or 32-bit float; source/44.1k/48k/96k
sample rate. Defaults (24-bit, source rate) need zero clicks.

Band-shaping (Advanced): optional high-pass (18 dB/oct; 50/80/120 Hz) and
low-pass (12 dB/oct; 6/8/10 kHz) Butterworth filters baked into the summary —
for IR loaders with no downstream EQ. Minimum-phase (no pre-ringing or added
latency), −3 dB at the corner, applied before normalization. The plot shows
the pre-filter average as a ghost, and applied filters are tagged into the
suggested filename (e.g. "… (4 IRs, HP80 LP8k).wav").

## Modules

- `wav.js` — RIFF/PCM decode (16/24/32-bit int, 32-bit float, EXTENSIBLE) and
  encode; preserves true sample rate (no `decodeAudioData`, which resamples)
- `dsp.js` — the pipeline: align → magnitude-average → minimum-phase rebuild;
  tilt selection; pure functions, no DOM
- `naming.js` — output filename from the longest common token-run
- `plot.js` — canvas magnitude plot (log axis, readable ticks)
- `resample.js` — output-rate conversion via `OfflineAudioContext`
- `app.js` — UI state machine and orchestration

## Tests

Node's built-in test runner covers the DOM-free modules (WAV round-trips,
FFT/alignment/min-phase math, tilt selection, naming):

```bash
cd sumir
npm test
```

Parity with the Python reference is held to < 0.01 dB across modes,
weightings, and filter settings (verified against `ir_average.py` on the same
inputs): `dsp.js` includes an arbitrary-N FFT (Bluestein) so the pipeline runs
on numpy's exact N = L grid rather than a padded power of two.
