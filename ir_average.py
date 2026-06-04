#!/usr/bin/env python3
"""
ir_average.py — average a set of guitar-cab impulse responses into one
"summary" IR that captures the tonal signature of the group without the
phase-cancellation artifacts you'd get from naive time-domain summing.

Two methods:
  magnitude  (default) : time-align -> average the MAGNITUDE spectra ->
                         rebuild a tight minimum-phase IR. Truest tonal
                         center-of-gravity; zero comb filtering.
  timealign            : time-align -> average in the time domain. Keeps a
                         "real" captured IR; high freq smears a little.

Inputs can be explicit files or a folder, optionally filtered by a substring
(e.g. "Cap Edge").

Examples:
  # average the seven Cap Edge mics in a pack
  python3 ir_average.py --dir "1976 Deluxe Reverb Cabinet with JBL E120-8" \
      --filter "Cap Edge" -o "Cap Edge - AVG.wav" --plot

  # average a hand-picked list
  python3 ir_average.py file1.wav file2.wav file3.wav -o avg.wav

  # whole folder, power(RMS) averaging instead of linear magnitude
  python3 ir_average.py --dir somepack --weighting power -o pack-avg.wav
"""
import argparse, glob, os, sys
import numpy as np
import soundfile as sf


def load_mono(path):
    x, sr = sf.read(path, always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    return x.astype(np.float64), sr


def align_to_ref(x, ref):
    """Integer-sample shift of x to best match ref via cross-correlation."""
    n = max(len(x), len(ref))
    a = np.zeros(n); a[:len(x)] = x
    b = np.zeros(n); b[:len(ref)] = ref
    c = np.correlate(a - a.mean(), b - b.mean(), mode="full")
    lag = np.argmax(c) - (n - 1)
    if lag > 0:
        x = np.concatenate([x[lag:], np.zeros(lag)])
    elif lag < 0:
        x = np.concatenate([np.zeros(-lag), x[:lag]])
    return x, lag


def minimum_phase_from_mag(mag):
    """Build a minimum-phase impulse response from a magnitude spectrum.
    mag is the full (two-sided) magnitude of length N. Uses the real-cepstrum
    method: a min-phase signal has its log-magnitude and phase as a
    Hilbert-transform pair."""
    N = len(mag)
    log_mag = np.log(np.maximum(mag, 1e-12))
    cep = np.fft.ifft(log_mag).real           # real cepstrum
    w = np.zeros(N)
    w[0] = 1.0
    w[1:N // 2] = 2.0
    if N % 2 == 0:
        w[N // 2] = 1.0
    # odd N: leave the single midpoint at default (covered above)
    H = np.exp(np.fft.fft(cep * w))
    h = np.fft.ifft(H).real
    return h


def band_level_db(x, sr, lo, hi=None):
    """Energy of x within [lo, hi] Hz, in dB. Magnitude-based, so it's
    independent of any time shift applied to x."""
    if hi is None:
        hi = sr / 2
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / sr)
    band = (f >= lo) & (f <= hi)
    energy = np.sum(np.abs(X[band]) ** 2)
    return 10 * np.log10(max(energy, 1e-20))


def main():
    ap = argparse.ArgumentParser(description="Average impulse responses into one summary IR.")
    ap.add_argument("files", nargs="*", help="explicit IR files to average")
    ap.add_argument("--dir", help="folder of IRs to average")
    ap.add_argument("--filter", default="", help="only include files containing this substring")
    ap.add_argument("--method", choices=["magnitude", "timealign"], default="magnitude")
    ap.add_argument("--weighting", choices=["linear", "power"], default="linear",
                    help="magnitude method: average |H| (linear) or |H|^2 then sqrt (power/RMS)")
    ap.add_argument("--length", type=int, default=0, help="output length in samples (0 = match inputs)")
    ap.add_argument("--norm", type=float, default=-0.2, help="output peak normalize target in dBFS")
    ap.add_argument("-o", "--out", help="output WAV path (full path); alternative to --name")
    ap.add_argument("--name", help="output base filename written into the --dir being summarized "
                                   "(or cwd); alternative to -o")
    ap.add_argument("--exclude", action="append", metavar="SUBSTR",
                    help="skip input files whose name contains SUBSTR (repeatable)")
    ap.add_argument("--plot", action="store_true", help="also write a PNG magnitude-response comparison")
    # ---- cohort selection by spectral tilt = level(highs) - level(lows); pick at most one ----
    ap.add_argument("--bright", action="store_true",
                    help="keep only IRs tilted brighter than the cohort average (tilt >= mean + margin)")
    ap.add_argument("--dark", action="store_true",
                    help="keep only IRs tilted darker than the cohort average (tilt <= mean - margin)")
    ap.add_argument("--mids", action="store_true",
                    help="keep only IRs near the cohort-average tilt (|tilt - mean| <= margin); trims both extremes")
    ap.add_argument("--low-hz", type=float, default=250.0,
                    help="upper edge of the LOW band for the tilt measure (default 250)")
    ap.add_argument("--high-hz", type=float, default=5000.0,
                    help="lower edge of the HIGH band for the tilt measure (default 5000)")
    ap.add_argument("--margin-db", type=float, default=None,
                    help="selection bar in dB. bright/dark: default 0 (split at mean), positive keeps fewer. "
                         "mids: half-width of the kept center band, default = cohort tilt std")
    args = ap.parse_args()

    # resolve output path: -o is a full path; --name is a base filename placed in
    # the folder being summarized (or cwd). exactly one is required.
    if bool(args.out) == bool(args.name):
        sys.exit("Specify exactly one of -o/--out (full path) or --name (filename into the source folder).")
    if args.out:
        out_path = args.out
    else:
        base = args.name if args.name.lower().endswith(".wav") else args.name + ".wav"
        out_path = os.path.join(args.dir if args.dir else ".", base)
    out_abs = os.path.abspath(out_path)

    files = list(args.files)
    if args.dir:
        files += sorted(glob.glob(os.path.join(args.dir, "*.wav")))
        files += sorted(glob.glob(os.path.join(args.dir, "*.WAV")))
    if args.filter:
        files = [f for f in files if args.filter.lower() in os.path.basename(f).lower()]
    files = sorted(dict.fromkeys(files))  # de-dup, stable

    # self-ingest guard + user --exclude: never average our own output (or any
    # name the user excludes) back into the summary.
    removed = []
    kept = []
    for f in files:
        if os.path.abspath(f) == out_abs:
            removed.append((os.path.basename(f), "would re-ingest output"))
            continue
        hit = next((p for p in (args.exclude or []) if p.lower() in os.path.basename(f).lower()), None)
        if hit:
            removed.append((os.path.basename(f), f"--exclude '{hit}'"))
            continue
        kept.append(f)
    files = kept
    if removed:
        print(f"Excluded {len(removed)} file(s):")
        for name, why in removed:
            print(f"  - {name}  ({why})")
    if len(files) < 2:
        sys.exit(f"Need at least 2 IRs to average; found {len(files)}.")

    sigs, srs = [], []
    for f in files:
        x, sr = load_mono(f)
        sigs.append(x); srs.append(sr)
    if len(set(srs)) != 1:
        sys.exit(f"Sample-rate mismatch across files: {set(srs)}")
    sr = srs[0]

    # pad to common length
    L = max(len(x) for x in sigs)
    if args.length:
        L = args.length
    sigs = [np.concatenate([x, np.zeros(L - len(x))])[:L] for x in sigs]

    # align everything to the file whose onset is earliest (most "reference"-like)
    ref = sigs[int(np.argmin([np.argmax(np.abs(x) >= 0.01 * np.max(np.abs(x))) for x in sigs]))]
    aligned, lags = [], []
    for x in sigs:
        xa, lag = align_to_ref(x, ref)
        aligned.append(xa); lags.append(lag)

    # ---- optional cohort selection by spectral tilt (highs vs lows) ----
    dropped = []  # (name, aligned_signal, tilt_db) for plotting
    mode = next((m for m in ("bright", "dark", "mids") if getattr(args, m)), None)
    if sum(bool(getattr(args, m)) for m in ("bright", "dark", "mids")) > 1:
        sys.exit("Choose at most one of --bright / --dark / --mids.")
    if mode:
        tilts = np.array([band_level_db(x, sr, args.high_hz) - band_level_db(x, sr, 0, args.low_hz)
                          for x in aligned])
        mean_t = float(tilts.mean())
        if args.margin_db is not None:
            margin = args.margin_db
        else:
            margin = float(tilts.std()) if mode == "mids" else 0.0
        if mode == "bright":
            keep_mask = tilts >= mean_t + margin
            rule = f">= mean + {margin:.2f}"
        elif mode == "dark":
            keep_mask = tilts <= mean_t - margin
            rule = f"<= mean - {margin:.2f}"
        else:  # mids
            keep_mask = np.abs(tilts - mean_t) <= margin
            rule = f"within +/- {margin:.2f}"
        print(f"Tilt screen [{mode}]: tilt = L(>{args.high_hz:.0f}Hz) - L(<{args.low_hz:.0f}Hz); "
              f"cohort mean = {mean_t:+.2f} dB; keep tilt {rule} dB")
        keep = []
        for i, f in enumerate(files):
            tag = "keep" if keep_mask[i] else "drop"
            print(f"  [{tag}] {os.path.basename(f):55} tilt={tilts[i]:+.2f} dB")
            if keep_mask[i]:
                keep.append(i)
            else:
                dropped.append((os.path.basename(f), aligned[i], tilts[i]))
        n_keep = len(keep)
        if n_keep == 0:
            sys.exit(f"\nNo IRs matched --{mode} (margin {margin:.2f} dB). Loosen --margin-db.")
        if n_keep == 1:
            best = files[keep[0]]
            print(f"\nOnly one IR matches --{mode}, so there is nothing to summarize. "
                  f"Use this single best-fit IR directly:\n  {best}")
            return
        files   = [files[i]   for i in keep]
        aligned = [aligned[i] for i in keep]
        lags    = [lags[i]    for i in keep]
        print(f"  -> averaging {n_keep} of {len(keep_mask)} IRs\n")

    WARN_SHIFT = 50  # samples (~1 ms @ 48k); larger usually means a distant/rear mic snuck in
    print(f"Averaging {len(files)} IRs @ {sr} Hz, method={args.method}, weighting={args.weighting}")
    flagged = []
    for f, lag in zip(files, lags):
        mark = "  <-- LARGE SHIFT" if abs(lag) > WARN_SHIFT else ""
        if mark:
            flagged.append((os.path.basename(f), lag))
        print(f"  aligned {os.path.basename(f):55} shift={lag:+d}{mark}")
    if flagged:
        print(f"\n  WARNING: {len(flagged)} file(s) aligned by more than {WARN_SHIFT} samples "
              f"(~{WARN_SHIFT/sr*1000:.1f} ms). These are likely distant/rear captures whose "
              f"different arrival time can smear the average. Consider a --filter to keep the set coherent:")
        for name, lag in flagged:
            print(f"    {name}  (shift={lag:+d})")

    if args.method == "timealign":
        out = np.mean(aligned, axis=0)
    else:
        N = L
        mags = []
        for x in aligned:
            X = np.fft.fft(x, N)
            mags.append(np.abs(X))
        mags = np.array(mags)
        if args.weighting == "power":
            avg_mag = np.sqrt(np.mean(mags ** 2, axis=0))
        else:
            avg_mag = np.mean(mags, axis=0)
        out = minimum_phase_from_mag(avg_mag)

    # peak-normalize
    peak = np.max(np.abs(out))
    if peak > 0:
        target = 10 ** (args.norm / 20.0)
        out = out * (target / peak)

    sf.write(out_path, out.astype(np.float32), sr, subtype="PCM_24")
    print(f"\nWrote {out_path}  ({len(out)} samples, 24-bit, {sr} Hz)")

    if args.plot:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.ticker import FixedLocator, FuncFormatter
        N = L
        freqs = np.fft.rfftfreq(N, 1 / sr)
        mo = np.abs(np.fft.rfft(out, N))
        ref_db = 20 * np.log10(np.maximum(mo.max(), 1e-9))  # put average peak at 0 dB
        fig, ax = plt.subplots(figsize=(11, 6))
        for f, x in zip(files, aligned):
            m = np.abs(np.fft.rfft(x, N))
            ax.semilogx(freqs, 20 * np.log10(np.maximum(m, 1e-9)) - ref_db,
                        color="0.72", lw=0.8)
        # dropped IRs (if any) as dashed blue so you can see what was excluded
        for j, (name, x, lvl) in enumerate(dropped):
            m = np.abs(np.fft.rfft(x, N))
            ax.semilogx(freqs, 20 * np.log10(np.maximum(m, 1e-9)) - ref_db,
                        color="steelblue", lw=1.0, ls="--",
                        label=f"dropped (--{mode})" if j == 0 else None)
        ax.semilogx(freqs, 20 * np.log10(np.maximum(mo, 1e-9)) - ref_db,
                    color="crimson", lw=2.2, label="AVERAGE")
        if mode:
            ax.axvline(args.low_hz, color="darkorange", lw=1.0, ls=":",
                       label=f"tilt bands: <{args.low_hz:.0f} / >{args.high_hz:.0f} Hz")
            ax.axvline(args.high_hz, color="darkorange", lw=1.0, ls=":")
        ax.set_xlim(20, sr / 2); ax.set_ylim(-40, 6)
        # readable, non-exponential frequency ticks
        ticks = [t for t in (20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000) if t <= sr / 2]
        ax.xaxis.set_major_locator(FixedLocator(ticks))
        ax.xaxis.set_minor_locator(FixedLocator([]))  # no minor ticks/labels
        ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{int(v):,}"))
        ax.grid(True, which="major", alpha=0.3)
        ax.set_xlabel("Hz"); ax.set_ylabel("dB")
        n_kept = len(files)
        title = f"{os.path.basename(out_path)} — {n_kept} IRs (grey) vs average (red)"
        if dropped:
            title += f"; {len(dropped)} dropped (dashed)"
        ax.set_title(title)
        ax.legend()
        png = os.path.splitext(out_path)[0] + ".png"
        fig.tight_layout(); fig.savefig(png, dpi=110)
        print(f"Wrote {png}")


if __name__ == "__main__":
    main()
