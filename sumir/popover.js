/**
 * popover.js — minimalist ⓘ tooltip + centered modal, shared by the whole
 * app. DOM only — the actual text parsing lives in markup.js so it can be
 * unit tested without a DOM.
 *
 * Never uses innerHTML with copy text: every node below is built with
 * createElement/textContent so the markup subset in copy.js can't leak raw
 * HTML into the page.
 */
import { parseMarkup } from './markup.js';

function appendInline(parent, inlineTokens) {
    for (const token of inlineTokens) {
        if (token.type === 'bold') {
            const strong = document.createElement('strong');
            strong.textContent = token.text;
            parent.appendChild(strong);
        } else if (token.type === 'italic') {
            const em = document.createElement('em');
            em.textContent = token.text;
            parent.appendChild(em);
        } else if (token.type === 'link') {
            const a = document.createElement('a');
            a.href = token.href;
            a.textContent = token.text;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            parent.appendChild(a);
        } else {
            parent.appendChild(document.createTextNode(token.text));
        }
    }
}

/**
 * Parse `source` and build DOM nodes for it into `container` (which is
 * cleared first). Consecutive "li" blocks are grouped into a single <ul>.
 */
export function renderMarkupInto(container, source) {
    container.textContent = '';
    let list = null;

    for (const block of parseMarkup(source)) {
        if (block.type === 'li') {
            if (!list) {
                list = document.createElement('ul');
                list.className = 'popover-list';
                container.appendChild(list);
            }
            const li = document.createElement('li');
            appendInline(li, block.inline);
            list.appendChild(li);
        } else {
            list = null;
            const p = document.createElement('p');
            appendInline(p, block.inline);
            container.appendChild(p);
        }
    }
}

// Only one tooltip popover may be open at a time.
let openTooltipClose = null;

function closeOpenTooltip() {
    if (openTooltipClose) {
        const close = openTooltipClose;
        openTooltipClose = null;
        close();
    }
}

/**
 * Build a circle-i info button that toggles a small anchored popover with
 * markup-rendered copy. Returns the wrapper element — append it wherever the
 * trigger should sit in the layout.
 *
 * @param {string} copyText
 * @param {{label?: string}} [opts]
 */
export function createInfoTooltip(copyText, { label = 'More information' } = {}) {
    const wrap = document.createElement('span');
    wrap.className = 'info-tooltip';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'info-trigger';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', 'false');
    button.textContent = 'i';

    const popover = document.createElement('div');
    popover.className = 'info-popover hidden';
    popover.setAttribute('role', 'dialog');
    popover.tabIndex = -1;
    renderMarkupInto(popover, copyText);

    wrap.append(button, popover);

    let isOpen = false;

    function onDocPointerDown(event) {
        if (!wrap.contains(event.target)) close();
    }

    function onKeydown(event) {
        if (event.key === 'Escape') close();
    }

    function open() {
        closeOpenTooltip();
        isOpen = true;
        popover.classList.remove('hidden');
        button.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', onDocPointerDown, true);
        document.addEventListener('keydown', onKeydown, true);
        popover.focus();
        openTooltipClose = close;
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        popover.classList.add('hidden');
        button.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onDocPointerDown, true);
        document.removeEventListener('keydown', onKeydown, true);
        if (openTooltipClose === close) openTooltipClose = null;
        button.focus();
    }

    button.addEventListener('click', () => {
        if (isOpen) close();
        else open();
    });

    return wrap;
}

/**
 * Open a centered modal dialog with a dimmed backdrop, rendering
 * markup-parsed `copyText`. Closes on ESC, backdrop click, or the × button.
 *
 * @param {string} copyText
 * @param {{title?: string, triggerEl?: HTMLElement}} [opts]
 * @returns {{close: () => void}}
 */
export function openModal(copyText, { title = 'About SumIR', triggerEl } = {}) {
    closeOpenTooltip();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);
    dialog.tabIndex = -1;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';

    const body = document.createElement('div');
    body.className = 'modal-body';
    renderMarkupInto(body, copyText);

    dialog.append(closeBtn, body);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('modal-open');

    function onKeydown(event) {
        if (event.key === 'Escape') close();
    }

    function onBackdropClick(event) {
        if (event.target === backdrop) close();
    }

    function close() {
        document.removeEventListener('keydown', onKeydown, true);
        backdrop.removeEventListener('click', onBackdropClick);
        backdrop.remove();
        document.body.classList.remove('modal-open');
        (triggerEl ?? null)?.focus();
    }

    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKeydown, true);
    backdrop.addEventListener('click', onBackdropClick);

    dialog.focus();

    return { close };
}
