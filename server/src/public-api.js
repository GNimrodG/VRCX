/**
 * The read-only, API-key-authenticated surface under `/api/v1/*`, for
 * external consumers (a stream overlay, a Discord bot, a personal site…).
 * Everything here reads the server's local cache — the SQLite database and
 * the already-logged-in VRChat user — and never calls VRChat itself, so a
 * misbehaving consumer can't burn the account's rate limit.
 *
 * Deliberately a hand-written allowlist of endpoints, not a window onto
 * `/api/rpc`: each route (`./public-api-routes.js`, which also generates the
 * OpenAPI spec) names the one scope that unlocks it and shapes its own
 * response, so internal database/config details never become a public contract.
 */
import http from 'node:http';
import https from 'node:https';

import { authenticateApiKey, readApiKey, SCOPES } from './api-keys.js';
import { allowedMethods, buildOpenApiSpec, matchRoute } from './public-api-routes.js';

const MAX_BODY_BYTES = 64 * 1024; // a 50-id batch is ~2 KiB; this is already generous

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>} The parsed JSON body; throws on oversize or invalid JSON
 */
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        req.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > MAX_BODY_BYTES) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * @param {import('./db.js').DatabaseHandle} handle
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 * @param {{ apiEnabled?: boolean; getCurrentUser?: () => any; getCachedUser?: (id: string) => any;
 *     getFriends?: () => any[]; getNote?: (id: string) => string | undefined }} options
 * @returns {Promise<{ status: number; body: any } | null>} `null` when the
 *   path isn't a `/api/v1/*` route at all, so the caller falls through
 */
export async function handlePublicApi(handle, req, url, options) {
    // Opt-in: with the API disabled the routes don't exist at all (callers
    // fall through to their ordinary 404), so nothing is probeable.
    if (!options.apiEnabled) {
        return null;
    }
    if (!url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1') {
        return null;
    }
    // GET everywhere; POST only on the routes that declare it (batch lookups
    // whose id list is too long for a URL). Nothing here ever mutates.
    if (req.method !== 'GET' && req.method !== 'POST') {
        return {
            status: 405,
            body: { ok: false, error: 'Read-only API: GET (or POST for batch lookups) only' }
        };
    }
    // The spec describes the API but exposes no data, so it needs no key.
    if (req.method === 'GET' && url.pathname === '/api/v1/openapi.json') {
        return { status: 200, body: buildOpenApiSpec(SCOPES) };
    }
    const key = await authenticateApiKey(handle, readApiKey(req));
    if (!key) {
        return {
            status: 401,
            body: { ok: false, error: 'Missing, invalid or expired API key' }
        };
    }
    const matched = matchRoute(url.pathname, req.method);
    if (!matched) {
        return allowedMethods(url.pathname).length > 0
            ? { status: 405, body: { ok: false, error: `${req.method} not allowed here` } }
            : { status: 404, body: { ok: false, error: 'Not found' } };
    }
    if (!key.scopes.includes(matched.route.scope)) {
        return {
            status: 403,
            body: { ok: false, error: `Key lacks scope ${matched.route.scope}` }
        };
    }
    let body;
    if (req.method === 'POST') {
        try {
            body = await readJsonBody(req);
        } catch (err) {
            return { status: 400, body: { ok: false, error: err.message } };
        }
    }
    return matched.route.handler({
        handle,
        body,
        getCurrentUser: () => options.getCurrentUser?.(),
        getCachedUser: (id) => options.getCachedUser?.(id) ?? null,
        getFriends: () => options.getFriends?.() ?? [],
        noteFor: (id) => (key.scopes.includes('notes:read') ? { note: options.getNote?.(id) || null } : {}),
        url,
        params: matched.params
    });
}

/**
 * A listener that serves *only* `/api/v1/*`, for exposing the read-only API
 * publicly while the main `serve` listener (login, `/api/rpc`, WebSockets,
 * key management, web client) stays private. Everything else, including
 * `/api/keys` and upgrade requests, doesn't exist here: 404 / socket closed.
 *
 * @param {import('./db.js').DatabaseHandle} handle
 * @param {{
 *     apiEnabled?: boolean;
 *     getCurrentUser?: () => any;
 *     tls?: { cert: Buffer | string; key: Buffer | string };
 * }} [options]
 * @returns {import('node:http').Server}
 */
export function createPublicApiServer(handle, options = {}) {
    const listener = async (req, res) => {
        let result;
        try {
            const url = new URL(req.url, 'http://localhost');
            result = (await handlePublicApi(handle, req, url, options)) ?? {
                status: 404,
                body: { ok: false, error: 'Not found' }
            };
        } catch {
            result = {
                status: 500,
                body: { ok: false, error: 'Internal error' }
            };
        }
        const payload = JSON.stringify(result.body);
        res.writeHead(result.status, {
            'Content-Type': 'application/json;charset=utf-8',
            'Content-Length': Buffer.byteLength(payload),
            'Cache-Control': 'no-store'
        });
        res.end(payload);
    };
    const server = options.tls
        ? https.createServer({ cert: options.tls.cert, key: options.tls.key }, listener)
        : http.createServer(listener);
    server.on('upgrade', (_req, socket) => socket.destroy());
    return server;
}

/**
 * The single opt-in switch for the whole external API (`/api/v1/*`, key
 * management, and the optional public listener). Off unless explicitly set.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isApiEnabled(env = process.env) {
    return /^(1|true|yes|on)$/i.test(env.VRCX_API_ENABLED ?? '');
}
