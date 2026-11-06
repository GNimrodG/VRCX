import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = new Map();
vi.mock('../../src/services/sqlite.js', () => ({
    default: {
        executeNonQuery: vi.fn(async (sql, params) => {
            if (params?.['@user_id']) {
                rows.set(params['@user_id'], [params['@data'], params['@now']]);
            }
        }),
        execute: vi.fn(async (cb, sql, params) => {
            const row = rows.get(params['@user_id']);
            if (row) {
                cb(row);
            }
        })
    }
}));

const mod = await import('../src/user-cache.js');
const ID = 'usr_00000000-0000-0000-0000-000000000001';
const none = () => null;

describe('user-cache resolveUser', () => {
    beforeEach(() => {
        rows.clear();
        mod.resetUserCacheForTests();
    });

    it('prefers the in-memory cache and never fetches', async () => {
        const fetchUser = vi.fn();
        const user = await mod.resolveUser(ID, { getCachedUser: () => ({ id: ID }), fetchUser });
        expect(user.id).toBe(ID);
        expect(fetchUser).not.toHaveBeenCalled();
    });

    it('fetches from VRChat, persists only public fields, then serves from the table', async () => {
        const fetchUser = vi.fn(async () => ({ id: ID, displayName: 'A', statusDescription: 'private', location: 'x' }));
        expect((await mod.resolveUser(ID, { getCachedUser: none, fetchUser })).displayName).toBe('A');
        expect(JSON.parse(rows.get(ID)[0])).toEqual({ id: ID, displayName: 'A' });
        const again = await mod.resolveUser(ID, { getCachedUser: none, fetchUser });
        expect(again.displayName).toBe('A');
        expect(fetchUser).toHaveBeenCalledTimes(1);
    });

    it('shares one request between concurrent lookups and remembers failures', async () => {
        const fetchUser = vi.fn(async () => {
            throw new Error('404');
        });
        const [a, b] = await Promise.all([
            mod.resolveUser(ID, { getCachedUser: none, fetchUser }),
            mod.resolveUser(ID, { getCachedUser: none, fetchUser })
        ]);
        expect([a, b]).toEqual([null, null]);
        await mod.resolveUser(ID, { getCachedUser: none, fetchUser });
        expect(fetchUser).toHaveBeenCalledTimes(1);
    });

    it('falls back to a stale row when VRChat fails', async () => {
        rows.set(ID, [JSON.stringify({ id: ID, displayName: 'Old' }), '2020-01-01T00:00:00.000Z']);
        const fetchUser = vi.fn(async () => {
            throw new Error('down');
        });
        expect((await mod.resolveUser(ID, { getCachedUser: none, fetchUser })).displayName).toBe('Old');
    });
});
