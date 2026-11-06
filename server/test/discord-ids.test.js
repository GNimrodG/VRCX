import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = new Map();
vi.mock('../../src/services/sqlite.js', () => ({
    default: {
        executeNonQuery: vi.fn(async (sql, params) => {
            if (params?.['@user_id']) {
                rows.set(params['@user_id'], params['@discord_id']);
            }
        }),
        execute: vi.fn(async (cb) => {
            for (const [u, d] of rows) {
                cb([u, d]);
            }
        })
    }
}));

const mod = await import('../src/discord-ids.js');

const USER = 'usr_00000000-0000-0000-0000-000000000001';
const flush = () => new Promise((r) => setImmediate(r));

describe('discord-ids', () => {
    beforeEach(() => {
        rows.clear();
        mod.resetDiscordIdsForTests();
    });

    it('records a discordId found in a user response and persists it', async () => {
        mod.recordFromResponseBody(JSON.stringify({ id: USER, discordId: '123456789012345678' }));
        await flush();
        expect(mod.getDiscordId(USER)).toBe('123456789012345678');
        expect(rows.get(USER)).toBe('123456789012345678');
    });

    it('finds ids inside arrays and ignores junk', async () => {
        mod.recordFromResponseBody(
            JSON.stringify([
                { id: USER, discordId: '123456789012345678' },
                { id: 'grp_x', discordId: '123456789012345678' },
                { id: 'usr_00000000-0000-0000-0000-000000000002', discordId: 'not-a-number' }
            ])
        );
        await flush();
        expect(mod.getDiscordId(USER)).toBe('123456789012345678');
        expect(rows.size).toBe(1);
    });

    it('keeps the last known id when a later response omits it', async () => {
        mod.recordFromResponseBody(JSON.stringify({ id: USER, discordId: '123456789012345678' }));
        await flush();
        mod.recordFromResponseBody(JSON.stringify({ id: USER, displayName: 'x' }));
        expect(mod.getDiscordId(USER)).toBe('123456789012345678');
    });

    it('loads persisted mappings on boot', async () => {
        rows.set(USER, '999999999999999999');
        await mod.loadDiscordIds();
        expect(mod.getDiscordId(USER)).toBe('999999999999999999');
    });

    it('never throws on non-JSON bodies', () => {
        expect(() => mod.recordFromResponseBody('"discordId" <html>')).not.toThrow();
    });
});
