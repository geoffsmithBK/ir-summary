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
    ap.add_argument("-o", "--out", required=True, help="output WAV path")
    ap.add_argument("--plot", action="store_true", help="also write a PNG magnitude-response comparison")
    args = ap.parse_args()

    files = list(args.files)
    if args.dir:
        files += sorted(glob.glob(os.path.join(args.dir, "*.wav")))
        files += sorted(glob.glob(os.path.join(args.dir, "*.WAV")))
    if args.filter:
        files = [f for f in files if args.filter.lower() in os.path.basename(f).lower()]
    files = sorted(dict.fromkeys(files))  # de-dup, stable
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

    sf.write(args.out, out.astype(np.float32), sr, subtype="PCM_24")
    print(f"\nWrote {args.out}  ({len(out)} samples, 24-bit, {sr} Hz)")

    if args.plot:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        N = L
        freqs = np.fft.rfftfreq(N, 1 / sr)
        mo = np.abs(np.fft.rfft(out, N))
        ref_db = 20 * np.log10(np.maximum(mo.max(), 1e-9))  # put average peak at 0 dB
        plt.figure(figsize=(11, 6))
        for f, x in zip(files, aligned):
            m = np.abs(np.fft.rfft(x, N))
            plt.semilogx(freqs, 20 * np.log10(np.maximum(m, 1e-9)) - ref_db,
                         color="0.72", lw=0.8)
        plt.semilogx(freqs, 20 * np.log10(np.maximum(mo, 1e-9)) - ref_db,
                     color="crimson", lw=2.2, label="AVERAGE")
        plt.xlim(20, sr / 2); plt.ylim(-40, 6)
        plt.grid(True, which="both", alpha=0.3)
        plt.xlabel("Hz"); plt.ylabel("dB")
        plt.title(f"{os.path.basename(args.out)} — {len(files)} IRs (grey) vs average (red)")
        plt.legend()
        png = os.path.splitext(args.out)[0] + ".png"
        plt.tight_layout(); plt.savefig(png, dpi=110)
        print(f"Wrote {png}")


if __name__ == "__main__":
    main()
