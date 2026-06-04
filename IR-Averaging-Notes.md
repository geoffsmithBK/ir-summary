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

## Practical findings on the JBL E120-8 pack

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

Lives at the archive root: `/Users/gsmith/Desktop/Speaker IR Archive/ir_average.py`
Uses numpy / scipy / soundfile / matplotlib in the `.ir-tools-venv` venv there.

### Behavior notes
- Auto-aligns every file via cross-correlation and prints each file's sample
  shift. **Prints a WARNING** when any file's shift exceeds **50 samples
  (~1 ms @ 48k)** — usually a distant/rear mic that snuck in; consider a
  `--filter` to keep the set coherent. (It still corrects the shift either way.)
- Defaults: `--method magnitude`, `--weighting linear`, peak-normalized to
  `-0.2 dBFS`. `-o` is required; `--plot` writes a same-named `.png`.
- Hard-stops if sample rates differ across files, or if fewer than 2 files
  survive the filter.
- A new folder may not be normalized or aligned like this pack — the printed
  shifts and the plot are your two sanity gauges.

### Easiest: the wrapper

`run-average.sh` (archive root) activates the venv for you — creating it on first
run if missing — and forwards all args to `ir_average.py`. Works from any
directory:

```bash
"/Users/gsmith/Desktop/Speaker IR Archive/run-average.sh" \
  --dir "Newer IRs/SOME CAB" --filter "Cap Edge" -o "out - AVG.wav" --plot
```

### Manual usage (without the wrapper)

```bash
cd "/Users/gsmith/Desktop/Speaker IR Archive"
source .ir-tools-venv/bin/activate

# whole folder:
python3 ir_average.py --dir "Newer IRs/SOME OTHER CAB" -o "/path/out - AVG.wav" --plot

# just one mic position across a folder:
python3 ir_average.py --dir "Newer IRs/SOME OTHER CAB" --filter "Cone" -o "out - AVG Cone.wav" --plot

# hand-picked files:
python3 ir_average.py "a.wav" "b.wav" "c.wav" -o "out - AVG.wav"
```

Options: `--method {magnitude,timealign}`, `--weighting {linear,power}`,
`--length N` (output samples, 0 = match inputs), `--norm dBFS` (default -0.2),
`--filter SUBSTRING`, `--plot`.
