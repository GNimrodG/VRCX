/**
 * Client side of settings sync (`server/src/config-sync.js`): another client
 * wrote a setting, the server relayed it on `/api/stream`, and this module
 * applies it. Shared by the web and desktop clients.
 *
 * Upstream's settings stores read their config once at startup into Pinia
 * refs, so refreshing the config cache alone changes nothing on screen. The
 * default response is therefore a persistent "reload to apply" toast. A
 * setting that *can* apply itself live opts in with `registerLiveSetting`;
 * when every changed key was handled that way no toast is shown.
 */
import { toast } from 'vue-sonner';

import configRepository from '../../src/services/config.js';

export const CONFIG_CHANGED_TYPE = 'vrcx-headless-config-changed';

const TOAST_ID = 'headless-config-changed';
const TOAST_DEBOUNCE_MS = 400;

/**
 * @type {{
 *     matches: (key: string) => boolean;
 *     apply: (key: string, value: any, removed: boolean) => boolean | void;
 * }[]}
 */
const liveSettings = [];
let toastTimer = null;
let pendingReload = false;

/**
 * Lets one setting (or a family) refresh itself when another client changes
 * it, instead of asking for a reload.
 *
 * @param {string | RegExp} keyOrPattern An exact config key, or a pattern
 * @param {(key: string, value: any, removed: boolean) => boolean | void} apply Return `false` to fall back to the
 *   reload prompt (e.g. the value was unusable)
 * @returns {() => void} Unregister
 */
export function registerLiveSetting(keyOrPattern, apply) {
    const matches = keyOrPattern instanceof RegExp ? (key) => keyOrPattern.test(key) : (key) => key === keyOrPattern;
    const entry = { matches, apply };
    liveSettings.push(entry);
    return () => {
        const index = liveSettings.indexOf(entry);
        if (index !== -1) {
            liveSettings.splice(index, 1);
        }
    };
}

function promptReload() {
    pendingReload = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        if (!pendingReload) {
            return;
        }
        pendingReload = false;
        toast.info('Settings were changed in another VRCX window', {
            id: TOAST_ID,
            duration: Infinity,
            description: 'Reload to apply them here.',
            action: { label: 'Reload', onClick: () => window.location.reload() }
        });
    }, TOAST_DEBOUNCE_MS);
}

/**
 * @param {{ key?: unknown; method?: unknown; value?: unknown }} frame A `vrcx-headless-config-changed` frame
 */
export function handleConfigFrame(frame) {
    if (typeof frame?.key !== 'string' || typeof frame.method !== 'string') {
        return;
    }
    const removed = frame.method === 'remove';
    const hasValue = !removed && 'value' in frame;
    configRepository.applyRemote?.(frame.key, removed, hasValue, frame.value);
    const live = liveSettings.filter((entry) => entry.matches(frame.key));
    let handled = live.length > 0;
    for (const entry of live) {
        try {
            if (entry.apply(frame.key, frame.value, removed) === false) {
                handled = false;
            }
        } catch {
            handled = false;
        }
    }
    if (!handled) {
        promptReload();
    }
}

/**
 * @param {string} raw A raw stream message
 * @returns {boolean} Whether it was a config-change frame (and was handled)
 */
export function tapConfigFrame(raw) {
    let frame;
    try {
        frame = JSON.parse(raw);
    } catch {
        return false;
    }
    if (frame?.type !== CONFIG_CHANGED_TYPE) {
        return false;
    }
    handleConfigFrame(frame);
    return true;
}
