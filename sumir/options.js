/**
 * SumIR — which Advanced controls apply to the current mode.
 *
 * The tilt-measure controls only feed the cohort selection, which runs solely
 * when a tilt region is picked (see the `mode` gate in dsp.js averageIRs, and
 * `if mode:` in ir_average.py). In the default "All" mode they have no effect,
 * so the UI disables them rather than letting them look live.
 */

/** Advanced controls that tune the tilt measure used for cohort selection. */
export const SELECTION_TUNING_IDS = ['low-hz', 'high-hz', 'margin-db'];

/**
 * Element ids that should be disabled for the given selection mode.
 * Anything other than an explicit tilt region ("bright" / "dark" / "mids")
 * counts as "All" — including an unset mode before any radio is read.
 */
export function inactiveOptionIds(mode) {
    const selecting = mode === 'bright' || mode === 'dark' || mode === 'mids';
    return selecting ? [] : [...SELECTION_TUNING_IDS];
}
