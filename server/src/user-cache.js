/**
 * `public_user_cache`: a persistent copy of the user fields the public API
 * exposes, filled on demand for the single-user endpoint.
 *
 * Upstream keeps users in memory only (`cachedUsers`), so anyone not seen
 * since the last restart is unknown to `GET /api/v1/users/{id}`. For that one
 * non-bulk route the server looks the user up in this order:
 *
 *  1. the in-memory store cache (always fresh enough, kept current by the pipeline);
 *  2. this table, if the row is younger than {@link FRESH_MS};
 *  3. VRChat (`users/{id}`), then persisted here, when logged in;
 *  4. a stale row from this table if VRChat can't be reached or errors;
 *  5. otherwise `null` (the route answers 404).
 *
 * Bulk routes never reach VRChat. Protection for the account's rate limit:
 * concurrent lookups of one id share a single request, and a failed lookup
 * is remembered for {@link NEGATIVE_MS} so repeats don't hammer VRChat.
 *
 * Server-owned and additive, like `discord_ids`: created here, not in
 * upstream's `database/index.js`, and ignored by the desktop app.
 */
import sqliteService from '../../src/services/sqlite.js';
import { log } from './log.js';

export const FRESH_MS = 24 * 60 * 60 * 1000;
export const NEGATIVE_MS = 5 * 60 * 1000;

// Only what `publicUser()` reads; nothing private is stored.
const FIELDS = [
    'id',
    'displayName',
    'profilePicOverride',
    'profilePicOverrideThumbnail',
    'currentAvatarImageUrl',
    'currentAvatarThumbnailImageUrl',
    'userIcon',
    'imageUrl',
    'iconUrl',
    'thumbnailUrl',
    'discordId'
];

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS public_user_cache (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at TEXT NOT NULL
)`;
const UPSERT = `INSERT INTO public_user_cache (user_id, data, fetched_at)
VALUES (@user_id, @data, @now)
ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`;

/** @type {Promise<boolean> | null} */
let ready = null;
/** @type {Map<string, Promise<any>>} */
const inFlight = new Map();
/** @type {Map<string, number>} */
const failedAt = new Map();

/** @returns {Promise<boolean>} whether the table is usable */
function ensureTable() {
    ready ??= sqliteService.executeNonQuery(CREATE_TABLE).then(
        () => true,
        (err) => {
            log.warn(`public_user_cache: unavailable (${err.message})`);
            return false;
        }
    );
    return ready;
}

/**
 * @param {string} userId
 * @returns {Promise<{ user: any; fetchedAt: number } | null>}
 */
async function readRow(userId) {
    if (!(await ensureTable())) {
        return null;
    }
    let found = null;
    try {
        await sqliteService.execute(
            (row) => {
                found = { user: JSON.parse(row[0]), fetchedAt: Date.parse(row[1]) };
            },
            'SELECT data, fetched_at FROM public_user_cache WHERE user_id = @user_id',
            { '@user_id': userId }
        );
    } catch (err) {
        log.warn(`public_user_cache: read failed for ${userId}: ${err.message}`);
    }
    return found;
}

/**
 * @param {any} user
 * @returns {Promise<void>}
 */
async function writeRow(user) {
    if (!(await ensureTable())) {
        return;
    }
    const picked = {};
    for (const field of FIELDS) {
        if (user[field] !== undefined && user[field] !== null) {
            picked[field] = user[field];
        }
    }
    try {
        await sqliteService.executeNonQuery(UPSERT, {
            '@user_id': user.id,
            '@data': JSON.stringify(picked),
            '@now': new Date().toISOString()
        });
    } catch (err) {
        log.warn(`public_user_cache: failed to persist ${user.id}: ${err.message}`);
    }
}

/**
 * @param {string} userId
 * @param {{ getCachedUser: (id: string) => any; fetchUser?: (id: string) => Promise<any> }} sources
 * @returns {Promise<any | null>} The user, or null if nobody has it
 */
export async function resolveUser(userId, { getCachedUser, fetchUser }) {
    const live = getCachedUser(userId);
    if (live) {
        return live;
    }
    const row = await readRow(userId);
    if (row && Date.now() - row.fetchedAt < FRESH_MS) {
        return row.user;
    }
    if (!fetchUser || Date.now() - (failedAt.get(userId) ?? 0) < NEGATIVE_MS) {
        return row?.user ?? null;
    }
    let pending = inFlight.get(userId);
    if (!pending) {
        pending = (async () => {
            try {
                const user = await fetchUser(userId);
                if (user?.id === userId) {
                    failedAt.delete(userId);
                    await writeRow(user);
                    return user;
                }
            } catch (err) {
                log.debug(`public_user_cache: fetch failed for ${userId}: ${err?.message ?? err}`);
            }
            failedAt.set(userId, Date.now());
            return null;
        })().finally(() => inFlight.delete(userId));
        inFlight.set(userId, pending);
    }
    return (await pending) ?? row?.user ?? null;
}

/** Test hook. */
export function resetUserCacheForTests() {
    ready = null;
    inFlight.clear();
    failedAt.clear();
}
