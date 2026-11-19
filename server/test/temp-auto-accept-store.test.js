/**
 * `src-electron/tempAutoAcceptStore.js`: the auto-accept friend list must
 * survive an app restart but not a system restart.
 */
import { describe, expect, it } from 'vitest';

import { BOOT_TIME_TOLERANCE_MS, createTempAutoAcceptStore } from '../../src-electron/tempAutoAcceptStore.js';

const BOOT = 1_000_000_000_000;
const FILE = 'temp-auto-accept.json';

/**
 * @param {{ uptimeS: number; nowMs: number }} clock
 * @param {Map<string, string>} files
 */
function makeStore(clock, files) {
    return createTempAutoAcceptStore({
        filePath: FILE,
        now: () => clock.nowMs,
        os: { uptime: () => clock.uptimeS },
        fs: /** @type {any} */ ({
            readFileSync: (p) => {
                if (!files.has(p)) throw new Error('ENOENT');
                return files.get(p);
            },
            writeFileSync: (p, data) => files.set(p, data),
            rmSync: (p) => files.delete(p)
        })
    });
}

describe('createTempAutoAcceptStore', () => {
    it('is off when nothing was saved', () => {
        const store = makeStore({ uptimeS: 10, nowMs: BOOT + 10_000 }, new Map());
        expect(store.load()).toEqual({ enabled: false, userIds: [] });
    });

    it('is kept across an app restart on the same boot', () => {
        const files = new Map();
        makeStore({ uptimeS: 3600, nowMs: BOOT + 3_600_000 }, files).save({ enabled: true, userIds: ['usr_a'] });
        // relaunch five minutes later, with a slightly jittery uptime
        const after = makeStore({ uptimeS: 3900.7, nowMs: BOOT + 3_900_000 }, files);
        expect(after.load()).toEqual({ enabled: true, userIds: ['usr_a'] });
    });

    it('is dropped after a system restart, and the file is removed', () => {
        const files = new Map();
        makeStore({ uptimeS: 3600, nowMs: BOOT + 3_600_000 }, files).save({ enabled: true, userIds: ['usr_a'] });
        const nextBoot = BOOT + 5 * 3_600_000;
        const after = makeStore({ uptimeS: 60, nowMs: nextBoot + 60_000 }, files);
        expect(after.load()).toEqual({ enabled: false, userIds: [] });
        expect(files.size).toBe(0);
    });

    it('tolerates only a small boot-time drift', () => {
        const files = new Map();
        makeStore({ uptimeS: 100, nowMs: BOOT + 100_000 }, files).save({ enabled: true, userIds: ['usr_a'] });
        const loadedAfterDrift = (ms) =>
            makeStore({ uptimeS: 100, nowMs: BOOT + 100_000 + ms }, new Map(files)).load().enabled;
        expect(loadedAfterDrift(BOOT_TIME_TOLERANCE_MS - 1000)).toBe(true);
        expect(loadedAfterDrift(BOOT_TIME_TOLERANCE_MS + 1000)).toBe(false);
    });

    it('clear() forgets the list (Windows session end)', () => {
        const files = new Map();
        const store = makeStore({ uptimeS: 100, nowMs: BOOT + 100_000 }, files);
        store.save({ enabled: true, userIds: ['usr_a'] });
        store.clear();
        expect(store.load().enabled).toBe(false);
    });

    it('cleans up junk and survives a corrupt file', () => {
        const files = new Map();
        const store = makeStore({ uptimeS: 100, nowMs: BOOT + 100_000 }, files);
        expect(store.save({ enabled: true, userIds: ['usr_a', 'usr_a', '', 5] })).toEqual({
            enabled: true,
            userIds: ['usr_a']
        });
        expect(store.save({ enabled: true, userIds: [] }).enabled).toBe(false);
        files.set(FILE, '{nope');
        expect(store.load()).toEqual({ enabled: false, userIds: [] });
    });
});
