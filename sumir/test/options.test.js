import test from 'node:test';
import assert from 'node:assert/strict';
import { SELECTION_TUNING_IDS, inactiveOptionIds } from '../options.js';

test('the selection-tuning group is the three tilt-measure controls', () => {
    assert.deepEqual(SELECTION_TUNING_IDS, ['low-hz', 'high-hz', 'margin-db']);
});

test('mode "all" leaves the selection-tuning controls inactive', () => {
    assert.deepEqual(inactiveOptionIds('all'), ['low-hz', 'high-hz', 'margin-db']);
});

test('picking a tilt region activates the selection-tuning controls', () => {
    for (const mode of ['bright', 'dark', 'mids']) {
        assert.deepEqual(inactiveOptionIds(mode), [], `mode ${mode} should activate them`);
    }
});

test('a missing or unknown mode is treated as "all" (nothing selected yet)', () => {
    assert.deepEqual(inactiveOptionIds(undefined), ['low-hz', 'high-hz', 'margin-db']);
    assert.deepEqual(inactiveOptionIds(null), ['low-hz', 'high-hz', 'margin-db']);
});

test('inactiveOptionIds returns a fresh array callers cannot use to mutate the group', () => {
    const first = inactiveOptionIds('all');
    first.push('highpass');
    assert.deepEqual(inactiveOptionIds('all'), ['low-hz', 'high-hz', 'margin-db']);
    assert.deepEqual(SELECTION_TUNING_IDS, ['low-hz', 'high-hz', 'margin-db']);
});
