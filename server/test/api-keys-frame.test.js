/**
 * `src-electron/apiKeysFrame.js`: the one place the desktop app relaxes the
 * server's framing rules. Lives with the server tests because the root vitest
 * config only collects `src/**`.
 */
import { describe, expect, it } from 'vitest';

import { applyApiKeysFrameOverride } from '../../src-electron/apiKeysFrame.js';

const SERVER = 'https://pi.example:9010/';
const headers = () => ({
    'Content-Type': ['text/html'],
    'X-Frame-Options': ['SAMEORIGIN'],
    'Content-Security-Policy': ["default-src 'none'; frame-ancestors 'self'; base-uri 'none'"]
});
const details = (over = {}) => ({
    url: 'https://pi.example:9010/admin/api-keys?bridge=1&theme=dark',
    resourceType: 'subFrame',
    responseHeaders: headers(),
    ...over
});

describe('applyApiKeysFrameOverride', () => {
    it('lifts framing for the key page, as a sub-frame, on the connected server', () => {
        const { responseHeaders } = applyApiKeysFrameOverride(details(), SERVER);
        expect(Object.keys(responseHeaders).map((k) => k.toLowerCase())).not.toContain('x-frame-options');
        // Dropped, not widened: CSP's `*` never matches a file:// ancestor.
        expect(responseHeaders['Content-Security-Policy'][0]).not.toMatch(/frame-ancestors/i);
        // everything else in the policy is untouched
        expect(responseHeaders['Content-Security-Policy'][0]).toContain("default-src 'none'");
        expect(responseHeaders['Content-Security-Policy'][0]).toContain("base-uri 'none'");
        expect(responseHeaders['Content-Type']).toEqual(['text/html']);
    });

    it('keeps the remaining directives intact, in order, and copes with a lone frame-ancestors', () => {
        const only = applyApiKeysFrameOverride(
            details({ responseHeaders: { 'Content-Security-Policy': ["frame-ancestors 'self'"] } }),
            SERVER
        );
        expect(only.responseHeaders['Content-Security-Policy'][0]).toBe('');
        const mid = applyApiKeysFrameOverride(
            details({
                responseHeaders: { 'content-security-policy': ["a 'none'; frame-ancestors 'self' https://x; b 'none'"] }
            }),
            SERVER
        );
        expect(mid.responseHeaders['content-security-policy'][0]).toBe("a 'none'; b 'none'");
    });

    it.each([
        ['another server', { url: 'https://evil.example/admin/api-keys' }],
        ['another path on the server', { url: 'https://pi.example:9010/' }],
        ['a path that merely starts the same', { url: 'https://pi.example:9010/admin/api-keys-evil' }],
        ['a top-level navigation', { resourceType: 'mainFrame' }],
        ['a script request', { resourceType: 'script' }],
        ['a different port', { url: 'https://pi.example:9011/admin/api-keys' }],
        ['a different scheme', { url: 'http://pi.example:9010/admin/api-keys' }]
    ])('leaves headers alone for %s', (_label, over) => {
        expect(applyApiKeysFrameOverride(details(over), SERVER)).toEqual({});
    });

    it('does nothing when not connected to a server, or on a bad URL', () => {
        expect(applyApiKeysFrameOverride(details(), null)).toEqual({});
        expect(applyApiKeysFrameOverride(details({ url: 'not a url' }), SERVER)).toEqual({});
        expect(applyApiKeysFrameOverride(details(), 'also not a url')).toEqual({});
    });
});
