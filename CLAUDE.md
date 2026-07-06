# ir_average

Tools for collapsing a group of guitar-cab impulse responses into one
representative "summary" IR. Two implementations of the same DSP pipeline:

- `ir_average.py` — the CLI (numpy/soundfile/matplotlib, venv via `run-average.sh`)
- `sumir/` — SumIR, the client-side browser port (plain ES modules, no build step)

Design rationale and option reference live in `IR-Averaging-Notes.md`; the web
app spec is `docs/superpowers/specs/2026-06-04-ir-droplet-web-app-design.md`.

## Reference-implementation policy (decided 2026-07-05)

**`ir_average.py` is the reference implementation.** New DSP features or
behavior changes are worked up and validated in the Python script first, then
ported to `sumir/dsp.js`, then parity-checked. Never change pipeline behavior in
the web app alone.

Parity discipline:

- The DSP pipeline (align → magnitude-average → min-phase; tilt selection;
  Butterworth band-shaping via `--highpass`/`--lowpass` — analytic magnitude,
  3rd-order/18 dB/oct HP and 2nd-order/12 dB/oct LP, −3 dB at corner, applied
  before normalization; defaults like −0.2 dBFS, 250/5000 Hz bands, margin
  rules; edge behaviors like the single-candidate short-circuit) must match
  between the two sides. Verified tolerance is < 0.01 dB on magnitude
  responses: `sumir/dsp.js` has an arbitrary-N FFT (Bluestein) so the whole
  pipeline runs on numpy's exact N = L grid. Do NOT reintroduce
  power-of-two-pad-then-truncate anywhere in the pipeline — it deviates
  audibly (multiple dB) once steep filtered magnitudes hit the min-phase
  rebuild, and the plot shows spurious ripple if drawn off-grid.
- Alignment-reference ties break by input file order. Python sorts its glob;
  the browser receives user drop order. Feed sorted input when comparing.
- UI/UX asymmetry is fine and expected (CLI has `--filter`/`--exclude`; web has
  output-format options). Only the pipeline needs parity.

Parity harness (seeded 2026-07-06): `tests/synthetic_ir_harness.py` generates a
pack of synthetic IRs with Gaussian-distributed spectral tilt and exercises the
DSP. It is currently **Python-side only** — it runs `ir_average.py` (All vs Mids)
and reports the difference; its synthetic-IR generator is the intended shared
input for the still-deferred two-sided check (a Node runner pushing the same
WAVs through `sumir/dsp.js`, asserting < 0.1 dB agreement). Until that JS runner
exists, re-verify JS↔Python parity manually after touching either side's DSP.
Building the two-sided half is the highest-leverage guard against drift; do it
if pipeline changes start happening regularly.

## Testing

- Web unit tests: `cd sumir && npm test` (Node built-in runner; covers wav.js
  round-trips, FFT/alignment/min-phase math, tilt selection, naming).
- The web app must be served over http (`python3 -m http.server`), not
  `file://` — ES modules won't load otherwise.
- CLI smoke test: generate synthetic IRs with soundfile, run
  `./run-average.sh --dir <folder> --name "Test" --plot`; usage errors must
  stay clean one-line `sys.exit` messages, and a plot failure must warn but
  still exit 0 (the WAV is the deliverable).

## Conventions

- CLI error handling stays `sys.exit("message")` — no exception hierarchies or
  logging boilerplate (a 2026-07-05 review rejected that approach; the diff is
  in `git stash` if ever needed).
- Output WAVs: 24-bit PCM default, peak-normalized to −0.2 dBFS.
- `*.wav` / `*.png` are gitignored (generated outputs).
