/**
 * `src-electron/sessionRetry.js`: the desktop app waiting for the network at
 * autostart instead of dropping a valid session to the setup screen.
 */
import { describe, expect, it, vi } from 'vitest';

import { isTransientStatus, refreshWithRetry } from '../../src-electron/sessionRetry.js';

const sleep = () => vi.fn().mockResolvedValue(undefined);

describe('refreshWithRetry', () => {
    it('keeps trying while unreachable and succeeds once the network is up', async () => {
        const attempt = vi
            .fn()
            .mockResolvedValueOnce('unreachable')
            .mockResolvedValueOnce('unreachable')
            .mockResolvedValueOnce('ok');
        const wait = sleep();
        expect(await refreshWithRetry(attempt, { delays: [1, 2, 3], sleep: wait })).toBe(true);
        expect(attempt).toHaveBeenCalledTimes(3);
        expect(wait.mock.calls).toEqual([[1], [2]]);
    });
    it('does not retry a rejected token', async () => {
        const attempt = vi.fn().mockResolvedValue('rejected');
        const wait = sleep();
        expect(await refreshWithRetry(attempt, { delays: [1, 2], sleep: wait })).toBe(false);
        expect(attempt).toHaveBeenCalledTimes(1);
        expect(wait).not.toHaveBeenCalled();
    });
    it('gives up after the last delay', async () => {
        const attempt = vi.fn().mockResolvedValue('unreachable');
        expect(await refreshWithRetry(attempt, { delays: [1, 2], sleep: sleep() })).toBe(false);
        expect(attempt).toHaveBeenCalledTimes(3);
    });
});

describe('isTransientStatus', () => {
    it('treats proxy "not ready" statuses as transient only', () => {
        expect([502, 503, 504].every(isTransientStatus)).toBe(true);
        expect([200, 401, 403, 404, 500].some(isTransientStatus)).toBe(false);
    });
});
