import { beforeEach, describe, expect, it } from 'vitest';

import { setFaviconDot } from '../../../../client-web/shims/favicon.js';

const href = () => document.querySelector('link[rel~="icon"]')?.getAttribute('href');

describe('web favicon dot', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
    });

    it('creates the icon link on first use', async () => {
        await setFaviconDot('green');
        expect(document.querySelectorAll('link[rel~="icon"]')).toHaveLength(1);
        expect(href()).toContain('VRCX_notify_green');
    });

    it('reuses an existing icon link', async () => {
        const link = document.createElement('link');
        link.rel = 'shortcut icon';
        document.head.appendChild(link);
        await setFaviconDot('blue');
        expect(document.querySelectorAll('link[rel~="icon"]')).toHaveLength(1);
        expect(link.getAttribute('href')).toContain('VRCX_notify_blue');
    });

    it('null / false -> plain icon, red -> original notify icon', async () => {
        await setFaviconDot(null);
        expect(href()).toMatch(/VRCX[^_]*\.png|VRCX-/);
        expect(href()).not.toContain('notify');
        await setFaviconDot(false);
        expect(href()).not.toContain('notify');
        await setFaviconDot('red');
        expect(href()).toContain('VRCX_notify');
        expect(href()).not.toContain('VRCX_notify_');
    });

    it('legacy boolean true means red', async () => {
        await setFaviconDot(true);
        expect(href()).toContain('VRCX_notify');
    });

    it('unknown color falls back to red rather than a broken icon', async () => {
        await setFaviconDot('chartreuse');
        expect(href()).toContain('VRCX_notify');
    });

    it('a slower earlier call never overwrites a newer one', async () => {
        const first = setFaviconDot('green');
        const second = setFaviconDot(null);
        await Promise.all([first, second]);
        expect(href()).not.toContain('notify');
    });

    it('every color resolves to its own asset', async () => {
        const seen = new Set();
        for (const color of ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple']) {
            await setFaviconDot(color);
            seen.add(href());
        }
        expect(seen.size).toBe(7);
    });
});
