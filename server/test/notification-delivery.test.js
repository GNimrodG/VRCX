import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrate, openDatabase } from '../src/db.js';

// The game-log notification fallback's database half (src/services/database/notifications.js), run against real
// SQLite: replaying the same game log any number of times must change nothing.
describe('notification delivery tracking', () => {
    let dir;
    let handle;
    let database;

    beforeAll(async () => {
        dir = mkdtempSync(path.join(tmpdir(), 'vrcx-headless-notif-'));
        handle = await openDatabase({ databasePath: path.join(dir, 'VRCX.sqlite3'), create: true });
        await migrate(handle, { userId: 'usr_00000000-0000-0000-0000-000000000001' });
        database = handle.database;
    });

    afterAll(() => {
        handle?.close();
        rmSync(dir, { recursive: true, force: true });
    });

    const base = {
        id: 'not_1',
        type: 'requestInvite',
        senderUsername: 'JustZen',
        createdAt: '2026-11-05T22:48:49.000Z'
    };

    it('reports a notification only the game saw as game-only (the pipeline missed it)', async () => {
        await database.recordNotificationDelivery({ ...base, source: 'log', at: '2026-11-05T22:48:49.000Z' });
        expect(await database.getNotificationDeliveries()).toEqual([
            expect.objectContaining({ id: 'not_1', status: 'game-only', delayMs: null, pipelineAt: null })
        ]);
    });

    it('is idempotent: replaying the log changes nothing, first write per source wins', async () => {
        await database.recordNotificationDelivery({ ...base, source: 'log', at: '2030-01-01T00:00:00.000Z' });
        await database.recordNotificationDelivery({ ...base, source: 'log', at: '2026-11-05T22:48:49.000Z' });
        const rows = await database.getNotificationDeliveries();
        expect(rows).toHaveLength(1);
        expect(rows[0].gameAt).toBe('2026-11-05T22:48:49.000Z');
    });

    it('computes the delay once both sources have seen it', async () => {
        await database.recordNotificationDelivery({ ...base, source: 'pipeline', at: '2026-11-05T22:48:51.500Z' });
        await database.recordNotificationDelivery({ ...base, source: 'pipeline', at: '2026-11-05T23:59:59.000Z' });
        const [row] = await database.getNotificationDeliveries();
        expect(row).toMatchObject({ status: 'both', delayMs: 2500, pipelineAt: '2026-11-05T22:48:51.500Z' });
    });

    it('stamps a pipeline delivery with the server clock when none is given', async () => {
        const before = Date.now();
        await database.recordNotificationDelivery({ ...base, id: 'not_2', source: 'pipeline' });
        const row = (await database.getNotificationDeliveries()).find((r) => r.id === 'not_2');
        expect(Date.parse(row.pipelineAt)).toBeGreaterThanOrEqual(before);
        expect(row.status).toBe('pipeline-only');
    });

    it('knows whether a notification is already stored, and storing twice is harmless', async () => {
        const row = {
            id: 'not_3',
            created_at: '2026-11-05T22:48:49.000Z',
            type: 'requestInvite',
            senderUserId: 'usr_a',
            senderUsername: 'JustZen',
            receiverUserId: 'usr_b',
            message: '',
            details: {}
        };
        expect(await database.hasNotification('not_3')).toBe(false);
        database.addNotificationToDatabase(row);
        database.addNotificationToDatabase(row);
        expect(await database.hasNotification('not_3')).toBe(true);
        const count = handle.sqlite.Execute(
            `SELECT COUNT(*) FROM ${handle.dbVars.userPrefix}_notifications WHERE id = 'not_3'`
        );
        expect(count[0][0]).toBe(1);
    });
});
