# IR Droplet — Client-Side Web App (Design Spec)

**Date:** 2026-06-04
**Status:** Approved for planning
**Relates to:** `ir_average.py` (reference CLI implementation in this repo)

## Overview

A minimalist "droplet" web app for musicians: drag two or more impulse-response
WAVs onto a dropzone and get a single **summary IR** that captures the group's
tonal signature, plus an in-app magnitude plot to *see* the pack at a glance. It
is a browser port of the existing `ir_average.py` pipeline.

The app is **fully client-side** — no backend, no uploads, no build step. Audio
is processed in the browser and never leaves the user's machine. It can be
hosted as static files (e.g. Vercel) or run from `localhost`.

## Goals

- Drop 2+ `.wav` IRs → magnitude-averaged, minimum-phase summary IR.
- Show the magnitude response (sources vs. average) in-app — the "grok the pack"
  payoff.
- Expose the existing selection powers (All / Bright / Dark / Mids tilt) and
  core options (method, weighting, tilt bands) without clutter.
- Basic **output-format** control: bit depth and sample rate, for hardware that
  needs a specific format (e.g. Strymon Iridium).
- Save via a progressive strategy: native folder/file picker where supported,
  download fallback otherwise.
- Shareable as a link (audience: friends + a possible small product), while
  keeping the door open to a later native (Tauri) wrapper reusing this code.

## Non-Goals (deferred to Phase 2+)

- **Audition/preview** (convolving a guitar DI to *hear* the summary).
- **Folder drop** and the `--filter` / `--exclude` flags (unneeded while the app
  is files-only; the user curates by what they drag).
- Same-folder auto-save next to sources (a native affordance the browser sandbox
  forbids; consciously dropped — was a wish, not a requirement).
- `--norm` / `--length` controls (stay at defaults: −0.2 dBFS, match inputs).
- Exhaustive format matrix; only the basics below.

## Architecture

Single-page static app, plain HTML/CSS/ES-modules, no framework and no bundler.
Files read via the File API; processing in pure JS. The save picker (File System
Access API) needs a secure context, satisfied by `https`/`localhost`.

### Modules (small, single-purpose, DOM-free where noted)

| Module | Responsibility | Depends on |
|---|---|---|
| `wav.js` | Decode RIFF/PCM (16/24/32-bit int + 32-bit float; mono or down-mixed), preserving true sample rate. Encode 16/24-bit PCM and 32-bit float. **Not** `decodeAudioData` (it resamples). | — |
| `dsp.js` | Port of `ir_average.py`: align → FFT → magnitude-average → min-phase; tilt selection. Pure functions, no DOM. | — |
| `resample.js` | Sample-rate conversion of the final IR via `OfflineAudioContext` when target ≠ source. | — |
| `naming.js` | Derive output filename from dropped files + mode + count. | — |
| `plot.js` | Canvas magnitude plot: grey sources, red average, dashed dropped, log axis 20–20k with readable ticks, tilt-band markers. | — |
| `app.js` | UI state machine, control wiring, orchestration. | all |
| `index.html`, `styles.css` | Layout A (see below). | — |

## DSP Pipeline (parity with `ir_average.py`)

1. **Decode** each file → Float64 mono + sample rate. Require ≥ 2 valid files and
   a single shared input sample rate (else error).
2. **Pad** all to common length `L` (max length).
3. **Align**: cross-correlate each to the earliest-onset reference; integer-sample
   shift. (Warn threshold retained conceptually; not surfaced in UI for MVP.)
4. **Tilt selection** (if a mode is active): `tilt = level(>highHz) − level(<lowHz)`,
   defaults `lowHz=250`, `highHz=5000`. Cohort mean; keep:
   - `bright`: tilt ≥ mean + margin
   - `dark`: tilt ≤ mean − margin
   - `mids`: |tilt − mean| ≤ margin
   `margin` default 0 for bright/dark, cohort tilt **std** for mids.
   **Single-candidate short-circuit:** if exactly one IR survives, produce no
   summary — show "only one IR matches; use this file directly: <name>". Zero
   matches → prompt to loosen the margin.
5. **Average**: zero-pad to next power of two for FFT (e.g. 32768 for 24000),
   magnitude-average (`linear` or `power` weighting), rebuild **minimum-phase**
   via real-cepstrum, trim to `L`. (`timealign` method = mean of aligned signals.)
6. **Normalize** peak to −0.2 dBFS.
7. **Format**: resample to target sample rate if requested (resample.js), then
   encode at the chosen bit depth.

**Parity tolerance:** JS magnitude spectrum vs. `ir_average.py` reference output
on the Cap Edge set, within a small dB tolerance (exact bit-match not expected
due to FFT-size/zero-pad and resampler differences).

## Output Format (new, basic affordance)

In the **Advanced** disclosure, next to Save:

- **Bit depth:** `16` / `24` (default) PCM, plus `32-bit float` (optional).
- **Sample rate:** `Source` (default) / `44.1k` / `48k` / `96k`. When target ≠
  source, resample the final IR via `OfflineAudioContext`. Future refinement:
  proper polyphase/sinc resampler.

Defaults (Source-rate / 24-bit) mean the common 24/48 workflow needs zero clicks.

## Interaction (Layout A — progressive droplet)

States:

- **Empty:** hero dropzone ("Drop 2+ IRs here / or click to choose"). Slim
  `All · Bright · Dark · Mids` segmented control beneath; `▸ Advanced` disclosure
  (method, weighting, lowHz, highHz, margin, bit depth, sample rate).
- **Result:** magnitude plot (full width) + derived filename + **Save**. Changing
  any control **re-renders live** (cheap). Re-dropping replaces the set.
- **Single-candidate / errors:** inline message in place of the result.

## Output Naming

Longest common token-run across dropped filenames + mode + count, e.g.
`1976 Deluxe Reverb 1x12 JBL E120-8 — Bright Summary (5 IRs).wav`; fallback
`IR Summary (N).wav`. User can rename in the save dialog.

## Error Handling (inline in the dropzone)

- Non-`.wav` dropped → ignored with a notice.
- `< 2` valid files → "drop at least two IRs".
- Input sample-rate mismatch → error listing the differing rates.
- Decode failure → names the offending file.

## Testing

- **Unit (Node built-in test runner, ES modules, no bundler):** WAV
  decode/encode round-trip at each bit depth; FFT against known transforms; tilt
  math; naming derivation.
- **Parity:** compare `dsp.js` output to `ir_average.py` reference on the Cap
  Edge set (magnitude within tolerance).
- **Manual:** drop the Cap Edge set; confirm in-app plot matches the Python PNG;
  verify Save in Chrome (picker) and Safari (download); spot-check a 44.1k/16-bit
  export loads in a hardware IR loader.

## Repo Placement

A **`web/`** subdirectory inside this `ir_average` repo, so the JS port lives
beside its reference Python (honest parity tests, shared git history).

## Future Refinements (noted, not built)

- Polyphase/sinc resampler in place of `OfflineAudioContext`.
- Tauri wrapper → native droplet with real paths + same-folder save, reusing this
  UI and `dsp.js` unchanged.
- Audition/preview (Phase 2).
- Folder drop + filter/exclude (Phase 2).
