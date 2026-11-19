/**
 * Fork-only. Keeps the temporary "auto-accept invite requests from these
 * friends" list (`src/shared/utils/tempAutoAccept.js`) across an app restart
 * (manual relaunch, self-update) but not across a system restart.
 *
 * The list is saved with the time the system booted, estimated from
 * `os.uptime()`. A later load only trusts it when the boot time is the same
 * (within a tolerance, since the estimate jitters by a few seconds), so a
 * reboot makes it start off again with no clock or timestamp bookkeeping.
 * On Windows, Fast Startup keeps the kernel (and its uptime) alive across a
 * shutdown, so the main process also calls `clear()` on the window's
 * `session-end` event, which Windows sends at log-off and shutdown.
 *
 * Kept free of Electron imports so it can be unit-tested.
 */

const BOOT_TIME_TOLERANCE_MS = 2 * 60 * 1000;

/** @typedef {{ enabled: boolean; userIds: string[] }} TempAutoAcceptState */

/**
 * @param {unknown} value
 * @returns {TempAutoAcceptState}
 */
function normalizeState(value) {
    const v = /** @type {any} */ (value);
    const userIds = Array.isArray(v?.userIds)
        ? [...new Set(v.userIds.filter((id) => typeof id === 'string' && id.length > 0))]
        : [];
    return { enabled: v?.enabled === true && userIds.length > 0, userIds };
}

/**
 * @param {{
 *     filePath: string;
 *     fs: Pick<typeof import('fs'), 'readFileSync' | 'writeFileSync' | 'rmSync'>;
 *     os: Pick<typeof import('os'), 'uptime'>;
 *     now?: () => number;
 * }} deps
 */
function createTempAutoAcceptStore({ filePath, fs, os, now = Date.now }) {
    const bootTime = () => now() - os.uptime() * 1000;

    return {
        /** @returns {TempAutoAcceptState} The saved state, or the off state after a reboot or on any error */
        load() {
            try {
                const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (
                    typeof saved?.bootTime !== 'number' ||
                    Math.abs(saved.bootTime - bootTime()) > BOOT_TIME_TOLERANCE_MS
                ) {
                    this.clear();
                    return { enabled: false, userIds: [] };
                }
                return normalizeState(saved);
            } catch {
                return { enabled: false, userIds: [] };
            }
        },
        /**
         * @param {unknown} state
         * @returns {TempAutoAcceptState}
         */
        save(state) {
            const normalized = normalizeState(state);
            fs.writeFileSync(filePath, JSON.stringify({ bootTime: bootTime(), ...normalized }));
            return normalized;
        },
        clear() {
            try {
                fs.rmSync(filePath, { force: true });
            } catch {
                // Nothing useful to do: the next boot-time check still rejects it.
            }
        }
    };
}

module.exports = { createTempAutoAcceptStore, BOOT_TIME_TOLERANCE_MS };
