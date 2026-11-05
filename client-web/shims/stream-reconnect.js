/**
 * Keeps retrying the `/api/stream` connection until it is back.
 *
 * Upstream's `src/services/websocket.js` makes exactly one reconnect attempt,
 * 5 s after a close: it calls `initWebsocket()`, whose first step is an RPC to
 * the server, and if the server is still down (a restart can take a while) the
 * failure is only logged. In the stock app `updateLoop` covers for that; the
 * client shims replace it, so nothing did. The peer here is our own server,
 * not VRChat, so retrying persistently costs nothing and is rate-limit-free.
 *
 * `initWebsocket()` is idempotent (a no-op while a socket exists), so racing
 * upstream's own 5 s attempt is harmless. The loop stops once a socket opens,
 * or when the user is no longer logged in with friends loaded, since
 * login itself starts the socket.
 */
import { initWebsocket } from '../../src/services/websocket.js';
import { watchState } from '../../src/services/watchState.js';

const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 10000;

/**
 * @param {{
 *   reconnect?: () => unknown,
 *   shouldRetry?: () => boolean,
 *   schedule?: typeof setTimeout,
 *   cancel?: typeof clearTimeout
 * }} [deps]
 */
export function createStreamReconnector({
    reconnect = initWebsocket,
    shouldRetry = () => watchState.isLoggedIn && watchState.isFriendsLoaded,
    schedule = setTimeout,
    cancel = clearTimeout
} = {}) {
    let timer = null;
    let delay = MIN_DELAY_MS;
    let open = false;

    function stop() {
        if (timer !== null) {
            cancel(timer);
            timer = null;
        }
    }

    function arm() {
        stop();
        timer = schedule(attempt, delay);
        delay = Math.min(delay * 2, MAX_DELAY_MS);
    }

    async function attempt() {
        timer = null;
        if (open || !shouldRetry()) {
            return;
        }
        try {
            await reconnect();
        } catch {
            // initWebsocket logs its own failures
        }
        if (!open) {
            arm();
        }
    }

    return {
        /** The stream socket opened. */
        onOpen() {
            open = true;
            delay = MIN_DELAY_MS;
            stop();
        },
        /** The stream socket closed, for any reason. */
        onClose() {
            open = false;
            arm();
        },
        /** The browser regained connectivity: try now instead of waiting. */
        retryNow() {
            if (!open && timer !== null) {
                stop();
                void attempt();
            }
        }
    };
}
