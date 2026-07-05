/**
 * markup.js — a tiny, deliberately dumb inline-markup subset used for
 * tooltip/modal copy in copy.js.
 *
 * Supported:
 *   **bold**, *italic*, [link text](url)
 *   blank-line paragraph breaks
 *   lines starting with "• " become list-item paragraphs
 *
 * `parseMarkup` is a pure string -> data-structure function (no DOM), so it
 * can be unit tested directly. `renderMarkupInto` (in popover.js) walks that
 * structure and builds real DOM nodes — never innerHTML — to render it.
 */

/**
 * Parse a single line/paragraph of text into an array of inline tokens.
 * @param {string} text
 * @returns {Array<{type: 'text'|'bold'|'italic'|'link', text: string, href?: string}>}
 */
export function parseInline(text) {
    const tokens = [];
    let buf = '';
    let i = 0;
    const n = text.length;

    function flush() {
        if (buf) {
            tokens.push({ type: 'text', text: buf });
            buf = '';
        }
    }

    while (i < n) {
        if (text.startsWith('**', i)) {
            const end = text.indexOf('**', i + 2);
            if (end !== -1) {
                flush();
                tokens.push({ type: 'bold', text: text.slice(i + 2, end) });
                i = end + 2;
                continue;
            }
        }

        if (text[i] === '*' && text[i + 1] !== '*') {
            const end = text.indexOf('*', i + 1);
            if (end !== -1) {
                flush();
                tokens.push({ type: 'italic', text: text.slice(i + 1, end) });
                i = end + 1;
                continue;
            }
        }

        if (text[i] === '[') {
            const closeBracket = text.indexOf(']', i + 1);
            if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
                const closeParen = text.indexOf(')', closeBracket + 2);
                if (closeParen !== -1) {
                    flush();
                    tokens.push({
                        type: 'link',
                        text: text.slice(i + 1, closeBracket),
                        href: text.slice(closeBracket + 2, closeParen),
                    });
                    i = closeParen + 1;
                    continue;
                }
            }
        }

        buf += text[i];
        i += 1;
    }
    flush();
    return tokens;
}

/**
 * Parse a full copy string into a list of paragraph/list-item blocks.
 * @param {string} source
 * @returns {Array<{type: 'p'|'li', inline: ReturnType<typeof parseInline>}>}
 */
export function parseMarkup(source) {
    const normalized = String(source).replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const blocks = normalized.split(/\n\s*\n/);
    const paragraphs = [];

    for (const block of blocks) {
        const trimmed = block.replace(/\s+/g, ' ').trim();
        if (!trimmed) continue;

        const isBullet = trimmed.startsWith('• ') || trimmed.startsWith('- ');
        const text = isBullet ? trimmed.slice(2).trim() : trimmed;

        paragraphs.push({
            type: isBullet ? 'li' : 'p',
            inline: parseInline(text),
        });
    }

    return paragraphs;
}
