/**
 * Client-side replacement for `src/services/database/index.js` (phase 5),
 * aliased in for the Electron/Linux build. Same reasoning and shape as
 * `client-web/shims/database.js` — the real module's ~190 methods all
 * bottom out in `src/services/sqlite.js`, which needs a native
 * `window.SQLite` binding no split client (web or desktop) installs
 * anymore — only the RPC transport differs (`./agent-rpc.js`, routed
 * through the main process rather than `fetch` directly).
 */
import { rpcCall } from './agent-rpc.js';

/**
 * Found live (2026-08-17): the server is the sole owner of `VRCX.sqlite3`
 * (§1's ownership table), but this client still runs the real, unmodified
 * `handlePipeline` (`src/services/websocket.js`) against the frames relayed
 * from the server's own `/api/stream` (`client-desktop/shims/pipeline-relay.js`)
 * — and the server's own copy of the store graph is *also* independently
 * running the exact same `handlePipeline` against its real, direct pipeline
 * connection. Any DB write that's a pure side effect of pipeline processing
 * (never reachable from a direct user action) therefore fires twice: once on
 * the server, once here, each computing its own timestamp — confirmed live
 * as genuine duplicate rows a few dozen milliseconds apart in
 * `..._feed_online_offline` (`friendPresenceCoordinator.js`'s
 * `runUpdateFriendDelayedCheckFlow`, the only two call sites of
 * `addOnlineOfflineToDatabase` in `src/**`, both inside that pipeline-only
 * flow — never called from a view/component).
 *
 * Scoped to just this one method deliberately: several other similarly-
 * shaped writes (`addFriendLogHistory`, `setFriendLogCurrent`) turned out to
 * *also* have real call sites from direct user actions
 * (`src/components/dialogs/UserDialog/useUserDialogCommands.js`), so a
 * blanket "pipeline writes are client no-ops" rule would silently break
 * those. Add a name here only after confirming (like this one) that *every*
 * call site is unreachable except through pipeline processing.
 */
// Emptied (2026-10-05 upstream sync): upstream's feed/gameLog writes now return the
// persisted row (with its rowId) and the coordinators feed that into the live
// feed store, so even `addOnlineOfflineToDatabase` must really round-trip to
// the server -- a client no-op would never show online/offline entries until a
// reload. Duplicate writes are absorbed by server/src/feed-dedup.js, which now
// returns the already-persisted row instead of undefined. Kept as an (empty)
// allowlist so a future genuinely pipeline-only write has somewhere to go.
const pipelineOnlyWrites = new Set();

// The server's feed-dedup hands back the already-persisted row on a duplicate
// write (so whichever of server/clients wrote second still gets a rowId), but
// upstream's coordinators push every returned row into the live feed store. If
// this client runs the same flow more than once for one real event (found
// live, 2026-11-04: a friend's "Online" shown many times until restart, with a
// single row in the DB), each repeat would add another UI entry for the same
// row. Return each rowId to a caller once per client; repeats become undefined,
// exactly what a duplicate write returned before the 2026-10-05 sync.
const feedWrites = new Set([
    'addGPSToDatabase',
    'addStatusToDatabase',
    'addAvatarToDatabase',
    'addBioToDatabase',
    'addOnlineOfflineToDatabase'
]);
const seenFeedRows = new Set();
const SEEN_FEED_ROWS_MAX = 500;

function onceForRow(method, promise) {
    return promise.then((row) => {
        if (!row?.rowId) return row;
        const key = `${method}:${row.rowId}`;
        if (seenFeedRows.has(key)) return undefined;
        seenFeedRows.add(key);
        if (seenFeedRows.size > SEEN_FEED_ROWS_MAX) {
            seenFeedRows.delete(seenFeedRows.values().next().value);
        }
        return row;
    });
}

export const dbVars = {
    userId: '',
    userPrefix: '',
    maxTableSize: 500,
    searchTableSize: 5000
};

const localOverrides = {
    setMaxTableSize(limit) {
        dbVars.maxTableSize = limit;
        rpcCall('db', 'setMaxTableSize', [limit]).catch((err) =>
            console.error('setMaxTableSize RPC failed', err)
        );
    },
    setSearchTableSize(limit) {
        dbVars.searchTableSize = limit;
        rpcCall('db', 'setSearchTableSize', [limit]).catch((err) =>
            console.error('setSearchTableSize RPC failed', err)
        );
    }
};

export const database = new Proxy(localOverrides, {
    get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop in target) return target[prop];
        if (pipelineOnlyWrites.has(prop)) return () => {};
        if (feedWrites.has(prop)) {
            return (...args) => onceForRow(prop, rpcCall('db', prop, args));
        }
        return (...args) => rpcCall('db', prop, args);
    }
});
