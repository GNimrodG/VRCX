/**
 * Header rewrite behind the in-app "Manage API keys" dialog.
 *
 * The server's key-management page (`server/src/api-keys-page.js`) refuses to
 * be framed by anything but its own origin. The desktop app's page is
 * `file://`, a different origin, so `main.js` lifts that restriction for
 * exactly one request shape: the page URL, as a sub-frame, on the server the
 * app is connected to. The server keeps its strict default for every real
 * browser, so it never has to allow `file://` or carry a configurable origin
 * list. A hostile page that framed it gets nothing: in that context the page
 * has no session cookie and only ever talks to its parent window.
 *
 * Kept free of Electron imports so it can be unit-tested.
 */

/**
 * Removes the `frame-ancestors` directive outright instead of widening it:
 * CSP's `*` only matches network schemes (http, https, ws…), never `file:`,
 * so `frame-ancestors *` would still block the app's `file://` page. (Found
 * live in Electron: the widened header was still refused with
 * ERR_BLOCKED_BY_RESPONSE.)
 *
 * @param {string} policy A Content-Security-Policy header value
 * @returns {string}
 */
function dropFrameAncestors(policy) {
    return policy
        .split(';')
        .map((directive) => directive.trim())
        .filter((directive) => directive && !/^frame-ancestors(\s|$)/i.test(directive))
        .join('; ');
}

/**
 * @param {{ url: string; resourceType?: string; responseHeaders?: Record<string, string[]> }} details An Electron
 *   `onHeadersReceived` details object
 * @param {string | null} serverUrl The server the app is connected to
 * @returns {{ responseHeaders?: Record<string, string[]> }} The callback argument
 */
function applyApiKeysFrameOverride(details, serverUrl) {
    try {
        const target = new URL(details.url);
        const applies =
            details.resourceType === 'subFrame' &&
            Boolean(serverUrl) &&
            target.origin === new URL(serverUrl).origin &&
            target.pathname === '/admin/api-keys';
        if (!applies) {
            return {};
        }
    } catch {
        // Unparseable URL: leave the headers alone.
        return {};
    }
    const responseHeaders = {};
    for (const [name, values] of Object.entries(details.responseHeaders ?? {})) {
        const lower = name.toLowerCase();
        if (lower === 'x-frame-options') {
            continue;
        }
        responseHeaders[name] = lower === 'content-security-policy' ? values.map(dropFrameAncestors) : values;
    }
    return { responseHeaders };
}

module.exports = { applyApiKeysFrameOverride };
