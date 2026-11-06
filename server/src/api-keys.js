/**
 * Persistent, scope-limited API keys for external, read-only consumers of
 * `/api/v1/*` (`./public-api.js`). A separate credential from the TOTP-minted
 * session tokens in `./http-auth.js`: sessions are all-powerful (full
 * `/api/rpc` read/write), keys can only ever do what their scopes name.
 *
 * ## Key format and storage
 *
 * `vrcx_<id>_<secret>` — `id` (8 hex) is a public lookup handle shown in
 * listings, `secret` is 32 random bytes (base64url). Only `sha256(secret)` is
 * persisted (a fast hash is fine for a high-entropy random secret), so a
 * leaked `VRCX.sqlite3` backup doesn't hand out working keys. The plaintext
 * key is returned exactly once, by `createApiKey`.
 *
 * Records live as one JSON array under the `VRCX_ServerApiKeys` config key,
 * the same place `./http-auth.js` keeps the TOTP and session secrets — no
 * schema change, so the database stays readable by the desktop app. Writes go
 * through a promise chain so concurrent create/revoke calls can't lose each
 * other's update.
 *
 * Revocation takes effect immediately (the list is read on every request).
 * `lastUsedAt` is only persisted at most once per `LAST_USED_WRITE_INTERVAL_MS`
 * per key, so a busy consumer doesn't turn every GET into a DB write.
 */
import crypto from 'node:crypto';

const CONFIG_KEY = 'VRCX_ServerApiKeys';
const KEY_PREFIX = 'vrcx';
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The full scope registry. A key can only be granted scopes listed here;
 * adding a new read endpoint means adding its scope here first.
 */
export const SCOPES = Object.freeze({
    'profile:read': 'Current user: id, display name, profile picture',
    'playtime:read':
        'When you were in the same instance as other players, with start/end and player count (from the game log)',
    'users:read': 'Cached name and picture for users, looked up by id',
    'friends:read': 'Your friend list: name, picture, status and online state (from the server cache)'
});

/**
 * @typedef {object} ApiKeyRecord
 * @property {string} id
 * @property {string} name
 * @property {string[]} scopes
 * @property {string} hash Sha256 hex of the secret half
 * @property {string} createdAt ISO
 * @property {string | null} expiresAt ISO, or null for a key that never expires
 * @property {string | null} lastUsedAt ISO
 */

/** @type {WeakMap<object, Promise<unknown>>} serializes writes per handle */
const writeChains = new WeakMap();
/** @type {Map<string, number>} key id -> last time lastUsedAt was persisted */
const lastUsedWrites = new Map();

/**
 * @param {string} secret
 * @returns {string}
 */
function hashSecret(secret) {
    return crypto.createHash('sha256').update(secret).digest('hex');
}

/**
 * @param {import('./db.js').DatabaseHandle} handle
 * @returns {Promise<ApiKeyRecord[]>}
 */
async function readRecords(handle) {
    const raw = await handle.configRepository.getString(CONFIG_KEY, '[]');
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Runs a read-modify-write on the record list, one at a time per handle.
 *
 * @template T
 * @param {import('./db.js').DatabaseHandle} handle
 * @param {(records: ApiKeyRecord[]) => { records: ApiKeyRecord[]; result: T }} mutate
 * @returns {Promise<T>}
 */
function updateRecords(handle, mutate) {
    const previous = writeChains.get(handle) ?? Promise.resolve();
    const run = previous.then(async () => {
        const { records, result } = mutate(await readRecords(handle));
        await handle.configRepository.setString(CONFIG_KEY, JSON.stringify(records));
        return result;
    });
    writeChains.set(
        handle,
        run.catch(() => {})
    );
    return run;
}

/**
 * @param {unknown} scopes
 * @returns {string[]} The validated, de-duplicated scopes
 * @throws If empty, not an array, or containing an unknown scope
 */
export function validateScopes(scopes) {
    if (!Array.isArray(scopes) || scopes.length === 0) {
        throw new Error('At least one scope is required');
    }
    const unknown = scopes.filter((scope) => typeof scope !== 'string' || !(scope in SCOPES));
    if (unknown.length > 0) {
        throw new Error(
            `Unknown scope(s): ${unknown.map(String).join(', ')}. Valid: ${Object.keys(SCOPES).join(', ')}`
        );
    }
    return [...new Set(scopes)];
}

/**
 * @param {import('./db.js').DatabaseHandle} handle
 * @param {{ name: string; scopes: unknown; expiresAt?: string | null }} input
 * @returns {Promise<{ key: string; record: Omit<ApiKeyRecord, 'hash'> }>} `key` is the plaintext and is not recoverable
 *   afterwards
 */
export async function createApiKey(handle, { name, scopes, expiresAt = null }) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) {
        throw new Error('name is required (max 100 characters)');
    }
    const validScopes = validateScopes(scopes);
    if (expiresAt !== null && expiresAt !== undefined) {
        const time = Date.parse(expiresAt);
        if (Number.isNaN(time) || time <= Date.now()) {
            throw new Error('expiresAt must be a future ISO date');
        }
    }
    const id = crypto.randomBytes(4).toString('hex');
    const secret = crypto.randomBytes(32).toString('base64url');
    const record = {
        id,
        name: name.trim(),
        scopes: validScopes,
        hash: hashSecret(secret),
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        lastUsedAt: null
    };
    await updateRecords(handle, (records) => ({
        records: [...records, record],
        result: undefined
    }));
    const { hash: _hash, ...publicRecord } = record;
    return { key: `${KEY_PREFIX}_${id}_${secret}`, record: publicRecord };
}

/**
 * @param {import('./db.js').DatabaseHandle} handle
 * @returns {Promise<Omit<ApiKeyRecord, 'hash'>[]>}
 */
export async function listApiKeys(handle) {
    return (await readRecords(handle)).map(({ hash: _hash, ...rest }) => rest);
}

/**
 * @param {import('./db.js').DatabaseHandle} handle
 * @param {string} id
 * @returns {Promise<boolean>} Whether a key was removed
 */
export async function revokeApiKey(handle, id) {
    return updateRecords(handle, (records) => {
        const remaining = records.filter((record) => record.id !== id);
        return {
            records: remaining,
            result: remaining.length !== records.length
        };
    });
}

/**
 * @param {import('./db.js').DatabaseHandle} handle
 * @param {string | undefined} presented The raw `vrcx_<id>_<secret>` string
 * @returns {Promise<ApiKeyRecord | null>} The matching, unexpired record
 */
export async function authenticateApiKey(handle, presented) {
    if (typeof presented !== 'string') {
        return null;
    }
    const match = /^vrcx_([0-9a-f]{8})_([A-Za-z0-9_-]{20,64})$/.exec(presented);
    if (!match) {
        return null;
    }
    const [, id, secret] = match;
    const record = (await readRecords(handle)).find((r) => r.id === id);
    if (!record) {
        return null;
    }
    const expected = Buffer.from(record.hash, 'hex');
    const actual = Buffer.from(hashSecret(secret), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return null;
    }
    if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
        return null;
    }
    touchLastUsed(handle, id);
    return record;
}

/**
 * Fire-and-forget; a failed bookkeeping write must never fail the request.
 *
 * @param {import('./db.js').DatabaseHandle} handle
 * @param {string} id
 */
function touchLastUsed(handle, id) {
    const now = Date.now();
    const last = lastUsedWrites.get(id) ?? 0;
    if (now - last < LAST_USED_WRITE_INTERVAL_MS) {
        return;
    }
    lastUsedWrites.set(id, now);
    updateRecords(handle, (records) => ({
        records: records.map((record) =>
            record.id === id ? { ...record, lastUsedAt: new Date(now).toISOString() } : record
        ),
        result: undefined
    })).catch(() => {});
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {string | undefined} The key from `Authorization: Bearer …`
 *   (deliberately not a cookie or query string: keys must not end up in
 *   browser state or access logs)
 */
export function readApiKey(req) {
    const header = req.headers.authorization;
    if (typeof header !== 'string') {
        return undefined;
    }
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    return match?.[1];
}
