import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/websocket.js', () => ({ initWebsocket: vi.fn() }));
vi.mock('../../src/services/watchState.js', () => ({
    watchState: { isLoggedIn: true, isFriendsLoaded: true }
}));

const { createStreamReconnector } = await import(
    '../../client-web/shims/stream-reconnect.js'
);

function harness(overrides = {}) {
    const scheduled = [];
    const reconnect = vi.fn().mockResolvedValue(undefined);
    const reconnector = createStreamReconnector({
        reconnect,
        shouldRetry: () => true,
        schedule: (fn, ms) => {
            scheduled.push({ fn, ms });
            return scheduled.length;
        },
        cancel: vi.fn(),
        ...overrides
    });
    const fire = async () => scheduled.shift().fn();
    return { reconnector, reconnect, scheduled, fire };
}

describe('createStreamReconnector', () => {
    it('keeps retrying with capped backoff until the socket opens', async () => {
        const { reconnector, reconnect, scheduled, fire } = harness();
        reconnector.onClose();
        const delays = [];
        for (let i = 0; i < 6; i++) {
            delays.push(scheduled[0].ms);
            await fire();
        }
        expect(delays).toEqual([2000, 4000, 8000, 10000, 10000, 10000]);
        expect(reconnect).toHaveBeenCalledTimes(6);

        reconnector.onOpen();
        scheduled.length = 0;
        await Promise.resolve();
        expect(scheduled).toHaveLength(0);
    });

    it('stops when the socket opens mid-attempt', async () => {
        const { reconnector, scheduled, fire } = harness({
            reconnect: vi.fn(async () => reconnector.onOpen())
        });
        reconnector.onClose();
        await fire();
        expect(scheduled).toHaveLength(0);
    });

    it('stops once the user is logged out', async () => {
        const { reconnector, reconnect, scheduled, fire } = harness({
            shouldRetry: () => false
        });
        reconnector.onClose();
        await fire();
        expect(reconnect).not.toHaveBeenCalled();
        expect(scheduled).toHaveLength(0);
    });

    it('keeps going when a reconnect attempt throws', async () => {
        const { reconnector, scheduled, fire } = harness({
            reconnect: vi.fn().mockRejectedValue(new Error('down'))
        });
        reconnector.onClose();
        await fire();
        expect(scheduled).toHaveLength(1);
    });

    it('retryNow() tries immediately instead of waiting for the timer', async () => {
        const { reconnector, reconnect } = harness();
        reconnector.onClose();
        reconnector.retryNow();
        await Promise.resolve();
        expect(reconnect).toHaveBeenCalledTimes(1);
    });
});
