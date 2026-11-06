/**
 * `discord_ids`: a persistent VRChat user id -> Discord user id mapping.
 *
 * VRChat returns `discordId` on a user object only when that user has linked
 * Discord and allows it to be shown, and upstream keeps it in memory only
 * (`cachedUsers`), so it is lost on restart and for anyone not currently
 * cached. This records every id the server ever sees, so the public API can
 * answer for users the cache no longer holds.
 *
 * Server-owned and additive, like `seen_avatars`: a global table created here
 * (not in upstream's `database/index.js`), ignored by the desktop app.
 *
 *  - {@link recordFromResponseBody} is called by the WebApi shim with every
 *    JSON response body; a cheap substring test keeps it off the hot path.
 *  - An in-memory map mirrors the table, so route handlers stay synchronous.
 *  - A user who unlinks Discord stops returning `discordId`; we keep the last
 *    known value rather than guess (`last_seen` says how fresh it is).
 */
import sqliteService from '../../src/services/sqlite.js';
import { log } from './log.js';

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS discord_ids (
    user_id TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
)`;

const UPSERT = `INSERT INTO discord_ids (user_id, discord_id, first_seen, last_seen)
VALUES (@user_id, @discord_id, @now, @now)
ON CONFLICT (user_id) DO UPDATE SET
    discord_id = excluded.discord_id,
    last_seen = excluded.last_seen`;

// Discord snowflakes are numeric; anything else is not a user id.
const DISCORD_ID_RE = /^\d{5,25}$/;
const USER_ID_RE = /^usr_[0-9a-f-]+$/;

/** @type {Map<string, string>} */
const known = new Map();
/** @type {Promise<void> | null} */
let ready = null;

/**
 * Creates the table and loads it into memory. Idempotent; safe to call on
 * every boot. A read-only database can't create the table, which is fine: the
 * map just stays empty.
 */
export function loadDiscordIds() {
    ready ??= (async () => {
        try {
            await sqliteService.executeNonQuery(CREATE_TABLE);
            await sqliteService.execute(
                (row) => {
                    known.set(row[0], row[1]);
                },
                'SELECT user_id, discord_id FROM discord_ids'
            );
            log.info(`discord_ids: loaded ${known.size} mappings`);
        } catch (err) {
            log.warn(`discord_ids: unavailable (${err.message})`);
        }
    })();
    return ready;
}

/**
 * @param {string} userId
 * @returns {string | null}
 */
export function getDiscordId(userId) {
    return known.get(userId) ?? null;
}

/**
 * @param {string} userId
 * @param {unknown} discordId
 * @returns {Promise<void>}
 */
export async function recordDiscordId(userId, discordId) {
    if (typeof userId !== 'string' || !USER_ID_RE.test(userId)) {
        return;
    }
    if (typeof discordId !== 'string' || !DISCORD_ID_RE.test(discordId)) {
        return;
    }
    if (known.get(userId) === discordId) {
        // Unchanged: skip the write (a user object arrives constantly).
        return;
    }
    known.set(userId, discordId);
    await loadDiscordIds();
    try {
        await sqliteService.executeNonQuery(UPSERT, {
            '@user_id': userId,
            '@discord_id': discordId,
            '@now': new Date().toISOString()
        });
    } catch (err) {
        log.warn(`discord_ids: failed to persist ${userId}: ${err.message}`);
    }
}

/**
 * @param {unknown} value
 * @param {Array<[string, string]>} out
 */
function collect(value, out) {
    if (Array.isArray(value)) {
        for (const item of value) {
            collect(item, out);
        }
        return;
    }
    if (value && typeof value === 'object') {
        // Only user objects carry both; this also skips nested non-user shapes.
        if (typeof value.id === 'string' && typeof value.discordId === 'string') {
            out.push([value.id, value.discordId]);
        }
        for (const child of Object.values(value)) {
            if (child && typeof child === 'object') {
                collect(child, out);
            }
        }
    }
}

/**
 * Called with every response body the WebApi shim returns. Never throws and
 * never delays the response.
 *
 * @param {string} body
 */
export function recordFromResponseBody(body) {
    if (typeof body !== 'string' || !body.includes('"discordId"')) {
        return;
    }
    try {
        /** @type {Array<[string, string]>} */
        const found = [];
        collect(JSON.parse(body), found);
        for (const [userId, discordId] of found) {
            recordDiscordId(userId, discordId).catch(() => {});
        }
    } catch {
        // Not JSON (or not the shape we expect): nothing to record.
    }
}

/** Test hook: forget everything in memory. */
export function resetDiscordIdsForTests() {
    known.clear();
    ready = null;
}
