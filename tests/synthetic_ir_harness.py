#!/usr/bin/env python3
"""Synthetic-IR behavior harness for the ir_average.py reference implementation.

Currently a *Python-side* probe: it generates a pack of synthetic cab IRs whose
spectral tilt is Gaussian-distributed, runs the real ir_average.py in All vs
Mids modes, and reports how much the two summaries actually differ. It exists to
answer "is the 'Mids' selection distinct from 'All' on a normal pack?" — the
finding (2026-07-06) is that on a clean Gaussian cohort they differ by only
~0.3 dB RMS / <0.5 dB peak, which is why the SumIR UI stopped exposing Mids.

This is also the seed for the deferred two-sided parity harness noted in
CLAUDE.md: the synthetic-IR generator here is exactly the shared input a Node
runner would push through sumir/dsp.js so both implementations can be diffed at
< 0.1 dB. Until that JS runner exists, this guards the Python side only.

Run with the project venv:
    .ir-tools-venv/bin/python tests/synthetic_ir_harness.py
Env knobs: N (cohort size), N_RES (per-IR random resonances; 0 = pure tilt),
KEEP=1 (leave the generated WAVs on disk instead of cleaning up).
"""
import os, sys, subprocess, tempfile, shutil
import numpy as np
import soundfile as sf

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
from ir_average import minimum_phase_from_mag, band_level_db  # reuse tool's math

SR = 48000
L = 24000            # 0.5 s, like the real packs
N = int(os.environ.get("N", 200))         # cohort size
SIGMA_TILT = 4.0     # target std of the tilt metric (dB), a realistic pack spread
PIVOT = 1000.0
SEED = 7
N_RES = int(os.environ.get("N_RES", 0))   # per-IR random resonances (0 = pure tilt)

rng = np.random.default_rng(SEED)
freqs = np.fft.rfftfreq(L, 1 / SR)
f = np.maximum(freqs, 1.0)                 # avoid log(0) at DC
logf = np.log2(f / PIVOT)


def base_cab_mag():
    """A plausible guitar-cab magnitude curve on the rfft grid (linear)."""
    g_db = np.zeros_like(f)
    g_db += 6.0 / (1 + (80.0 / f) ** 4)                      # HP-ish below 80
    g_db += 5.0 * np.exp(-((np.log2(f / 130.0)) ** 2) / (2 * 0.5 ** 2))   # low bump
    g_db += 4.0 * np.exp(-((np.log2(f / 2800.0)) ** 2) / (2 * 0.6 ** 2))  # presence
    g_db += -18.0 / (1 + (5000.0 / f) ** 3) * (f > 1000)     # HF rolloff
    return 10 ** (g_db / 20.0)


# tilt metric moves ~ slope * (octave span between the high & low band centroids)
oct_span = np.log2(7000.0 / 1000.0) - np.log2(120.0 / 1000.0)   # ~5.9 oct
sigma_slope = SIGMA_TILT / oct_span
base = base_cab_mag()


def make_ir(slope_db_per_oct):
    tilt_curve_db = slope_db_per_oct * logf
    res_db = np.zeros_like(f)
    for _ in range(N_RES):                 # light independent resonances for realism
        fc = 10 ** rng.uniform(np.log10(200), np.log10(6000))
        q = rng.uniform(0.4, 0.9)
        amp = rng.normal(0, 0.8)
        res_db += amp * np.exp(-((np.log2(f / fc)) ** 2) / (2 * q ** 2))
    mag_half = base * 10 ** ((tilt_curve_db + res_db) / 20.0)
    full = np.concatenate([mag_half, mag_half[-2:0:-1]])   # two-sided for min-phase
    ir = minimum_phase_from_mag(full)[:L]
    ir = ir / np.max(np.abs(ir)) * 0.97    # peak-normalized like real packs
    return ir.astype(np.float32)


def mag_db(x):
    m = np.abs(np.fft.rfft(x, L))
    return 20 * np.log10(np.maximum(m, 1e-9))


def tilt_of(x):
    return band_level_db(x, SR, 5000) - band_level_db(x, SR, 0, 250)


def main():
    workdir = tempfile.mkdtemp(prefix="sumir_harness_")
    try:
        slopes = rng.normal(0, sigma_slope, N)
        tilts = []
        for i, s in enumerate(slopes):
            ir = make_ir(s)
            sf.write(os.path.join(workdir, f"ir_{i:02d}.wav"), ir, SR, subtype="PCM_24")
            tilts.append(tilt_of(ir.astype(np.float64)))
        tilts = np.array(tilts)
        z = (tilts - tilts.mean()) / tilts.std()
        print(f"Cohort N={N}  N_RES={N_RES}  tilt metric: mean={tilts.mean():+.2f} dB  "
              f"std={tilts.std():.2f} dB  skew={np.mean(z ** 3):+.2f}  "
              f"range=[{tilts.min():+.2f}, {tilts.max():+.2f}]")

        tool = os.path.join(REPO, "ir_average.py")
        out_all = os.path.join(workdir, "SUM_all.wav")
        out_mids = os.path.join(workdir, "SUM_mids.wav")

        def run(args, out):
            r = subprocess.run([sys.executable, tool, "--dir", workdir, "-o", out,
                                "--exclude", "SUM_"] + args, capture_output=True, text=True)
            if r.returncode != 0:
                sys.exit(f"ir_average.py failed:\n{r.stderr}")
            return r.stdout

        run([], out_all)
        mids_log = run(["--mids"], out_mids)
        kept, dropped = mids_log.count("[keep]"), mids_log.count("[drop]")
        print(f"Mids kept {kept}/{N}, dropped {dropped}  "
              f"(expect ~68% kept for +/-1 sigma on a Gaussian)")

        a = mag_db(sf.read(out_all)[0]);  a -= a.max()
        m = mag_db(sf.read(out_mids)[0]); m -= m.max()
        d = m - a

        def band_mean(lo, hi):
            sel = (freqs >= lo) & (freqs <= hi)
            return d[sel].mean()

        aud = (freqs >= 20) & (freqs <= 18000)
        print("\nMids - All magnitude difference (audible 20 Hz-18 kHz):")
        print(f"  max |diff| = {np.abs(d[aud]).max():.3f} dB")
        print(f"  RMS  diff  = {np.sqrt(np.mean(d[aud] ** 2)):.3f} dB")
        print(f"  lows  (20-250 Hz)  = {band_mean(20, 250):+.3f} dB")
        print(f"  mids  (250-5k Hz)  = {band_mean(250, 5000):+.3f} dB")
        print(f"  highs (5k-18k Hz)  = {band_mean(5000, 18000):+.3f} dB")
    finally:
        if os.environ.get("KEEP"):
            print(f"\nKEEP set; generated pack left at {workdir}")
        else:
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
