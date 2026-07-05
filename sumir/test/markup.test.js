import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkup } from '../markup.js';

test('parseInline splits plain text into a single text token', () => {
    assert.deepEqual(parseInline('hello world'), [{ type: 'text', text: 'hello world' }]);
});

test('parseInline recognizes bold spans', () => {
    assert.deepEqual(parseInline('a **bold** word'), [
        { type: 'text', text: 'a ' },
        { type: 'bold', text: 'bold' },
        { type: 'text', text: ' word' },
    ]);
});

test('parseInline recognizes italic spans without matching bold', () => {
    assert.deepEqual(parseInline('a *italic* word'), [
        { type: 'text', text: 'a ' },
        { type: 'italic', text: 'italic' },
        { type: 'text', text: ' word' },
    ]);
});

test('parseInline recognizes links', () => {
    assert.deepEqual(parseInline('see [this page](https://example.com) now'), [
        { type: 'text', text: 'see ' },
        { type: 'link', text: 'this page', href: 'https://example.com' },
        { type: 'text', text: ' now' },
    ]);
});

test('parseInline handles bold, italic, and a link together', () => {
    const tokens = parseInline('**Bright** keeps *tilted* ones, see [docs](https://x.test)');
    assert.deepEqual(tokens, [
        { type: 'bold', text: 'Bright' },
        { type: 'text', text: ' keeps ' },
        { type: 'italic', text: 'tilted' },
        { type: 'text', text: ' ones, see ' },
        { type: 'link', text: 'docs', href: 'https://x.test' },
    ]);
});

test('parseInline treats unterminated markers as literal text', () => {
    assert.deepEqual(parseInline('a **bold with no close'), [
        { type: 'text', text: 'a **bold with no close' },
    ]);
});

test('parseMarkup splits blank-line-separated blocks into paragraphs', () => {
    const blocks = parseMarkup('First paragraph.\n\nSecond paragraph.');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'p');
    assert.equal(blocks[1].type, 'p');
    assert.deepEqual(blocks[0].inline, [{ type: 'text', text: 'First paragraph.' }]);
    assert.deepEqual(blocks[1].inline, [{ type: 'text', text: 'Second paragraph.' }]);
});

test('parseMarkup treats "• " prefixed blocks as list items', () => {
    const blocks = parseMarkup('Intro paragraph.\n\n• First bullet.\n\n• Second bullet.');
    assert.deepEqual(
        blocks.map((b) => b.type),
        ['p', 'li', 'li']
    );
    assert.deepEqual(blocks[1].inline, [{ type: 'text', text: 'First bullet.' }]);
    assert.deepEqual(blocks[2].inline, [{ type: 'text', text: 'Second bullet.' }]);
});

test('parseMarkup ignores extra blank lines and surrounding whitespace', () => {
    const blocks = parseMarkup('\n\n  One.  \n\n\n\n  Two.  \n\n');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].inline[0].text, 'One.');
    assert.equal(blocks[1].inline[0].text, 'Two.');
});

test('parseMarkup returns an empty array for empty input', () => {
    assert.deepEqual(parseMarkup(''), []);
    assert.deepEqual(parseMarkup('   \n\n  '), []);
});

test('parseMarkup handles the real tooltip copy without throwing and keeps bold/italic markers', () => {
    const copy =
        "Emphasize brighter, darker, or middle-of-the-pack IRs during the averaging process. SumIR measures each IR's *spectral tilt* — its level above 5 kHz minus its level below 250 Hz — and compares it to the group average: **Bright** keeps the IRs tilted brighter than average, **Dark** keeps the darker ones, and **Mids** keeps those closest to the average (the Advanced *margin* sets how picky the selection is). No frequency-based processing (i.e. equalization) is performed on any file in this stage, it's merely a selection process (and so works better with larger summarization cohorts).";
    const blocks = parseMarkup(copy);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'p');
    const boldTexts = blocks[0].inline.filter((t) => t.type === 'bold').map((t) => t.text);
    assert.deepEqual(boldTexts, ['Bright', 'Dark', 'Mids']);
    const italicTexts = blocks[0].inline.filter((t) => t.type === 'italic').map((t) => t.text);
    assert.deepEqual(italicTexts, ['spectral tilt', 'margin']);
});
