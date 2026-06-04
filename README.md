# IR Summary

Tools for collapsing a group of cabinet **impulse responses** into a single,
representative "summary" IR — so you can grok a pack's tonal signature at a
glance instead of auditioning every file one by one (which has real perceptual
pitfalls).

It averages IRs the *right* way: not by naive time-domain summing (which
comb-filters wherever phases disagree), but by aligning, averaging the
**magnitude** spectra, and rebuilding a tight **minimum-phase** IR — the truest
tonal center-of-gravity of the group.

## What's here

- **`ir_average.py`** — the command-line tool (magnitude/min-phase averaging,
  spectral-tilt `--bright` / `--dark` / `--mids` selection, readable plots,
  self-ingest guard, and basic cohort hygiene). See
  **[IR-Averaging-Notes.md](IR-Averaging-Notes.md)** for the full writeup and the
  reasoning behind the design.
- **`run-average.sh`** — a zero-friction wrapper that sets up its Python venv on
  first run and forwards all arguments to the tool.
- **`docs/superpowers/specs/`** — the design spec for the **IR Summary droplet**,
  a client-side drag-and-drop web app port (in progress).

## Quick start (CLI)

```bash
# brighter half of a pack, with a magnitude plot, written next to the pack:
./run-average.sh --dir "path/to/IR pack" --bright --name "Pack - Bright Summary" --plot
```

The wrapper creates its virtualenv (numpy / scipy / soundfile / matplotlib) on
first run. Full option reference and worked examples live in
[IR-Averaging-Notes.md](IR-Averaging-Notes.md).

## Roadmap

- **Phase 1 (designed):** a minimalist client-side web *droplet* — drag 2+ IRs
  onto a window, get a summary plus an in-app magnitude plot, with progressive
  save and basic bit-depth / sample-rate output options.
- **Phase 2:** audition/preview (hear the summary through a guitar DI) and
  folder-drop.
