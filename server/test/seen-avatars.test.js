/**
 * `seen_avatars` (server/src/seen-avatars.js): the per-author index of avatars
 * seen in the feed, kept up to date on every avatar event and backfilled from
 * the existing feed once.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrate, openDatabase } from '../src/db.js';
import { backfill } from '../src/seen-avatars.js';

const USER_ID = 'usr_12345678-1234-1234-1234-123456789abc';
const AUTHOR = 'usr_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FILE_A = 'file_11111111-1111-1111-1111-111111111111';
const FILE_B = 'file_22222222-2222-2222-2222-222222222222';
const url = (file, v = 1) => `https://api.vrchat.cloud/api/1/file/${file}/${v}/file`;

describe('seen_avatars', () => {
    /** @type {string} */
    let dir;
    /** @type {Awaited<ReturnType<typeof openDatabase>>} */
    let handle;

    beforeAll(async () => {
        dir = mkdtempSync(path.join(tmpdir(), 'vrcx-headless-seen-avatars-'));
        handle = await openDatabase({
            databasePath: path.join(dir, 'VRCX.sqlite3'),
            create: true
        });
        await migrate(handle, { userId: USER_ID });
    });

    afterAll(() => {
        handle?.close();
        rmSync(dir, { recursive: true, force: true });
    });

    const event = (overrides) => ({
        created_at: '2026-09-01T10:00:00.000Z',
        userId: 'usr_wearer',
        displayName: 'Wearer',
        ownerId: AUTHOR,
        avatarName: 'Cool Avatar',
        currentAvatarImageUrl: url(FILE_A),
        currentAvatarThumbnailImageUrl: `${url(FILE_A)}/256`,
        previousCurrentAvatarImageUrl: '',
        previousCurrentAvatarThumbnailImageUrl: '',
        ...overrides
    });

    it('records an avatar the first time a feed event sees it', async () => {
        await handle.database.addAvatarToDatabase(event());
        const rows = await handle.database.getSeenAvatarsByOwner(AUTHOR);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            ownerId: AUTHOR,
            fileId: FILE_A,
            name: 'Cool Avatar',
            firstSeen: '2026-09-01T10:00:00.000Z',
            lastSeen: '2026-09-01T10:00:00.000Z'
        });
    });

    it('keeps one row per file, updating last_seen and the newest name', async () => {
        await handle.database.addAvatarToDatabase(
            event({
                created_at: '2026-09-02T10:00:00.000Z',
                userId: 'usr_other',
                avatarName: 'Cool Avatar v2',
                currentAvatarImageUrl: url(FILE_A, 2)
            })
        );
        const rows = await handle.database.getSeenAvatarsByOwner(AUTHOR);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            name: 'Cool Avatar v2',
            firstSeen: '2026-09-01T10:00:00.000Z',
            lastSeen: '2026-09-02T10:00:00.000Z'
        });
    });

    it('ignores events without an author or a file id, and other authors', async () => {
        await handle.database.addAvatarToDatabase(
            event({ created_at: '2026-09-03T10:00:00.000Z', ownerId: '' })
        );
        await handle.database.addAvatarToDatabase(
            event({
                created_at: '2026-09-03T11:00:00.000Z',
                currentAvatarImageUrl: 'https://example.com/none.png'
            })
        );
        expect(await handle.database.getSeenAvatarsByOwner(AUTHOR)).toHaveLength(1);
        expect(await handle.database.getSeenAvatarsByOwner('usr_nobody')).toEqual([]);
    });

    it('backfills existing feed rows, newest first, and is idempotent', async () => {
        const prefix = handle.dbVars.userPrefix;
        const insert = (created, file, name) =>
            handle.sqlite.ExecuteNonQuery(
                `INSERT INTO ${prefix}_feed_avatar (created_at, user_id, display_name, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url) VALUES (@c, 'usr_x', 'X', @o, @n, @u, '', '', '')`,
                { '@c': created, '@o': AUTHOR, '@n': name, '@u': url(file) }
            );
        insert('2026-01-01T00:00:00.000Z', FILE_B, 'Old B');
        insert('2026-02-01T00:00:00.000Z', FILE_B, 'New B');

        await backfill(prefix);
        await backfill(prefix);

        const rows = await handle.database.getSeenAvatarsByOwner(AUTHOR);
        expect(rows.map((r) => r.fileId)).toEqual([FILE_A, FILE_B]);
        expect(rows.find((r) => r.fileId === FILE_B)).toMatchObject({
            name: 'New B',
            firstSeen: '2026-01-01T00:00:00.000Z',
            lastSeen: '2026-02-01T00:00:00.000Z'
        });
    });
});
