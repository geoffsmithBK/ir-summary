/**
 * SumIR — user-facing popover/modal copy.
 *
 * Plain strings only. Supports a barebones inline markup subset, parsed by
 * markup.js: **bold**, *italic*, [link text](url), blank-line paragraph
 * breaks, and lines starting with "• " which render as list items.
 *
 * Edit this file to change any tooltip or modal copy — nothing else needs to
 * change.
 */

export const TILT_TOOLTIP_COPY = `
Skew the averaging toward the brighter or darker IRs in the group. SumIR measures each IR's *spectral tilt* — its level above 5 kHz minus its level below 250 Hz — and compares it to the group average: **Brighter** keeps only the IRs tilted brighter than average, **Darker** keeps only the darker ones (the Advanced *margin* sets how picky the selection is). No frequency-based processing (i.e. equalization) is performed on any file in this stage, it's merely a selection process (and so works better with larger summarization cohorts).
`.trim();

export const WHY_MODAL_COPY = `
[Impulse responses](https://www.tone3000.com/guides/what-is-an-impulse-response-ir-beginner-guide-guitarists#what-is-an-impulse-response) are becoming more and more widely used by guitar players in an equally widening range of scenarios. IRs are often available in large packs, which can be overwhelming or tedious to audition. And while many IR makers provide their own summary IRs, not all do and/or you might want more control over the summarization process.

Many IR utilities, primarily loaders, exist in plugin form for use in DAWs and other production environments, but what if you need to create a summary of a group of IRs from a large pack right before going on stage at a festival?

SumIR to the rescue: a simple, web-based tool that processes a few, or a dozen, or a folder full of IRs into a comprehensive average. No more rooting through a folder of dozens of IR files to find the 'right' one, especially when time is of the essence.

Additionally, SumIR provides a visual graph of the resulting summary IR as well as options for:

• Emphasizing the brighter or darker IRs during the averaging process. SumIR measures each IR's spectral tilt — how its energy above 5 kHz compares to its energy below 250 Hz — and averages only the brighter-than-average or darker-than-average members of the group. No frequency-based processing (i.e. equalization) is applied to any file in this stage; it's purely a selection process (and so works better with larger summarization cohorts).

• Summarization algorithms based on magnitude (averaging just the tonal fingerprint of each IR and rebuilding a clean minimum-phase result; this is the default) or time alignment (averaging the actual waveforms after lining up their onsets, which keeps a 'real' captured IR). All the IRs to be summarized must share one sample rate.

• High- and low-pass filtering lets you dump unusable lows, or smooth out fizzy highs, for an IR you need to send — right now! — to FoH, or use with in-ears. This stage does filter, or 'eq', the summary file (only), rolling off 18 dB/octave below the high-pass corner and/or 12 dB/octave above the low-pass corner.

Most importantly, SumIR runs *locally*. All processing happens in your browser and the files you upload for summarization never leave your computer/tablet/phone.
`.trim();

export const RENORMALIZE_TOOLTIP_COPY = `
Filtering removes energy, so the filtered IR ends up quieter than the file you dropped. **Renormalize** (the default) brings its peak back up to −0.2 dBFS — dumping inaudible sub-bass or fizz this way buys real headroom in a hardware loader. Uncheck to **preserve the original level**: the IR keeps the input file's own scale, minus only what the filters removed — handy when A/B level-matching against the unfiltered original.
`.trim();
