# IR Summary

Tools for collapsing a group of cabinet **impulse responses** into a single,
representative "summary" IR — so you can grok a pack's tonal signature at a
glance instead of auditioning every file one by one (which has real perceptual
pitfalls).

It averages IRs the *right* way: not by naive time-domain summing (which
comb-filters wherever phases disagree), but by aligning, averaging the
**magnitude** spectra, and rebuilding a tight **minimum-phase** IR — the truest
tonal center-of-gravity of the group.

**[Try web version live](https://geoffsmithbk.github.io/ir-summary/)**

## What's here

- **`ir_average.py`** — the command-line tool (magnitude/min-phase averaging,
  spectral-tilt `--bright` / `--dark` / `--mids` selection, `--highpass` /
  `--lowpass` Butterworth band-shaping (18/12 dB per octave, min-phase — handy
  for black-box hardware IR loaders like pedal-format preamps with no
  downstream EQ), a single-IR `--bandpassonly` flow that filters one existing
  IR without averaging (preserving its own phase/character), readable plots,
  self-ingest guard, and basic cohort hygiene). See
  **[IR-Averaging-Notes.md](IR-Averaging-Notes.md)** for the full writeup
  and the reasoning behind the design.
- **`run-average.sh`** — a zero-friction wrapper that sets up its Python venv on
  first run and forwards all arguments to the tool.
- **`sumir/`** — **SumIR**, the client-side drag-and-drop web app port of the
  tool: drop 2+ IRs, get a summary plus an in-app plot, in a dark instrument-
  panel UI, with output format options (bit depth / sample rate) and save via
  the native picker or download. A "Bandpass a single IR" mode mirrors the
  CLI's `--bandpassonly` flow for filtering one IR. See `sumir/README.md`.
- **`docs/superpowers/specs/`** — the original design spec for the web app.

## Quick start (CLI)

```bash
# brighter half of a pack, with a magnitude plot, written next to the pack:
./run-average.sh --dir "path/to/IR pack" --bright --name "Pack - Bright Summary" --plot
```

The wrapper creates its virtualenv (numpy / scipy / soundfile / matplotlib) on
first run. Full option reference and worked examples live in
[IR-Averaging-Notes.md](IR-Averaging-Notes.md).

## Roadmap

- **Phase 1 (done):** SumIR, the client-side web droplet — drag 2+ IRs onto
  the page, get a summary plus an in-app magnitude plot, with save via the
  native picker or download and bit-depth / sample-rate output options. See
  `sumir/`.
- **Phase 2:** audition/preview (hear the summary through a guitar DI) and
  folder-drop.

## License

MIT — see [LICENSE](LICENSE).
