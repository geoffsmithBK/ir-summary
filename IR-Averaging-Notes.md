# Averaging Impulse Responses into a "Summary" IR

Session notes + tool documentation for collapsing a group of cabinet IRs into
one representative IR that captures the group's tonal signature — so you can
grok a pack's voicing without auditioning every file (and without the
perceptual pitfalls of serial A/B listening).

## The core problem: don't naively sum IRs

An IR is a **time-domain waveform**, not a frequency curve. Averaging two IRs
sample-by-sample (`(a + b) / 2`) sums signals whose phases disagree, so they
**cancel** wherever phase differs → comb filtering, a hollow/dull result that
sounds like neither source. This is worst when mic *positions* differ (e.g.
close mic + "Distant 24in"), because the later arrival is a big time offset.

## Approaches (tiers)

1. **Time-align, then average** (`--method timealign`) — detect each onset,
   shift to a common start, average in time domain. Keeps a "real" captured IR;
   high frequencies smear slightly because fine phase still differs.
2. **Magnitude-average → minimum-phase rebuild** (`--method magnitude`, default)
   — FFT each IR, average only the **magnitudes** (the voicing), discard the
   conflicting phases, rebuild a tight minimum-phase IR. Truest tonal
   center-of-gravity, zero cancellation. Best for "what does this pack sound
   like on average." It's a synthesized min-phase IR, not a literal recording —
   which is exactly right for a summary.
3. **Power/RMS averaging** (`--weighting power`) — average magnitude² then sqrt;
   slightly favors the louder/brighter mics ("loudest common voice").

### Selecting a sub-cohort by spectral tilt

The plain average can be "too representative" — extreme members pull the summary
toward the middle. You can instead average only one region of the pack's
**brightness axis**, defined by *spectral tilt*:

```
tilt(IR) = level(above --high-hz)  −  level(below --low-hz)     [dB]
```

with defaults `--high-hz 5000`, `--low-hz 250` (mids ignored — they don't decide
bright/dark). Tilt rolls *both* instincts into one number: an IR is "dark" by
having weak highs **or** strong lows. Because it's a highs-minus-lows ratio it's
also robust to these packs being peak- (not loudness-) normalized. Pick **at most
one** region:

- `--bright` — keep IRs with tilt ≥ cohort mean + margin (the brighter half)
- `--dark`   — keep IRs with tilt ≤ cohort mean − margin (the darker half)
- `--mids`   — keep IRs within ± margin of the mean tilt (trims *both* extremes)

`--margin-db` sets the bar: for bright/dark it defaults to 0 (split at the mean),
positive keeps fewer; for mids it's the half-width of the kept band and defaults
to the cohort tilt's standard deviation. The tool prints each IR's tilt and the
keep/drop decision; on the plot, dropped IRs are dashed and the two band edges
are marked.

**Single-candidate short-circuit:** if the selection leaves exactly one IR, there
is nothing to average — the tool writes nothing and instead names that single
best-fit file so you can use it directly. (Zero matches → it tells you to loosen
`--margin-db`.)

## Practical findings on a test case (JBL E120-8 pack from TONE3000.com)

- 33 IRs, all **48 kHz / 24-bit / mono / 0.5 s** (24,000 samples).
- The 7 **Cap Edge** mics (C414, i5, MD421, R121, SM57, SM7B, SM94) were already
  near-perfectly aligned: peaks at sample 5–6, cross-correlation drift **≤ 2
  samples (0.042 ms)**. Also already peak-normalized (~0.9755).
- Even the "Distant 24in" capture had its delay **stripped at creation**
  (aligns at shift 0) — so this maker pre-aligns everything. Not all packs do;
  many room/distant packs preserve the delay, which is why alignment + the
  warning below matter.
- Produced: `... - AVG Cap Edge (7 mics).wav` (+ `.png` magnitude plot).
  "Cap Edge" is a good pick to average — same physical spot on the cone, so only
  mic character varies.

## The tool: `ir_average.py`

Lives in its own git repo alongside `run-average.sh`
and this file. Uses numpy / scipy / soundfile / matplotlib in a `.ir-tools-venv`
venv that `run-average.sh` creates inside the repo on first run (gitignored).

### Behavior notes
- Auto-aligns every file via cross-correlation and prints each file's sample
  shift. **Prints a WARNING** when any file's shift exceeds **50 samples
  (~1 ms @ 48k)** — usually a distant/rear mic that snuck in (we still correct the shift either way).
- Defaults: `--method magnitude`, `--weighting linear`, peak-normalized to
  `-0.2 dBFS`. `-o` is required; `--plot` writes a same-named `.png`.
- Hard-stops if sample rates differ across files, or if fewer than 2 files
  survive the filter.
- A new folder may not be normalized or aligned like this pack — the printed
  shifts and the plot are your two sanity gauges.
- The frequency axis on the plot uses readable ticks (20, 50, 100, 200, 500,
  1,000 … 20,000 Hz), not powers of ten.
- **Output naming:** use `-o` for a full output path, or `--name "Foo"` to drop
  `Foo.wav` straight into the `--dir` being summarized (handy for keeping a
  pack's summary next to its IRs). Exactly one of the two is required.
- **Self-ingest guard:** the tool never averages its own output back in — the
  resolved output file is auto-excluded from the inputs, so re-running with
  `--name` into a source folder is safe. For *other* leftover summaries (e.g. an
  older `...- AVG ....wav` with a different name), use `--exclude SUBSTR`
  (repeatable, case-insensitive) — e.g. `--exclude AVG --exclude Summary`.
  Excluded files are listed at the top of the run with the reason.

### Easiest: the wrapper

`run-average.sh` (in the repo dir) activates the venv for you — creating it on
first run if missing — and forwards all args to `ir_average.py`. Works from any
directory:

```bash
"/Users/gsmith/Desktop/Speaker IR Archive/ir_average/run-average.sh" \
  --dir "../Newer IRs/SOME CAB" --filter "Cap Edge" -o "out - AVG.wav" --plot
```

### Manual usage (without the wrapper)

```bash
cd "/Users/gsmith/Desktop/Speaker IR Archive/ir_average"
source .ir-tools-venv/bin/activate   # or ../.ir-tools-venv if reusing the old one

# whole folder:
python3 ir_average.py --dir "../Newer IRs/SOME OTHER CAB" -o "/path/out - AVG.wav" --plot

# just one mic position across a folder:
python3 ir_average.py --dir "../Newer IRs/SOME OTHER CAB" --filter "Cone" -o "out - AVG Cone.wav" --plot

# drop the summary straight into the pack folder with a chosen name (safe to re-run):
python3 ir_average.py --dir "../Newer IRs/SOME OTHER CAB" --name "SOME OTHER CAB - Summary" --plot

# brighter half of a pack (tilt-based), excluding old summaries:
python3 ir_average.py --dir "../Newer IRs/SOME OTHER CAB" --bright --exclude AVG --name "SOME OTHER CAB - Bright" --plot

# darker half, or the central (least-extreme) cluster:
python3 ir_average.py --dir "../Newer IRs/SOME OTHER CAB" --dark --name "SOME OTHER CAB - Dark" --plot
python3 ir_average.py --dir "../Newer IRs/SOME OTHER CAB" --mids --name "SOME OTHER CAB - Mids" --plot

# hand-picked files:
python3 ir_average.py "a.wav" "b.wav" "c.wav" -o "out - AVG.wav"
```

Options: `-o PATH` / `--name BASENAME` (one required), `--exclude SUBSTR`
(repeatable), `--method {magnitude,timealign}`, `--weighting {linear,power}`,
`--length N` (output samples, 0 = match inputs), `--norm dBFS` (default -0.2),
`--filter SUBSTRING`, `--plot`, one of `--bright` / `--dark` / `--mids`,
`--low-hz HZ` (default 250), `--high-hz HZ` (default 5000),
`--margin-db DB` (bright/dark default 0; mids default = cohort tilt std).

## Design reflections & possible refinements

Decisions we made deliberately, and where they could bend later:

- **Why magnitude-average is the default.** Summing IRs in the time domain
  cancels wherever phases disagree. Averaging magnitudes and rebuilding a
  minimum-phase IR sidesteps that entirely and yields the truest *tonal*
  center-of-gravity — which is the whole point of a "summary." `timealign`
  stays available when you specifically want a real captured waveform.
- **Why selection is one tilt axis, not separate treble/bass knobs.** "Dark"
  is perceptually a *lack of treble relative to lows*, so `tilt = highs − lows`
  unifies "less treble" and "more bass" into a single, monotonic axis. That's
  what makes `--bright` / `--dark` / `--mids` clean opposites/center rather than
  three unrelated filters, and it's robust to the packs being peak- (not
  loudness-) normalized.
- **Brick-wall tilt bands (known limitation).** `--low-hz` / `--high-hz` are
  hard edges, so a single resonant peak parked right on an edge can swing an
  IR's tilt more than feels fair. If that ever bites, the fix is a softer
  measure — spectral **centroid**, or a smooth shelf weighting instead of hard
  band integration. Predictable hard edges were the right call for now.
- **Single-candidate short-circuit as a feature, not an error.** When a
  selection narrows to one IR, the honest answer is "don't average — just use
  this file," so the tool says exactly that and writes nothing.
- **Open ideas not yet built:** loudness/RMS normalization option (vs peak);
  a batch mode that emits bright/dark/mids summaries for a folder in one pass;
  optional CSV of per-IR tilt/level metrics for offline sorting.
