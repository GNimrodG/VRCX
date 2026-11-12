/**
 * `client-web/shims/config-sync.js` (fork-only, shared by the web and desktop
 * clients): applying a setting another client changed. Lives under `src/`
 * because the root vitest config only collects tests from there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ info: vi.fn() }));
const configRepository = vi.hoisted(() => ({ applyRemote: vi.fn() }));
vi.mock('vue-sonner', () => ({ toast }));
vi.mock('../../services/config.js', () => ({ default: configRepository }));

import {
    CONFIG_CHANGED_TYPE,
    handleConfigFrame,
    registerLiveSetting,
    tapConfigFrame
} from '../../../client-web/shims/config-sync.js';

beforeEach(() => {
    vi.useFakeTimers();
    toast.info.mockClear();
    configRepository.applyRemote.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('handleConfigFrame', () => {
    it('refreshes the config cache and asks for a reload', () => {
        handleConfigFrame({ key: 'VRCX_a', method: 'setBool', value: true });
        expect(configRepository.applyRemote).toHaveBeenCalledWith('VRCX_a', false, true, true);
        vi.advanceTimersByTime(500);
        expect(toast.info).toHaveBeenCalledTimes(1);
        const [, options] = toast.info.mock.calls[0];
        expect(options.duration).toBe(Infinity);
        expect(options.action.label).toBe('Reload');
    });

    it('shows one toast for a burst of changes', () => {
        for (const key of ['a', 'b', 'c']) {
            handleConfigFrame({ key, method: 'setString', value: 'x' });
        }
        vi.advanceTimersByTime(500);
        expect(toast.info).toHaveBeenCalledTimes(1);
    });

    it('treats a removal and an omitted value as "forget the cached value"', () => {
        handleConfigFrame({ key: 'k', method: 'remove' });
        expect(configRepository.applyRemote).toHaveBeenLastCalledWith('k', true, false, undefined);
        handleConfigFrame({ key: 'big', method: 'setString' });
        expect(configRepository.applyRemote).toHaveBeenLastCalledWith('big', false, false, undefined);
    });

    it('ignores malformed frames', () => {
        handleConfigFrame({ method: 'setBool' });
        handleConfigFrame(null);
        vi.advanceTimersByTime(500);
        expect(configRepository.applyRemote).not.toHaveBeenCalled();
        expect(toast.info).not.toHaveBeenCalled();
    });
});

describe('registerLiveSetting', () => {
    it('applies a handled setting in place, with no reload prompt', () => {
        const apply = vi.fn();
        const off = registerLiveSetting('VRCX_live', apply);
        handleConfigFrame({ key: 'VRCX_live', method: 'setString', value: 'dark' });
        vi.advanceTimersByTime(500);
        expect(apply).toHaveBeenCalledWith('VRCX_live', 'dark', false);
        expect(toast.info).not.toHaveBeenCalled();
        off();
    });

    it('still prompts when a handler declines or throws, or other keys changed', () => {
        const off = registerLiveSetting(/^VRCX_live/, () => false);
        handleConfigFrame({ key: 'VRCX_live2', method: 'setString', value: 'x' });
        vi.advanceTimersByTime(500);
        expect(toast.info).toHaveBeenCalledTimes(1);
        off();
        const off2 = registerLiveSetting('VRCX_boom', () => {
            throw new Error('nope');
        });
        handleConfigFrame({ key: 'VRCX_boom', method: 'setString', value: 'x' });
        vi.advanceTimersByTime(500);
        expect(toast.info).toHaveBeenCalledTimes(2);
        off2();
    });

    it('stops applying once unregistered', () => {
        const apply = vi.fn();
        registerLiveSetting('VRCX_once', apply)();
        handleConfigFrame({ key: 'VRCX_once', method: 'setString', value: 'x' });
        expect(apply).not.toHaveBeenCalled();
    });
});

describe('tapConfigFrame', () => {
    it('handles config frames and leaves every other frame alone', () => {
        expect(
            tapConfigFrame(JSON.stringify({ type: CONFIG_CHANGED_TYPE, key: 'k', method: 'setInt', value: 1 }))
        ).toBe(true);
        expect(tapConfigFrame(JSON.stringify({ type: 'friend-online', content: '{}' }))).toBe(false);
        expect(tapConfigFrame('not json')).toBe(false);
    });
});
