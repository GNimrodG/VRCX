/**
 * `seen_avatars`: one row per (author, image file) ever seen in the avatar
 * feed, so the user dialog's Avatars tab can list what an author has been seen
 * wearing without scanning `<user>_feed_avatar` (millions of rows) each time.
 *
 * The feed carries the author (`owner_id`), name and image URLs but never an
 * avatar id, so rows are keyed by the image *file* id, the only stable
 * identity available. The id is resolved on click, via the avatar cache or the
 * external avatar database (`showAvatarAuthorDialog`).
 *
 * Server-owned and additive: a global table created here, not in upstream's
 * `database/index.js` (which would be a merge surface), and absent from the
 * desktop app, which simply ignores it.
 *
 *  - `initUserTables` is wrapped: the user's feed table name is only known
 *    after login, so that is when the table is created and, once, backfilled
 *    from the feed in the background (resumable, batched).
 *  - `addAvatarToDatabase` is wrapped: every new feed event upserts its row.
 *  - `getSeenAvatarsByOwner(ownerId)` is the read the client calls over RPC.
 */
import sqliteService from '../../src/services/sqlite.js';
import { extractFileId } from '../../src/shared/utils/fileUtils.js';
import { log } from './log.js';

const BACKFILL_BATCH = 5000;
const BACKFILL_KEY = 'seen_avatars_backfill_cursor';

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS seen_avatars (
    owner_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    avatar_name TEXT,
    image_url TEXT,
    thumbnail_image_url TEXT,
    first_seen TEXT,
    last_seen TEXT,
    PRIMARY KEY (owner_id, file_id)
)`;
const CREATE_META = `CREATE TABLE IF NOT EXISTS seen_avatars_meta (
    key TEXT PRIMARY KEY,
    value TEXT
)`;

// Newest event wins for the display fields; first_seen only ever moves back.
const UPSERT = `INSERT INTO seen_avatars (owner_id, file_id, avatar_name, image_url, thumbnail_image_url, first_seen, last_seen)
VALUES (@owner_id, @file_id, @avatar_name, @image_url, @thumbnail_image_url, @seen, @seen)
ON CONFLICT (owner_id, file_id) DO UPDATE SET
    avatar_name = CASE WHEN excluded.last_seen >= last_seen THEN excluded.avatar_name ELSE avatar_name END,
    image_url = CASE WHEN excluded.last_seen >= last_seen THEN excluded.image_url ELSE image_url END,
    thumbnail_image_url = CASE WHEN excluded.last_seen >= last_seen THEN excluded.thumbnail_image_url ELSE thumbnail_image_url END,
    first_seen = MIN(first_seen, excluded.first_seen),
    last_seen = MAX(last_seen, excluded.last_seen)`;

/**
 * @param {{ ownerId?: string, avatarName?: string, imageUrl?: string, thumbnailImageUrl?: string, seen?: string }} row
 */
async function upsert({ ownerId, avatarName, imageUrl, thumbnailImageUrl, seen }) {
    const fileId = extractFileId(imageUrl ?? '');
    // No author or no file id (e.g. a stock/icon avatar): nothing to key on.
    if (!ownerId || !fileId) {
        return;
    }
    await sqliteService.executeNonQuery(UPSERT, {
        '@owner_id': ownerId,
        '@file_id': fileId,
        '@avatar_name': avatarName ?? '',
        '@image_url': imageUrl,
        '@thumbnail_image_url': thumbnailImageUrl ?? '',
        '@seen': seen ?? new Date().toISOString()
    });
}

async function readMeta(key) {
    let value = null;
    await sqliteService.execute(
        (row) => {
            value = row[0];
        },
        'SELECT value FROM seen_avatars_meta WHERE key = @key',
        { '@key': key }
    );
    return value;
}

/**
 * Walks the feed by id in batches, so it is resumable after a restart and never
 * holds more than one batch in memory. Safe to run while new events arrive:
 * upserts are idempotent and order-independent.
 *
 * @param {string} userPrefix
 */
export async function backfill(userPrefix) {
    let cursor = Number(await readMeta(BACKFILL_KEY)) || 0;
    const started = Date.now();
    let scanned = 0;
    for (;;) {
        /** @type {Map<string, object>} */
        const batch = new Map();
        let lastId = cursor;
        let count = 0;
        await sqliteService.execute(
            (row) => {
                const [id, createdAt, ownerId, avatarName, imageUrl, thumbnailImageUrl] = row;
                lastId = id;
                count += 1;
                const fileId = extractFileId(imageUrl ?? '');
                if (!ownerId || !fileId) {
                    return;
                }
                const key = `${ownerId}\u0000${fileId}`;
                const existing = batch.get(key);
                if (!existing) {
                    batch.set(key, { ownerId, avatarName, imageUrl, thumbnailImageUrl, first: createdAt, last: createdAt });
                    return;
                }
                if (createdAt >= existing.last) {
                    Object.assign(existing, { avatarName, imageUrl, thumbnailImageUrl, last: createdAt });
                }
                if (createdAt < existing.first) {
                    existing.first = createdAt;
                }
            },
            `SELECT id, created_at, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url FROM ${userPrefix}_feed_avatar WHERE id > @cursor ORDER BY id LIMIT ${BACKFILL_BATCH}`,
            { '@cursor': cursor }
        );
        if (count === 0) {
            break;
        }
        for (const entry of batch.values()) {
            // The upsert keeps the earliest first_seen and latest last_seen, so
            // feed the two ends of the batch's range as two events.
            await upsert({ ...entry, seen: entry.first });
            if (entry.last !== entry.first) {
                await upsert({ ...entry, seen: entry.last });
            }
        }
        cursor = lastId;
        scanned += count;
        await sqliteService.executeNonQuery(
            'INSERT INTO seen_avatars_meta (key, value) VALUES (@key, @value) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
            { '@key': BACKFILL_KEY, '@value': String(cursor) }
        );
        // Yield so other queries on the shared connection interleave.
        await new Promise((resolve) => setImmediate(resolve));
    }
    if (scanned > 0) {
        log.info(`seen_avatars backfill: scanned ${scanned} feed rows in ${Date.now() - started}ms`);
    }
}

/**
 * @param {Record<string, Function>} database the real `database` facade
 * @param {{ userPrefix: string }} dbVars
 */
export function installSeenAvatars(database, dbVars) {
    const originalInit = database.initUserTables.bind(database);
    database.initUserTables = async function seenAvatarsInit(userId) {
        const result = await originalInit(userId);
        await sqliteService.executeNonQuery(CREATE_TABLE);
        await sqliteService.executeNonQuery(CREATE_META);
        const prefix = dbVars.userPrefix;
        // Background, not awaited: a large feed must not delay login.
        backfill(prefix).catch((err) => log.warn(`seen_avatars backfill failed: ${err.message}`));
        return result;
    };

    const originalAdd = database.addAvatarToDatabase.bind(database);
    database.addAvatarToDatabase = async function seenAvatarsAdd(entry) {
        const row = await originalAdd(entry);
        try {
            await upsert({
                ownerId: entry.ownerId,
                avatarName: entry.avatarName,
                imageUrl: entry.currentAvatarImageUrl,
                thumbnailImageUrl: entry.currentAvatarThumbnailImageUrl,
                seen: entry.created_at
            });
        } catch (err) {
            // Never fail the feed write over a derived index.
            log.warn(`seen_avatars upsert failed: ${err.message}`);
        }
        return row;
    };

    database.getSeenAvatarsByOwner = async function getSeenAvatarsByOwner(ownerId) {
        const rows = [];
        await sqliteService.execute(
            (row) => {
                rows.push({
                    ownerId: row[0],
                    fileId: row[1],
                    name: row[2],
                    imageUrl: row[3],
                    thumbnailImageUrl: row[4],
                    firstSeen: row[5],
                    lastSeen: row[6]
                });
            },
            'SELECT owner_id, file_id, avatar_name, image_url, thumbnail_image_url, first_seen, last_seen FROM seen_avatars WHERE owner_id = @owner_id ORDER BY last_seen DESC',
            { '@owner_id': ownerId }
        );
        return rows;
    };
}
