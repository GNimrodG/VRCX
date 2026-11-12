/**
 * Startup session refresh that tolerates a network that is not up yet.
 *
 * An autostart launch can run before DNS/Wi-Fi is ready. Treating that like a
 * rejected token sent a perfectly valid session to the setup screen, so the
 * app never logged in on boot. Only "unreachable" outcomes are retried; a
 * server that answered and refused the token ends the loop at once.
 *
 * Kept free of Electron imports so it can be unit-tested.
 */

/** Waits between attempts, in ms: about 50 s of patience in total. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 20000];

/**
 * @param {number} status An HTTP status from the refresh call
 * @returns {boolean} Whether the server (or a proxy in front of it) is just not ready
 */
function isTransientStatus(status) {
    return status === 502 || status === 503 || status === 504;
}

/**
 * @param {() => Promise<'ok' | 'rejected' | 'unreachable'>} attempt
 * @param {{ delays?: number[]; sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<boolean>} Whether the session was refreshed
 */
async function refreshWithRetry(
    attempt,
    { delays = RETRY_DELAYS_MS, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}
) {
    for (let i = 0; ; i++) {
        const outcome = await attempt();
        if (outcome === 'ok') {
            return true;
        }
        if (outcome === 'rejected' || i >= delays.length) {
            return false;
        }
        await sleep(delays[i]);
    }
}

module.exports = { refreshWithRetry, isTransientStatus, RETRY_DELAYS_MS };
