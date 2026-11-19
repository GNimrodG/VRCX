/**
 * Fork-only. The temporary "auto-accept invite requests from these friends"
 * list.
 *
 * It is never written to `configRepository`, so it is not a saved setting and
 * is not shared between devices or with the server. It survives an app
 * restart (a manual relaunch, a self-update) but not a system restart, and
 * has to be turned on again by hand after that: a normal persisted switch
 * would keep inviting people long after you forgot about it.
 *
 * - Desktop client: kept by the main process in a file tied to the system's boot time
 *   (`src-electron/tempAutoAcceptStore.js`).
 * - Web client: kept in `sessionStorage`, so it survives a reload but not closing the tab; a page cannot tell when the
 *   system was last restarted.
 *
 * The headless server runs this same file but never has the list turned on,
 * so only the app you enabled it in answers the requests.
 */
import { ref, watch } from 'vue';

const STORAGE_KEY = 'VRCX_tempAutoAccept';

export const tempAutoAcceptEnabled = ref(false);
export const tempAutoAcceptUserIds = ref(/** @type {string[]} */ ([]));

/**
 * @param {unknown} value
 * @returns {{ enabled: boolean; userIds: string[] }}
 */
function normalize(value) {
    const v = /** @type {any} */ (value);
    const userIds = Array.isArray(v?.userIds)
        ? [...new Set(v.userIds.filter((id) => typeof id === 'string' && id.length > 0))]
        : [];
    return { enabled: v?.enabled === true && userIds.length > 0, userIds };
}

/**
 * @param {unknown} userId
 * @returns {boolean} Whether a request from this user should be auto-accepted
 */
export function isTempAutoAcceptSender(userId) {
    return tempAutoAcceptEnabled.value && typeof userId === 'string' && tempAutoAcceptUserIds.value.includes(userId);
}

/**
 * @param {boolean} enabled
 */
export function setTempAutoAcceptEnabled(enabled) {
    tempAutoAcceptEnabled.value = enabled === true;
}

/**
 * @param {unknown} userIds Anything that is not a non-empty string is dropped
 */
export function setTempAutoAcceptUserIds(userIds) {
    tempAutoAcceptUserIds.value = normalize({ userIds }).userIds;
}

/**
 * Loads the saved list into the refs. Called once when the app starts; an
 * unreadable or missing save leaves the list as it is.
 *
 * @returns {Promise<void>}
 */
export async function restoreTempAutoAccept() {
    try {
        const electron = window.electron;
        const saved = electron?.getTempAutoAccept
            ? await electron.getTempAutoAccept()
            : JSON.parse(window.sessionStorage?.getItem(STORAGE_KEY) ?? 'null');
        if (saved === null || saved === undefined) {
            return;
        }
        const state = normalize(saved);
        tempAutoAcceptUserIds.value = state.userIds;
        tempAutoAcceptEnabled.value = state.enabled;
    } catch (err) {
        console.error('Failed to restore the temporary auto-accept list', err);
    }
}

function persist() {
    const state = { enabled: tempAutoAcceptEnabled.value, userIds: tempAutoAcceptUserIds.value };
    try {
        const electron = window.electron;
        if (electron?.setTempAutoAccept) {
            electron.setTempAutoAccept(state).catch((err) => console.error(err));
        } else {
            window.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
        }
    } catch (err) {
        console.error('Failed to save the temporary auto-accept list', err);
    }
}

if (typeof window !== 'undefined') {
    restoreTempAutoAccept();
    watch([tempAutoAcceptEnabled, tempAutoAcceptUserIds], persist);
}
